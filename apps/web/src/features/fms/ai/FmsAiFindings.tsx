import { useMemo } from "react";
import { diagnoseFmsDefinition, type FmsFlowDefinition } from "@jewelos/core";
import type { FmsData } from "../api";
import { fmsDiagnosticCatalogFromData } from "./catalog";

/** The app's own rule-based findings on the current draft (no AI). The server sends the same findings to the assistant. */
export function useFmsDiagnostics(definition: FmsFlowDefinition, data: FmsData) {
  return useMemo(() => diagnoseFmsDefinition(definition, fmsDiagnosticCatalogFromData(data)), [data, definition]);
}
