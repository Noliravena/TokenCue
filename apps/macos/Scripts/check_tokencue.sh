#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONOREPO_ROOT="$(cd "${ROOT_DIR}/../.." && pwd)"
cd "${ROOT_DIR}"

swift package dump-package >/dev/null

if rg -n 'import (CloudKit|WidgetKit)|Sparkle' Package.swift Sources/TokenCue Sources/TokenCueCore; then
  printf '%s\n' "TokenCue macOS source still contains a removed platform capability." >&2
  exit 1
fi

node "${MONOREPO_ROOT}/scripts/check-contracts.mjs"
node "${ROOT_DIR}/Scripts/check-app-locales.mjs"

printf '%s\n' "TokenCue macOS static checks passed."
