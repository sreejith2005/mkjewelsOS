// CRM parity harness: the ORIGINAL CRM (sreejith-crm/web-app, `next dev`, original schema in a
// throwaway local stack) versus the JewelOS port (/crm in the JewelOS web app, schema crm),
// on the same synthetic fixture, captured route by route and state by state.
//
//   pnpm.cmd crm:parity                       full run (fresh original stack + fixture)
//   pnpm.cmd crm:parity -- --reuse            reuse the running stack and loaded fixture
//   pnpm.cmd crm:parity -- --states=dashboard,clients --roles=salesperson --viewports=desktop
//   pnpm.cmd crm:parity -- --ingest           server routes only: /api/ingest/walkin and the Runo push
//                                             (original route vs. the Edge Functions), see ingest.mjs
//
// Output (outside Git): <workdir>/run-<timestamp>/{original,port,diff}/*.png, *.txt, report.json,
// report.md. Workdir: CRM_PARITY_WORKDIR or <tmp>/jewelos-crm-parity. Local only; no hosted calls.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

import { comparePngs, firstDifference, pageControlsDump, pageMaskRects, pageTextDump } from "./compare.mjs";
import { copyFixtureToJewelos, createJewelosIdentity, fixtureIds, JEWELOS_DB_CONTAINER, PARITY_PASSWORD, PARITY_USERS } from "./load-jewelos.mjs";
import { isolatedJewelos, prepareJewelosStack, startJewelosStack } from "./jewelos-stack.mjs";
import { ORIGINAL_DB_CONTAINER, prepareOriginalStack, startOriginalStack } from "./original-stack.mjs";
import { jewelosSession, localStackKeys, originalSessionCookies } from "./sessions.mjs";
import { statesFor } from "./states.mjs";
import { psql, REPO_ROOT, startServer, stopServer, waitForUrl, workdir } from "./util.mjs";
import { compareWorkflowRows, runWorkflow, WORKFLOW_PHONE } from "./workflow.mjs";

const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith("--")).map((arg) => {
  const [key, value] = arg.slice(2).split("=");
  return [key, value ?? "true"];
}));
const ORIGINAL_ORIGIN = "http://localhost:3300";
const PORT_ORIGIN = "http://localhost:5180";
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const PIXEL_LIMIT = 0.5;
const list = (value) => (value ? value.split(",").filter(Boolean) : null);

/** Resolves once no request has started or finished for `quietMs` (debounced lookups included). */
async function waitQuiet(page, quietMs = 1_000, limitMs = 60_000) {
  let last = Date.now();
  const bump = () => { last = Date.now(); };
  const events = ["request", "requestfinished", "requestfailed"];
  events.forEach((event) => page.on(event, bump));
  const started = Date.now();
  try {
    while (Date.now() - last < quietMs && Date.now() - started < limitMs) await page.waitForTimeout(100);
  } finally {
    events.forEach((event) => page.off(event, bump));
  }
}

// Both apps must have their CRM stylesheet attached (Next dev can paint before its CSS link
// loads), fonts ready, the page rendered, and the network quiet before a capture.
async function settle(page) {
  await page.waitForLoadState("load");
  await waitQuiet(page);
  await page.waitForFunction(() => {
    const root = document.getElementById("crm-root") ?? document.body;
    const rendered = Boolean(root.querySelector("main, .next-error-h1"));
    const styled = [...document.styleSheets].some((sheet) => {
      try { return [...sheet.cssRules].some((rule) => (rule.selectorText ?? "").includes("crm-topbar")); } catch { return false; }
    });
    return rendered && styled;
  }, null, { timeout: 90_000 });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await waitQuiet(page);
}

