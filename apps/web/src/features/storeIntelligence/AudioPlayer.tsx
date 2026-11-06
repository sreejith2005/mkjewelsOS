import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Loader2, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { EVIDENCE_PLAYBACK_MAX_MS, formatAudioOffset, type AnalysisTranscriptSegment } from "@jewelos/core";
import { AnalysisActionError, fetchEvidenceAudio } from "@jewelos/data";
import { cn } from "@/lib/utils";

export type AudioPlayerHandle = { playFrom: (ms: number) => void };
const RATES = [1, 1.25, 1.5, 2] as const;
type Clip = { url: string; startMs: number };

/**
 * Plays a finished conversation without ever exposing a storage key or signed URL.
 * The server grants one audited, single-use window of up to a minute at a time;
 * the player asks for the next window when one ends. Every listen is audited.
 */
export const AudioPlayer = forwardRef<AudioPlayerHandle, {
  sessionId: string; durationMs: number; segments: readonly AnalysisTranscriptSegment[]; onPosition?: (ms: number) => void;
}>(function AudioPlayer({ sessionId, durationMs, segments, onPosition }, ref) {
  const audio = useRef<HTMLAudioElement>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const pendingSeek = useRef<{ ms: number; play: boolean } | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [scrub, setScrub] = useState<number | null>(null);
  const requestToken = useRef(0);

  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip]);
  useEffect(() => { setClip(null); setPosition(0); setPlaying(false); setError(null); }, [sessionId]);

  const loadAt = useCallback(async (ms: number, play: boolean) => {
    const token = ++requestToken.current;
    const start = Math.max(0, Math.min(Math.floor(ms), Math.max(0, durationMs - 2000)));
    const end = Math.min(start + EVIDENCE_PLAYBACK_MAX_MS, Math.max(durationMs, start + 2000));
    setLoading(true); setError(null);
    try {
      const result = await fetchEvidenceAudio(sessionId, start, end);
      if (token !== requestToken.current) { URL.revokeObjectURL(result.url); return; }
      pendingSeek.current = { ms: Math.max(ms, result.clipStartMs), play };
      setClip({ url: result.url, startMs: result.clipStartMs });
    } catch (cause) {
      if (token !== requestToken.current) return;
      setPlaying(false);
      setError(cause instanceof AnalysisActionError ? cause.message : "This part could not be played. Try again in a moment.");
    } finally { if (token === requestToken.current) setLoading(false); }
  }, [durationMs, sessionId]);

  const inClip = (ms: number) => {
    const element = audio.current;
    return Boolean(clip && element && Number.isFinite(element.duration) && ms >= clip.startMs && ms < clip.startMs + element.duration * 1000 - 250);
  };
  const seek = useCallback((ms: number, play: boolean) => {
    const target = Math.max(0, Math.min(ms, durationMs));
    setPosition(target); onPosition?.(target);
    const element = audio.current;
    if (element && clip && inClip(target)) {
      element.currentTime = (target - clip.startMs) / 1000;
      if (play) void element.play().catch(() => setPlaying(false));
      return;
    }
    void loadAt(target, play);
    // inClip reads refs/state captured in this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip, durationMs, loadAt, onPosition]);

  useImperativeHandle(ref, () => ({ playFrom: (ms: number) => seek(ms, true) }), [seek]);

  const toggle = () => {
    const element = audio.current;
    if (playing && element) { element.pause(); return; }
    if (element && clip && inClip(position)) { void element.play().catch(() => setPlaying(false)); return; }
    void loadAt(position >= durationMs - 500 ? 0 : position, true);
  };
  const onLoaded = () => {
    const element = audio.current; const request = pendingSeek.current;
    if (!element || !clip) return;
    element.playbackRate = rate;
    if (request) { element.currentTime = Math.max(0, (request.ms - clip.startMs) / 1000); if (request.play) void element.play().catch(() => setPlaying(false)); pendingSeek.current = null; }
  };
  const onTime = () => {
    const element = audio.current; if (!element || !clip) return;
    const ms = clip.startMs + element.currentTime * 1000;
    setPosition(ms); onPosition?.(ms);
  };
  const onEnded = () => {
    const element = audio.current; if (!element || !clip) return;
    const end = clip.startMs + element.duration * 1000;
    if (end < durationMs - 500) void loadAt(end, true); else { setPlaying(false); setPosition(durationMs); }
  };
  useEffect(() => { if (audio.current) audio.current.playbackRate = rate; }, [rate]);

  const shown = scrub ?? position;
  const known = segments.filter((segment) => segment.speaker !== "unknown");
  return <div aria-label="Conversation audio" className="rounded-2xl border border-task-border bg-task-bg/95 p-3 shadow-lift backdrop-blur" role="region">
    <audio className="hidden" onEnded={onEnded} onLoadedMetadata={onLoaded} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} onTimeUpdate={onTime} preload="auto" ref={audio} src={clip?.url} />
    <div className="flex items-center gap-2">
      <button aria-label={playing ? "Pause" : "Play"} className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gold-sheen text-on-gold shadow-gold transition active:scale-95 disabled:opacity-50" disabled={loading && !playing} onClick={toggle} type="button">
        {loading && !playing ? <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" /> : playing ? <Pause aria-hidden className="size-5" /> : <Play aria-hidden className="ml-0.5 size-5" />}
      </button>
      <button aria-label="Back 10 seconds" className="flex size-11 shrink-0 items-center justify-center rounded-full text-task-text-muted hover:bg-task-muted hover:text-task-text" onClick={() => seek(position - 10_000, playing)} type="button"><RotateCcw aria-hidden className="size-5" /></button>
      <div className="min-w-0 flex-1">
        <div aria-hidden className="relative mb-1 h-2 overflow-hidden rounded-full bg-task-muted">
          {known.map((segment) => <span className={cn("absolute inset-y-0", segment.speaker === "employee" ? "bg-gold/50" : "bg-task-text-muted/40")} key={segment.segment_id}
            style={{ left: `${(segment.start_ms / Math.max(durationMs, 1)) * 100}%`, width: `${Math.max(0.4, ((segment.end_ms - segment.start_ms) / Math.max(durationMs, 1)) * 100)}%` }} />)}
          <span className="absolute inset-y-0 left-0 bg-gold" style={{ width: `${(shown / Math.max(durationMs, 1)) * 100}%`, opacity: 0.35 }} />
        </div>
        <input aria-label="Position in conversation" aria-valuetext={`${formatAudioOffset(shown)} of ${formatAudioOffset(durationMs)}`} className="block h-6 w-full cursor-pointer accent-gold" max={Math.max(durationMs, 1)} min={0}
          onChange={(event) => { const value = Number(event.target.value); if (scrub === null) seek(value, playing); else setScrub(value); }}
          onKeyUp={() => { if (scrub !== null) { seek(scrub, playing); setScrub(null); } }}
          onPointerDown={() => setScrub(position)} onPointerUp={(event) => { seek(Number((event.target as HTMLInputElement).value), playing); setScrub(null); }}
          step={1000} type="range" value={Math.min(shown, Math.max(durationMs, 1))} />
        <div className="flex justify-between text-[11px] tabular-nums text-task-text-muted"><span>{formatAudioOffset(shown)}</span><span>{formatAudioOffset(durationMs)}</span></div>
      </div>
      <button aria-label="Forward 10 seconds" className="flex size-11 shrink-0 items-center justify-center rounded-full text-task-text-muted hover:bg-task-muted hover:text-task-text" onClick={() => seek(position + 10_000, playing)} type="button"><RotateCw aria-hidden className="size-5" /></button>
      <button aria-label={`Playback speed ${rate} times. Change speed`} className="min-h-11 min-w-12 shrink-0 rounded-lg border border-task-border px-2 text-xs font-semibold tabular-nums text-task-text hover:border-gold/50" onClick={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]!)} type="button">{rate}×</button>
    </div>
    {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
    <p className="mt-1 text-[11px] text-task-text-muted">Gold marks the salesperson, grey the customer, where we are sure. Every listen is recorded.</p>
  </div>;
});
