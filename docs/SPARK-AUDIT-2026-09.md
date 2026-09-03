# Spark audit 2026-09-03 (muscriptor)

10 findings (severity / effort), then the 5 fixed in this PR.

## The 10

1. **No CI test workflow** — only `pypi.yml` on release; PRs merge untested. (high / small)
2. **`pypi.yml` uses `actions/checkout@v2`** — deprecated Node16 runner, risks failing. (med / trivial)
3. **`scripts/deploy-preflight.sh` SSHs `root@5.223.51.74`** — decommissioned; prod is `5.223.44.132` per `config/deploy.yml`. Preflight always fails / probes the wrong box. (high / trivial)
4. **Unbounded upload reads in `/transcribe` + `/auralize`** — `await file.read()` buffers arbitrary bodies into RAM (DoS). (high / small)
5. **`/auralize` leaks internals** — `except Exception → 500 str(e)` exposes FluidSynth paths/command lines. (med / trivial)
6. **HTTP weight download has no timeout** — `urlretrieve` hangs forever on a stalled mirror; URL ending in `/` yields an empty cache filename. (med / small)
7. **CLI `--auralize` + `-o -` silently ignored** — condition `auralize is not None and not is_stdout` drops the flag without a word; stdout would carry MIDI bytes anyway. (med / trivial)
8. **Server `unknown instrument → 400` path untested** — validation exists, zero coverage. (low / trivial)
9. **`tests/conftest.py` hardcodes `/home/simon/audio/…`** — stale personal path. (low / trivial)
10. **Legacy swarm deploy (`swarm.yml`, `deploy.sh`) contradicts Kamal** — old registry, old domain, GPU reservation vs CPU/small. Confusing but referenced nowhere in the live path. (low / small)

## Fixed in this PR (5)

- **1+2 (CI):** new `.github/workflows/ci.yml` (hermetic pytest, integration excluded); `checkout@v2 → v4`.
- **3 (preflight):** SSH host `5.223.51.74 → 5.223.44.132`.
- **4+5+8 (server):** 256 MB chunked upload cap → 413 on `/transcribe` + `/auralize`; generic 500 detail (logged server-side) for auralize failures; tests for 413, unknown-instrument 400, error-shape.
- **7 (CLI):** `--auralize` with `-o -` and `--auralize` without `--format midi` now fail fast before model load; tests.
- **6 (download):** `urlopen(..., timeout=60)` + atomic rename preserved; empty-filename fallback; tests.

Verified: `pytest tests/test_server.py tests/test_cli.py tests/test_download.py` — 22 passed.

## Skipped (5)

- **9:** cosmetic; touches shared fixture, no user impact. Left alone.
- **10:** deleting live-adjacent deploy files is higher-risk review surface than the value; deserves its own PR with the deploy owner.
- Open upstream PRs (MIDI channel leak, mobile upload, BPM embed, waveform editor, etc.) deliberately untouched — no duplication.
- Registry/ECR/Kamal hosts/secrets: off-limits per mission, not audited.
- No dependency bumps, refactors, or new features — out of scope.
