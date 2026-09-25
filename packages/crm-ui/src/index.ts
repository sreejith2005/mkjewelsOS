// Public entry of the ported original CRM. The web app lazy-loads this module for /crm/*.
// Its type surface is src/public-api.d.ts (kept in step by crm-port/public-api.check.ts), so the
// web app never type-checks the ported sources under its own compiler settings.
export { CrmApp, type CrmAppProps } from "./crm-port/crm-app";
export { CRM_BASE_PATH } from "./crm-port/runtime";
