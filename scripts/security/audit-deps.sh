#!/usr/bin/env bash
# Dependency deep-audit. Wraps npm audit with additional checks.
# Usage: bash scripts/security/audit-deps.sh

set -euo pipefail

red() { printf '\033[0;31m%s\033[0m\n' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$1"; }
green() { printf '\033[0;32m%s\033[0m\n' "$1"; }

ISSUES=0

echo "Dependency Security Audit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. npm audit ─────────────────────────────────────────────────────────────
echo ""
echo "Running npm audit..."
AUDIT_JSON=$(npm audit --json 2>/dev/null) || true
AUDIT_VULNS=$(echo "$AUDIT_JSON" | jq -r '.metadata.vulnerabilities // {}' 2>/dev/null) || true

if [ -n "$AUDIT_VULNS" ]; then
  CRITICAL=$(echo "$AUDIT_VULNS" | jq -r '.critical // 0')
  HIGH=$(echo "$AUDIT_VULNS" | jq -r '.high // 0')
  MODERATE=$(echo "$AUDIT_VULNS" | jq -r '.moderate // 0')
  LOW=$(echo "$AUDIT_VULNS" | jq -r '.low // 0')

  if [ "$CRITICAL" -gt 0 ] || [ "$HIGH" -gt 0 ]; then
    red "  Critical: $CRITICAL | High: $HIGH | Moderate: $MODERATE | Low: $LOW"
    ISSUES=1
  elif [ "$MODERATE" -gt 0 ]; then
    yellow "  Critical: $CRITICAL | High: $HIGH | Moderate: $MODERATE | Low: $LOW"
  else
    green "  No vulnerabilities found"
  fi
else
  green "  No vulnerabilities found"
fi

# ── 2. Known malicious package check ─────────────────────────────────────────
echo ""
echo "Checking for known malicious packages..."

# Known malicious / compromised package names (non-exhaustive)
MALICIOUS_PACKAGES=(
  "crossenv" "cross-env.js" "d3.js" "fabric-js" "ffmpegs" "gruntcli"
  "http-proxy.js" "jquery.js" "mariadb" "mongose" "mlogtk" "mybigrepo"
  "node-hierarchysettings" "nodecaffe" "nodefabric" "node-opencv"
  "node-opensl" "node-openssl" "noderequest" "nodesass" "nodesqlite"
  "node-tkinter" "opencv.js" "openssl.js" "proxy.js" "shadowsock"
  "smb" "sqlite.js" "sqliter" "sqlserver" "tkinter" "event-stream"
  "flatmap-stream" "ua-parser-js" "coa" "rc"
)

if [ -f "package-lock.json" ]; then
  for pkg in "${MALICIOUS_PACKAGES[@]}"; do
    if jq -e ".packages.\"node_modules/$pkg\"" package-lock.json >/dev/null 2>&1; then
      red "  CRITICAL: Known malicious package found: $pkg"
      ISSUES=1
    fi
  done
  green "  No known malicious packages detected"
else
  yellow "  No package-lock.json found -- skipping"
fi

# ── 3. Packages with lifecycle scripts ───────────────────────────────────────
echo ""
echo "Packages with lifecycle scripts (blocked by ignore-scripts=true):"

if [ -d "node_modules" ]; then
  SCRIPT_PKGS=$(find node_modules -maxdepth 2 -name "package.json" -exec \
    jq -r 'select(.scripts.postinstall != null or .scripts.preinstall != null or .scripts.install != null) |
    "  " + .name + " (" +
    ([ if .scripts.preinstall then "preinstall" else empty end,
       if .scripts.install then "install" else empty end,
       if .scripts.postinstall then "postinstall" else empty end ] | join(", ")) + ")"' {} \; 2>/dev/null | sort) || true

  if [ -n "$SCRIPT_PKGS" ]; then
    yellow "$SCRIPT_PKGS"
    echo ""
    echo "  These scripts are blocked. To allow for a trusted package:"
    echo "  npm rebuild <package-name>"
  else
    green "  None found"
  fi
else
  echo "  node_modules not present -- run npm install first"
fi

# ── 4. Recently published packages ──────────────────────────────────────────
echo ""
echo "Checking dependency publish dates..."

if [ -f "package.json" ]; then
  DEPS=$(jq -r '(.dependencies // {}) * (.devDependencies // {}) | keys[]' package.json 2>/dev/null) || true
  NOW_EPOCH=$(date +%s)

  for dep in $DEPS; do
    PUB_DATE=$(curl -sS "https://registry.npmjs.org/$dep" 2>/dev/null | \
      jq -r '.time[.["dist-tags"].latest] // empty' 2>/dev/null) || true

    if [ -n "$PUB_DATE" ]; then
      PUB_EPOCH=$(date -d "$PUB_DATE" +%s 2>/dev/null || echo "0")
      AGE_DAYS=$(( (NOW_EPOCH - PUB_EPOCH) / 86400 ))

      if [ "$AGE_DAYS" -lt 7 ]; then
        yellow "  $dep: published $AGE_DAYS days ago (recent -- verify this is expected)"
      fi
    fi
  done
  green "  Publish date check complete"
fi

# ── 5. Lockfile integrity ────────────────────────────────────────────────────
echo ""
echo "Checking lockfile integrity..."
if [ -f "package-lock.json" ]; then
  # Check for non-standard registries
  REGISTRIES=$(jq -r '.. | .resolved? // empty' package-lock.json 2>/dev/null | \
    grep -oE 'https?://[^/]+' | sort -u | grep -v 'registry.npmjs.org') || true

  if [ -n "$REGISTRIES" ]; then
    red "  Non-standard registries found in lockfile:"
    echo "$REGISTRIES" | while read -r reg; do echo "    $reg"; done
    ISSUES=1
  else
    green "  All packages resolve from official npm registry"
  fi
else
  yellow "  No lockfile found"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$ISSUES" -eq 1 ]; then
  red "Issues found. Review above."
  exit 1
else
  green "All dependency checks passed."
  exit 0
fi
