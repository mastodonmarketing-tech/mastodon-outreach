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

## Security

- `.npmrc` blocks install scripts by default (`ignore-scripts=true`)
- Git hooks silently prevent secret leaks in commits
- Run `npm run security:scan` to audit a cloned repo
- Run `npm run security:audit-repo -- <github-url>` to vet a repo before cloning
- See SECURITY.md for incident response procedures

## Testing

```bash
npm install
npm run test-gemini   # Tests Gemini AI prompt chain
npm run test-ghl      # Tests GoHighLevel Social Planner API
npm run get-accounts  # Retrieves GHL LinkedIn account ID
```
