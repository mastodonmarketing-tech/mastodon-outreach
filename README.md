# Mastodon Marketing LinkedIn Automation

Fully automated LinkedIn content system for Mastodon Marketing. Scans industry news 3x/week, generates AI-drafted LinkedIn posts, scores them against a QC rubric, and sends to Slack for approval. One emoji reaction schedules the post to LinkedIn via GoHighLevel.

**Total monthly cost: $0** (all free-tier tools)

## How It Works

```
RSS Feeds → Gemini AI (Intelligence) → Gemini AI (Draft) → Gemini AI (QC Score)
    → Google Sheets (log) → Slack DM (approve/edit/reject)
    → GoHighLevel Social Planner → LinkedIn
```

**Scenario 1 (Content Engine):** Runs Mon/Wed/Fri at 6:00 AM CT
- Pulls latest articles from 4 Google News RSS feeds
- Gemini selects the best topic and generates a LinkedIn post
- QC rubric scores the draft on 7 dimensions
- Logs everything to Google Sheets
- Sends approval message to Slack DM

**Scenario 2 (Approve + Publish):** Triggered by Slack emoji reaction
- :white_check_mark: Approve: Schedules post via GHL Social Planner API
- :pencil: Edit: Gemini revises based on your reply, sends new draft
- :x: Reject: Archives the post

## File Structure

```
├── CLAUDE.md                        ← Project context
├── README.md                        ← This file
├── .env.example                     ← Required environment variables
├── package.json                     ← Node.js dependencies
├── prompts/
│   ├── master-system-prompt.txt     ← Voice and brand rules
│   ├── intelligence-prompt.txt      ← News scoring + topic selection
│   ├── brief-expander-prompt.txt    ← Topic to content brief expansion
│   ├── draft-generator-prompt.txt   ← Brief to LinkedIn post generation
│   └── qc-rubric-prompt.txt         ← 7-dimension QC scoring
├── make-blueprints/
│   ├── scenario-1-content-engine.json
│   └── scenario-2-approve-publish.json
├── scripts/
│   ├── get-ghl-linkedin-account.js  ← One-time: find LinkedIn account ID
│   ├── test-gemini.js               ← Test all Gemini prompt chains
│   └── test-ghl-post.js             ← Test GHL Social Planner API
├── sheets/
│   └── schema.md                    ← Google Sheets column definitions
└── slack/
    └── message-templates.md         ← Slack DM approval format
```

## Prerequisites

- GoHighLevel (GHL) account with Social Planner enabled
- Google account (for Sheets + Gemini API)
- Slack workspace
- Make.com free account

## Step 1: Get Gemini API Key (5 minutes)

1. Go to https://aistudio.google.com
2. Sign in with Google
3. Click "Get API key" then "Create API key in new project"
4. Copy key and paste into `.env` as `GEMINI_API_KEY`
5. Free quota: 1,500 requests/day on Gemini 1.5 Flash, 50/day on Pro. More than enough for 3 posts/week.

## Step 2: Set Up Google Sheets (10 minutes)

1. Create a new Google Sheet named "Mastodon LinkedIn Content Queue"
2. Add headers from `sheets/schema.md` to Row 1 (columns A through Q)
3. Copy the Sheet ID from the URL (the long string between `/d/` and `/edit`)
4. Paste into `.env` as `GOOGLE_SHEETS_ID`
5. In Make.com, connect Google Sheets using your Google account OAuth

## Step 3: Get GHL Location ID and API Key (5 minutes)

1. GHL Settings > Business Profile > copy Location ID
2. GHL Settings > Integrations > API Keys > Create Key > copy
3. Paste both into `.env`

## Step 4: Connect LinkedIn to GHL Social Planner (5 minutes)

1. GHL > Marketing > Social Planner
2. Click settings gear > "Add LinkedIn Profile/Page"
3. Authorize with your LinkedIn credentials
4. LinkedIn now appears under Connected Accounts
5. **Note:** Token expires every ~60 days. Set a Google Calendar reminder to reauthorize.

## Step 5: Get LinkedIn Account ID (2 minutes)

```bash
npm install
npm run get-accounts
```

Copy the LinkedIn `_id` value and paste into `.env` as `GHL_LINKEDIN_ACCOUNT_ID`.

## Step 6: Test Everything

```bash
npm run test-gemini   # Tests all 3 AI prompt chains
npm run test-ghl      # Creates a test draft in GHL (delete it after!)
```

## Step 7: Set Up Google News RSS Feeds (10 minutes)

The Make.com scenario uses Google News RSS search URLs. The 4 default feeds are pre-configured in the blueprint:

1. `contractor marketing digital`
2. `local SEO Google algorithm update`
3. `restoration construction industry news`
4. `Google Ads local business marketing`

You can customize these by editing the RSS module URLs in Make.com after import. The URL format is:
```
https://news.google.com/rss/search?q=YOUR+SEARCH+TERMS&hl=en-US
```

Optionally, go to https://google.com/alerts and create alerts with "RSS feed" delivery for more targeted feeds.

## Step 8: Import Make.com Blueprints

1. Go to Make.com > Create new scenario > click the three dots (...) > Import blueprint
2. Upload `make-blueprints/scenario-1-content-engine.json`
3. Connect your Google Sheets and Slack accounts in each module
4. Enter your Gemini API key in the HTTP module URLs (replace `{{GEMINI_API_KEY}}`)
5. Enter your Google Sheets ID (replace `{{GOOGLE_SHEETS_ID}}`)
6. Enter your Slack approval channel ID (replace `{{SLACK_APPROVAL_CHANNEL}}`)
7. Repeat for Scenario 2, also entering GHL credentials
8. Set Scenario 1 schedule: Monday/Wednesday/Friday at 06:00, timezone America/Chicago
9. Test Scenario 1 with "Run once" before activating the schedule

## Step 9: Set Up Slack Approval Flow

1. In Scenario 2, connect your Slack account
2. The approval DM will come from your Make.com Slack bot
3. React with :white_check_mark: to approve, :pencil: to edit, :x: to reject
4. For edits: reply in the thread with your instruction, then react :pencil:

## Ongoing Maintenance

- **Re-authorize LinkedIn** in GHL every ~60 days (GHL emails you when token expires)
- **Review RSS feed quality** monthly. Add/remove search terms as needed
- **Check Sheets analytics** columns (M-P) weekly for performance patterns
- **QC score trends**: If scores consistently dip, review and update the master system prompt

## Environment Variables

See `.env.example` for all required variables. Copy it to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Where to Get It |
|----------|----------------|
| `GEMINI_API_KEY` | https://aistudio.google.com |
| `GHL_API_KEY` | GHL Settings > Integrations > API Keys |
| `GHL_LOCATION_ID` | GHL Settings > Business Profile |
| `GHL_LINKEDIN_ACCOUNT_ID` | Run `npm run get-accounts` |
| `SLACK_BOT_TOKEN` | Slack App Settings > OAuth & Permissions |
| `SLACK_APPROVAL_CHANNEL` | Alex's Slack user ID (for DMs) |
| `GOOGLE_SHEETS_ID` | Google Sheets URL (between /d/ and /edit) |
