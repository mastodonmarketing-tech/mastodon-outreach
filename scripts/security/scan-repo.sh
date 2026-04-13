#!/usr/bin/env bash
# Post-clone security scanner. Run BEFORE npm install on any cloned repo.
# Usage: bash scripts/security/scan-repo.sh [directory]
# Outputs findings by severity. Prints "No threats detected." if clean.

set -euo pipefail

TARGET="${1:-.}"
TARGET="$(cd "$TARGET" && pwd)"
FOUND_CRITICAL=0
FOUND_WARNING=0

red() { printf '\033[0;31m%s\033[0m\n' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$1"; }
green() { printf '\033[0;32m%s\033[0m\n' "$1"; }

# ── 1. Lifecycle scripts in package.json files ──────────────────────────────
LIFECYCLE_HOOKS=("preinstall" "postinstall" "install" "prepare" "prepublish" "prepublishOnly")
PKGJSONS=$(find "$TARGET" -name "package.json" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null)

for pkg in $PKGJSONS; do
  for hook in "${LIFECYCLE_HOOKS[@]}"; do
    SCRIPT_VAL=$(jq -r ".scripts.\"$hook\" // empty" "$pkg" 2>/dev/null)
    if [ -n "$SCRIPT_VAL" ]; then
      # Check for dangerous commands inside lifecycle scripts
      if echo "$SCRIPT_VAL" | grep -qE 'curl |wget |bash |sh -c|eval |/dev/tcp|nc |ncat |\|.*base64'; then
        red "CRITICAL: Dangerous lifecycle script in $pkg"
        echo "  $hook: $SCRIPT_VAL"
        FOUND_CRITICAL=1
      else
        yellow "WARNING: Lifecycle script found in $pkg"
        echo "  $hook: $SCRIPT_VAL"
        FOUND_WARNING=1
      fi
    fi
  done
done

# ── 2. Suspicious shell commands in non-doc files ───────────────────────────
SUSPICIOUS_CMDS='curl\s+[^#]|wget\s+[^#]|/dev/tcp/|nc\s+-[elp]|ncat\s|bash\s+-i|python[3]?\s+-c|ruby\s+-e|perl\s+-e'
MATCHES=$(grep -rnE "$SUSPICIOUS_CMDS" "$TARGET" \
  --include="*.sh" --include="*.js" --include="*.ts" --include="*.py" --include="*.rb" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=security \
  2>/dev/null | grep -v 'README\|\.md:' | head -20) || true

if [ -n "$MATCHES" ]; then
  yellow "WARNING: Suspicious shell commands found"
  echo "$MATCHES" | while read -r line; do
    echo "  $line"
  done
  FOUND_WARNING=1
fi

# ── 3. Base64 encoded payloads ──────────────────────────────────────────────
B64_MATCHES=$(grep -rnE '[A-Za-z0-9+/]{60,}={0,2}' "$TARGET" \
  --include="*.js" --include="*.ts" --include="*.sh" --include="*.py" \
  --exclude-dir=node_modules --exclude-dir=.git \
  2>/dev/null | grep -v 'package-lock\|\.lock\|\.svg\|\.map' | head -10) || true

B64_FUNCS=$(grep -rnE 'atob\(|Buffer\.from\(.+,\s*["\x27]base64|base64\s+--?d' "$TARGET" \
  --include="*.js" --include="*.ts" --include="*.sh" \
  --exclude-dir=node_modules --exclude-dir=.git \
  2>/dev/null | head -10) || true

if [ -n "$B64_MATCHES" ] || [ -n "$B64_FUNCS" ]; then
  yellow "WARNING: Base64 encoded content detected"
  [ -n "$B64_MATCHES" ] && echo "$B64_MATCHES" | while read -r line; do echo "  $line"; done
  [ -n "$B64_FUNCS" ] && echo "$B64_FUNCS" | while read -r line; do echo "  $line"; done
  FOUND_WARNING=1
fi

# ── 4. Obfuscated JavaScript ────────────────────────────────────────────────
OBFUS=$(grep -rnE 'eval\(|new\s+Function\(|String\.fromCharCode\(' "$TARGET" \
  --include="*.js" --include="*.mjs" \
  --exclude-dir=node_modules --exclude-dir=.git \
  2>/dev/null | head -10) || true

if [ -n "$OBFUS" ]; then
  red "CRITICAL: Possible obfuscated code"
  echo "$OBFUS" | while read -r line; do echo "  $line"; done
  FOUND_CRITICAL=1
fi

# ── 5. Binary / executable files ────────────────────────────────────────────
BINARIES=$(find "$TARGET" -type f \( -name "*.exe" -o -name "*.dll" -o -name "*.so" -o -name "*.dylib" -o -name "*.bin" \) \
  -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null) || true

EXECUTABLES=$(find "$TARGET" -type f -executable \
  -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/hooks/*" \
  -not -name "*.sh" 2>/dev/null | head -10) || true

ELF_FILES=""
if [ -n "$EXECUTABLES" ]; then
  for f in $EXECUTABLES; do
    if file "$f" 2>/dev/null | grep -qE 'ELF|Mach-O|PE32|PE32\+'; then
      ELF_FILES="$ELF_FILES $f"
    fi
  done
fi

if [ -n "$BINARIES" ] || [ -n "$ELF_FILES" ]; then
  red "CRITICAL: Binary/executable files found"
  [ -n "$BINARIES" ] && echo "$BINARIES" | while read -r line; do echo "  $line"; done
  [ -n "$ELF_FILES" ] && echo "$ELF_FILES" | tr ' ' '\n' | grep -v '^$' | while read -r line; do echo "  $line"; done
  FOUND_CRITICAL=1
fi

# ── 6. Hardcoded secrets patterns ───────────────────────────────────────────
SECRETS=$(grep -rnE 'AKIA[0-9A-Z]{16}|gh[pos]_[A-Za-z0-9_]{36,}|xox[baprs]-[A-Za-z0-9\-]{10,}|-----BEGIN[[:space:]]+(RSA|DSA|EC|OPENSSH)?[[:space:]]*PRIVATE KEY-----' "$TARGET" \
  --include="*.js" --include="*.ts" --include="*.sh" --include="*.py" --include="*.env" --include="*.cfg" --include="*.conf" --include="*.yml" --include="*.yaml" \
  --exclude-dir=node_modules --exclude-dir=.git \
  2>/dev/null | grep -v '\.example\|\.sample\|\.template' | head -10) || true

if [ -n "$SECRETS" ]; then
  red "CRITICAL: Possible hardcoded secrets"
  echo "$SECRETS" | while read -r line; do echo "  $line"; done
  FOUND_CRITICAL=1
fi

# ── 7. Lifecycle scripts in node_modules (if present) ───────────────────────
if [ -d "$TARGET/node_modules" ]; then
  NM_SCRIPTS=$(find "$TARGET/node_modules" -maxdepth 3 -name "package.json" -exec \
    jq -r 'select(.scripts.postinstall != null or .scripts.preinstall != null or .scripts.install != null) | .name + ": " + (.scripts.postinstall // .scripts.preinstall // .scripts.install)' {} \; 2>/dev/null | head -20) || true

  if [ -n "$NM_SCRIPTS" ]; then
    yellow "WARNING: node_modules packages with lifecycle scripts"
    echo "$NM_SCRIPTS" | while read -r line; do echo "  $line"; done
    FOUND_WARNING=1
  fi
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
if [ "$FOUND_CRITICAL" -eq 1 ]; then
  red "RESULT: Critical threats detected. Do NOT install dependencies."
  exit 2
elif [ "$FOUND_WARNING" -eq 1 ]; then
  yellow "RESULT: Warnings found. Review before proceeding."
  exit 1
else
  green "No threats detected."
  exit 0
fi
