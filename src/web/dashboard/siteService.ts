import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { DashboardSiteRepository, type DashboardSiteEntry } from "@/utils/db/repositories/DashboardSiteRepository";
import { localizer } from "@/utils/text/localizer";
import { DashboardServiceError } from "./errors";
import english from "@/locales/en-US/general";

const pageIds = ["imprint", "data-protection", "cookies"] as const;
const siteEntrySchema = z
  .object({
    kind: z.enum(["page", "link"]),
    title: z.string().trim().min(1).max(100),
    content: z.string().max(100_000),
    url: z.string().trim().max(2048),
    enabled: z.boolean(),
    position: z.number().int().min(0).max(999),
  })
  .strict();

export function cleanSiteHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "h2", "h3", "strong", "em", "u", "s", "blockquote", "ul", "ol", "li", "a"],
    allowedAttributes: { a: ["href"] },
    allowedSchemes: ["https", "http", "mailto"],
    allowProtocolRelative: false,
  });
}

export function siteCopy(): Record<string, string> {
  const keys = [
    "title",
    "hint",
    "pages",
    "links",
    "imprint",
    "data_protection",
    "cookies",
    "visible",
    "visible_hint",
    "page_title",
    "content",
    "save",
    "saved",
    "add_link",
    "link_title",
    "url",
    "position",
    "position_hint",
    "remove",
    "remove_title",
    "remove_hint",
    "cancel",
    "preview",
    "back",
    "public_links",
    "admin",
    "editor",
    "bold",
    "italic",
    "underline",
    "heading",
    "subheading",
    "ordered",
    "bullet",
    "add_editor_link",
    "remove_format",
    "invalid",
    "forbidden",
    "empty",
    "missing",
    "load_failed",
    "link_hint",
  ];
  return Object.fromEntries(keys.map((key) => [key, localizer("en-US", `general.dashboard.site_${key}`)]));
}

export function siteInterfaceCopy(): Record<string, string> {
  return Object.fromEntries(
    Object.keys(english.general.dashboard)
      .filter((key) => key.startsWith("interface_"))
      .map((key) => [key.slice("interface_".length), localizer("en-US", `general.dashboard.${key}`)]),
  );
}

export class DashboardSiteService {
  constructor(private readonly repository = new DashboardSiteRepository()) {}

  async list(includeHidden = false): Promise<DashboardSiteEntry[]> {
    const stored = await this.repository.list();
    const entries = includeHidden
      ? [
          ...pageIds
            .filter((id) => !stored.some((entry) => entry.id === id))
            .map((id) => ({
              id,
              kind: "page" as const,
              title: siteCopy()[id.replaceAll("-", "_")],
              content: "",
              url: "",
              enabled: false,
              position: pageIds.indexOf(id),
            })),
          ...stored,
        ]
      : stored.filter((entry) => entry.enabled);
    return entries
      .map((entry) => ({ ...entry, content: cleanSiteHtml(entry.content) }))
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  }

  async save(id: string, input: unknown): Promise<DashboardSiteEntry> {
    const parsed = siteEntrySchema.safeParse(input);
    if (!parsed.success) throw new DashboardServiceError("invalid_site_entry", 422, siteCopy().invalid);
    const entry = { id, ...parsed.data };
    if (entry.kind === "page") {
      if (!pageIds.some((pageId) => pageId === id))
        throw new DashboardServiceError("invalid_site_entry", 422, siteCopy().invalid);
      entry.content = cleanSiteHtml(entry.content);
      entry.url = "";
      const text = sanitizeHtml(entry.content, { allowedTags: [], allowedAttributes: {} })
        .replace(/&nbsp;/g, " ")
        .trim();
      if (entry.enabled && !text) throw new DashboardServiceError("empty_site_page", 422, siteCopy().empty);
    } else {
      if (!z.string().uuid().safeParse(id).success)
        throw new DashboardServiceError("invalid_site_entry", 422, siteCopy().invalid);
      let url: URL;
      try {
        url = new URL(entry.url);
      } catch {
        throw new DashboardServiceError("invalid_site_link", 422, siteCopy().invalid);
      }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
        throw new DashboardServiceError("invalid_site_link", 422, siteCopy().invalid);
      }
      entry.url = url.href;
      entry.content = "";
    }
    await this.repository.save(entry);
    return entry;
  }

  async deleteLink(id: string): Promise<void> {
    if (!z.string().uuid().safeParse(id).success)
      throw new DashboardServiceError("invalid_site_entry", 422, siteCopy().invalid);
    await this.repository.deleteLink(id);
  }
}
