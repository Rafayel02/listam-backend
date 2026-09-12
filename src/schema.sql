CREATE TABLE IF NOT EXISTS searches (
  id TEXT PRIMARY KEY,
  name TEXT,
  url TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  profile_url TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  is_verified_company BOOLEAN,
  rating DOUBLE PRECISION,
  review_count INTEGER,
  tenure_text TEXT,
  description TEXT,
  reviews_url TEXT,
  site_posts_count INTEGER,
  scraped_posts_count INTEGER,
  owner_extras JSONB,
  first_seen_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  last_changed_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  owner_id TEXT REFERENCES owners(id),
  title TEXT,
  price DOUBLE PRECISION,
  currency TEXT,
  is_monthly BOOLEAN,
  thumbnail_url TEXT,
  street TEXT,
  district TEXT,
  rooms INTEGER,
  area_sqm DOUBLE PRECISION,
  current_floor INTEGER,
  total_floors INTEGER,
  badges JSONB,
  verification_status TEXT,
  description TEXT,
  image_urls JSONB,
  attributes JSONB,
  source_price_history JSONB,
  posted_at BIGINT,
  renewed_at BIGINT,
  first_seen_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  last_changed_at BIGINT NOT NULL,
  enrichment_status TEXT NOT NULL,
  enrichment_error TEXT,
  is_removed BOOLEAN DEFAULT FALSE,
  removed_at BIGINT,
  card_extras JSONB,
  detail_extras JSONB
);

CREATE TABLE IF NOT EXISTS search_listings (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  first_seen_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  is_present BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  finished_at BIGINT,
  last_completed_page INTEGER NOT NULL DEFAULT 0,
  current_page INTEGER NOT NULL DEFAULT 1,
  search_pages_complete BOOLEAN NOT NULL DEFAULT FALSE,
  pending_detail_ids JSONB NOT NULL DEFAULT '[]',
  processing_detail_ids JSONB NOT NULL DEFAULT '[]',
  completed_detail_ids JSONB NOT NULL DEFAULT '[]',
  failed_detail_ids JSONB NOT NULL DEFAULT '[]',
  discovered_listing_ids JSONB NOT NULL DEFAULT '[]',
  detail_retry_counts JSONB NOT NULL DEFAULT '{}',
  awaiting_user_ready BOOLEAN NOT NULL DEFAULT FALSE,
  refresh_details BOOLEAN
);

CREATE TABLE IF NOT EXISTS run_listing_statuses (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  existed_before_run BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS scrape_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  timestamp BIGINT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_changes (
  id BIGSERIAL PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  scrape_run_id TEXT NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  changed_at BIGINT NOT NULL,
  changes JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_owner ON listings(owner_id);
CREATE INDEX IF NOT EXISTS idx_listings_district ON listings(district);
CREATE INDEX IF NOT EXISTS idx_search_listings_search ON search_listings(search_id);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_search ON scrape_runs(search_id);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_run ON scrape_logs(run_id);
