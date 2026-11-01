import { beforeAll, describe, expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";

async function dashboardFunction(name: string): Promise<string> {
  const source = await Bun.file("src/web/dashboard/assets/app.js").text();
  const ast = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let result = "";
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast);
    if (name === "dashboardClick" && ts.isFunctionDeclaration(node) && node.name?.text === "handleDashboardAction")
      result = node.getText(ast);
    if (
      name === "dashboardClick" &&
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "document.addEventListener" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "click" &&
      !ts.isIdentifier(node.arguments[1])
    )
      result = node.arguments[1].getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(result).not.toBe("");
  return result;
}

describe("dashboard lorebook UI", () => {
  beforeAll(() => initializeLocalizer());

  it("omits absent page-header copy without leaving an empty decorative label", async () => {
    const header = runInNewContext(`(${await dashboardFunction("pageHeader")})`, {
      escapeHtml: (value: string) => value,
    }) as (eyebrow: string, title: string, copy: string) => string;
    expect(header("", "Collection", "")).not.toContain("<p");
    expect(header("Workspace", "Collection", "Description").match(/<p/g)).toHaveLength(2);
  });

  it("previews the actual additional word conditions for each matching mode", async () => {
    const source = await dashboardFunction("lorebookUsage");
    const usage = runInNewContext(`(${source})`, {
      ui: (key: string) => localizedCopy("en-US", `general.dashboard.interface_${key}`),
    }) as (entry: unknown) => string;
    const secondaryKeys = ["$&", "fog"];
    const words = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" }).format(
      secondaryKeys.map((key) => `"${key}"`),
    );
    for (const [logic, key] of ["any", "not_all", "none", "all"].entries()) {
      const text = usage({
        enabled: true,
        constant: false,
        trigger_chance: 50,
        scan_depth: 5,
        keys: ["harbor"],
        secondary_keys: secondaryKeys,
        selective_logic: logic,
      });
      expect(text).toContain(
        localizedCopy("en-US", `general.dashboard.interface_lorebook_usage_${key}`).replace("{words}", () => words),
      );
      expect(text).toContain(
        localizedCopy("en-US", "general.dashboard.interface_lorebook_usage_keys", { keys: '"harbor"', messages: 5 }),
      );
    }
  });

  it("offers one editor action per entry", async () => {
    const source = await dashboardFunction("lorebookEntry");
    const render = runInNewContext(`(${source})`, {
      state: { overview: { canManage: true } },
      ui: (key: string) => key,
      escapeHtml: (value: string) => value,
      lorebookUsage: () => "",
    }) as (entry: unknown) => string;
    const html = render({ entry_id: 11, title: "Harbor", content: "A harbor.", keys: [], enabled: true });
    expect(html.match(/data-lorebook-edit-entry=/g)).toHaveLength(1);
  });

  it("confirms the selected lorebook and its destructive consequence before deleting", async () => {
    const source = await dashboardFunction("dashboardClick");
    let writes = 0;
    const confirmations: { title: string; message: string }[] = [];
    const click = runInNewContext(`(${source})`, {
      savingForms: 0,
      state: { guildId: "42", lorebookData: { books: [{ lorebook_id: 3, name: "History" }] } },
      activeLorebookLineage: () => 0,
      lorebookScope: () => ({ lineageId: 0, bookId: 3 }),
      document: { querySelector: () => ({}) },
      ui: (key: string) => localizedCopy("en-US", `general.dashboard.interface_${key}`),
      confirmAction: async (title: string, message: string) => {
        confirmations.push({ title, message });
        return false;
      },
      api: () => writes++,
    }) as (event: unknown) => Promise<void>;
    await click({
      target: {
        closest: (selector: string) =>
          selector.includes("[data-lorebook-delete-book]")
            ? { hasAttribute: (name: string) => name === "data-lorebook-delete-book" }
            : null,
      },
    });
    expect(confirmations).toEqual([
      {
        title: localizedCopy("en-US", "general.dashboard.interface_lorebook_delete_title", { name: "History" }),
        message: localizedCopy("en-US", "general.dashboard.interface_lorebook_delete_book_confirm"),
      },
    ]);
    expect(writes).toBe(0);
  });

  it("links to the matching server setting and focuses it without changing its value", async () => {
    const source = await dashboardFunction("openChannelMemorySettings");
    const state = { overview: { canManage: true }, view: "lorebooks", settingsGroup: "conversation" };
    let focused = 0;
    let closed = 0;
    let rendered = 0;
    const open = runInNewContext(`(${source})`, {
      state,
      document: {
        querySelectorAll: () => [{ close: () => closed++ }],
        querySelector: (selector: string) => {
          expect(selector).toBe('[name="channel_memory_enabled"]');
          return { scrollIntoView: () => {}, focus: () => focused++ };
        },
      },
      renderShell: () => rendered++,
    }) as () => void;
    open();
    expect(state.view).toBe("settings");
    expect(state.settingsGroup).toBe("memory");
    expect(focused).toBe(1);
    expect(closed).toBe(1);
    state.overview.canManage = false;
    open();
    expect(rendered).toBe(1);
  });

  it("opens a settings deep link on the requested shared server without admitting a foreign server", async () => {
    const source = await dashboardFunction("boot");
    const shared = ["123456789012345678", "223456789012345678"];
    for (const [requested, expected] of [
      [shared[1], shared[1]],
      ["323456789012345678", shared[0]],
    ]) {
      let selected = "";
      let opened = 0;
      let failed = false;
      const boot = runInNewContext(`(${source})`, {
        state: {},
        window: { location: { search: `?guild=${requested}`, hash: "#channel-scoped-memory" } },
        URLSearchParams,
        api: async () => ({ csrfToken: "preview", guilds: shared.map((id) => ({ id })) }),
        selectGuild: async (id: string) => {
          selected = id;
        },
        openChannelMemorySettings: () => opened++,
        renderLoggedOut: () => {
          failed = true;
        },
      }) as () => Promise<void>;
      await boot();
      expect(failed).toBe(false);
      expect(selected).toBe(expected);
      expect(opened).toBe(1);
    }
  });
  it("blocks book and editor navigation while a save is pending, even after closing its dialog", async () => {
    const source = await dashboardFunction("dashboardClick");
    const state = { lorebookBookId: 3 };
    let loads = 0;
    const click = runInNewContext(`(${source})`, {
      state,
      savingForms: 1,
      toast: () => {},
      ui: (key: string) => key,
      loadLorebooks: () => loads++,
    }) as (event: unknown) => Promise<void>;
    for (const attribute of [
      "data-lorebook-select",
      "data-lorebook-edit-entry",
      "data-lorebook-open",
      "data-lorebook-channel-settings",
    ]) {
      await click({
        preventDefault: () => {},
        target: {
          closest: (selector: string) =>
            selector.includes(`[${attribute}]`) ? { dataset: { lorebookSelect: "4" } } : null,
        },
      });
    }
    expect(state.lorebookBookId).toBe(3);
    expect(loads).toBe(0);
  });
  it("preserves untouched imported keys and splits edited keys only on newlines", async () => {
    const source = await dashboardFunction("lorebookKeys");
    const keys = runInNewContext(`(${source})`) as (form: unknown, name: string) => string[];
    const original = ["/a,b/", "line\nbreak"];
    const form = {
      dataset: { originalKeys: JSON.stringify(original) },
      elements: { keys: { value: original.join("\n") } },
    };
    expect(keys(form, "keys")).toEqual(original);
    form.elements.keys.value = "/a,b/\nother";
    expect(keys(form, "keys")).toEqual(["/a,b/", "other"]);
  });

  it("identifies the selected destination separately from the editable entry title", async () => {
    const source = await dashboardFunction("renderLorebooks");
    const choices = await dashboardFunction("lorebookChoices");
    const state = {
      overview: { canManage: true, personas: [{ lineageId: 77, nickname: "Juno" }] },
      lorebookBookId: 3,
      lorebookImportReceipt: null,
    };
    const render = runInNewContext(`${choices}; (${source})`, {
      state,
      ui: (key: string) => localizedCopy("en-US", `general.dashboard.interface_${key}`),
      escapeHtml: (value: string) => value,
      fieldLabel: (value: string) => value,
      lorebookChannels: () => "",
      lorebookEntry: () => "",
      navigationIcon: () => "",
      lorebookDialogActions: () => "",
      lorebookDialog: (id: string, _title: string, body: string) => `<dialog id="${id}">${body}</dialog>`,
    }) as (lineageId: number, data: unknown) => string;
    const data = {
      books: [
        { lorebook_id: 3, name: "World history", enabled: true, channel_disc_ids: [] },
        { lorebook_id: 4, name: "Hidden places", enabled: true, channel_disc_ids: [] },
      ],
      entries: [],
    };
    for (const [lineageId, bookId, name, label] of [
      [0, 3, "World history", "lorebook_selected"],
      [0, 4, "Hidden places", "lorebook_selected"],
      [77, 4, "Juno", "lorebook_persona"],
    ] as const) {
      state.lorebookBookId = bookId;
      const html = render(lineageId, data);
      expect(html.includes('id="lorebook-collection-actions"')).toBe(lineageId === 0);
      expect(html).toContain('id="lorebook-book-actions"');
      for (const id of ["lorebook-entry-dialog", "lorebook-import-dialog"]) {
        const dialog = html.split(`<dialog id="${id}">`)[1]?.split("</dialog>")[0];
        expect(dialog).toContain(
          `<dt>${localizedCopy("en-US", `general.dashboard.interface_${label}`)}</dt><dd dir="auto">${name}</dd>`,
        );
        if (id === "lorebook-entry-dialog") {
          expect(dialog).toContain(localizedCopy("en-US", "general.dashboard.interface_lorebook_title"));
          expect(dialog).toContain('name="title" maxlength="128" required autofocus');
          expect(dialog).not.toContain(`value="${name}"`);
        }
      }
    }
  });

  it("renders a read-only workspace without mutation controls", async () => {
    const source = await dashboardFunction("renderLorebooks");
    const choices = await dashboardFunction("lorebookChoices");
    const render = runInNewContext(`${choices}; (${source})`, {
      state: { overview: { canManage: false }, lorebookBookId: 3, lorebookImportReceipt: null },
      ui: (key: string) => key,
      escapeHtml: (value: string) => value,
      fieldLabel: (value: string) => value,
      lorebookChannels: () => "",
      lorebookEntry: () => "entry",
      navigationIcon: () => "",
      lorebookDialog: (_id: string, _title: string, body: string) => body,
    }) as (lineageId: number, data: unknown) => string;
    const html = render(0, {
      books: [{ lorebook_id: 3, name: "History", enabled: true, channel_disc_ids: [] }],
      entries: [{}],
    });
    expect(html).toContain("entry");
    expect(html).toContain("lorebook_export_hint");
    expect(html).not.toContain("data-lorebook-form");
    expect(html).not.toContain("data-lorebook-import-form");
  });

  it("keeps zero activation values in the request", async () => {
    const source = await dashboardFunction("saveLorebookForm");
    let payload: unknown;
    const save = runInNewContext(`(${source})`, {
      state: { guildId: "42", lorebookBookId: 3 },
      activeLorebookLineage: () => 0,
      lorebookScope: () => ({ lineageId: 0, bookId: 3 }),
      document: { querySelector: () => ({ focus: () => {} }) },
      lorebookCurrent: () => true,
      lorebookKeys: () => ["/a,b/"],
      withBusyForm: async (_form: unknown, action: () => Promise<void>) => action(),
      api: async (_path: string, options: { body: string }) => {
        payload = JSON.parse(options.body);
      },
      completeFormSave: () => {},
      toast: () => {},
      ui: (key: string) => key,
      loadLorebooks: async () => {},
    }) as (form: unknown) => Promise<void>;
    await save({
      isConnected: true,
      closest: () => null,
      dataset: { lorebookForm: "activation", entryId: "9" },
      elements: {
        selectiveLogic: { value: "0" },
        scanDepth: { value: "5" },
        triggerChance: { value: "0" },
        insertionOrder: { value: "0" },
      },
    });
    expect(payload).toMatchObject({
      lineageId: 0,
      bookId: 3,
      secondaryKeys: ["/a,b/"],
      selectiveLogic: 0,
      triggerChance: 0,
      insertionOrder: 0,
    });
  });

  it("saves the constant draft through its existing flags endpoint", async () => {
    const source = await dashboardFunction("saveLorebookForm");
    const writes: { path: string; payload: unknown }[] = [];
    const completed: unknown[] = [];
    const save = runInNewContext(`(${source})`, {
      state: { guildId: "42", lorebookBookId: 3 },
      activeLorebookLineage: () => 0,
      lorebookScope: () => ({ lineageId: 0, bookId: 3 }),
      document: { querySelector: () => ({ focus: () => {} }) },
      lorebookCurrent: () => true,
      withBusyForm: async (_form: unknown, action: () => Promise<void>) => action(),
      api: async (path: string, options: { body: string }) => {
        writes.push({ path, payload: JSON.parse(options.body) });
      },
      completeFormSave: (form: unknown) => completed.push(form),
      toast: () => {},
      ui: (key: string) => key,
      loadLorebooks: async () => {},
    }) as (form: unknown) => Promise<void>;
    for (const kind of ["constant"]) {
      const form = {
        isConnected: true,
        closest: () => null,
        dataset: { lorebookForm: kind, entryId: "9" },
        elements: { [kind]: { checked: false } },
      };
      await save(form);
      expect(writes.at(-1)).toEqual({
        path: "/guilds/42/lorebooks/entries/9/flags",
        payload: { lineageId: 0, bookId: 3, flags: { [kind]: false } },
      });
      expect(completed.at(-1)).toBe(form);
    }
  });

  it("keeps the content draft on a partial save and retries both endpoints", async () => {
    const source = await dashboardFunction("saveLorebookForm");
    const writes: { path: string; payload: unknown }[] = [];
    let failFlag = true;
    let completed = 0;
    let refreshed = 0;
    const save = runInNewContext(`(${source})`, {
      state: { guildId: "42", lorebookBookId: 3 },
      activeLorebookLineage: () => 0,
      lorebookScope: () => ({ lineageId: 0, bookId: 3 }),
      document: { querySelector: () => ({ focus: () => {} }) },
      lorebookCurrent: () => true,
      withBusyForm: async (_form: unknown, action: () => Promise<void>) => action(),
      api: async (path: string, options: { body: string }) => {
        writes.push({ path, payload: JSON.parse(options.body) });
        if (path.endsWith("/flags") && failFlag) throw new Error("Unavailable");
      },
      completeFormSave: () => completed++,
      toast: () => {},
      ui: (key: string) => key,
      loadLorebooks: async () => refreshed++,
    }) as (form: unknown) => Promise<void>;
    const form = {
      isConnected: true,
      closest: () => null,
      dataset: { lorebookForm: "content", entryId: "9" },
      elements: { title: { value: "Harbor" }, content: { value: "A harbor." }, enabled: { checked: false } },
    };
    await expect(save(form)).rejects.toThrow("lorebook_partial_save");
    expect(completed).toBe(0);
    expect(refreshed).toBe(0);
    failFlag = false;
    await save(form);
    expect(writes.map((write) => write.path)).toEqual([
      "/guilds/42/lorebooks/entries/9/content",
      "/guilds/42/lorebooks/entries/9/flags",
      "/guilds/42/lorebooks/entries/9/content",
      "/guilds/42/lorebooks/entries/9/flags",
    ]);
    expect(writes[1].payload).toEqual({ lineageId: 0, bookId: 3, flags: { enabled: false } });
    expect(completed).toBe(1);
    expect(refreshed).toBe(1);
  });

  it("rejects empty and duplicate inline book titles before a request", async () => {
    const source = await dashboardFunction("saveLorebookForm");
    let writes = 0;
    let focused = 0;
    const attributes = new Map();
    const error = { hidden: true, textContent: "" };
    const input = {
      value: "",
      focus: () => focused++,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    };
    const save = runInNewContext(`(${source})`, {
      state: { guildId: "42", lorebookBookId: 3, lorebookData: { books: [{ lorebook_id: 4, name: "Places" }] } },
      activeLorebookLineage: () => 0,
      lorebookScope: () => ({ lineageId: 0, bookId: 3 }),
      document: { querySelector: () => ({}) },
      ui: (key: string) => key,
      api: () => writes++,
    }) as (form: unknown) => Promise<void>;
    for (const value of ["   ", "places"]) {
      input.value = value;
      await save({ dataset: { lorebookForm: "book-rename" }, elements: { name: input }, querySelector: () => error });
      expect(attributes.get("aria-invalid")).toBe("true");
      expect(error.hidden).toBe(false);
    }
    expect(writes).toBe(0);
    expect(focused).toBe(2);
  });

  it("keeps the create dialog on failure and closes it with focus restored only after saving", async () => {
    const source = await dashboardFunction("saveLorebookForm");
    const focusTarget = await dashboardFunction("lorebookDialogFocusTarget");
    let fail = true;
    let closed = 0;
    let focused = 0;
    let refreshed = 0;
    let payload: unknown;
    const dialog = { id: "lorebook-entry-dialog", close: () => closed++ };
    const save = runInNewContext(`${focusTarget}; (${source})`, {
      state: { guildId: "42", lorebookBookId: 3 },
      activeLorebookLineage: () => 0,
      lorebookScope: () => ({ lineageId: 0, bookId: 3 }),
      document: { querySelector: () => ({ focus: () => focused++ }) },
      lorebookCurrent: () => true,
      lorebookKeys: () => ["harbor"],
      withBusyForm: async (_form: unknown, action: () => Promise<unknown>) => action(),
      api: async (_path: string, options: { body: string }) => {
        payload = JSON.parse(options.body);
        if (fail) throw new Error("Unavailable");
        return { status: "success" };
      },
      completeFormSave: () => {},
      toast: () => {},
      ui: (key: string) => key,
      loadLorebooks: async () => refreshed++,
    }) as (form: unknown) => Promise<void>;
    const form = {
      isConnected: true,
      closest: () => dialog,
      dataset: { lorebookForm: "create" },
      elements: { title: { value: "Harbor" }, content: { value: "A glass harbor." } },
    };
    await expect(save(form)).rejects.toBeInstanceOf(Error);
    expect(closed).toBe(0);
    expect(focused).toBe(0);
    expect(refreshed).toBe(0);
    fail = false;
    await save(form);
    expect(payload).toMatchObject({ lineageId: 0, bookId: 3, keys: ["harbor"], channelDiscIds: [] });
    expect(closed).toBe(1);
    expect(focused).toBe(1);
    expect(refreshed).toBe(1);
  });

  it("imports a new serverwide lorebook atomically and shows conversion counts", async () => {
    const source = await dashboardFunction("importLorebook");
    const focusTarget = await dashboardFunction("lorebookDialogFocusTarget");
    let payload: Record<string, unknown> = {};
    const state = { guildId: "42", lorebookBookId: null as number | null, lorebookImportReceipt: null as unknown };
    const run = runInNewContext(`${focusTarget}; (${source})`, {
      state,
      activeLorebookLineage: () => 0,
      document: { querySelector: () => ({ focus: () => {} }) },
      lorebookCurrent: () => true,
      lorebookScope: () => ({ lineageId: 0 }),
      TextEncoder,
      ui: (key: string) => key,
      withBusyForm: async (_form: unknown, action: () => Promise<unknown>) => action(),
      api: async (_path: string, options: { body: string }) => {
        payload = JSON.parse(options.body);
        return {
          bookId: 7,
          added: 1,
          report: { skippedEntries: 0, unsupportedKeys: 1, ignoredEntries: 0, collapsedPlacement: 0 },
        };
      },
      toast: () => {},
      loadLorebooks: async () => {},
    }) as (form: unknown) => Promise<void>;
    await run({
      isConnected: true,
      closest: () => ({ id: "lorebook-import-new-dialog", close: () => {} }),
      hasAttribute: () => true,
      elements: {
        name: { value: "History" },
        file: {
          files: [
            {
              size: 90,
              text: async () =>
                JSON.stringify({
                  entries: { "0": { key: ["/a,b/"], comment: "Place", content: "Description", constant: false } },
                }),
            },
          ],
        },
      },
    });
    expect(payload).toMatchObject({ mode: "new", name: "History", lineageId: 0 });
    expect(payload).not.toHaveProperty("bookId");
    expect(state.lorebookBookId).toBe(7);
    const receipt = state.lorebookImportReceipt as { key: string; text: string };
    expect(receipt.key).toBe("lorebook/0/7");
    expect(receipt.text).toContain("lorebook_receipt_unsupported: 1");
    expect(receipt.text).toContain("lorebook_receipt_inserted: 1");
  });

  it("ignores stale guild results and recovers a deleted selected book", async () => {
    const source = await dashboardFunction("loadLorebooks");
    const state = { guildId: "1", lorebookBookId: 9 as number | null, lorebookData: null as unknown };
    const target = { innerHTML: "", querySelectorAll: () => [], querySelector: () => null };
    const pending: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
    const load = runInNewContext(`let lorebookLoadVersion = 0; ${source}; loadLorebooks`, {
      state,
      window: {},
      lorebookSelections: new Map(),
      lorebookSelectionKey: () => "scope",
      document: { querySelector: () => target },
      URLSearchParams,
      ui: (key: string) => key,
      escapeHtml: (value: string) => value,
      lorebookCurrent: (_lineage: number, _target: unknown, guild: string) => state.guildId === guild,
      api: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
      renderLorebooks: () => "new data",
      initDraftForms: () => {},
    }) as (lineageId: number) => Promise<void>;
    const old = load(0);
    state.guildId = "2";
    state.lorebookBookId = 8;
    const current = load(0);
    pending[0].resolve({ books: [], entries: [] });
    await old;
    expect(state.lorebookBookId).toBe(8);
    const missing = Object.assign(new Error("missing"), { code: "lorebook_missing" });
    pending[1].reject(missing);
    await Promise.resolve();
    await Promise.resolve();
    pending[2].resolve({ books: [], entries: [] });
    await current;
    expect(state.lorebookBookId).toBeNull();
    expect(target.innerHTML).toBe("new data");
  });

  it("shows books, entries and an inline detail region with a hidden book-rename form", async () => {
    const source = await dashboardFunction("renderLorebooks");
    const dialogSource = await dashboardFunction("lorebookDialog");
    const actionsSource = await dashboardFunction("lorebookDialogActions");
    const choicesSource = await dashboardFunction("lorebookChoices");
    const render = runInNewContext(`${choicesSource}; ${dialogSource}; ${actionsSource}; ${source}; renderLorebooks`, {
      state: { overview: { canManage: true }, lorebookBookId: 3, lorebookImportReceipt: null },
      ui: (key: string) => key,
      escapeHtml: (value: string) => value,
      fieldLabel: (value: string) => value,
      navigationIcon: () => "",
      lorebookChannels: () => "",
      lorebookEntry: (entry: { title: string }) => entry.title,
    }) as (lineage: number, data: unknown) => string;
    const html = render(0, {
      books: [
        { lorebook_id: 3, name: "History", enabled: true, entryCount: 1, channel_disc_ids: [] },
        { lorebook_id: 4, name: "Places", enabled: false, entryCount: 0, channel_disc_ids: [] },
      ],
      entries: [{ title: "Glass harbor" }],
    });
    const browsing = html.split("<dialog")[0];
    expect(browsing).toContain('data-lorebook-select="3" aria-pressed="true"');
    expect(browsing).toContain('data-lorebook-select="4" aria-pressed="false"');
    expect(browsing).toContain("History");
    expect(browsing).toContain("Places");
    expect(browsing).toContain("Glass harbor");
    expect(browsing).not.toContain("<textarea");
    expect(browsing).toContain('class="mailbox" data-view="list"');
    expect(browsing).toContain('class="mail-folders"');
    expect(browsing).toContain('class="mail-list"');
    expect(browsing).toContain('class="mail-detail" id="lorebook-editor-host"');
    expect(browsing).toContain('popovertarget="lorebook-collection-actions"');
    expect(browsing).toContain('id="lorebook-collection-actions" class="action-menu" popover');
    expect(browsing).toContain('popovertarget="lorebook-book-actions"');
    expect(browsing).toContain('id="lorebook-book-actions" class="action-menu" popover');
    expect(browsing).toContain("data-lorebook-rename data-action-menu-preserve-focus");
    expect(browsing).toContain('data-lorebook-open="lorebook-import-dialog"');
    expect(browsing).toContain("data-lorebook-delete-book");
    const menuMarkup = [
      ...browsing.matchAll(
        /<div id="lorebook-(?:collection|book)-actions" class="action-menu" popover[^>]*>(.*?)<\/div>/gs,
      ),
    ]
      .map((match) => match[1])
      .join("");
    expect(menuMarkup).not.toContain('data-lorebook-open="lorebook-entry-dialog"');
    expect(browsing).toContain(
      '<button class="button primary" type="button" data-lorebook-open="lorebook-entry-dialog"',
    );
    expect(browsing).toContain('data-lorebook-form="book-rename"');
    expect(browsing).toContain("novalidate hidden");
    expect(html).not.toContain("<details");
    expect(html).toContain('id="lorebook-entry-dialog"');
  });

  it("separates entry content, matching words and additional rules into focused editor sections", async () => {
    const source = await dashboardFunction("openLorebookEditor");
    const mailbox = { dataset: { view: "list" } };
    const host = { innerHTML: "", querySelector: () => ({ focus: () => {} }), closest: () => mailbox };
    let enhanced = 0;
    const selections = new Map();
    const open = runInNewContext(`(${source})`, {
      state: {
        overview: { canManage: true },
        lorebookBookId: 3,
        lorebookData: {
          entries: [
            {
              entry_id: 11,
              title: "Harbor",
              content: "A harbor.",
              keys: ["harbor"],
              secondary_keys: [],
              enabled: true,
              constant: false,
              scan_depth: 5,
              trigger_chance: 100,
              insertion_order: 100,
              placement: 0,
            },
          ],
        },
      },
      activeLorebookLineage: () => 0,
      lorebookSelections: selections,
      lorebookSelectionKey: () => "42/0/3",
      window: { TomoriControls: { enhance: () => enhanced++ } },
      ui: (key: string) => key,
      escapeHtml: (value: string) => value,
      fieldLabel: (value: string) => value,
      document: { querySelector: () => host, querySelectorAll: () => [] },
      navigationIcon: () => "",
      lorebookDialog: (_id: string, _title: string, body: string) => body,
      lorebookDialogActions: () => "",
      initDraftForms: () => {},
    }) as (id: number, section: string) => void;
    open(11, "content");
    expect(host.innerHTML).toContain('name="content"');
    expect(host.innerHTML).not.toContain('name="keys"');
    expect(host.innerHTML).not.toContain("<dialog");
    expect(host.innerHTML).toContain("data-lorebook-back");
    expect(host.innerHTML).toContain('name="enabled"');
    expect(host.innerHTML.match(/type="submit"/g)).toHaveLength(1);
    expect(host.innerHTML).toContain('data-lorebook-delete-entry="11"');
    expect(host.innerHTML).not.toContain("data-lorebook-flag");
    expect(mailbox.dataset.view).toBe("detail");
    open(11, "matching");
    expect(host.innerHTML).toContain('name="keys"');
    expect(host.innerHTML).not.toContain('name="content"');
    expect(host.innerHTML).toContain('data-lorebook-form="constant"');
    expect(host.innerHTML).not.toContain("data-lorebook-flag");
    open(11, "rules");
    expect(host.innerHTML).toContain('name="secondaryKeys"');
    expect(host.innerHTML).toContain('name="triggerChance"');
    expect(host.innerHTML).not.toContain('name="content"');
    expect(selections.get("42/0/3")).toEqual({ entryId: 11, section: "rules" });
    expect(enhanced).toBe(3);
  });
});
