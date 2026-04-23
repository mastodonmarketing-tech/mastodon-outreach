drop index if exists public.linkedin_drafts_outstand_post_id_idx;

alter table public.linkedin_drafts
drop column if exists publishing_provider,
drop column if exists outstand_post_id,
drop column if exists outstand_status,
drop column if exists outstand_error,
drop column if exists platform_post_id,
drop column if exists submitted_at;
