// These rules moved to `@jewelos/core` so the web builder and the Android
// builder cannot disagree about them. This shim keeps every existing web
// import working unchanged; the tests moved with the code.
export { buildFormRoutingMap } from "@jewelos/core";
export type { FormRoutingEdge, FormRoutingMapModel, FormRoutingNode } from "@jewelos/core";
