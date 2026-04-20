#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

mkdir -p .claude

# user-level Claude Code config — enough for detectAdapters() to find one
cat > CLAUDE.md <<'MD'
# CLAUDE.md

User-level global instructions for Claude Code.
MD
