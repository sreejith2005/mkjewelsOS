// Builds src/styles/crm.generated.css from the original CRM stylesheet (src/app/globals.css,
// verbatim) with the original Tailwind version, scoped to the CRM root element.
//
//   node scripts/build-css.mjs          regenerate the stylesheet
//   node scripts/build-css.mjs --check  fail if the committed stylesheet is stale or unscoped
//
// Why each transform exists:
// 1. Tailwind 4 emits native cascade layers (properties, theme, base, components, utilities)
//    and the original's own rules are unlayered. Layered rules always lose to unlayered ones,
//    and the JewelOS Tailwind 3 stylesheet is unlayered, so a layered CRM stylesheet would lose
//    to JewelOS. The layers are flattened in their original order instead, and their
//    precedence is kept with id "tiers": every selector of a later layer carries one more
//    #crm-root (base/theme 1, components 2, utilities 3, the original unlayered rules 4), so a
//    later layer outranks an earlier one whatever the class/type specificity, exactly as native
//    layers do, while specificity still decides inside a layer. (Tailwind's only !important
//    rule, base-layer [hidden], cannot meet an unlayered !important rule in this app.)
// 2. Every selector is scoped to ".crm-root#crm-root..." (html/body/:root/:host become the root
//    itself). JewelOS uses no ids, so every CRM rule outranks every JewelOS rule.
// 3. @property registrations are global and would change JewelOS's own Tailwind variables;
//    they are replaced by the same initial values set on the CRM root and its descendants.
// 4. JewelOS element rules (preflight, base layer) could still set properties the original
//    never sets inside the CRM (checkbox size, focus rings, table density, ...). They are
//    reverted to browser defaults inside the root before any CRM rule applies; the root itself
//    starts from initial values instead of inheriting the JewelOS body. SVG content is left
//    alone so its presentation attributes keep working.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(packageRoot, "src");
const inputPath = join(sourceRoot, "app", "globals.css");
const outputPath = join(sourceRoot, "styles", "crm.generated.css");
const SCOPE = ".crm-root#crm-root";
const LAYER_TIERS = { properties: 1, theme: 1, base: 1, components: 2, utilities: 3 };
const UNLAYERED_TIER = 4;
const tierScope = (tier) => `.crm-root${"#crm-root".repeat(tier)}`;
const ROOT_COMPOUND = /^(?::root|html|body|:host)(?![\w-])/;

// Per-element variables of the JewelOS Tailwind 3 stylesheet ("*, ::before, ::after" and
// "::backdrop"). Those Tailwind 4 does not register are unset inside the CRM.
const TAILWIND3_ELEMENT_VARIABLES = [
  "--tw-border-spacing-x", "--tw-border-spacing-y", "--tw-translate-x", "--tw-translate-y", "--tw-rotate",
  "--tw-skew-x", "--tw-skew-y", "--tw-scale-x", "--tw-scale-y", "--tw-pan-x", "--tw-pan-y", "--tw-pinch-zoom",
  "--tw-scroll-snap-strictness", "--tw-gradient-from-position", "--tw-gradient-via-position",
  "--tw-gradient-to-position", "--tw-ordinal", "--tw-slashed-zero", "--tw-numeric-figure", "--tw-numeric-spacing",
  "--tw-numeric-fraction", "--tw-ring-inset", "--tw-ring-offset-width", "--tw-ring-offset-color", "--tw-ring-color",
  "--tw-ring-offset-shadow", "--tw-ring-shadow", "--tw-shadow", "--tw-shadow-colored", "--tw-blur",
  "--tw-brightness", "--tw-contrast", "--tw-grayscale", "--tw-hue-rotate", "--tw-invert", "--tw-saturate",
  "--tw-sepia", "--tw-drop-shadow", "--tw-backdrop-blur", "--tw-backdrop-brightness", "--tw-backdrop-contrast",
  "--tw-backdrop-grayscale", "--tw-backdrop-hue-rotate", "--tw-backdrop-invert", "--tw-backdrop-opacity",
  "--tw-backdrop-saturate", "--tw-backdrop-sepia", "--tw-contain-size", "--tw-contain-layout",
  "--tw-contain-paint", "--tw-contain-style",
];

function scopeSelector(selector, tier) {
  const scope = tierScope(tier);
  const trimmed = selector.trim();
  if (ROOT_COMPOUND.test(trimmed)) return trimmed.replace(ROOT_COMPOUND, scope);
  return `${scope} ${trimmed}`;
}

/** The tier of each rule, from the outermost @layer it was emitted in (none = unlayered). */
function ruleTiers(root) {
  const tiers = new Map();
  root.walkRules((rule) => {
    let tier = UNLAYERED_TIER;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === "atrule" && parent.name === "layer") {
        const name = parent.params.trim();
        if (!(name in LAYER_TIERS)) throw new Error(`unknown Tailwind layer "${name}"`);
        tier = LAYER_TIERS[name];
      }
    }
    tiers.set(rule, tier);
  });
  return tiers;
}

