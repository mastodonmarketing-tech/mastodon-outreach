delete from public.linkedin_drafts
where id in (1, 3, 8, 12)
  and status = 'Published'
  and publishing_provider is null;
