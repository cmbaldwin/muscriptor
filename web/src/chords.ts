/**
 * Chord detection + fake-book / lead-sheet builder from multi-instrument notes.
 * Pure TypeScript — no extra deps.
 */

export type NoteEvent = {
  pitch: number; // MIDI
  start: number; // seconds
  end: number;
  instrument: string;
};

export type ChordHit = {
  start: number;
  end: number;
  /** Display symbol e.g. "Am7", "G/B", "Cmaj7" */
  symbol: string;
  root: number; // pitch class 0-11
  quality: string;
  bass: number; // pitch class of lowest note
};

export type MelodyNote = {
  pitch: number;
  start: number;
  end: number;
};

export type LeadBar = {
  index: number;
  start: number;
  end: number;
  /** Distinct chords in this bar (merged runs). */
  chords: ChordHit[];
  /** Simplified melody (one pitch stream). */
  melody: MelodyNote[];
};

export type LeadSheet = {
  bpm: number;
  key: string;
  beatsPerBar: number;
  barDuration: number;
  duration: number;
  bars: LeadBar[];
  /** Flat chord list for scrolling / export. */
  chords: ChordHit[];
};

const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

const BASS_LIKE = /bass|contrabass|tuba/;
const DRUM_LIKE = /drum|percussion|timpani/;
const MELODY_PREF = /voice|violin|trumpet|flute|sax|oboe|clarinet|synth_lead|piano/;

/** Common chord templates as pitch-class sets relative to root. */
const TEMPLATES: { quality: string; pcs: number[] }[] = [
  { quality: "maj7", pcs: [0, 4, 7, 11] },
  { quality: "m7", pcs: [0, 3, 7, 10] },
  { quality: "7", pcs: [0, 4, 7, 10] },
  { quality: "m7b5", pcs: [0, 3, 6, 10] },
  { quality: "dim7", pcs: [0, 3, 6, 9] },
  { quality: "6", pcs: [0, 4, 7, 9] },
  { quality: "m6", pcs: [0, 3, 7, 9] },
  { quality: "aug", pcs: [0, 4, 8] },
  { quality: "dim", pcs: [0, 3, 6] },
  { quality: "sus4", pcs: [0, 5, 7] },
  { quality: "sus2", pcs: [0, 2, 7] },
  { quality: "m", pcs: [0, 3, 7] },
  { quality: "", pcs: [0, 4, 7] }, // major
  { quality: "5", pcs: [0, 7] },
];

function pc(pitch: number): number {
  return ((pitch % 12) + 12) % 12;
}

function symbolFor(root: number, quality: string, bass: number): string {
  const name = NOTE_NAMES[root] ?? "C";
  let s = name + quality;
  if (bass !== root) s += `/${NOTE_NAMES[bass]}`;
  return s;
}

/** Score how well a pitch-class multiset matches a template at a given root. */
function scoreTemplate(
  counts: number[],
  root: number,
  template: number[],
): number {
  let score = 0;
  let total = 0;
  for (let i = 0; i < 12; i++) total += counts[i] ?? 0;
  if (total === 0) return 0;

  for (const rel of template) {
    const p = (root + rel) % 12;
    score += (counts[p] ?? 0) * (rel === 0 ? 1.4 : rel === 7 ? 1.1 : 1);
  }
  // Penalize loud non-chord tones a bit
  for (let i = 0; i < 12; i++) {
    const rel = (i - root + 12) % 12;
    if (!template.includes(rel)) score -= (counts[i] ?? 0) * 0.35;
  }
  return score / total;
}

/**
 * Detect the best chord label for a bag of sounding notes.
 * Returns null if nothing harmonic is happening.
 */
