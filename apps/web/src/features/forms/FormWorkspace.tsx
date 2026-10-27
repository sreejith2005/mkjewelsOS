import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./formWorkspace.css";

/** Both panes stay mounted: changing view must not throw away edits or test answers. */
export function FormWorkspace({ preview, editor, live, desktopPreview = true, previewVisible = true }: { preview: boolean; editor: ReactNode; live: ReactNode; desktopPreview?: boolean; previewVisible?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(65);
  const clamp = (value: number) => setWidth(Math.max(45, Math.min(72, value)));
  return <div className={`form-workspace ${preview ? "form-workspace-preview" : ""} ${desktopPreview ? "" : "form-workspace-collapsed"}`} ref={host} style={{ "--form-editor-width": `${width}%` } as CSSProperties}>
    <div className="form-workspace-editor min-w-0 space-y-5">{editor}</div>
    <div aria-label="Resize form preview" aria-orientation="vertical" aria-valuemax={72} aria-valuemin={45} aria-valuenow={Math.round(width)} className="form-workspace-divider" onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); clamp(width + (event.key === "ArrowRight" ? 2 : -2)); } }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = host.current?.getBoundingClientRect(); if (rect) clamp((event.clientX - rect.left) / rect.width * 100); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} role="separator" tabIndex={0} />
    <aside aria-hidden={!previewVisible} aria-label="Live preview" className="form-workspace-live min-w-0 rounded-xl border border-gold/20 bg-charcoal/20">{live}</aside>
  </div>;
}
