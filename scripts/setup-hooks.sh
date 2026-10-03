#!/usr/bin/env bash
# One-time per clone: use the repo's hooks (.githooks). Idempotent.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
git config core.hooksPath .githooks
echo "setup-hooks: core.hooksPath = .githooks"
