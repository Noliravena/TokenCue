#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

swift build -c debug --product TokenCue --arch arm64
swift build -c debug --product TokenCue --arch x86_64
swift build -c debug --product tokencue --arch arm64
swift build -c debug --product tokencue --arch x86_64

printf '%s\n' "TokenCue sources built for Apple Silicon and Intel."
