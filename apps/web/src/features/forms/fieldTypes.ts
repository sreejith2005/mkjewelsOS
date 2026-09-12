// These rules moved to `@jewelos/core` so the web builder and the Android
// builder cannot disagree about them. This shim keeps every existing web
// import working unchanged; the tests moved with the code.
export { convertFormFieldType, LAYOUT_FIELD_TYPES, OPTION_FIELD_TYPES, pruneOptionValueReferences } from "@jewelos/core";
