# Mastodon Marketing LinkedIn Automation

Automated LinkedIn content pipeline for Mastodon Marketing (Houston-based digital marketing agency).

## Architecture

Two Make.com scenarios form the pipeline:

1. **Content Engine** (Scenario 1): Scheduled Mon/Wed/Fri 6AM CT. Scans RSS feeds, uses Gemini AI to select a topic, generate a LinkedIn post draft, and QC score it. Logs to Google Sheets and sends approval DM to Slack.

2. **Approve + Publish** (Scenario 2): Triggered by Slack emoji reaction. Routes to approve (schedule via GHL), edit (Gemini revision), or reject.

## Key Conventions

- Scripts use **CommonJS** (`require()`) with `node-fetch` v2 and `dotenv`
- Prompt files are **plain text** (.txt), not markdown
- Make.com blueprints use `{{variable}}` notation for placeholders
- No API keys are hardcoded in blueprint JSON files
- Google Sheets column mappings use `col_A` through `col_Q`

## Directory Structure

```
prompts/          - AI prompt templates (plain text)
make-blueprints/  - Importable Make.com scenario JSON files
scripts/          - Node.js utility scripts for setup/testing
sheets/           - Google Sheets schema documentation
slack/            - Slack message format documentation
```

## AI Skills (taste-skill)

7 frontend design skills installed via `npx skills add https://github.com/Leonxlnx/taste-skill`:

- **design-taste-frontend** — Core UI/UX rules for layouts, typography, colors, spacing, motion
- **high-end-visual-design** — Agency-style fonts, spacing, shadows, animations
- **redesign-existing-projects** — Audit and upgrade existing projects to premium quality
- **full-output-enforcement** — Prevents code truncation and placeholder patterns
- **minimalist-ui** — Clean editorial-style interfaces (Notion/Linear inspired)
- **industrial-brutalist-ui** — Raw Swiss typography + terminal aesthetics
- **stitch-design-taste** — Google Stitch-compatible semantic design rules

Skills live in `.agents/skills/` with symlinks in `.claude/skills/`. Manage with `npx skills list`, `npx skills update`, or `npx skills remove`.

## Testing

```bash
npm install
npm run test-gemini   # Tests Gemini AI prompt chain
npm run test-ghl      # Tests GoHighLevel Social Planner API
npm run get-accounts  # Retrieves GHL LinkedIn account ID
```
