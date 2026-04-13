#!/usr/bin/env bash
# Copies tracked hook files into .git/hooks/ and sets permissions.
# Run once after cloning: npm run security:install-hooks

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_SRC="$SCRIPT_DIR/hooks"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"

if [ -z "$REPO_ROOT" ]; then
  echo "Error: not inside a git repository"
  exit 1
fi

HOOKS_DST="$REPO_ROOT/.git/hooks"

for hook in pre-commit post-merge; do
  if [ -f "$HOOKS_SRC/$hook" ]; then
    cp "$HOOKS_SRC/$hook" "$HOOKS_DST/$hook"
    chmod +x "$HOOKS_DST/$hook"
  fi
done

echo "Hooks installed."
