DO $$
BEGIN
  IF to_regclass('dashboard_site_entries') IS NOT NULL THEN
    LOCK TABLE dashboard_site_entries IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM dashboard_site_entries) THEN
      RAISE EXCEPTION 'Cannot remove dashboard_site_entries while it contains pages or links';
    END IF;
    DROP TABLE dashboard_site_entries;
  END IF;
END;
$$;
