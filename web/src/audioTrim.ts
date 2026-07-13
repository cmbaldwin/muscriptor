/**
 * Client-side helpers for pre-transcription audio editing: decode, peaks,
 * multi-region slice, gain, fades, and export as a WAV File.
 */

export type TrimRegion = {
  /** Inclusive start in seconds. */
  start: number;
  /** Exclusive end in seconds. */
  end: number;
};

/** Full edit recipe applied before MIDI transcription. */
export type EditOptions = {
  /** Keep regions (kept in order). Overlaps are allowed but unusual. */
  regions: TrimRegion[];
  /** Linear gain multiplier (1 = unity). Clamped samples after gain. */
  gain: number;
  /** Fade-in length at the start of each region (seconds). */
  fadeInSec: number;
  /** Fade-out length at the end of each region (seconds). */
  fadeOutSec: number;
  /** Silence inserted between regions (seconds). */
  gapSec: number;
};

export const DEFAULT_EDIT: EditOptions = {
  regions: [],
  gain: 1,
  fadeInSec: 0.01,
  fadeOutSec: 0.01,
  gapSec: 0,
};

/** Decode an uploaded audio file via Web Audio. */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    const bytes = await file.arrayBuffer();
    return await ctx.decodeAudioData(bytes.slice(0));
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Downsample an AudioBuffer into `bars` peak magnitudes in [0, 1] for drawing
 * a simple waveform (max abs sample per bar, mono-mixed).
 */
export function computePeaks(buffer: AudioBuffer, bars: number): Float32Array {
  const peaks = new Float32Array(bars);
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  if (length === 0 || bars <= 0) return peaks;

  const block = Math.max(1, Math.floor(length / bars));
  for (let i = 0; i < bars; i++) {
    const from = i * block;
    const to = Math.min(length, from + block);
    let peak = 0;
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let s = from; s < to; s++) {
        const v = Math.abs(data[s] ?? 0);
        if (v > peak) peak = v;
      }
    }
    peaks[i] = peak;
  }
  let max = 0;
  for (let i = 0; i < bars; i++) if ((peaks[i] ?? 0) > max) max = peaks[i] ?? 0;
  if (max > 0) {
    for (let i = 0; i < bars; i++) peaks[i] = (peaks[i] ?? 0) / max;
  }
  return peaks;
}

/** Normalize and sort regions; drop empty / invalid ones. */
export function sanitizeRegions(
  regions: TrimRegion[],
  duration: number,
  minLen = 0.05,
): TrimRegion[] {
  return regions
    .map((r) => {
      const start = Math.max(0, Math.min(duration, r.start));
      const end = Math.max(start, Math.min(duration, r.end));
      return { start, end };
    })
    .filter((r) => r.end - r.start >= minLen)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** True if a time is inside any region. */
export function timeInRegions(t: number, regions: TrimRegion[]): boolean {
  return regions.some((r) => t >= r.start && t <= r.end);
}

/** Total output duration after edits (regions + gaps). */
export function outputDuration(regions: TrimRegion[], gapSec: number): number {
  if (regions.length === 0) return 0;
  let total = 0;
  regions.forEach((r, i) => {
    total += Math.max(0, r.end - r.start);
    if (i < regions.length - 1) total += Math.max(0, gapSec);
  });
  return total;
}

/**
 * Map a time on the concatenated output timeline back to source time.
 * Returns null if t falls in a gap between regions.
 */
export function outputTimeToSource(
  tOut: number,
  regions: TrimRegion[],
  gapSec: number,
): number | null {
  if (tOut < 0 || regions.length === 0) return null;
  let cursor = 0;
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i]!;
    const len = r.end - r.start;
    if (tOut < cursor + len) {
      return r.start + (tOut - cursor);
    }
    cursor += len;
    if (i < regions.length - 1) {
      if (tOut < cursor + gapSec) return null; // in gap
      cursor += gapSec;
    }
  }
  const last = regions[regions.length - 1]!;
  return last.end;
}

/** Peak absolute sample in buffer (all channels). */
export function peakLevel(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i] ?? 0);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/** Gain that puts peak at target (default 0.95). Returns 1 if already silent. */
export function normalizeGain(buffer: AudioBuffer, target = 0.95): number {
  const peak = peakLevel(buffer);
  if (peak < 1e-8) return 1;
  return target / peak;
}

/**
 * Build an AudioBuffer from one or more regions with gain + per-region fades
 * and optional silence between regions.
 */
