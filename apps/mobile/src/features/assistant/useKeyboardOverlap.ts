import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, type View } from "react-native";
import { keyboardOverlap } from "./askKiaraModel";

/**
 * Keeps a bottom composer above the keyboard. The app draws edge-to-edge, so
 * Android may or may not shrink the window for the keyboard; this measures the
 * frame of `ref` against the keyboard's top edge and returns the overlap, which
 * is 0 whenever the window already shrank. The frame is measured, not its
 * padded content, so applying the result never changes the measurement.
 */
export function useKeyboardOverlap(): Readonly<{ ref: React.RefObject<View | null>; overlap: number; onLayout: () => void }> {
  const ref = useRef<View | null>(null);
  const keyboardTop = useRef<number | null>(null);
  const [overlap, setOverlap] = useState(0);

  const measure = useCallback(() => {
    const view = ref.current;
    if (!view || keyboardTop.current === null) {
      setOverlap(0);
      return;
    }
    view.measureInWindow((_x, y, _width, height) => setOverlap(keyboardOverlap(y + height, keyboardTop.current)));
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      keyboardTop.current = event.endCoordinates.screenY;
      measure();
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardTop.current = null;
      setOverlap(0);
    });
    return () => { show.remove(); hide.remove(); };
  }, [measure]);

  return { ref, overlap, onLayout: measure };
}