async function capture(page, app, origin, state, runDir, key) {
  const response = await page.goto(`${origin}/crm${state.path === "/" ? "" : state.path}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await settle(page);
  if (state.act) {
    await state.act(page);
    await waitQuiet(page);
  }
  const url = new URL(page.url());
  const text = await page.evaluate(pageTextDump, app);
  const controls = await page.evaluate(pageControlsDump, app);
  const masks = await page.evaluate(pageMaskRects);
  const png = join(runDir, app, `${key}.png`);
  await page.screenshot({ path: png, fullPage: true, animations: "disabled", caret: "hide" });
  writeFileSync(join(runDir, app, `${key}.txt`), `${text}\n\n--- controls ---\n${controls.join("\n")}\n`);
  return { status: response?.status() ?? null, path: `${url.pathname}${url.search}`, text, controls, masks, png };
}

async function workflowCheck(browser, originalKeys, jewelosKeys) {
  const existing = Number(psql(ORIGINAL_DB_CONTAINER, `select count(*) from public.clients where primary_phone = '${WORKFLOW_PHONE}';`))
    + Number(psql(JEWELOS_DB_CONTAINER, `select count(*) from crm.clients where primary_phone = '${WORKFLOW_PHONE}';`));
  if (existing) return { error: "the workflow client already exists; run the workflow on a fresh fixture (without --reuse)" };
  const user = PARITY_USERS.find((candidate) => candidate.key === "salesperson");
  const startedAt = new Date().toISOString();
  const outcome = {};
  for (const app of ["original", "port"]) {
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop, deviceScaleFactor: 1, bypassCSP: app === "original" });
    if (app === "original") {
      await context.addCookies(await originalSessionCookies(originalKeys, user.email, PARITY_PASSWORD, "localhost"));
    } else {
      const session = await jewelosSession(jewelosKeys, user.email, PARITY_PASSWORD);
      await context.addInitScript(([key, value]) => { window.localStorage.setItem(key, value); }, [session.storageKey, session.value]);
    }
    const page = await context.newPage();
    try {
      await runWorkflow(page, app === "original" ? ORIGINAL_ORIGIN : PORT_ORIGIN);
      outcome[app] = "completed";
    } catch (error) {
      outcome[app] = `failed: ${String(error?.message ?? error).split("\n").slice(0, 4).join(" ")}`;
      await page.screenshot({ path: join(workdir(), `workflow-${app}-failure.png`), fullPage: true }).catch(() => undefined);
    }
    await context.close();
  }
  if (outcome.original !== "completed" || outcome.port !== "completed") return { error: "workflow did not complete in both apps", outcome };
  return { outcome, ...compareWorkflowRows(startedAt) };
}

async function main() {
  const base = workdir();
  const stackDir = join(base, "original");
  const jewelosDir = join(base, "port");
  if (args.reuse !== "true") {
    const migrations = prepareOriginalStack(stackDir);
    console.log(`original stack: ${migrations} original migrations`);
    await startOriginalStack(stackDir, migrations);
    if (isolatedJewelos()) {
      prepareJewelosStack(jewelosDir);
      await startJewelosStack(jewelosDir);
      console.log("JewelOS port stack: isolated throwaway stack (jewelos-crm-parity-port)");
    }
    psql(ORIGINAL_DB_CONTAINER, (await import("node:fs")).readFileSync(join(REPO_ROOT, "scripts", "crm-parity", "fixture.sql"), "utf8"));
    const copied = await copyFixtureToJewelos();
    createJewelosIdentity();
    console.log(`fixture copied to JewelOS crm (${copied.tables} tables): ${copied.counts}`);
  } else if (args["reload-jewelos"] === "true") {
    // The original stack keeps its fixture; only the local JewelOS copy is rebuilt (for example
    // after another `supabase db reset` of the shared local JewelOS database).
    const copied = await copyFixtureToJewelos();
    createJewelosIdentity();
    console.log(`fixture re-copied to JewelOS crm (${copied.tables} tables)`);
  }
  const ids = fixtureIds();
  const originalKeys = localStackKeys(stackDir);
  const jewelosKeys = localStackKeys(isolatedJewelos() ? jewelosDir : undefined);

  if (args.ingest === "true") {
    const { runIngestParity } = await import("./ingest.mjs");
    let payload = null;
    const ok = await runIngestParity({ originalKeys, jewelosKeys, base, jewelosWorkdir: isolatedJewelos() ? jewelosDir : undefined, report: (data) => { payload = data; } });
    const stamp = new Date().toISOString().replaceAll(":", "").replace(/\..+/, "");
    const runDir = join(base, `ingest-${stamp}`);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "report.json"), JSON.stringify(payload, null, 2));
    const yes = (value) => (value ? "yes" : "NO");
    const rows = (payload?.results ?? []).map((r) => `| ${r.id} | ${r.status.original} / ${r.status.port} | ${yes(r.status.identical)} | ${yes(r.json.identical)} | ${r.outbound ? yes(r.outbound.identical) : "-"} | ${r.uiMessage ? yes(r.uiMessage.identical) : "-"} | ${yes(r.rows.identical)} |`);
    const lines = [
      `# CRM server-route parity ${stamp}`, "",
      "| Case | Status (original / port) | Status same | JSON same | Runo request same | UI message same | Rows same |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...rows, "",
      `JewelOS ingest audit rows free of customer values: ${yes(payload?.auditHasNoCustomerValues)}`, "",
      `Original without a session: ${JSON.stringify(payload?.originalProxyFinding)}`, "",
    ];
    writeFileSync(join(runDir, "report.md"), lines.join("\n"));
    console.log(`Report: ${join(runDir, "report.md")}`);
    process.exitCode = ok ? 0 : 1;
    return;
  }

  const servers = [];
  try {
    if (args["no-servers"] !== "true") {
      servers.push(startServer("node", ["node_modules/next/dist/bin/next", "dev", "--port", "3300"], {
        cwd: join(REPO_ROOT, "sreejith-crm", "web-app"),
        env: { NEXT_PUBLIC_SUPABASE_URL: originalKeys.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: originalKeys.anonKey, NEXT_TELEMETRY_DISABLED: "1" },
      }));
      servers.push(startServer("pnpm.cmd", ["--filter", "web", "exec", "vite", "--port", "5180", "--strictPort", "--host", "localhost"], {
        cwd: REPO_ROOT,
        env: { VITE_SUPABASE_URL: jewelosKeys.url, VITE_SUPABASE_ANON_KEY: jewelosKeys.anonKey },
      }));
    }
    try {
      await waitForUrl(`${ORIGINAL_ORIGIN}/crm/login`);
      await waitForUrl(PORT_ORIGIN);
    } catch (error) {
      for (const server of servers) console.error(`--- server log ---\n${server.logTail()}`);
      throw error;
    }

    const stamp = new Date().toISOString().replaceAll(":", "").replace(/\..+/, "");
    const runDir = join(base, `run-${stamp}`);
    for (const dir of ["original", "port", "diff"]) mkdirSync(join(runDir, dir), { recursive: true });
    const browser = await chromium.launch();
    const results = [];
    let workflow = null;
    const roles = list(args.roles) ?? ["salesperson", "branch_manager", "super_admin"];
    const viewports = list(args.viewports) ?? ["desktop", "phone"];
    const onlyStates = list(args.states);
    try {
      for (const viewportName of viewports) {
        for (const role of roles) {
          const user = PARITY_USERS.find((candidate) => candidate.key === role);
          // The original's CSP allows browser Supabase calls only to https://*.supabase.co (its
          // hosted project); locally the CSP is bypassed so they reach the local original stack.
          const originalContext = await browser.newContext({ viewport: VIEWPORTS[viewportName], deviceScaleFactor: 1, bypassCSP: true });
          await originalContext.addCookies(await originalSessionCookies(originalKeys, user.email, PARITY_PASSWORD, "localhost"));
          // Next's dev-only indicator is tooling, not the app.
          await originalContext.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { const style = document.createElement("style"); style.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(style); }); });
          const portContext = await browser.newContext({ viewport: VIEWPORTS[viewportName], deviceScaleFactor: 1 });
          const session = await jewelosSession(jewelosKeys, user.email, PARITY_PASSWORD);
          await portContext.addInitScript(([key, value]) => { window.localStorage.setItem(key, value); }, [session.storageKey, session.value]);
          const originalPage = await originalContext.newPage();
          const portPage = await portContext.newPage();
          for (const state of statesFor(ids)) {
            if (!state.roles.includes(role) || (onlyStates && !onlyStates.includes(state.id))) continue;
            const key = `${viewportName}--${role}--${state.id}`;
            const result = { key, viewport: viewportName, role, state: state.id, path: state.path };
            try {
              const original = await capture(originalPage, "original", ORIGINAL_ORIGIN, state, runDir, key);
              const port = await capture(portPage, "port", PORT_ORIGIN, state, runDir, key);
              const pixels = comparePngs(original.png, port.png, join(runDir, "diff", `${key}.png`), [...original.masks, ...port.masks]);
              Object.assign(result, {
                finalPath: { original: original.path, port: port.path },
                pathMatch: original.path === port.path,
                textMatch: original.text === port.text,
                controlsMatch: original.controls.join("\n") === port.controls.join("\n"),
                textDifference: firstDifference(original.text, port.text),
                controlsDifference: firstDifference(original.controls.join("\n"), port.controls.join("\n")),
                ...pixels,
                pixelPass: pixels.diffPercent <= PIXEL_LIMIT,
                images: { original: original.png, port: port.png, diff: join(runDir, "diff", `${key}.png`) },
              });
            } catch (error) {
              result.error = String(error?.message ?? error).split("\n").slice(0, 6).join(" ");
            }
            results.push(result);
            const flag = result.error ? "ERROR" : `${result.textMatch && result.controlsMatch ? "text=" : "TEXT≠"} ${result.pixelPass ? "px" : "PX"}=${result.diffPercent}%${result.pathMatch ? "" : " PATH≠"}`;
            console.log(`${key}: ${flag}`);
          }
          await originalContext.close();
          await portContext.close();
        }
      }
      if (args.workflow === "true") workflow = await workflowCheck(browser, originalKeys, jewelosKeys);
    } finally {
      await browser.close();
    }
    writeFileSync(join(runDir, "report.json"), JSON.stringify({ captures: results, workflow }, null, 2));
    const rows = results.map((r) => `| ${r.viewport} | ${r.role} | ${r.state} | ${r.error ? "ERROR" : r.textMatch && r.controlsMatch ? "yes" : "NO"} | ${r.error ? "-" : r.diffPercent} | ${r.error ? r.error : [r.pathMatch ? "" : `path ${r.finalPath.original} vs ${r.finalPath.port}`, r.textDifference ? `text L${r.textDifference.line}` : "", r.controlsDifference ? `controls L${r.controlsDifference.line}` : "", r.pixelPass ? "" : `pixels > ${PIXEL_LIMIT}%`].filter(Boolean).join("; ")} |`);
    const failed = results.filter((r) => r.error || !r.textMatch || !r.controlsMatch || !r.pixelPass || !r.pathMatch);
    const workflowFailed = Boolean(workflow && (workflow.error || Object.values(workflow.tables ?? {}).some((table) => !table.match)
      || !workflow.auditHasNoCustomerValues || !workflow.directWriteAudited || !workflow.rpcWriteNotDoubleAudited
      || !workflow.storageObjects?.original || !workflow.storageObjects?.port));
    const workflowSection = workflow ? `\n## Workflow check\n\n${"```"}json\n${JSON.stringify(workflow, null, 2)}\n${"```"}\n` : "";
    writeFileSync(join(runDir, "report.md"), `# CRM parity run ${stamp}\n\nStates: ${results.length}; failing: ${failed.length}. Pixel limit ${PIXEL_LIMIT}% after masking the JewelOS link and the live visit time.\n\n| Viewport | Role | State | Text + controls match | Pixel diff % | Notes |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n${workflowSection}`);
    console.log(`\n${results.length} captures, ${failed.length} failing. Report: ${join(runDir, "report.md")}`);
    if (workflow) console.log(`workflow: ${workflowFailed ? "FAILED" : "rows identical"}`);
    process.exitCode = failed.length || workflowFailed ? 1 : 0;
  } finally {
    if (args["keep-servers"] !== "true") servers.forEach(stopServer);
  }
}

await main();
