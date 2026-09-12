module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: [
      // `jsxImportSource` routes JSX through NativeWind so `className` works on
      // React Native components, which is what lets a web component's Tailwind
      // classes be reused here verbatim.
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [
      [
        "module-resolver",
        {
          root: ["./src"],
          alias: { "@": "./src" },
          extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
        },
      ],
    ],
  };
};
