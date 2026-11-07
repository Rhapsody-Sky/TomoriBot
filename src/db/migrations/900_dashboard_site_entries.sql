CREATE TABLE IF NOT EXISTS dashboard_site_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'link')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0
);
