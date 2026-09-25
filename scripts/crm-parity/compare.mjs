// Visible text, form controls and pixels for one state in one app, and the comparison of the
// original's capture with the port's.
import { readFileSync, writeFileSync } from "node:fs";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

// Runs in the page. The original is the whole document body (Next renders nothing else
// visible; its dev overlay lives in a shadow root). The port is the CRM root element, without
// the one JewelOS addition (the "← JewelOS" link, marked data-crm-port).
export function pageTextDump(app) {
  const root = app === "port" ? document.getElementById("crm-root") : document.body;
  if (!root) return "<no root>";
  const additions = [...document.querySelectorAll("[data-crm-port]")];
  const saved = additions.map((element) => element.style.display);
  additions.forEach((element) => { element.style.display = "none"; });
  const text = root.innerText;
  additions.forEach((element, index) => { element.style.display = saved[index]; });
  return text.split("\n").map((line) => line.replace(/\s+$/, "")).filter((line, index, lines) => !(line === "" && lines[index - 1] === "")).join("\n").trim();
}

export function pageControlsDump(app) {
  const root = app === "port" ? document.getElementById("crm-root") : document.body;
  if (!root) return [];
  return [...root.querySelectorAll("input, select, textarea")]
    // Next renders a hidden $ACTION_ID input for a server-action form (framework plumbing).
    .filter((element) => !element.closest("[data-crm-port]") && !(element.type === "hidden" && (element.name ?? "").startsWith("$ACTION")))
    .map((element) => [
      element.tagName.toLowerCase(),
      element.getAttribute("type") ?? "",
      element.getAttribute("aria-label") ?? element.getAttribute("name") ?? element.getAttribute("placeholder") ?? "",
      element.type === "file" ? "" : element.type === "datetime-local" ? "<now>" : element.value,
      element.checked ? "checked" : "",
      element.disabled ? "disabled" : "",
      element.tagName === "SELECT" ? [...element.options].map((option) => `${option.value}=${option.textContent}`).join("|") : "",
    ].join(" ¦ "));
}

// The JewelOS link and the live "now" of the visit form are masked in both screenshots.
export function pageMaskRects() {
  return [...document.querySelectorAll('[data-crm-port], input[type="datetime-local"]')]
    .map((element) => { const rect = element.getBoundingClientRect(); return { x: Math.floor(rect.x + window.scrollX), y: Math.floor(rect.y + window.scrollY), w: Math.ceil(rect.width) + 1, h: Math.ceil(rect.height) + 1 }; })
    .filter((rect) => rect.w > 1 && rect.h > 1);
}

function padded(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  out.data.fill(0);
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 255; out.data[i + 2] = 255; out.data[i + 3] = 255; }
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
  return out;
}

function paintMasks(png, rects) {
  for (const rect of rects) {
    for (let y = Math.max(0, rect.y); y < Math.min(png.height, rect.y + rect.h); y++) {
      for (let x = Math.max(0, rect.x); x < Math.min(png.width, rect.x + rect.w); x++) {
        const index = (y * png.width + x) * 4;
        png.data[index] = 0; png.data[index + 1] = 0; png.data[index + 2] = 0; png.data[index + 3] = 255;
      }
    }
  }
}

export function comparePngs(originalPath, portPath, diffPath, rects) {
  const original = PNG.sync.read(readFileSync(originalPath));
  const port = PNG.sync.read(readFileSync(portPath));
  const width = Math.max(original.width, port.width);
  const height = Math.max(original.height, port.height);
  const a = padded(original, width, height);
  const b = padded(port, width, height);
  paintMasks(a, rects);
  paintMasks(b, rects);
  const diff = new PNG({ width, height });
  const differing = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1 });
  writeFileSync(diffPath, PNG.sync.write(diff));
  return {
    diffPercent: Number(((differing / (width * height)) * 100).toFixed(4)),
    originalSize: `${original.width}x${original.height}`,
    portSize: `${port.width}x${port.height}`,
  };
}

export function firstDifference(left, right) {
  const a = left.split("\n");
  const b = right.split("\n");
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] !== b[index]) return { line: index + 1, original: a[index] ?? "<end>", port: b[index] ?? "<end>" };
  }
  return null;
}
