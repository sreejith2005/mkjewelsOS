// Non-CRM regression check for the CRM port: JewelOS routes rendered by a "before" checkout
// (e.g. a detached worktree of main) and by this checkout, same local stack, same user, compared
// pixel by pixel. It also opens /crm first and navigates client-side to each route, to prove the
// CRM stylesheet is detached and nothing of it leaks into JewelOS.
//
//   node scripts/crm-parity/regression.mjs <before-checkout-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

import { comparePngs } from "./compare.mjs";
import { PARITY_PASSWORD, PARITY_USERS } from "./load-jewelos.mjs";
import { jewelosSession, localStackKeys } from "./sessions.mjs";
import { REPO_ROOT, startServer, stopServer, waitForUrl, workdir } from "./util.mjs";

const beforeDir = process.argv[2];
if (!beforeDir) throw new Error("usage: node scripts/crm-parity/regression.mjs <before-checkout-dir>");
const ROUTES = [["home", "/"], ["tasks", "/tasks"], ["fms", "/fms"], ["forms", "/forms"], ["notifications", "/notifications"]];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const keys = localStackKeys();
const env = { VITE_SUPABASE_URL: keys.url, VITE_SUPABASE_ANON_KEY: keys.anonKey };
const servers = [
  startServer("pnpm.cmd", ["--filter", "web", "exec", "vite", "--port", "5181", "--strictPort", "--host", "localhost"], { cwd: beforeDir, env }),
  startServer("pnpm.cmd", ["--filter", "web", "exec", "vite", "--port", "5182", "--strictPort", "--host", "localhost"], { cwd: REPO_ROOT, env }),
];

async function ready(page) {
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
}

try {
  await waitForUrl("http://localhost:5181");
  await waitForUrl("http://localhost:5182");
  const dir = join(workdir(), `regression-${new Date().toISOString().replaceAll(":", "").replace(/\..+/, "")}`);
  mkdirSync(dir, { recursive: true });
  const user = PARITY_USERS.find((candidate) => candidate.key === "super_admin");
  const browser = await chromium.launch();
  const results = [];
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    const session = await jewelosSession(keys, user.email, PARITY_PASSWORD);
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    await context.addInitScript(([key, value]) => { window.localStorage.setItem(key, value); }, [session.storageKey, session.value]);
    const page = await context.newPage();
    for (const [name, path] of ROUTES) {
      const shots = {};
      for (const [label, origin] of [["before", "http://localhost:5181"], ["after", "http://localhost:5182"]]) {
        await page.goto(`${origin}${path}`);
        await ready(page);
        shots[label] = join(dir, `${viewportName}--${name}--${label}.png`);
        await page.screenshot({ path: shots[label], fullPage: true, animations: "disabled", caret: "hide" });
      }
      // After visiting the CRM, a client-side return to the route must look the same and carry
      // no CRM stylesheet or CRM root.
      await page.goto("http://localhost:5182/crm/dashboard");
      await ready(page);
      const crmStyleWhileMounted = await page.evaluate(() => document.querySelectorAll("style[data-crm-ui]").length);
      await page.evaluate((target) => { window.history.pushState({}, "", target); window.dispatchEvent(new PopStateEvent("popstate")); }, path);
      await ready(page);
      const leftovers = await page.evaluate(() => ({ styles: document.querySelectorAll("style[data-crm-ui]").length, root: Boolean(document.getElementById("crm-root")) }));
      shots.afterCrm = join(dir, `${viewportName}--${name}--after-crm.png`);
      await page.screenshot({ path: shots.afterCrm, fullPage: true, animations: "disabled", caret: "hide" });
      const beforeVsAfter = comparePngs(shots.before, shots.after, join(dir, `${viewportName}--${name}--diff.png`), []);
      const afterVsAfterCrm = comparePngs(shots.after, shots.afterCrm, join(dir, `${viewportName}--${name}--diff-after-crm.png`), []);
      const result = { viewport: viewportName, route: path, beforeVsAfter, afterVsAfterCrm, crmStyleWhileMounted, leftovers };
      results.push(result);
      console.log(`${viewportName} ${path}: before/after ${beforeVsAfter.diffPercent}% (${beforeVsAfter.originalSize} vs ${beforeVsAfter.portSize}); after /crm ${afterVsAfterCrm.diffPercent}%; CRM style while mounted ${crmStyleWhileMounted}, after leaving ${leftovers.styles}, CRM root after leaving ${leftovers.root}`);
    }
    await context.close();
  }
  await browser.close();
  writeFileSync(join(dir, "regression.json"), JSON.stringify(results, null, 2));
  console.log(`report: ${join(dir, "regression.json")}`);
} finally {
  servers.forEach(stopServer);
}
