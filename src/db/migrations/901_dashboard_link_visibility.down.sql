DO $$
BEGIN
  LOCK TABLE dashboard_site_entries IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM dashboard_site_entries WHERE kind = 'link' AND show_on_login <> show_in_sidebar) THEN
    RAISE EXCEPTION 'Cannot roll back dashboard links with different login and sidebar visibility';
  END IF;
  UPDATE dashboard_site_entries SET enabled = show_on_login WHERE kind = 'link';
  ALTER TABLE dashboard_site_entries DROP COLUMN show_on_login, DROP COLUMN show_in_sidebar;
END;
$$;
