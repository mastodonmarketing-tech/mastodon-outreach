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
