import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Everything the harness writes (stack workdir, screenshots, reports) lives outside Git. */
export function workdir() {
  const dir = process.env.CRM_PARITY_WORKDIR ?? join(tmpdir(), "jewelos-crm-parity");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function run(command, args, { timeoutMs = 120_000, allowFailure = false, input, cwd = REPO_ROOT, env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    input,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: "utf8",
    timeout: timeoutMs,
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    maxBuffer: 256 * 1024 * 1024,
  });
  if (!allowFailure && (result.status !== 0 || result.error)) {
    const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().split("\n").slice(-30).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.error?.message})\n${detail}`);
  }
  return result;
}

/** Runs SQL in a local Supabase database container (psql inside the container; no host client). */
export function psql(container, sql, { user = "postgres", timeoutMs = 300_000 } = {}) {
  const result = run("docker", ["exec", "-i", container, "psql", "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-A", "-t"], { input: sql, timeoutMs });
  return result.stdout.trim();
}

/** Streams COPY output from one container's database into another's (no data touches disk). */
export function copyBetween(source, sourceSql, target, targetSql) {
  return new Promise((resolvePromise, reject) => {
    const reader = spawn("docker", ["exec", "-i", source, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-c", sourceSql]);
    const writer = spawn("docker", ["exec", "-i", target, "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"]);
    let errors = "";
    reader.stderr.on("data", (chunk) => { errors += chunk; });
    writer.stderr.on("data", (chunk) => { errors += chunk; });
    writer.stdin.write(`${targetSql}\n`);
    reader.stdout.pipe(writer.stdin);
    let pending = 2;
    const done = (code) => {
      if (code !== 0) errors += `\nexit ${code}`;
      if (--pending === 0) (errors.includes("ERROR") || errors.includes("exit") ? reject(new Error(errors)) : resolvePromise());
    };
    reader.on("close", done);
    writer.on("close", done);
  });
}

export async function waitForUrl(url, { timeoutMs = 180_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch { /* not listening yet */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export function startServer(command, args, { cwd, env, logFile }) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const lines = [];
  const keep = (chunk) => { lines.push(String(chunk)); if (lines.length > 400) lines.shift(); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.logTail = () => lines.join("").split("\n").slice(-40).join("\n");
  child.logFile = logFile;
  return child;
}

export function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}
