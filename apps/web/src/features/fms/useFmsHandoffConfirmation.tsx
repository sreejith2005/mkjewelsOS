import { useEffect, useRef, useState } from "react";
import type { FmsHandoffDecision, FmsTransitionRequest, FmsWorkPreview, FmsWorkResult } from "@jewelos/core";
import { runFmsHandoff } from "@jewelos/data/fms/confirmation";
import { FmsHandoffConfirmation } from "./FmsHandoffConfirmation";

export function useFmsHandoffConfirmation(identity?: string) {
  const [pending, setPending] = useState<{ request: FmsTransitionRequest; preview: FmsWorkPreview } | null>(null);
  const [result, setResult] = useState<FmsWorkResult | null>(null);
  const resolveChoice = useRef<((decision: FmsHandoffDecision | null) => void) | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; setPending(null);
    return () => { mounted.current = false; resolveChoice.current?.(null); resolveChoice.current = null; };
  }, [identity]);
  const close = (decision: FmsHandoffDecision | null) => { resolveChoice.current?.(decision); resolveChoice.current = null; setPending(null); };
  const confirmWork = async (request: FmsTransitionRequest) => {
    const completed = await runFmsHandoff(request, preview => {
      if (!mounted.current) return Promise.resolve(null);
      setPending({ request, preview });
      return new Promise(resolve => { resolveChoice.current = resolve; });
    });
    if (completed && mounted.current) setResult(completed);
    return completed;
  };
  return { confirmWork, result, confirmation: pending ? <FmsHandoffConfirmation request={pending.request} preview={pending.preview} onConfirm={close} onCancel={() => close(null)} /> : null };
}
