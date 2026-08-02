#!/usr/bin/env bash
# Preflight for muscriptor Kamal deploy (ms.moab.jp).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ok=0; warn=0; fail=0
pass() { echo "  OK  $*"; ok=$((ok+1)); }
note() { echo "  ..  $*"; warn=$((warn+1)); }
die()  { echo "  FAIL $*"; fail=$((fail+1)); }

echo "=== muscriptor deploy preflight ==="
echo "branch: $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)"
[[ -f config/deploy.yml && -f Dockerfile && -f .kamal/secrets ]] && pass "deploy files" || die "missing deploy files"
grep -q 'host: ms.moab.jp' config/deploy.yml && pass "host ms.moab.jp" || die "host"
grep -q 'service: muscriptor' config/deploy.yml && pass "service muscriptor" || die "service"
grep -q 'path: /health' config/deploy.yml && pass "health /health" || die "health"
command -v docker >/dev/null && docker info >/dev/null 2>&1 && pass "docker" || note "docker not ready"
command -v aws >/dev/null && (aws sts get-caller-identity --profile default >/dev/null 2>&1 || aws sts get-caller-identity >/dev/null 2>&1) && pass "aws creds" || die "aws"
[[ -n "${HF_TOKEN:-}" ]] && pass "HF_TOKEN set" || note "HF_TOKEN unset (needed first boot)"
ssh -o BatchMode=yes -o ConnectTimeout=5 root@5.223.51.74 true 2>/dev/null && pass "ssh host" || die "ssh root@5.223.51.74"
echo "=== $ok ok · $warn notes · $fail failures ==="
[[ "$fail" -eq 0 ]] || exit 1
echo "Ready: kamal deploy   (or bin/kamal deploy)"
echo "DNS once: ensure CNAME ms.moab.jp → moab.jp (proxied)"
echo "ECR once: aws ecr create-repository --repository-name moab/muscriptor --region ap-southeast-2"
