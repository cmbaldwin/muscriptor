# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS web-builder
WORKDIR /web

# pnpm is the project's package manager (pinned via package.json#packageManager).
RUN corepack enable

COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Download the soundfonts: the .sf3 the frontend streams from /soundfonts/,
# and the .sf2 for /auralize (to /MuseScore_General.sf2, one level above the
# package root — the runtime stage copies it from here). Runs in its own
# layer so day-to-day source changes don't re-trigger the 253 MB download.
COPY web/scripts/prepare-soundfonts.mjs scripts/
RUN node scripts/prepare-soundfonts.mjs

COPY web/ ./
RUN pnpm run build


FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS runtime


ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_FROZEN=1

WORKDIR /app

# fluidsynth is required at runtime for MIDI auralization (the /auralize endpoint).
RUN apt-get update \
    && apt-get install -y --no-install-recommends fluidsynth \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    uv sync --no-install-project

COPY pyproject.toml uv.lock README.md ./
# SoundFont for auralization; auralize() defaults to <repo-root>/MuseScore_General.sf2.
# Reuse the copy the web-builder stage downloaded — no need for it in the context.
COPY --from=web-builder /MuseScore_General.sf2 ./
COPY muscriptor/ ./muscriptor/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync

COPY --from=web-builder /web/dist ./web/dist


EXPOSE 8000
ENTRYPOINT ["uv", "run", "muscriptor", "serve", "--host", "0.0.0.0"]
