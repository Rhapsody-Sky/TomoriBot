ALTER TABLE dashboard_site_entries
  ADD COLUMN IF NOT EXISTS show_on_login BOOLEAN,
  ADD COLUMN IF NOT EXISTS show_in_sidebar BOOLEAN;

UPDATE dashboard_site_entries
SET show_on_login = COALESCE(show_on_login, kind = 'link' AND enabled),
    show_in_sidebar = COALESCE(show_in_sidebar, kind = 'link' AND enabled)
WHERE show_on_login IS NULL OR show_in_sidebar IS NULL;

ALTER TABLE dashboard_site_entries
  ALTER COLUMN show_on_login SET DEFAULT false,
  ALTER COLUMN show_on_login SET NOT NULL,
  ALTER COLUMN show_in_sidebar SET DEFAULT false,
  ALTER COLUMN show_in_sidebar SET NOT NULL;
