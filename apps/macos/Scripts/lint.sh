#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${ROOT_DIR}/.build/lint-tools/bin"

ensure_swiftformat() {
  "${ROOT_DIR}/Scripts/install_lint_tools.sh" swiftformat
}

ensure_swiftlint() {
  "${ROOT_DIR}/Scripts/install_lint_tools.sh" swiftlint
}

check_codex_parser_hash() {
  "${ROOT_DIR}/Scripts/regenerate-codex-parser-hash.sh" --check
}

check_provider_manifests() {
  "${ROOT_DIR}/Scripts/regenerate-provider-manifests.sh" --check
}

check_swift_test_sharding() {
  "${ROOT_DIR}/Scripts/test_swift_test_sharding.sh"
}

check_ci_path_gate() {
  "${ROOT_DIR}/Scripts/test_ci_path_gate.sh"
}

check_repository_size() {
  "${ROOT_DIR}/Scripts/check_repository_size.sh"
  "${ROOT_DIR}/Scripts/test_repository_size.sh"
}

check_shell_scripts() {
  local count=0
  local script
  for script in "${ROOT_DIR}"/Scripts/*.sh; do
    [[ -f "$script" ]] || continue
    bash -n "$script"
    count=$((count + 1))
  done
  printf 'shell scripts OK: %d files\n' "$count"
}

check_app_locales() {
  node "${ROOT_DIR}/Scripts/check-app-locales.mjs" --test
  node "${ROOT_DIR}/Scripts/check-app-locales.mjs"
}

run_portable_checks() {
  check_codex_parser_hash
  check_provider_manifests
  check_swift_test_sharding
  check_ci_path_gate
  check_repository_size
  check_shell_scripts
}

run_swiftformat_lint() {
  ensure_swiftformat
  "${BIN_DIR}/swiftformat" Sources Tests --lint
}

run_swiftlint() {
  ensure_swiftlint
  "${BIN_DIR}/swiftlint" --strict
}

cmd="${1:-lint}"

case "$cmd" in
  lint)
    check_app_locales
    run_portable_checks
    run_swiftformat_lint
    run_swiftlint
    ;;
  lint-linux)
    run_portable_checks
    run_swiftlint
    ;;
  lint-macos)
    check_app_locales
    run_swiftformat_lint
    ;;
  format)
    ensure_swiftformat
    "${BIN_DIR}/swiftformat" Sources Tests
    ;;
  *)
    printf 'Usage: %s [lint|lint-linux|lint-macos|format]\n' "$(basename "$0")" >&2
    exit 2
    ;;
esac
