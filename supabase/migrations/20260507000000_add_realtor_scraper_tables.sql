-- Realtor scraper system: sold-listings → top producers → contact enrichment.

create table if not exists public.realtor_metros (
  slug text primary key,
  display_name text not null,
  state text not null,
  search_terms text[] not null default '{}',
  bbox_north double precision,
  bbox_south double precision,
  bbox_east double precision,
  bbox_west double precision,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.realtors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  brokerage text,
  license_number text,
  primary_metro text references public.realtor_metros(slug),
  email text,
  phone text,
  linkedin_url text,
  instagram_url text,
  facebook_url text,
  twitter_url text,
  website_url text,
  brokerage_profile_url text,
  zillow_profile_url text,
  realtor_dot_com_profile_url text,
  enrichment_status text not null default 'pending',
  enrichment_error text,
  enriched_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A realtor is uniquely identified by name + brokerage (or name + license if available).
create unique index if not exists realtors_name_brokerage_idx
  on public.realtors (lower(full_name), lower(coalesce(brokerage, '')));

create unique index if not exists realtors_license_idx
  on public.realtors (lower(license_number))
  where license_number is not null;

create index if not exists realtors_enrichment_status_idx
  on public.realtors (enrichment_status);

create table if not exists public.realtor_listings (
  id uuid primary key default gen_random_uuid(),
  realtor_id uuid not null references public.realtors(id) on delete cascade,
  metro text not null references public.realtor_metros(slug),
  source text not null,
  source_listing_id text,
  address_line text,
  city text,
  state text,
  zip text,
  sold_price numeric,
  sold_date date not null,
  listing_url text,
  raw jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists realtor_listings_source_id_idx
  on public.realtor_listings (source, source_listing_id)
  where source_listing_id is not null;

create index if not exists realtor_listings_realtor_sold_idx
  on public.realtor_listings (realtor_id, sold_date desc);

create index if not exists realtor_listings_metro_sold_idx
  on public.realtor_listings (metro, sold_date desc);

-- Rolling stats so the dashboard / outreach picker can sort by closings/mo without recomputing.
create table if not exists public.realtor_metro_stats (
  realtor_id uuid not null references public.realtors(id) on delete cascade,
  metro text not null references public.realtor_metros(slug),
  window_days int not null,
  closings_count int not null default 0,
  total_sold_volume numeric not null default 0,
  median_sold_price numeric,
  computed_at timestamptz not null default now(),
  primary key (realtor_id, metro, window_days)
);

create index if not exists realtor_metro_stats_top_idx
  on public.realtor_metro_stats (metro, window_days, closings_count desc);

-- Seed top 10 US metros.
insert into public.realtor_metros (slug, display_name, state, search_terms) values
  ('nyc',          'New York',     'NY', array['New York, NY', 'Manhattan, NY', 'Brooklyn, NY', 'Queens, NY']),
  ('los-angeles',  'Los Angeles',  'CA', array['Los Angeles, CA']),
  ('chicago',      'Chicago',      'IL', array['Chicago, IL']),
  ('houston',      'Houston',      'TX', array['Houston, TX']),
  ('phoenix',      'Phoenix',      'AZ', array['Phoenix, AZ', 'Scottsdale, AZ']),
  ('philadelphia', 'Philadelphia', 'PA', array['Philadelphia, PA']),
  ('san-antonio',  'San Antonio',  'TX', array['San Antonio, TX']),
  ('san-diego',    'San Diego',    'CA', array['San Diego, CA']),
  ('dallas',       'Dallas',       'TX', array['Dallas, TX', 'Fort Worth, TX', 'Plano, TX']),
  ('austin',       'Austin',       'TX', array['Austin, TX'])
on conflict (slug) do nothing;

-- Trigger to keep updated_at fresh on realtors.
create or replace function public.touch_realtors_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists realtors_touch_updated_at on public.realtors;
create trigger realtors_touch_updated_at
before update on public.realtors
for each row execute function public.touch_realtors_updated_at();