export function buildEditedBuffer(
  buffer: AudioBuffer,
  options: EditOptions,
): AudioBuffer {
  const duration = buffer.duration;
  const regions = sanitizeRegions(options.regions, duration);
  if (regions.length === 0) {
    // Empty → 1 frame of silence so encodeWav still works.
    return new AudioBuffer({
      length: 1,
      numberOfChannels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
    });
  }

  const sr = buffer.sampleRate;
  const gain = Math.max(0, options.gain);
  const fadeInSec = Math.max(0, options.fadeInSec);
  const fadeOutSec = Math.max(0, options.fadeOutSec);
  const gapSec = Math.max(0, options.gapSec);
  const gapFrames = Math.floor(gapSec * sr);

  const pieces: { startF: number; frames: number }[] = [];
  let totalFrames = 0;
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i]!;
    const startF = Math.floor(r.start * sr);
    const endF = Math.ceil(r.end * sr);
    const frames = Math.max(1, endF - startF);
    pieces.push({ startF, frames });
    totalFrames += frames;
    if (i < regions.length - 1) totalFrames += gapFrames;
  }

  const out = new AudioBuffer({
    length: totalFrames,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: sr,
  });

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    let writeAt = 0;

    for (let p = 0; p < pieces.length; p++) {
      const { startF, frames } = pieces[p]!;
      const fadeInF = Math.min(Math.floor(fadeInSec * sr), Math.floor(frames / 2));
      const fadeOutF = Math.min(Math.floor(fadeOutSec * sr), Math.floor(frames / 2));

      for (let i = 0; i < frames; i++) {
        let sample = (src[startF + i] ?? 0) * gain;
        if (fadeInF > 0 && i < fadeInF) sample *= i / fadeInF;
        if (fadeOutF > 0 && i >= frames - fadeOutF) {
          sample *= (frames - 1 - i) / fadeOutF;
        }
        // Soft clip after gain so loud boosts don't wrap.
        dst[writeAt + i] = Math.max(-1, Math.min(1, sample));
      }
      writeAt += frames;

      if (p < pieces.length - 1 && gapFrames > 0) {
        // silence already zero-filled
        writeAt += gapFrames;
      }
    }
  }

  return out;
}

/** Encode an AudioBuffer as a 16-bit PCM WAV Blob. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const array = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(array);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([array], { type: "audio/wav" });
}

/** True when the edit is a no-op relative to the original file. */
export function isIdentityEdit(
  buffer: AudioBuffer,
  options: EditOptions,
): boolean {
  const regions = sanitizeRegions(options.regions, buffer.duration);
  if (regions.length !== 1) return false;
  const r = regions[0]!;
  const full = r.start <= 0.005 && r.end >= buffer.duration - 0.005;
  const unityGain = Math.abs(options.gain - 1) < 0.001;
  const noGap = options.gapSec <= 0.001;
  // Fades only matter if we re-encode; for identity we keep original file.
  return full && unityGain && noGap;
}

/**
 * Export the edited buffer as a WAV File suitable for upload.
 * Returns the original file when no real edit is needed.
 */
export async function exportEditedFile(
  file: File,
  buffer: AudioBuffer,
  options: EditOptions,
): Promise<File> {
  if (isIdentityEdit(buffer, options)) return file;

  const regions = sanitizeRegions(options.regions, buffer.duration);
  if (regions.length === 0) {
    throw new Error("Select at least one region longer than 50ms.");
  }

  const edited = buildEditedBuffer(buffer, { ...options, regions });
  const blob = encodeWav(edited);
  const base = file.name.replace(/\.[^/.]+$/, "") || "audio";
  const name = `${base}_edit_${regions.length}r.wav`;
  return new File([blob], name, { type: "audio/wav" });
}

/** @deprecated Use exportEditedFile */
export async function exportTrimmedFile(
  file: File,
  buffer: AudioBuffer,
  region: TrimRegion,
  fadeSec = 0.01,
): Promise<File> {
  return exportEditedFile(file, buffer, {
    regions: [region],
    gain: 1,
    fadeInSec: fadeSec,
    fadeOutSec: fadeSec,
    gapSec: 0,
  });
}

/** @deprecated Use buildEditedBuffer */
export function sliceBuffer(
  buffer: AudioBuffer,
  region: TrimRegion,
  fadeSec = 0.01,
): AudioBuffer {
  return buildEditedBuffer(buffer, {
    regions: [region],
    gain: 1,
    fadeInSec: fadeSec,
    fadeOutSec: fadeSec,
    gapSec: 0,
  });
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00.0";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const frac = Math.floor((sec % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${frac}`;
}

/** Linear gain → display dB (clamped). */
export function gainToDb(gain: number): string {
  if (gain <= 0) return "-∞ dB";
  const db = 20 * Math.log10(gain);
  const sign = db >= 0 ? "+" : "";
  return `${sign}${db.toFixed(1)} dB`;
}

export function newRegionId(): string {
  return `r_${Math.random().toString(36).slice(2, 9)}`;
}

export type RegionWithId = TrimRegion & { id: string };
