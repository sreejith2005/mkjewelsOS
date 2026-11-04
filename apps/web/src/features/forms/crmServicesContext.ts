// Client lookups in every form (owner request 2026-11-04): the app provides CRM's phone and
// pincode lookups to every FormRenderer for people with CRM access, so a form fills a registered
// client's or lead's details without any setup. Forms CRM opens pass richer services directly.
import { createContext, useContext } from "react";
import type { FormCrmServices } from "@jewelos/core";

export const FormCrmServicesContext = createContext<FormCrmServices | undefined>(undefined);

export function useFormCrmServices(): FormCrmServices | undefined {
  return useContext(FormCrmServicesContext);
}
