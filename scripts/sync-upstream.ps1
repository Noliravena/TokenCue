[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$MacRef,
    [Parameter(Mandatory = $false)]
    [string]$WindowsRef,
    [string]$Output = "docs/upstream/generated/candidate-report.md"
)

$ErrorActionPreference = "Stop"

# External product repository clone/sync is intentionally disabled.
# shared/upstream-lock.json keeps historical import snapshot pins (tag/commit only)
# and does not store clone URLs for third-party product repositories.
throw @"
Upstream product repository sync is disabled.

TokenCue no longer clones external product repositories for parity sync.
- shared/upstream-lock.json records import snapshot pins only (tags/commits), without repository URLs.
- policy.externalProductSync is false.

For local provider parity against the current monorepo trees, run:
  pnpm run upstream:report

Import-pin policy: docs/upstream-policy.md
Manual review of historical MIT import pins: THIRD_PARTY_NOTICES.md
"@
