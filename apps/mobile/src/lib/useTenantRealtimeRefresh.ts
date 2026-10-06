import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useNavigation } from "@react-navigation/native";
import { subscribeToTenantRealtime, type TenantRealtimeTopic } from "@jewelos/data/realtime/api";
import { createRefreshLifecycle } from "./refreshLifecycle";

// One OS/connectivity registration shared by all mounted operational screens.
const observers = new Set<(active: boolean) => void>();
let foreground = AppState.currentState === "active";
let online = true;
let stopState: (() => void) | null = null;
export function subscribeAppAvailability(listener: (active: boolean) => void): () => void {
  observers.add(listener);
  if (!stopState) {
    foreground = AppState.currentState === "active";
    const emit = () => observers.forEach((observer) => observer(foreground && online));
    const app = AppState.addEventListener("change", (state) => { foreground = state === "active"; emit(); });
    const stopNetwork = NetInfo.addEventListener((state) => {
      online = state.isConnected !== false && state.isInternetReachable !== false;
      emit();
    });
    stopState = () => { app.remove(); stopNetwork(); };
  }
  listener(foreground && online);
  return () => {
    observers.delete(listener);
    if (!observers.size) { stopState?.(); stopState = null; }
  };
}

export function useTenantRealtimeRefresh({ tenantId, topics, refresh, debounceMs = 350 }: {
  tenantId: string | null | undefined;
  topics: readonly TenantRealtimeTopic[];
  refresh: () => Promise<void> | void;
  debounceMs?: number;
}): () => void {
  const navigation = useNavigation();
  const requestRef = useRef<() => void>(() => {});
  const request = useCallback(() => requestRef.current(), []);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const topicKey = topics.join(",");
  useEffect(() => {
    if (!tenantId) return;
    let focused = navigation.isFocused();
    let available = foreground && online;
    const lifecycle = createRefreshLifecycle(() => refreshRef.current(), focused && available, debounceMs);
    requestRef.current = lifecycle.request;
    const stopFocus = navigation.addListener("focus", () => { focused = true; lifecycle.setActive(available); });
    const stopBlur = navigation.addListener("blur", () => { focused = false; lifecycle.setActive(false); });
    const stopAvailability = subscribeAppAvailability((active) => { available = active; lifecycle.setActive(focused && available); });
    const stopRealtime = topicKey ? subscribeToTenantRealtime(tenantId, topics, lifecycle.request) : () => {};
    return () => { requestRef.current = () => {}; lifecycle.dispose(); stopRealtime(); stopAvailability(); stopFocus(); stopBlur(); };
  }, [debounceMs, navigation, tenantId, topicKey]);
  return request;
}
