-- Applied automatically by lib/db.ts migrate() for databases created before
-- section tracking existed. Both statements are safe to re-run.
ALTER TABLE analytics_sessions ADD COLUMN IF NOT EXISTS deepest_section TEXT;
ALTER TABLE analytics_events DROP CONSTRAINT IF EXISTS analytics_events_type_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_type_check
  CHECK (type IN ('pageview','cta_click','scroll','engaged','form_start','form_submit','heartbeat','section_view'));

-- The flood limit needs an identifier the submitter cannot choose, so the
-- request's IP is recorded server-side alongside the client-supplied session.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS submitted_ip TEXT;
CREATE INDEX IF NOT EXISTS leads_ip_idx ON leads (submitted_ip, created_at);
