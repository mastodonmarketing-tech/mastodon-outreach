#!/usr/bin/env bash
# MCP server configuration security scanner.
# Scans for inline secrets, overly broad permissions, and exposed configs.
# Usage: bash scripts/security/audit-mcp.sh

set -euo pipefail

red() { printf '\033[0;31m%s\033[0m\n' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$1"; }
green() { printf '\033[0;32m%s\033[0m\n' "$1"; }

ISSUES=0

echo "MCP Server Security Audit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Locations to check
MCP_CONFIGS=(
  "$HOME/.claude/settings.json"
  "$HOME/.claude/settings.local.json"
  ".mcp.json"
  ".claude/settings.json"
  ".claude/settings.local.json"
  "$HOME/.config/claude/settings.json"
  "$HOME/.cursor/mcp.json"
  "$HOME/.vscode/settings.json"
)

FOUND_CONFIGS=0

for config in "${MCP_CONFIGS[@]}"; do
  [ ! -f "$config" ] && continue
  FOUND_CONFIGS=$((FOUND_CONFIGS + 1))

  echo ""
  echo "Scanning: $config"

  # ── Check file permissions ──────────────────────────────────────────────
  PERMS=$(stat -c '%a' "$config" 2>/dev/null || stat -f '%Lp' "$config" 2>/dev/null || echo "unknown")
  if [ "$PERMS" != "unknown" ]; then
    WORLD_READ=$(echo "$PERMS" | grep -c '[0-9][0-9][4-7]$' || true)
    if [ "$WORLD_READ" -gt 0 ]; then
      yellow "  WARNING: File is world-readable (permissions: $PERMS)"
      echo "  Fix: chmod 600 $config"
      ISSUES=1
    else
      green "  File permissions: $PERMS"
    fi
  fi

  # ── Check for inline secrets ────────────────────────────────────────────
  INLINE_SECRETS=$(grep -nE '(api[_-]?key|token|secret|password|credential)["\x27]?\s*[:=]\s*["\x27][A-Za-z0-9+/\-_]{10,}["\x27]' "$config" 2>/dev/null | \
    grep -vi 'env\|process\|variable\|\$\{' | head -5) || true

  if [ -n "$INLINE_SECRETS" ]; then
    red "  CRITICAL: Possible inline secrets (should use env vars)"
    echo "$INLINE_SECRETS" | while read -r line; do echo "    $line"; done
    ISSUES=1
  fi

  # ── Check for broad permissions ─────────────────────────────────────────
  BROAD_PERMS=$(grep -nE 'Bash\(\*\)|allow.*\*|"allow"\s*:\s*\[.*"Bash"' "$config" 2>/dev/null | head -5) || true

  if [ -n "$BROAD_PERMS" ]; then
    yellow "  WARNING: Overly broad permissions detected"
    echo "$BROAD_PERMS" | while read -r line; do echo "    $line"; done
    ISSUES=1
  fi

  # ── Check for sensitive path access ─────────────────────────────────────
  SENSITIVE_PATHS=$(grep -nE '(/\.ssh|/\.aws|/\.gnupg|/\.config/gh|/etc/passwd|/etc/shadow)' "$config" 2>/dev/null | head -5) || true

  if [ -n "$SENSITIVE_PATHS" ]; then
    red "  CRITICAL: MCP server accessing sensitive paths"
    echo "$SENSITIVE_PATHS" | while read -r line; do echo "    $line"; done
    ISSUES=1
  fi

  # ── List MCP servers ────────────────────────────────────────────────────
  SERVERS=$(jq -r '.mcpServers // {} | keys[]' "$config" 2>/dev/null) || true
  if [ -n "$SERVERS" ]; then
    echo "  Connected MCP servers:"
    echo "$SERVERS" | while read -r server; do echo "    - $server"; done
  fi
done

# ── Check for MCP configs in public repos ──────────────────────────────────
echo ""
echo "Checking for MCP configs that might be committed..."
GIT_TRACKED=$(git ls-files 2>/dev/null | grep -iE 'mcp\.json|claude.*settings' || true)

if [ -n "$GIT_TRACKED" ]; then
  red "CRITICAL: MCP config files tracked by git (may expose secrets):"
  echo "$GIT_TRACKED" | while read -r f; do echo "  $f"; done
  ISSUES=1
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FOUND_CONFIGS" -eq 0 ]; then
  echo "No MCP configuration files found."
  exit 0
elif [ "$ISSUES" -gt 0 ]; then
  red "Issues found. Review above."
  exit 1
else
  green "All MCP security checks passed."
  exit 0
fi