export function detectChord(notes: NoteEvent[]): ChordHit | null {
  const harmonic = notes.filter(
    (n) => !DRUM_LIKE.test(n.instrument) && n.end > n.start,
  );
  if (harmonic.length === 0) return null;

  const counts = new Array(12).fill(0);
  let lowest = 127;
  for (const n of harmonic) {
    // Weight by duration (capped)
    const w = Math.min(2, Math.max(0.05, n.end - n.start));
    // Bass instruments count more toward bass tone
    const bassBoost = BASS_LIKE.test(n.instrument) ? 1.5 : 1;
    counts[pc(n.pitch)] += w * bassBoost;
    if (n.pitch < lowest) lowest = n.pitch;
  }

  const bass = pc(lowest);
  let best = { score: 0.15, root: bass, quality: "" }; // threshold

  for (let root = 0; root < 12; root++) {
    for (const t of TEMPLATES) {
      let s = scoreTemplate(counts, root, t.pcs);
      // Prefer bass = root, or bass = 3rd/5th of chord (inversions)
      if (root === bass) s += 0.15;
      else if (t.pcs.includes((bass - root + 12) % 12)) s += 0.06;
      if (s > best.score) best = { score: s, root, quality: t.quality };
    }
  }

  if (best.score < 0.22) return null;

  const start = Math.min(...harmonic.map((n) => n.start));
  const end = Math.max(...harmonic.map((n) => n.end));
  return {
    start,
    end,
    symbol: symbolFor(best.root, best.quality, bass),
    root: best.root,
    quality: best.quality,
    bass,
  };
}

/** Rough BPM from note onsets (drums preferred). Falls back to 120. */
export function estimateBpm(notes: NoteEvent[]): number {
  const onsets = notes
    .filter((n) => DRUM_LIKE.test(n.instrument) || !BASS_LIKE.test(n.instrument))
    .map((n) => n.start)
    .sort((a, b) => a - b);

  if (onsets.length < 8) return 120;

  const ioi: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const d = onsets[i]! - onsets[i - 1]!;
    if (d > 0.12 && d < 1.2) ioi.push(d);
  }
  if (ioi.length < 4) return 120;

  ioi.sort((a, b) => a - b);
  const med = ioi[Math.floor(ioi.length / 2)]!;
  // Treat median IOI as eighth or quarter — pick bpm in musical range
  let bpm = 60 / med;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
}

/** Krumhansl-ish key from chord roots / pitch histogram. */
export function estimateKey(notes: NoteEvent[]): string {
  const counts = new Array(12).fill(0);
  for (const n of notes) {
    if (DRUM_LIKE.test(n.instrument)) continue;
    counts[pc(n.pitch)] += n.end - n.start;
  }
  // Major key profiles (simplified)
  const major = [6.3, 2.2, 3.5, 2.3, 4.4, 4.1, 2.5, 5.2, 2.4, 3.7, 2.3, 2.9];
  const minor = [6.3, 2.8, 3.5, 5.4, 2.6, 3.5, 2.5, 4.8, 4.0, 2.7, 3.3, 3.2];
  let best = { name: "C", score: -1e9 };
  for (let root = 0; root < 12; root++) {
    let maj = 0;
    let min = 0;
    for (let i = 0; i < 12; i++) {
      const c = counts[(root + i) % 12] ?? 0;
      maj += c * (major[i] ?? 0);
      min += c * (minor[i] ?? 0);
    }
    if (maj > best.score) best = { name: NOTE_NAMES[root]!, score: maj };
    if (min > best.score)
      best = { name: `${NOTE_NAMES[root]}m`, score: min };
  }
  return best.name;
}

function notesInWindow(
  notes: NoteEvent[],
  start: number,
  end: number,
): NoteEvent[] {
  return notes.filter((n) => n.start < end && n.end > start);
}

