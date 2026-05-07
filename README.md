# Mastodon Marketing LinkedIn Automation

This project runs Mastodon Marketing's LinkedIn content workflow through a Supabase-backed dashboard and Buffer publishing.

## Current Architecture

```
RSS + topic selection -> Supabase Edge Functions -> dashboard.html
    -> approve / rewrite / regenerate image
    -> Buffer queue / publish
    -> LinkedIn
```

The active runtime pieces are:

- `dashboard.html` - the single-page review and scheduling dashboard
- `supabase/functions/generate-draft` - draft generation
- `supabase/functions/rewrite` - rewrite, edit, and image regeneration
- `supabase/functions/approve` - scheduling, publish-now, reject, delete, unschedule
- `supabase/functions/publish-scheduled` - scheduled publish reconciliation
- `supabase/functions/_shared/buffer.ts` - Buffer publishing helper

## Important Notes

- Publishing is Buffer-only.
- Normal scheduling uses Buffer's queue timing.
- Manual date changes still create an exact scheduled time in Buffer.
- Generated first comments default to Mastodon Marketing's survey CTA.
- Social images are generated as text-free LinkedIn graphics, not editorial photos.

## File Structure

```
├── CLAUDE.md
├── README.md
├── dashboard.html
├── supabase/
│   ├── config.toml
│   ├── functions/
│   │   ├── _shared/
│   │   ├── approve/
│   │   ├── generate-draft/
│   │   ├── publish-scheduled/
│   │   └── rewrite/
│   └── migrations/
├── prompts/
├── scripts/
├── sheets/
└── slack/
```

## Deployment

Supabase functions are deployed individually:

```bash
supabase functions deploy generate-draft --project-ref vaaudpclqxaqzlryhhlm
supabase functions deploy rewrite --project-ref vaaudpclqxaqzlryhhlm
supabase functions deploy approve --project-ref vaaudpclqxaqzlryhhlm
supabase functions deploy publish-scheduled --project-ref vaaudpclqxaqzlryhhlm --no-verify-jwt
```

The dashboard is published via GitHub Pages from `dashboard.html`.

## Required Secrets

The active production setup depends on:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `BUFFER_API_KEY`
- `BUFFER_CHANNEL_ID`
- `BUFFER_ORGANIZATION_ID`

## Status

Legacy Make / GoHighLevel publishing flow has been removed from the active app code.

## Realtor Scraper (in development)

A separate pipeline ingests sold listings from the top 10 US metros, ranks
listing agents by closings per month, and enriches the top producers (10+
closings/mo) with email, phone, and social profile URLs for outreach.

Tables (see `supabase/migrations/20260507000000_add_realtor_scraper_tables.sql`):

- `realtor_metros` - configurable list of target metros (seeded with top 10)
- `realtors` - agent identity + contact info + enrichment status
- `realtor_listings` - raw sold listings keyed to a realtor
- `realtor_metro_stats` - rolling closings/volume aggregates per agent per metro

Edge functions:

- `scrape-sold-listings` - ingest sold listings via the configured data source
  (RealEstateAPI.com by default; set `REALTOR_SOURCE=mock` for local dev) and
  recompute per-agent stats
- `enrich-realtors` - find email / phone / LinkedIn / Instagram / Facebook for
  top producers using Serper.dev + Gemini
- `top-realtors` - read API for the dashboard / outreach picker; supports JSON
  and CSV output

Required secrets in addition to those above: `REALESTATEAPI_KEY`,
`SERPER_API_KEY`. See `.env.example`.

Typical run:

```bash
# 1. Pull last 30 days of solds for all enabled metros, recompute stats
curl -X POST $SUPABASE_URL/functions/v1/scrape-sold-listings \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"since_days": 30}'

# 2. Enrich the top producers (>=10 closings/30d) that don't have contact info
curl -X POST $SUPABASE_URL/functions/v1/enrich-realtors \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"min_closings": 10, "limit": 25}'

# 3. Pull the resulting list (JSON or CSV)
curl "$SUPABASE_URL/functions/v1/top-realtors?metro=austin&format=csv" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```
