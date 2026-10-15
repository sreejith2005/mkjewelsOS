// Metro configuration for the JewelOS mobile app.
//
// Two things differ from a standalone Expo project:
//   1. The shared `@jewelos/ui-tokens` package lives outside this app, in the
//      pnpm workspace at the repository root, and ships TypeScript source — so
//      Metro has to watch that root and transpile from there.
//   2. This app installs with npm while the workspace uses pnpm (see
//      apps/mobile/README.md for why), so a dependency can resolve from either
//      tree and both are searched.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// The workspace packages are symlinked, so Metro must follow the links rather
// than treat them as opaque files.
config.resolver.unstable_enableSymlinks = true;
// `@jewelos/ui-tokens` exposes its entry points only through an
// `exports` map that points at `./src/*.ts`.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ["react-native", "import", "require", "default"];

module.exports = config;