function insideKeyframes(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "atrule" && /keyframes$/i.test(parent.name)) return true;
  }
  return false;
}

function unwrapLayers(root) {
  let changed = true;
  while (changed) {
    changed = false;
    root.walkAtRules("layer", (atRule) => {
      changed = true;
      if (atRule.nodes && atRule.nodes.length) atRule.replaceWith(atRule.nodes);
      else atRule.remove();
      return false;
    });
  }
}

function scopeStylesheet(root) {
  const registered = [];
  root.walkAtRules("property", (atRule) => {
    let initialValue = "initial";
    let inherits = false;
    atRule.walkDecls((declaration) => {
      if (declaration.prop === "initial-value") initialValue = declaration.value;
      if (declaration.prop === "inherits") inherits = declaration.value.trim() === "true";
    });
    registered.push({ name: atRule.params.trim(), initialValue, inherits });
    atRule.remove();
  });
  const tiers = ruleTiers(root);
  unwrapLayers(root);
  root.walkRules((rule) => {
    if (insideKeyframes(rule) || rule.parent?.type === "rule") return;
    const tier = tiers.get(rule) ?? UNLAYERED_TIER;
    rule.selectors = rule.selectors.map((selector) => scopeSelector(selector, tier));
  });

  const registeredNames = new Set(registered.map((property) => property.name));
  const elementDeclarations = [
    ...registered.filter((property) => !property.inherits).map((property) => `${property.name}:${property.initialValue}`),
    ...TAILWIND3_ELEMENT_VARIABLES.filter((name) => !registeredNames.has(name)).map((name) => `${name}:initial`),
  ];
  const rootDeclarations = registered.filter((property) => property.inherits).map((property) => `${property.name}:${property.initialValue}`);
  const isolation = postcss.parse([
    "/* JewelOS isolation (see scripts/build-css.mjs) */",
    `${SCOPE}{all:initial;display:block;-webkit-font-smoothing:auto;-moz-osx-font-smoothing:auto${rootDeclarations.map((declaration) => `;${declaration}`).join("")}}`,
    `${SCOPE} :where(:not(svg,svg *)),${SCOPE} :where(:not(svg,svg *))::before,${SCOPE} :where(:not(svg,svg *))::after,${SCOPE} ::placeholder,${SCOPE} ::file-selector-button,${SCOPE} ::backdrop{all:revert}`,
    `${SCOPE},${SCOPE} *,${SCOPE} ::before,${SCOPE} ::after,${SCOPE} ::backdrop{${elementDeclarations.join(";")}}`,
  ].join("\n"));

  // @import and @charset must stay first; the isolation rules precede every CRM rule.
  let anchor = null;
  root.each((node) => {
    if (node.type === "atrule" && (node.name === "import" || node.name === "charset")) anchor = node;
  });
  if (anchor) anchor.after(isolation.nodes);
  else root.prepend(isolation.nodes);
  return root;
}

export async function buildCrmCss() {
  const input = readFileSync(inputPath, "utf8");
  const compiled = await postcss([tailwindcss({ base: sourceRoot, optimize: { minify: false } })]).process(input, { from: inputPath });
  const scoped = scopeStylesheet(postcss.parse(compiled.css));
  const header = `/* GENERATED by packages/crm-ui/scripts/build-css.mjs from ${relative(packageRoot, inputPath).replaceAll("\\", "/")} (original CRM globals.css, Tailwind 4). Do not edit. */\n`;
  return `${header}${scoped.toString().trim()}\n`;
}

export function verifyScoped(css) {
  const problems = [];
  const root = postcss.parse(css);
  root.walkAtRules((atRule) => {
    if (atRule.name === "layer") problems.push("@layer remains (JewelOS unlayered rules would win)");
    if (atRule.name === "property") problems.push(`global @property ${atRule.params}`);
  });
  root.walkRules((rule) => {
    if (insideKeyframes(rule) || rule.parent?.type === "rule") return;
    for (const selector of rule.selectors) if (!selector.startsWith(SCOPE)) problems.push(`unscoped selector: ${selector}`);
  });
  return problems;
}

const isCheck = process.argv.includes("--check");
const css = await buildCrmCss();
const problems = verifyScoped(css);
if (problems.length) {
  console.error(`crm.generated.css is not safely scoped:\n${problems.slice(0, 20).join("\n")}`);
  process.exit(1);
}
if (isCheck) {
  let committed = "";
  try { committed = readFileSync(outputPath, "utf8"); } catch { /* missing */ }
  if (committed.replaceAll("\r\n", "\n") !== css) {
    console.error("src/styles/crm.generated.css is stale. Run: pnpm.cmd --filter @jewelos/crm-ui build:css");
    process.exit(1);
  }
  console.log("crm.generated.css is current and scoped to .crm-root#crm-root");
} else {
  writeFileSync(outputPath, css);
  console.log(`wrote ${relative(packageRoot, outputPath)}`);
}
