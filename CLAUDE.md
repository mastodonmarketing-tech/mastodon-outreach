# Mastodon Marketing LinkedIn Automation

Automated LinkedIn content pipeline for Mastodon Marketing.

## Architecture

The current system is Supabase + Zernio based:

1. `generate-draft` creates drafts from the content pipeline.
2. `dashboard.html` is the review UI for pending, scheduled, published, rejected, and calendar views.
3. `approve` handles scheduling, publish-now, reject, delete, and unschedule actions.
4. `rewrite` handles draft edits, rewrites, and image regeneration.
5. `publish-scheduled` reconciles scheduled and in-flight Zernio posts.
6. Zernio handles queue timing and multi-platform publishing.

## Key Conventions

- Edge functions are written for Deno / Supabase.
- The dashboard is a single static HTML file deployed to GitHub Pages.
- Scheduled posts should be treated as Zernio-managed posts.
- `publishing_provider = "zernio"` is the expected live publish path.
- Database columns `buffer_post_id`, `buffer_status`, `buffer_error` are reused for Zernio data.
- There is no active Make, GoHighLevel, or Buffer publishing path in the runtime code.

## Directory Structure

```
prompts/   - AI prompt templates
scripts/   - setup and utility scripts
sheets/    - Google Sheets schema docs
slack/     - Slack message format docs
supabase/  - edge functions, config, migrations
```

## Testing

```bash
npm install
npm run test-gemini
```
