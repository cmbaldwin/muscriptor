#!/usr/bin/env node
// Fetches the soundfonts the app needs from the MuseScore mirror:
//
//   - MuseScore_General.sf2 (215 MB) -> <repo root>, used by the backend's
//     fluidsynth /auralize endpoint (and copied into the Docker runtime image
//     from the web-builder stage).
//   - MuseScore_General.sf3 (38 MB, vorbis-compressed build of the same
//     soundfont) -> public/soundfonts/, streamed by the frontend into its
//     spessasynth_lib AudioWorklet synthesizer (see src/audio.ts).
//
// Runs on every build (pnpm prebuild) and is idempotent and fast: files
// already on disk are never re-downloaded (a download goes to a temp file
// first, so a half-finished download never masquerades as a complete one).
// Pass --force to re-download both.
//
// Usage:
//   node scripts/prepare-soundfonts.mjs [--force]

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const MIRROR = "https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");

const DOWNLOADS = [
  {
    url: `${MIRROR}/MuseScore_General.sf2`,
    dest: path.resolve(webRoot, "../MuseScore_General.sf2"),
  },
  {
    url: `${MIRROR}/MuseScore_General.sf3`,
    dest: path.resolve(webRoot, "public/soundfonts/MuseScore_General.sf3"),
  },
];

async function download(url, dest) {
  console.log(`Downloading ${url} -> ${dest}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  }
  const size = Number(res.headers.get("content-length"));
  if (size) console.log(`(${(size / 1024 / 1024).toFixed(0)} MB)`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmpPath = `${dest}.download`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmpPath));
  const magic = Buffer.alloc(4);
  const fd = fs.openSync(tmpPath, "r");
  fs.readSync(fd, magic, 0, 4, 0);
  fs.closeSync(fd);
  if (magic.toString("ascii") !== "RIFF") {
    fs.unlinkSync(tmpPath);
    throw new Error(`Downloaded file is not a RIFF soundfont: ${url}`);
  }
  fs.renameSync(tmpPath, dest);
}

for (const { url, dest } of DOWNLOADS) {
  if (!force && fs.existsSync(dest)) {
    console.log(`${dest} already present; skipping.`);
    continue;
  }
  await download(url, dest);
}
