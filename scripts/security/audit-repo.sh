#!/usr/bin/env bash
# Pre-clone GitHub repo risk scorer. Checks a repo BEFORE you clone it.
# Usage: bash scripts/security/audit-repo.sh <github-url-or-owner/repo>
# Set GITHUB_TOKEN env var for higher API rate limits.

set -euo pipefail

red() { printf '\033[0;31m%s\033[0m\n' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$1"; }
green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
dim() { printf '\033[0;90m%s\033[0m\n' "$1"; }

if [ $# -lt 1 ]; then
  echo "Usage: $0 <github-url-or-owner/repo>"
  echo "Example: $0 expressjs/express"
  echo "Example: $0 https://github.com/expressjs/express"
  exit 1
fi

INPUT="$1"
# Extract owner/repo from URL or direct input
REPO=$(echo "$INPUT" | sed -E 's|https?://github\.com/||' | sed 's|\.git$||' | sed 's|/$||')

OWNER=$(echo "$REPO" | cut -d'/' -f1)
NAME=$(echo "$REPO" | cut -d'/' -f2)

if [ -z "$OWNER" ] || [ -z "$NAME" ]; then
  echo "Error: Could not parse owner/repo from: $INPUT"
  exit 1
fi

# GitHub API setup
AUTH_HEADER=""
if [ -n "${GITHUB_TOKEN:-}" ]; then
  AUTH_HEADER="Authorization: token $GITHUB_TOKEN"
fi

gh_api() {
  local endpoint="$1"
  if [ -n "$AUTH_HEADER" ]; then
    curl -sS -H "$AUTH_HEADER" -H "Accept: application/vnd.github.v3+json" "https://api.github.com$endpoint" 2>/dev/null
  else
    curl -sS -H "Accept: application/vnd.github.v3+json" "https://api.github.com$endpoint" 2>/dev/null
  fi
}

RISK=0
echo "Auditing: $OWNER/$NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Fetch repo data ─────────────────────────────────────────────────────────
REPO_DATA=$(gh_api "/repos/$OWNER/$NAME")

if echo "$REPO_DATA" | jq -e '.message' 2>/dev/null | grep -q "Not Found"; then
  echo "Error: Repository not found: $OWNER/$NAME"
  exit 1
fi

STARS=$(echo "$REPO_DATA" | jq -r '.stargazers_count // 0')
FORKS=$(echo "$REPO_DATA" | jq -r '.forks_count // 0')
ISSUES=$(echo "$REPO_DATA" | jq -r '.open_issues_count // 0')
CREATED=$(echo "$REPO_DATA" | jq -r '.created_at // ""')
PUSHED=$(echo "$REPO_DATA" | jq -r '.pushed_at // ""')
DESCRIPTION=$(echo "$REPO_DATA" | jq -r '.description // "none"')
TOPICS=$(echo "$REPO_DATA" | jq -r '.topics | length // 0')

echo "Stars: $STARS | Forks: $FORKS | Open Issues: $ISSUES"
echo "Description: $DESCRIPTION"

# ── Check 1: Repo age ───────────────────────────────────────────────────────
if [ -n "$CREATED" ]; then
  CREATED_EPOCH=$(date -d "$CREATED" +%s 2>/dev/null || date -jf "%Y-%m-%dT%H:%M:%SZ" "$CREATED" +%s 2>/dev/null || echo "0")
  NOW_EPOCH=$(date +%s)
  AGE_DAYS=$(( (NOW_EPOCH - CREATED_EPOCH) / 86400 ))

  if [ "$AGE_DAYS" -lt 30 ]; then
    red "  [+20] Repo is only $AGE_DAYS days old"
    RISK=$((RISK + 20))
  elif [ "$AGE_DAYS" -lt 90 ]; then
    yellow "  [+10] Repo is only $AGE_DAYS days old"
    RISK=$((RISK + 10))
  else
    dim "  [+0] Repo age: $AGE_DAYS days"
  fi

  # Stars per day ratio
  if [ "$AGE_DAYS" -gt 0 ] && [ "$STARS" -gt 100 ]; then
    STARS_PER_DAY=$((STARS / AGE_DAYS))
    if [ "$STARS_PER_DAY" -gt 20 ]; then
      red "  [+20] Suspicious star velocity: ~$STARS_PER_DAY stars/day"
      RISK=$((RISK + 20))
    elif [ "$STARS_PER_DAY" -gt 10 ]; then
      yellow "  [+10] High star velocity: ~$STARS_PER_DAY stars/day"
      RISK=$((RISK + 10))
    else
      dim "  [+0] Star velocity: ~$STARS_PER_DAY stars/day"
    fi
  fi
fi

# ── Check 2: Fork-to-star ratio ─────────────────────────────────────────────
if [ "$STARS" -gt 100 ]; then
  if [ "$FORKS" -eq 0 ]; then
    red "  [+15] Zero forks with $STARS stars"
    RISK=$((RISK + 15))
  else
    RATIO=$((STARS / FORKS))
    if [ "$RATIO" -gt 50 ]; then
      yellow "  [+10] Low fork:star ratio (1:$RATIO)"
      RISK=$((RISK + 10))
    else
      dim "  [+0] Fork:star ratio: 1:$RATIO"
    fi
  fi
fi

# ── Check 3: Issues vs stars ────────────────────────────────────────────────
if [ "$STARS" -gt 500 ] && [ "$ISSUES" -lt 5 ]; then
  yellow "  [+10] Only $ISSUES open issues for $STARS stars"
  RISK=$((RISK + 10))
else
  dim "  [+0] Issue count: $ISSUES"
fi

# ── Check 4: Owner account analysis ─────────────────────────────────────────
USER_DATA=$(gh_api "/users/$OWNER")
USER_CREATED=$(echo "$USER_DATA" | jq -r '.created_at // ""')
USER_REPOS=$(echo "$USER_DATA" | jq -r '.public_repos // 0')
USER_FOLLOWERS=$(echo "$USER_DATA" | jq -r '.followers // 0')
USER_TYPE=$(echo "$USER_DATA" | jq -r '.type // "User"')

echo ""
echo "Owner: $OWNER ($USER_TYPE)"
echo "Public repos: $USER_REPOS | Followers: $USER_FOLLOWERS"

if [ -n "$USER_CREATED" ]; then
  USER_EPOCH=$(date -d "$USER_CREATED" +%s 2>/dev/null || date -jf "%Y-%m-%dT%H:%M:%SZ" "$USER_CREATED" +%s 2>/dev/null || echo "0")
  USER_AGE_DAYS=$(( (NOW_EPOCH - USER_EPOCH) / 86400 ))

  if [ "$USER_AGE_DAYS" -lt 90 ]; then
    red "  [+15] Owner account is only $USER_AGE_DAYS days old"
    RISK=$((RISK + 15))
  elif [ "$USER_AGE_DAYS" -lt 180 ]; then
    yellow "  [+5] Owner account is $USER_AGE_DAYS days old"
    RISK=$((RISK + 5))
  else
    dim "  [+0] Account age: $USER_AGE_DAYS days"
  fi
fi

if [ "$USER_REPOS" -lt 3 ] && [ "$STARS" -gt 100 ]; then
  yellow "  [+10] Owner has only $USER_REPOS public repos but repo has $STARS stars"
  RISK=$((RISK + 10))
fi

if [ "$USER_FOLLOWERS" -lt 5 ] && [ "$STARS" -gt 200 ]; then
  yellow "  [+10] Owner has only $USER_FOLLOWERS followers but repo has $STARS stars"
  RISK=$((RISK + 10))
fi

# ── Check 5: Contributor count ───────────────────────────────────────────────
CONTRIBUTORS=$(gh_api "/repos/$OWNER/$NAME/contributors?per_page=5")
CONTRIB_COUNT=$(echo "$CONTRIBUTORS" | jq -r 'length // 0' 2>/dev/null || echo "0")

echo ""
echo "Contributors: $CONTRIB_COUNT"

if [ "$CONTRIB_COUNT" -le 1 ] && [ "$STARS" -gt 200 ]; then
  yellow "  [+10] Single contributor with $STARS stars"
  RISK=$((RISK + 10))
else
  dim "  [+0] Contributor count: $CONTRIB_COUNT"
fi

# ── Check 6: npm cross-reference (if it looks like an npm package) ──────────
HAS_PKG=$(gh_api "/repos/$OWNER/$NAME/contents/package.json" 2>/dev/null | jq -r '.name // empty' 2>/dev/null) || true

if [ -n "$HAS_PKG" ]; then
  NPM_DATA=$(curl -sS "https://registry.npmjs.org/$NAME" 2>/dev/null) || true
  NPM_EXISTS=$(echo "$NPM_DATA" | jq -r '.name // empty' 2>/dev/null) || true

  if [ -z "$NPM_EXISTS" ]; then
    dim "  [+0] Not published on npm (could be normal for tools)"
  else
    NPM_WEEKLY=$(curl -sS "https://api.npmjs.org/downloads/point/last-week/$NAME" 2>/dev/null | jq -r '.downloads // 0' 2>/dev/null) || NPM_WEEKLY=0
    echo "npm weekly downloads: $NPM_WEEKLY"

    if [ "$STARS" -gt 500 ] && [ "$NPM_WEEKLY" -lt 50 ]; then
      yellow "  [+10] $STARS GitHub stars but only $NPM_WEEKLY npm downloads/week"
      RISK=$((RISK + 10))
    fi
  fi
fi

# ── Risk Score ───────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Cap at 100
[ "$RISK" -gt 100 ] && RISK=100

if [ "$RISK" -le 30 ]; then
  green "RISK SCORE: $RISK/100 (LOW)"
  echo "This repo appears legitimate. Standard caution applies."
  exit 0
elif [ "$RISK" -le 60 ]; then
  yellow "RISK SCORE: $RISK/100 (MEDIUM)"
  echo "Proceed with caution. Run scan-repo.sh after cloning."
  exit 1
else
  red "RISK SCORE: $RISK/100 (HIGH)"
  echo "Do NOT clone without further investigation."
  exit 2
fi
