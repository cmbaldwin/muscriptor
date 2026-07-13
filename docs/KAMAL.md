# Kamal deploy — muscriptor

Runs **MuScriptor** (audio→MIDI web UI + API) with Kamal 2:

| Piece | Value |
|-------|--------|
| App port | `8000` |
| Health | `GET /health` |
| Defaults | `MUSCRIPTOR_MODEL=small`, `MUSCRIPTOR_DEVICE=cpu` |
| Secrets | `HF_TOKEN`, TLS cert/key (if using origin PEMs) |

Upstream Kyutai deploy used Docker Swarm + GPU (`swarm.yml`). On a typical
VPS without a GPU, start with **small** on **cpu**. Use `medium`/`cuda` only
on a GPU machine.

## One-time setup

### 1. DNS + TLS

Point your hostname (e.g. `muscriptor.example.com`) at the server. If you use
Cloudflare in front of kamal-proxy with origin certificates, set SSL/TLS mode
to **Full** (not Flexible).

### 2. Container registry

Create a repository for the image name in `config/deploy.yml` (ECR, GHCR, Docker
Hub, etc.) and ensure the deploy machine can push/pull.

### 3. Hugging Face

1. Create a free account at https://huggingface.co  
2. Accept the model license on e.g. https://huggingface.co/MuScriptor/muscriptor-small  
3. Create a read token: https://huggingface.co/settings/tokens  
4. Export before deploy: `export HF_TOKEN=hf_...`

### 4. Secrets file

```bash
cd /path/to/muscriptor
cp .kamal/secrets.example .kamal/secrets
# edit placeholders; ensure HF_TOKEN is exported in your shell
export HF_TOKEN=hf_...
```

`.kamal/secrets` must **never** be committed (see `.gitignore`).

### 5. Fill `config/deploy.yml`

Replace:

- `YOUR_SERVER_IP`
- `YOUR_REGISTRY_NAMESPACE` / registry `server`
- `proxy.host`

### 6. Kamal

```bash
gem install kamal   # or: brew install kamal
kamal setup         # first time only
kamal deploy
```

First deploy can take several minutes: image build (Node UI + Python +
soundfonts) plus HF weight download into the `muscriptor_hf_cache` volume.

## Day-to-day

```bash
export HF_TOKEN=hf_...   # only needed if weights missing / new model
kamal deploy
kamal app logs -f
kamal health             # alias → curl /health inside container
kamal shell
```

### Change model / device

Edit `config/deploy.yml`:

```yaml
env:
  clear:
    MUSCRIPTOR_MODEL: medium   # small | medium | large
    MUSCRIPTOR_DEVICE: cpu     # cpu | cuda | auto
```

Then `kamal deploy`. Weights stay on the volume across deploys.

## Cloudflare / long transcriptions

`POST /transcribe` is an **SSE** stream that can run for minutes on long audio.
Some CDN proxies have short idle timeouts. If browsers drop mid-stream:

- Use DNS-only (no proxy) for the host, or  
- Trim audio in the UI (multi-region trim is supported)

## Local image smoke test

```bash
docker build -t muscriptor:local .
docker run --rm -p 8000:8000 \
  -e HF_TOKEN=$HF_TOKEN \
  -e MUSCRIPTOR_MODEL=small \
  -e MUSCRIPTOR_DEVICE=cpu \
  -v muscriptor_hf_dev:/data/huggingface \
  muscriptor:local

curl -s http://127.0.0.1:8000/health
open http://127.0.0.1:8000
```

## Files for Kamal

| Path | Role |
|------|------|
| `config/deploy.yml` | Kamal service definition (placeholders) |
| `bin/docker-entrypoint` | Port/model/device + HF volume seed |
| `Dockerfile` | Multi-stage web+python, entrypoint, `/data` cache |
| `.kamal/secrets.example` | Template only — no real credentials |
| `docs/KAMAL.md` | This runbook |

Upstream `swarm.yml` / `deploy.sh` remain for the original Kyutai GPU stack.