/** Merge consecutive identical chord symbols. */
function mergeChords(chords: ChordHit[], minLen = 0.15): ChordHit[] {
  const out: ChordHit[] = [];
  for (const c of chords) {
    if (c.end - c.start < minLen) continue;
    const prev = out[out.length - 1];
    if (prev && prev.symbol === c.symbol) {
      prev.end = Math.max(prev.end, c.end);
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

/**
 * Pick a single melody stream: prefer voice-like instruments, else highest
 * non-bass/non-drum pitches per slice.
 */
export function extractMelody(
  notes: NoteEvent[],
  windowSec: number,
  duration: number,
): MelodyNote[] {
  const melodySrc = notes.filter((n) => !DRUM_LIKE.test(n.instrument));
  const preferred = melodySrc.filter((n) => MELODY_PREF.test(n.instrument));
  const pool = preferred.length > 4 ? preferred : melodySrc.filter((n) => !BASS_LIKE.test(n.instrument));
  if (pool.length === 0) return [];

  const melody: MelodyNote[] = [];
  for (let t = 0; t < duration; t += windowSec) {
    const win = pool.filter((n) => n.start < t + windowSec && n.end > t);
    if (win.length === 0) continue;
    // Highest pitch, break ties by preferred instrument
    win.sort((a, b) => {
      if (b.pitch !== a.pitch) return b.pitch - a.pitch;
      const ap = MELODY_PREF.test(a.instrument) ? 1 : 0;
      const bp = MELODY_PREF.test(b.instrument) ? 1 : 0;
      return bp - ap;
    });
    const top = win[0]!;
    const start = Math.max(t, top.start);
    const end = Math.min(t + windowSec, top.end);
    if (end - start < 0.04) continue;
    const last = melody[melody.length - 1];
    if (last && last.pitch === top.pitch && Math.abs(last.end - start) < 0.08) {
      last.end = end;
    } else {
      melody.push({ pitch: top.pitch, start, end });
    }
  }
  return melody;
}

export function midiToName(pitch: number): string {
  return `${NOTE_NAMES[pc(pitch)]}${Math.floor(pitch / 12) - 1}`;
}

/**
 * Build a fake-book style lead sheet from transcribed notes.
 */
export function buildLeadSheet(
  notes: NoteEvent[],
  opts: { bpm?: number; beatsPerBar?: number } = {},
): LeadSheet {
  if (notes.length === 0) {
    return {
      bpm: 120,
      key: "C",
      beatsPerBar: 4,
      barDuration: 2,
      duration: 0,
      bars: [],
      chords: [],
    };
  }

  const duration = Math.max(...notes.map((n) => n.end), 0.1);
  const bpm = opts.bpm ?? estimateBpm(notes);
  const beatsPerBar = opts.beatsPerBar ?? 4;
  const beatDur = 60 / bpm;
  const barDuration = beatDur * beatsPerBar;
  const key = estimateKey(notes);

  // Detect chords per beat
  const raw: ChordHit[] = [];
  for (let t = 0; t < duration; t += beatDur) {
    const win = notesInWindow(notes, t, t + beatDur * 1.05);
    const chord = detectChord(win);
    if (chord) {
      raw.push({
        ...chord,
        start: t,
        end: Math.min(duration, t + beatDur),
      });
    }
  }
  const chords = mergeChords(raw, beatDur * 0.4);

  const melody = extractMelody(notes, beatDur / 2, duration);

  const barCount = Math.max(1, Math.ceil(duration / barDuration));
  const bars: LeadBar[] = [];
  for (let i = 0; i < barCount; i++) {
    const start = i * barDuration;
    const end = Math.min(duration, start + barDuration);
    bars.push({
      index: i,
      start,
      end,
      chords: chords.filter((c) => c.start < end && c.end > start + 0.01),
      melody: melody.filter((m) => m.start < end && m.end > start),
    });
  }

  return { bpm, key, beatsPerBar, barDuration, duration, bars, chords };
}

/** Text export — classic fake-book chord chart. */
export function leadSheetToText(sheet: LeadSheet, title = "Lead sheet"): string {
  const lines: string[] = [
    title,
    `Key: ${sheet.key}   ·   ~${sheet.bpm} BPM   ·   ${sheet.beatsPerBar}/4`,
    "",
  ];
  for (let i = 0; i < sheet.bars.length; i += 4) {
    const row = sheet.bars.slice(i, i + 4);
    const cells = row.map((b) => {
      const syms = b.chords.map((c) => c.symbol);
      const uniq: string[] = [];
      for (const s of syms) if (uniq[uniq.length - 1] !== s) uniq.push(s);
      const label = uniq.length ? uniq.join("  ") : "·";
      return label.padEnd(12).slice(0, 12);
    });
    while (cells.length < 4) cells.push("".padEnd(12));
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
  return lines.join("\n");
}
