import { moveFmsNode, type FmsPoint } from "@jewelos/core";

type NodeDragOptions = Readonly<{
  key: string;
  origin: FmsPoint;
  zoom: number;
  preview: (key: string, position: FmsPoint) => void;
  commit: (positions: Readonly<Record<string, FmsPoint>>) => void;
}>;

/** Keeps high-frequency drag previews separate from the single durable commit. */
export function createFmsNodeDragSession(options: NodeDragOptions) {
  let last = options.origin;
  let ended = false;
  return {
    update(screenDelta: FmsPoint) {
      if (ended) return;
      last = moveFmsNode(options.origin, screenDelta, options.zoom);
      options.preview(options.key, last);
    },
    end() {
      if (ended) return;
      ended = true;
      options.commit({ [options.key]: last });
    },
  };
}
