alter table public.linkedin_drafts
add column if not exists publishing_provider text,
add column if not exists outstand_post_id text,
add column if not exists outstand_status text,
add column if not exists outstand_error text,
add column if not exists platform_post_id text,
add column if not exists submitted_at timestamptz;

create index if not exists linkedin_drafts_outstand_post_id_idx
on public.linkedin_drafts(outstand_post_id);
