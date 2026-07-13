import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  buildEditedBuffer,
  computePeaks,
  decodeAudioFile,
  exportEditedFile,
  formatTime,
  gainToDb,
  newRegionId,
  normalizeGain,
  outputDuration,
  outputTimeToSource,
  sanitizeRegions,
  timeInRegions,
  type EditOptions,
  type RegionWithId,
  type TrimRegion,
} from "../audioTrim";
import { IconPlay, IconPause } from "./icons";

const WAVE_BARS = 280;

/**
 * Pre-transcription editor: multi-region keep-list, gain, fade in/out, gaps,
 * waveform + preview, then export a WAV for transcription.
 */
export function AudioEditor(props: {
  file: File;
  onReady: (file: File) => void;
  busy?: boolean;
  continueLabel?: string;
}) {
  const { file, onReady, busy = false, continueLabel = "Transcribe" } = props;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);

  const [regions, setRegions] = useState<RegionWithId[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [gain, setGain] = useState(1);
  const [fadeInSec, setFadeInSec] = useState(0.01);
  const [fadeOutSec, setFadeOutSec] = useState(0.01);
  const [gapSec, setGapSec] = useState(0);

  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** Playhead in source-seconds (null when in a gap). */
  const [playhead, setPlayhead] = useState<number | null>(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const rafRef = useRef(0);

  const active = regions.find((r) => r.id === activeId) ?? regions[0] ?? null;

  const cleanRegions = useMemo(
    () => (buffer ? sanitizeRegions(regions, buffer.duration) : []),
    [regions, buffer],
  );

  const editOptions: EditOptions | null = buffer
    ? {
        regions: cleanRegions,
        gain,
        fadeInSec,
        fadeOutSec,
        gapSec,
      }
    : null;

  const outDur = editOptions ? outputDuration(editOptions.regions, gapSec) : 0;

  // Decode source
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPlaying(false);
    stopPreview();

    decodeAudioFile(file)
      .then((buf) => {
        if (cancelled) return;
        setBuffer(buf);
        setPeaks(computePeaks(buf, WAVE_BARS));
        const id = newRegionId();
        setRegions([{ id, start: 0, end: buf.duration }]);
        setActiveId(id);
        setGain(1);
        setFadeInSec(0.01);
        setFadeOutSec(0.01);
        setGapSec(0);
        setPlayhead(0);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || "Could not decode this audio file.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      stopPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !buffer) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    const cssH = canvas.clientHeight || 110;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = cssW;
    const h = cssH;
    const dur = buffer.duration || 1;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(0, 0, w, h);

    // Dim non-kept areas
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, w, h);

    // Kept regions
    for (const r of regions) {
      const isActive = r.id === active?.id;
      const l = (r.start / dur) * w;
      const rw = Math.max(1, ((r.end - r.start) / dur) * w);
      ctx.fillStyle = isActive
        ? "rgba(255, 80, 160, 0.22)"
        : "rgba(255, 80, 160, 0.12)";
      ctx.fillRect(l, 0, rw, h);
      ctx.strokeStyle = isActive
        ? "rgba(255, 80, 160, 0.95)"
        : "rgba(255, 120, 180, 0.45)";
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.strokeRect(l + 0.5, 0.5, rw - 1, h - 1);
    }

    // Peaks
    const mid = h / 2;
    const barW = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const t = ((i + 0.5) / peaks.length) * dur;
      const kept = timeInRegions(t, regions);
      const isActive =
        active != null && t >= active.start && t <= active.end;
      ctx.fillStyle = isActive
        ? "rgba(255, 120, 180, 0.95)"
        : kept
          ? "rgba(255, 120, 180, 0.55)"
          : "rgba(255,255,255,0.22)";
      const amp = (peaks[i] ?? 0) * (h * 0.42);
      ctx.fillRect(i * barW, mid - amp, Math.max(1, barW - 0.5), amp * 2);
    }

    // Playhead (source time)
    if (playhead != null && playhead >= 0) {
      const px = (playhead / dur) * w;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }, [peaks, buffer, regions, active, playhead]);

  function stopPreview() {
    cancelAnimationFrame(rafRef.current);
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPlaying(false);
  }

  function touch() {
    stopPreview();
  }

  function updateActive(patch: Partial<TrimRegion>) {
    if (!active || !buffer) return;
    setRegions((prev) =>
      prev.map((r) => {
        if (r.id !== active.id) return r;
        let start = patch.start ?? r.start;
        let end = patch.end ?? r.end;
        start = Math.max(0, Math.min(buffer.duration - 0.05, start));
        end = Math.max(start + 0.05, Math.min(buffer.duration, end));
        return { ...r, start, end };
      }),
    );
    touch();
  }

  function addRegion() {
    if (!buffer || !active) return;
    const span = Math.min(8, buffer.duration / 4);
    let start = Math.min(active.end + 0.1, buffer.duration - 0.1);
    let end = Math.min(start + span, buffer.duration);
    if (end - start < 0.05) {
      start = Math.max(0, buffer.duration - span);
      end = buffer.duration;
    }
    const id = newRegionId();
    setRegions((prev) => [...prev, { id, start, end }]);
    setActiveId(id);
    touch();
  }

  function removeActive() {
    if (!active || regions.length <= 1) return;
    const next = regions.filter((r) => r.id !== active.id);
    setRegions(next);
    setActiveId(next[0]?.id ?? null);
    touch();
  }

  function resetFull() {
    if (!buffer) return;
    const id = newRegionId();
    setRegions([{ id, start: 0, end: buffer.duration }]);
    setActiveId(id);
    setGain(1);
    setFadeInSec(0.01);
    setFadeOutSec(0.01);
    setGapSec(0);
    setPlayhead(0);
    touch();
  }

  function normalizeSelection() {
    if (!buffer || cleanRegions.length === 0) return;
    const tmp = buildEditedBuffer(buffer, {
      regions: cleanRegions,
      gain: 1,
      fadeInSec: 0,
      fadeOutSec: 0,
      gapSec: 0,
    });
    setGain(normalizeGain(tmp, 0.95));
    touch();
  }

  async function togglePreview() {
    if (!buffer || !editOptions) return;
    if (playing) {
      stopPreview();
      return;
    }
    if (cleanRegions.length === 0) {
      setError("Add at least one region longer than 50ms.");
      return;
    }

    setExporting(true);
    try {
      const outFile = await exportEditedFile(file, buffer, editOptions);
      stopPreview();
      const url = URL.createObjectURL(outFile);
      objectUrlRef.current = url;
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.src = url;
      a.currentTime = 0;
      await a.play();
      setPlaying(true);

      const tick = () => {
        if (!audioRef.current || audioRef.current.paused) return;
        const tOut = audioRef.current.currentTime;
        const src = outputTimeToSource(tOut, cleanRegions, gapSec);
        setPlayhead(src);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      a.onended = () => {
        setPlaying(false);
        setPlayhead(cleanRegions[0]?.start ?? 0);
        cancelAnimationFrame(rafRef.current);
      };
    } catch (e) {
      setError((e as Error).message || "Preview failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleContinue() {
    if (!buffer || !editOptions) return;
    if (cleanRegions.length === 0) {
      setError("Add at least one region longer than 50ms.");
      return;
    }
    setExporting(true);
    setError(null);
    stopPreview();
    try {
      const out = await exportEditedFile(file, buffer, editOptions);
      onReady(out);
    } catch (e) {
      setError((e as Error).message || "Could not export edited audio.");
    } finally {
      setExporting(false);
    }
  }

  // Click waveform: select region under click, or set active start near edge
  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!buffer || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = (x / rect.width) * buffer.duration;
    const hit = regions.find((r) => t >= r.start && t <= r.end);
    if (hit) {
      setActiveId(hit.id);
      return;
    }
    // Click outside: create a ~4s region centered on click (or to edge)
    const half = 2;
    const start = Math.max(0, t - half);
    const end = Math.min(buffer.duration, t + half);
    if (end - start < 0.05) return;
    const id = newRegionId();
    setRegions((prev) => [...prev, { id, start, end }]);
    setActiveId(id);
    touch();
  }

  const duration = buffer?.duration ?? 0;
  const isEdited =
    buffer != null &&
    (regions.length !== 1 ||
      (active != null &&
        (active.start > 0.01 || active.end < duration - 0.01)) ||
      Math.abs(gain - 1) > 0.001 ||
      gapSec > 0.001 ||
      Math.abs(fadeInSec - 0.01) > 0.001 ||
      Math.abs(fadeOutSec - 0.01) > 0.001);

  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-base font-semibold text-content">Edit before MIDI</h2>
        <p className="m-0 text-sm text-muted">
          Keep one or more regions, set gain &amp; fades, then transcribe.
        </p>
      </div>

      {loading && (
        <p className="m-0 py-8 text-center text-sm text-muted">Loading waveform…</p>
      )}

      {error && (
        <p className="m-0 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {!loading && buffer && active && (
        <>
          <canvas
            ref={canvasRef}
            className="h-[110px] w-full cursor-crosshair rounded-lg border border-line bg-bg"
            role="img"
            aria-label="Audio waveform — click a region to select, empty area to add"
            onClick={onCanvasClick}
          />

          {/* Region list */}
          <div className="flex flex-wrap items-center gap-2">
            {regions.map((r, i) => (
              <button
                key={r.id}
                type="button"
                className={clsx(
                  "rounded-full px-3 py-1 text-xs font-mono",
                  r.id === active.id
                    ? "border-accent bg-accent/20 text-content"
                    : "border-line text-muted",
                )}
                onClick={() => setActiveId(r.id)}
              >
                R{i + 1} {formatTime(r.start)}–{formatTime(r.end)}
              </button>
            ))}
            <button type="button" className="text-sm" onClick={addRegion}>
              + Add region
            </button>
            <button
              type="button"
              className="text-sm"
              onClick={removeActive}
              disabled={regions.length <= 1}
            >
              Remove active
            </button>
          </div>

          {/* Active region start/end */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-muted">
              <span className="flex justify-between">
                <span>Active start</span>
                <span className="font-mono tabular-nums text-content">
                  {formatTime(active.start)}
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.05}
                value={active.start}
                onChange={(e) => updateActive({ start: parseFloat(e.target.value) })}
                className="w-full accent-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              <span className="flex justify-between">
                <span>Active end</span>
                <span className="font-mono tabular-nums text-content">
                  {formatTime(active.end)}
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.05}
                value={active.end}
                onChange={(e) => updateActive({ end: parseFloat(e.target.value) })}
                className="w-full accent-accent"
              />
            </label>
          </div>

          {/* Gain + fades + gap */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm text-muted">
              <span className="flex justify-between">
                <span>Gain</span>
                <span className="font-mono tabular-nums text-content">
                  {gainToDb(gain)}
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.01}
                value={gain}
                onChange={(e) => {
                  setGain(parseFloat(e.target.value));
                  touch();
                }}
                className="w-full accent-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              <span className="flex justify-between">
                <span>Fade in</span>
                <span className="font-mono tabular-nums text-content">
                  {Math.round(fadeInSec * 1000)} ms
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.005}
                value={fadeInSec}
                onChange={(e) => {
                  setFadeInSec(parseFloat(e.target.value));
                  touch();
                }}
                className="w-full accent-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              <span className="flex justify-between">
                <span>Fade out</span>
                <span className="font-mono tabular-nums text-content">
                  {Math.round(fadeOutSec * 1000)} ms
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.005}
                value={fadeOutSec}
                onChange={(e) => {
                  setFadeOutSec(parseFloat(e.target.value));
                  touch();
                }}
                className="w-full accent-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              <span className="flex justify-between">
                <span>Gap between regions</span>
                <span className="font-mono tabular-nums text-content">
                  {gapSec.toFixed(2)} s
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={gapSec}
                onChange={(e) => {
                  setGapSec(parseFloat(e.target.value));
                  touch();
                }}
                className="w-full accent-accent"
                disabled={regions.length < 2}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>
              Output{" "}
              <strong className="font-mono font-semibold text-content">
                {formatTime(outDur)}
              </strong>
              {" from "}
              <span className="font-mono">{formatTime(duration)}</span>
              {regions.length > 1 && (
                <>
                  {" · "}
                  <span>{regions.length} regions</span>
                </>
              )}
            </span>
            {isEdited && (
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">
                edited
              </span>
            )}
            <button
              type="button"
              className="text-xs underline underline-offset-2"
              onClick={normalizeSelection}
            >
              Normalize gain
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={clsx(
                "inline-flex items-center gap-2",
                playing &&
                  "border-accent bg-accent text-white hover:border-accent hover:bg-accent",
              )}
              onClick={() => void togglePreview()}
              disabled={exporting || outDur < 0.05}
            >
              {playing ? <IconPause /> : <IconPlay />}
              {playing ? "Stop preview" : "Preview output"}
            </button>
            <button type="button" onClick={resetFull} disabled={!isEdited}>
              Reset edits
            </button>
            <div className="ml-auto flex gap-2 max-[760px]:ml-0 max-[760px]:w-full max-[760px]:justify-end">
              <button
                type="button"
                className="btn-primary rounded-xl px-7 py-2.5 text-base"
                onClick={() => void handleContinue()}
                disabled={busy || exporting || loading || outDur < 0.05}
              >
                {exporting ? "Preparing…" : continueLabel}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
