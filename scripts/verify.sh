#!/usr/bin/env bash
# The phase gate (CLAUDE.md): typecheck → lint → test (unit + API + DB) → e2e. Fails on the first error.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }
step "typecheck"; pnpm typecheck
step "lint";      pnpm lint
step "test";      pnpm test
step "e2e";       pnpm test:e2e
printf '\n\033[1;32m✔ verify passed\033[0m\n'
