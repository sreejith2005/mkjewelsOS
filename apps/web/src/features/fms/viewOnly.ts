import { createContext, useContext } from "react";

/**
 * True while a workflow is open view only (a View grant, or a leader's view access).
 * The builder wraps the step editor in a disabled fieldset; this lets the few
 * controls that only reveal information (route details) stay usable.
 */
export const FmsViewOnlyContext = createContext(false);
export const useFmsViewOnly = () => useContext(FmsViewOnlyContext);
