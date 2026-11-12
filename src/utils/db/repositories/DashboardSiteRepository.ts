import { sql } from "@/utils/db/client";

export interface DashboardSiteEntry {
  id: string;
  kind: "page" | "link";
  title: string;
  content: string;
  url: string;
  enabled: boolean;
  showOnLogin: boolean;
  showInSidebar: boolean;
  position: number;
}

export class DashboardSiteRepository {
  async list(): Promise<DashboardSiteEntry[]> {
    return sql<DashboardSiteEntry[]>`
      SELECT id, kind, title, content, url, enabled, position,
        show_on_login AS "showOnLogin", show_in_sidebar AS "showInSidebar"
      FROM dashboard_site_entries ORDER BY position, id
    `;
  }

  async save(entry: DashboardSiteEntry): Promise<void> {
    await sql`
      INSERT INTO dashboard_site_entries (id, kind, title, content, url, enabled, position, show_on_login, show_in_sidebar)
      VALUES (${entry.id}, ${entry.kind}, ${entry.title}, ${entry.content}, ${entry.url}, ${entry.enabled}, ${entry.position},
        ${entry.showOnLogin}, ${entry.showInSidebar})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content,
        url = EXCLUDED.url, enabled = EXCLUDED.enabled, position = EXCLUDED.position,
        show_on_login = EXCLUDED.show_on_login, show_in_sidebar = EXCLUDED.show_in_sidebar
    `;
  }

  async deleteLink(id: string): Promise<void> {
    await sql`DELETE FROM dashboard_site_entries WHERE id = ${id} AND kind = 'link'`;
  }
}
