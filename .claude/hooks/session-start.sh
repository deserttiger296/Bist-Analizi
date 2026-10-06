#!/bin/bash
# Claude Code bulut oturumu açılışında bağımlılıkları kurar (yalnızca uzak ortamda çalışır).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# --- Python: python_bot/requirements-lock.txt (Python 3.12 için sabitlenmiş) ---
if [ ! -x .venv/bin/python ]; then
  uv venv --python 3.12 .venv -q
fi

if ! uv pip install -q --python .venv/bin/python -r python_bot/requirements-lock.txt pytest; then
  # download.pytorch.org ağ politikasınca engelliyse torch'u aynı sürümle PyPI'dan kur.
  echo "PyTorch CPU index erişilemedi, torch PyPI'dan kuruluyor." >&2
  tmp_lock="$(mktemp)"
  grep -v "extra-index-url" python_bot/requirements-lock.txt \
    | sed 's/^torch==\([^+]*\)+cpu/torch==\1/' > "$tmp_lock"
  uv pip install -q --python .venv/bin/python -r "$tmp_lock" pytest
  rm -f "$tmp_lock"
fi

# --- Node ---
npm ci --no-audit --no-fund

# --- FinBERT önbelleği (best-effort; huggingface.co engelliyse motor lexicon fallback'e düşer) ---
if ! .venv/bin/python - << 'PY' 2>/dev/null
from transformers import AutoTokenizer, AutoModelForSequenceClassification
AutoTokenizer.from_pretrained("ProsusAI/finbert")
AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert")
PY
then
  echo "FinBERT indirilemedi (huggingface.co erişimi?); sentiment lexicon fallback ile çalışır." >&2
fi
