import { sql } from "@/utils/db/client";

export interface DashboardSiteEntry {
  id: string;
  kind: "page" | "link";
  title: string;
  content: string;
  url: string;
  enabled: boolean;
  position: number;
}

export class DashboardSiteRepository {
  async list(): Promise<DashboardSiteEntry[]> {
    return sql<DashboardSiteEntry[]>`
      SELECT id, kind, title, content, url, enabled, position
      FROM dashboard_site_entries ORDER BY position, id
    `;
  }

  async save(entry: DashboardSiteEntry): Promise<void> {
    await sql`
      INSERT INTO dashboard_site_entries (id, kind, title, content, url, enabled, position)
      VALUES (${entry.id}, ${entry.kind}, ${entry.title}, ${entry.content}, ${entry.url}, ${entry.enabled}, ${entry.position})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content,
        url = EXCLUDED.url, enabled = EXCLUDED.enabled, position = EXCLUDED.position
    `;
  }

  async deleteLink(id: string): Promise<void> {
    await sql`DELETE FROM dashboard_site_entries WHERE id = ${id} AND kind = 'link'`;
  }
}
