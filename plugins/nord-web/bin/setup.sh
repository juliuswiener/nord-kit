#!/usr/bin/env bash
# nord-web setup — build the local tool venvs in $NORD_WEB_TOOLS.
# Idempotent-ish; safe to re-run. Requires: uv, an AMD ROCm stack for GPU MinerU.
#   bash setup.sh            # crawl4ai + mineru(ROCm) + pixelrag
#   bash setup.sh --stealth  # also add invisible_playwright (patched-Firefox stealth) to scrape-venv
set -euo pipefail

TOOLS="${NORD_WEB_TOOLS:-$HOME/02_Software/nord-web-tools}"
PYVER="${NORD_WEB_PYVER:-3.12}"
ROCM_INDEX="${NORD_WEB_ROCM_INDEX:-https://download.pytorch.org/whl/rocm7.2}"
TORCH_PIN="${NORD_WEB_TORCH:-torch==2.12.1 torchvision}"
WITH_STEALTH=0
[ "${1:-}" = "--stealth" ] && WITH_STEALTH=1

mkdir -p "$TOOLS"; cd "$TOOLS"

echo "== scrape-venv: Crawl4AI =="
uv venv --python "$PYVER" scrape-venv
( source scrape-venv/bin/activate
  uv pip install crawl4ai
  crawl4ai-setup || python -m playwright install chromium
  if [ "$WITH_STEALTH" = 1 ]; then
    # Stealth backend for hard anti-bot/sensitive sites — on-device, patched Firefox.
    # Source: github.com/feder-cr/invisible_playwright (MIT). Review before trusting.
    uv pip install "git+https://github.com/feder-cr/invisible_playwright"
  fi
)

echo "== mineru-venv: MinerU + torch ROCm =="
uv venv --python "$PYVER" mineru-venv
( source mineru-venv/bin/activate
  uv pip install --index-url "$ROCM_INDEX" $TORCH_PIN
  uv pip install "mineru[core]"
)

echo "== pixel-venv: pixelrag (pixelshot render) =="
uv venv --python "$PYVER" pixel-venv
( source pixel-venv/bin/activate
  uv pip install pixelrag
)

echo "== done. doctor: =="
"$(dirname "$0")/nw" doctor
