-- Revenue Express portal schema.
-- Written for Postgres; the local dev database (PGlite) speaks the same SQL,
-- so this file is the single source of truth for both.

-- ---------------------------------------------------------------- accounts --
-- There is no public signup. The super admin provisions every account and the
-- system hands out a one-time password the member must replace on first login.
CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  password_hash        TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- Sessions are server-side so an admin can revoke a teammate instantly. The
-- cookie carries a random token; only its hash is stored here.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

-- Rate limiting for the login form, so the admin-only portal cannot be
-- brute-forced by anyone who finds the URL.
CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGSERIAL PRIMARY KEY,
  identifier TEXT NOT NULL,
  succeeded  BOOLEAN NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts (identifier, at);

-- --------------------------------------------------------------- analytics --
-- One row per visit. Rolling up here rather than deriving from raw events
-- keeps the dashboard queries cheap: bounce rate, views/session and scroll
-- depth are all single-table aggregates.
CREATE TABLE IF NOT EXISTS analytics_sessions (
  id          TEXT PRIMARY KEY,
  visitor_id  TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entry_path  TEXT NOT NULL,
  referrer    TEXT,
  referrer_host TEXT,
  country     TEXT,
  device      TEXT NOT NULL DEFAULT 'desktop' CHECK (device IN ('desktop','mobile','tablet')),
  intent      TEXT NOT NULL DEFAULT 'unknown' CHECK (intent IN ('brand','creator','unknown')),
  deepest_section TEXT,
  views       INTEGER NOT NULL DEFAULT 0,
  max_scroll  INTEGER NOT NULL DEFAULT 0,
  duration_ms BIGINT NOT NULL DEFAULT 0,
  cta_clicks  INTEGER NOT NULL DEFAULT 0,
  -- "Engaged" mirrors the definition shown on the dashboard: 15s+ or 50%+ scroll.
  engaged     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS a_sessions_started_idx ON analytics_sessions (started_at);
CREATE INDEX IF NOT EXISTS a_sessions_visitor_idx ON analytics_sessions (visitor_id);

CREATE TABLE IF NOT EXISTS analytics_events (
  id         BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('pageview','cta_click','scroll','engaged','form_start','form_submit','heartbeat','section_view')),
  path       TEXT NOT NULL,
  label      TEXT,
  value      INTEGER,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS a_events_at_idx ON analytics_events (at);
CREATE INDEX IF NOT EXISTS a_events_type_idx ON analytics_events (type, at);
CREATE INDEX IF NOT EXISTS a_events_path_idx ON analytics_events (path);

-- Per-page durations, so "Top Pages" can show avg time on page.
CREATE TABLE IF NOT EXISTS analytics_pageviews (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms BIGINT NOT NULL DEFAULT 0,
  max_scroll  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS a_pv_at_idx ON analytics_pageviews (at);
CREATE INDEX IF NOT EXISTS a_pv_path_idx ON analytics_pageviews (path, at);

-- ------------------------------------------------------------------- leads --
CREATE TABLE IF NOT EXISTS leads (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  phone          TEXT,
  brand          TEXT,
  role_title     TEXT,
  type           TEXT NOT NULL DEFAULT 'brand' CHECK (type IN ('brand','creator')),
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','won','lost')),
  category       TEXT,
  location       TEXT,
  annual_revenue TEXT,
  monthly_gmv    TEXT,
  ad_spend       TEXT,
  biggest_need   TEXT,
  goal           TEXT,
  message        TEXT,
  source_path    TEXT,
  session_id     TEXT,
  -- Recorded server-side; the flood limit must not trust a client value.
  submitted_ip   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_status_idx ON leads (status);
CREATE INDEX IF NOT EXISTS leads_type_idx ON leads (type);

-- An audit trail of stage changes and notes, shown on the lead detail panel.
CREATE TABLE IF NOT EXISTS lead_notes (
  id         BIGSERIAL PRIMARY KEY,
  lead_id    TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','status')),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lead_notes_lead_idx ON lead_notes (lead_id, created_at DESC);

-- -------------------------------------------------------------------- blog --
CREATE TABLE IF NOT EXISTS posts (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  excerpt         TEXT,
  body_md         TEXT NOT NULL DEFAULT '',
  cover_image     TEXT,
  cover_alt       TEXT,
  tags            JSONB NOT NULL DEFAULT '[]'::jsonb,
  author          TEXT NOT NULL DEFAULT 'Revenue Express',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  seo_title       TEXT,
  seo_description TEXT,
  published_at    TIMESTAMPTZ,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS posts_status_idx ON posts (status, published_at DESC);
CREATE INDEX IF NOT EXISTS posts_slug_idx ON posts (slug);
