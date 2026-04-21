#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

mkdir -p app-frontend/.promptpit/skills/code-review
mkdir -p app-frontend/.cursor/rules
mkdir -p app-frontend/packages/ui/.cursor/rules
mkdir -p app-frontend/node_modules/some-dep
mkdir -p app-backend
mkdir -p llm-demo

# managed stack
cat > app-frontend/.promptpit/stack.json <<'JSON'
{"name":"app-frontend","version":"0.3.1"}
JSON
echo "# CLAUDE.md" > app-frontend/CLAUDE.md
cat > app-frontend/.promptpit/skills/code-review/SKILL.md <<'MD'
---
name: code-review
description: Review code
---
# Review
MD
echo "rule" > app-frontend/.cursor/rules/project-style.mdc
echo '{"name":"app-frontend"}' > app-frontend/package.json

# monorepo sub-config
echo "sub-rule" > app-frontend/packages/ui/.cursor/rules/ui.mdc

# junk that must be pruned
touch app-frontend/node_modules/some-dep/dummy

# unmanaged
echo "# CLAUDE.md" > app-backend/CLAUDE.md
echo '{"mcpServers":{}}' > app-backend/.mcp.json

# legacy
echo "legacy" > llm-demo/.cursorrules
