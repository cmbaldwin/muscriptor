import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  buildLeadSheet,
  leadSheetToText,
  midiToName,
  type LeadSheet,
  type NoteEvent,
} from "../chords";

/**
 * Fake-book / lead-sheet reader: large chord symbols + simplified melody cues,
 * auto-scrolls with playback so you can read while playing piano.
 */
export function FakeBook(props: {
  notes: NoteEvent[];
  /** Current transport time in seconds. */
  currentTime: number;
  title?: string;
  /** Called when user seeks by clicking a bar. */
  onSeek?: (seconds: number) => void;
}) {
  const { notes, currentTime, title = "Lead sheet", onSeek } = props;
  const [bpmOverride, setBpmOverride] = useState<number | null>(null);
  const activeBarRef = useRef<HTMLDivElement | null>(null);

  const sheet: LeadSheet = useMemo(() => {
    return buildLeadSheet(notes, bpmOverride ? { bpm: bpmOverride } : {});
  }, [notes, bpmOverride]);

  const activeBar = Math.min(
    sheet.bars.length - 1,
    Math.max(0, Math.floor(currentTime / sheet.barDuration)),
  );

  // Keep the current bar in view while playing.
  useEffect(() => {
    activeBarRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeBar]);

  function copyChart() {
    const text = leadSheetToText(sheet, title);
    void navigator.clipboard.writeText(text).then(
      () => {
        /* ok */
      },
      () => alert("Couldn't copy to clipboard"),
    );
  }

  function downloadChart() {
    const text = leadSheetToText(sheet, title);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\.[^.]+$/, "") || "lead-sheet"}_chords.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (notes.length === 0) {
    return (
      <div className="fakebook flex min-h-[320px] flex-col items-center justify-center rounded-card border border-line bg-[#f4f0e6] px-6 py-16 text-center text-[#2a2a2a]">
        <p className="m-0 font-serif text-2xl">Waiting for notes…</p>
        <p className="m-0 mt-2 max-w-md text-sm opacity-70">
          Chord symbols appear here as transcription finishes. Play the track to
          follow the chart while you sit at the piano.
        </p>
      </div>
    );
  }

  // Group bars into systems of 4
  const systems: (typeof sheet.bars)[] = [];
  for (let i = 0; i < sheet.bars.length; i += 4) {
    systems.push(sheet.bars.slice(i, i + 4));
  }

  return (
    <div className="fakebook col-span-full flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-2.5">
        <div className="font-serif text-lg text-content">{title}</div>
        <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-xs text-muted">
          {sheet.key} · ~{sheet.bpm} BPM · {sheet.beatsPerBar}/4
        </span>
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          BPM
          <input
            type="number"
            min={40}
            max={220}
            className="w-16 rounded-md border border-line bg-bg px-2 py-1 font-mono text-content"
            value={bpmOverride ?? sheet.bpm}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) setBpmOverride(v);
            }}
          />
        </label>
        <button type="button" className="text-sm" onClick={copyChart}>
          Copy chart
        </button>
        <button type="button" className="text-sm" onClick={downloadChart}>
          Download .txt
        </button>
      </div>

      {/* Paper-like reading surface */}
      <div
        className="max-h-[min(70vh,720px)] overflow-y-auto rounded-card border border-[#d4cbb8] bg-[#f7f3ea] px-5 py-6 text-[#1c1b19] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
      >
        <header className="mb-6 border-b border-[#d4cbb8] pb-4 text-center">
          <h2 className="m-0 text-3xl font-normal tracking-wide">{title}</h2>
          <p className="m-0 mt-1 text-sm opacity-60">
            {sheet.key} major/minor estimate · {sheet.bpm} bpm · auto chords from
            audio→MIDI
          </p>
        </header>

        <div className="flex flex-col gap-5">
          {systems.map((row, si) => (
            <div
              key={si}
              className="grid grid-cols-4 gap-0 border-t border-[#cfc6b4] max-[640px]:grid-cols-2"
            >
              {row.map((bar) => {
                const isActive = bar.index === activeBar;
                const chordLabel = (() => {
                  const syms: string[] = [];
                  for (const c of bar.chords) {
                    if (syms[syms.length - 1] !== c.symbol) syms.push(c.symbol);
                  }
                  return syms.length ? syms : ["·"];
                })();

                return (
                  <div
                    key={bar.index}
                    ref={isActive ? activeBarRef : undefined}
                    role={onSeek ? "button" : undefined}
                    tabIndex={onSeek ? 0 : undefined}
                    onClick={() => onSeek?.(bar.start)}
                    onKeyDown={(e) => {
                      if (onSeek && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        onSeek(bar.start);
                      }
                    }}
                    className={clsx(
                      "relative min-h-[100px] border-r border-[#cfc6b4] px-3 py-3 transition-colors max-[640px]:border-b",
                      isActive && "bg-[#ffe8c8]",
                      onSeek && "cursor-pointer hover:bg-[#fff6e8]",
                    )}
                  >
                    <div className="absolute left-1.5 top-1 font-mono text-[10px] opacity-40">
                      {bar.index + 1}
                    </div>
                    {/* Chord symbols — large for piano stand reading */}
                    <div className="mt-2 flex min-h-[2.5rem] flex-wrap items-end gap-x-3 gap-y-1">
                      {chordLabel.map((s, i) => (
                        <span
                          key={`${bar.index}-${i}-${s}`}
                          className={clsx(
                            "text-[clamp(1.4rem,3.5vw,2rem)] font-semibold leading-none tracking-tight",
                            s === "·" && "opacity-25",
                          )}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                    {/* Melody cue line (note names, not full notation) */}
                    <div className="mt-3 flex flex-wrap gap-1 border-t border-dashed border-[#d4cbb8] pt-2 font-mono text-[11px] leading-tight opacity-70">
                      {bar.melody.length === 0 ? (
                        <span className="opacity-40">—</span>
                      ) : (
                        bar.melody.slice(0, 12).map((m, i) => (
                          <span key={i} className="rounded bg-black/5 px-1">
                            {midiToName(m.pitch)}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
              {/* pad incomplete last system */}
              {row.length < 4 &&
                Array.from({ length: 4 - row.length }).map((_, i) => (
                  <div
                    key={`pad-${i}`}
                    className="min-h-[100px] border-r border-[#cfc6b4] bg-[#efe9dc]/40 max-[640px]:hidden"
                  />
                ))}
            </div>
          ))}
        </div>

        <p className="m-0 mt-8 text-center text-xs opacity-50">
          Chords are estimated from the multi-instrument MIDI — tweak BPM if bar
          lines feel off. Click a bar to seek.
        </p>
      </div>
    </div>
  );
}
