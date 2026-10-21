import { useEffect, useRef, useState } from "react";

/** Request generations are scoped to a mounted actor and exact filter/page identity. */
export function useFmsRead<T>(enabled: boolean, identity: string, load: () => Promise<T>, revision = 0) {
  const loader = useRef(load); loader.current = load;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ identity: string; data?: T; error?: string; loading: boolean }>({ identity: "", loading: false });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState(previous => ({ identity, ...(previous.identity === identity && previous.data !== undefined ? { data: previous.data } : {}), loading: true }));
    void loader.current().then(data => { if (active) setState({ identity, data, loading: false }); })
      .catch((error: unknown) => { if (active) setState({ identity, error: error instanceof Error ? error.message : "Unable to load FMS work", loading: false }); });
    return () => { active = false; };
  }, [enabled, identity, attempt, revision]);
  return { data: state.identity === identity ? state.data : undefined, error: state.identity === identity ? state.error : undefined,
    loading: enabled && (state.identity !== identity || state.loading), retry: () => setAttempt(a => a + 1) };
}
