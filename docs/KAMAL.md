# Kamal deploy — muscriptor

Audio→MIDI service on the shared moab host. **Low public surface:** short hostname, CPU/`small` model, no marketing deploy notes in the app.

| Piece | Value |
|-------|--------|
| Host | `ms.moab.jp` |
| Service | `muscriptor` |
| Image | `moab/muscriptor` (ECR `ap-southeast-2`) |
| App port | `8000` |
| Health | `GET /health` |
| Defaults | `MUSCRIPTOR_MODEL=small`, `MUSCRIPTOR_DEVICE=cpu` |
| Secrets | CF origin PEMs, `HF_TOKEN`, ECR password |
| Server | `5.223.51.74` (kamal-proxy) |

Upstream Kyutai used Docker Swarm + GPU (`swarm.yml`). This box is CPU-only.

## One-time setup

```bash
# DNS: CNAME ms → moab.jp (proxied). Zone SSL Full (strict).
export CLOUDFLARE_API_TOKEN=…
~/.grok/skills/moab-fly-deploy/scripts/ensure-moab-cname.sh ms

# ECR
aws ecr create-repository --repository-name moab/muscriptor \
  --region ap-southeast-2 --profile default \
  --image-scanning-configuration scanOnPush=true 2>/dev/null || true

# Secrets
cp .kamal/secrets.example .kamal/secrets
export HF_TOKEN=hf_...   # accept license on huggingface.co/MuScriptor/muscriptor-small
```

Accept the gated model license, then deploy:

```bash
./scripts/deploy-preflight.sh   # optional
kamal setup                     # first time only
kamal deploy
curl -sS https://ms.moab.jp/health
```

First deploy is slow: image build + HF weight download into volume `muscriptor_hf_cache`.

## Day-to-day

```bash
export HF_TOKEN=hf_...   # only if volume empty / model change
kamal deploy
kamal app logs -f
kamal health
```

### Model / device

```yaml
env:
  clear:
    MUSCRIPTOR_MODEL: small   # small | medium | large
    MUSCRIPTOR_DEVICE: cpu    # cpu | cuda | auto
```

## Cloudflare + long transcriptions

`POST /transcribe` is SSE and can run for minutes. If the stream drops, use DNS-only for `ms` or trim audio in the UI.

## Fingerprint notes

- Hostname is short (`ms`), not a product landing domain.
- Telemetry env: `HF_HUB_DISABLE_TELEMETRY`, `DO_NOT_TRACK`.
- No extra public status page beyond `/health`.
- Do not commit `.kamal/secrets` with raw tokens.
