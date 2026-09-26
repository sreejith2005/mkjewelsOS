// Parity harness only. Loaded into the ORIGINAL app's `next dev` (NODE_OPTIONS=--require) so
// its hard-coded https://api.runo.in call reaches the local Runo stub instead. It changes the
// destination only; method, headers and body are passed through untouched.
const stub = process.env.PARITY_RUNO_STUB_URL;
const realFetch = globalThis.fetch;
if (stub && typeof realFetch === "function") {
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    if (typeof url === "string" && url.startsWith("https://api.runo.in/")) {
      return realFetch(stub + url.slice("https://api.runo.in".length), init);
    }
    return realFetch(input, init);
  };
}
