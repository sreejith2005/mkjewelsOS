// These rules moved to `@jewelos/core` so the web builder and the Android
// builder cannot disagree about them. This shim keeps every existing web
// import working unchanged; the tests moved with the code.
export { readAnswerRoutes, readGuidedConditionLinks, setAnswerRoute, setGuidedFollowUp } from "@jewelos/core";
export type { AnswerRoute, GuidedConditionLink } from "@jewelos/core";
