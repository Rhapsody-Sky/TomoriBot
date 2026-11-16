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

describe("Persona section navigation", () => {
  it("keeps a tracked card draft when navigation is canceled and clears it on discard", async () => {
    const source = await dashboardFunction("confirmPersonaSectionChange");
    const key = "persona-settings/77";
    const otherKey = "persona-settings/89";
    const drafts = new Map([
      [key, []],
      [otherKey, []],
    ]);
    let discard = false;
    const confirm = runInNewContext(`(${source})`, {
      state: { personaPanel: "settings" },
      drafts,
      ui: (name: string) => name,
      confirmAction: async () => discard,
    }) as (content: unknown) => Promise<boolean>;
    const form = { dataset: { draftKey: key } };
    const content = {
      isConnected: true,
      querySelector: (selector: string) => (selector === "form[data-changed]" ? form : null),
      querySelectorAll: (selector: string) => (selector === "form[data-draft-key]" ? [form] : []),
    };

    expect(await confirm(content)).toBe(false);
    expect(drafts.has(key)).toBe(true);
    discard = true;
    expect(await confirm(content)).toBe(true);
    expect([...drafts.keys()]).toEqual([otherKey]);
  });
});

describe("dashboard lorebook UI", () => {
  beforeAll(() => initializeLocalizer());

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
      state: { overview: { canManage: true, channels: [{ id: "1", name: "creative" }] } },
      ui: (key: string) => localizedCopy("en-US", `general.dashboard.interface_${key}`),
      escapeHtml: (value: string) => value,
      lorebookUsage: () => "",
      navigationIcon: () => "",
    }) as (entry: unknown, book?: { channel_disc_ids: string[] }) => string;
    const html = render(
      {
        entry_id: 11,
        title: "Harbor",
        content: "A harbor.",
        keys: ["harbor"],
        secondary_keys: ["tide"],
        channel_disc_ids: [],
        enabled: true,
      },
      { channel_disc_ids: ["1"] },
    );
    expect(html.match(/data-lorebook-edit-entry=/g)).toHaveLength(1);
    expect(html).toContain('<article class="item"');
    expect(html).toMatch(/data-lorebook-search="[^"]*tide[^"]*creative/);
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
      expect(html.includes('id="lorebook-book-actions"')).toBe(lineageId === 0);
      for (const id of ["lorebook-entry-dialog", "lorebook-import-dialog"]) {
        const dialog = html.split(`<dialog id="${id}">`)[1]?.split("</dialog>")[0];
        expect(dialog).toContain(localizedCopy("en-US", `general.dashboard.interface_${label}`));
        expect(dialog).toContain(`>${name}<`);
        if (id === "lorebook-entry-dialog") {
          expect(dialog).toContain(localizedCopy("en-US", "general.dashboard.interface_lorebook_title"));
          expect(dialog).toContain('name="title" maxlength="128" required autofocus');
          expect(dialog).not.toContain(`value="${name}"`);
        }
      }
    }
  });

  it("keeps every entry draft on cancel and clears them all on confirmed discard", async () => {
    const source = await dashboardFunction("confirmDraftDiscard");
    const keys = ["lorebook/77/0/11/keys", "lorebook/77/0/11/channels", "lorebook/77/0/12/content"];
    const drafts = new Map(keys.map((key) => [key, []]));
    let accepted = false;
    const confirm = runInNewContext(`(${source})`, {
      drafts,
      ui: (key: string) => key,
      confirmAction: async (_title: string, message: string) => {
        expect(message).toBe("discard_detail");
        return accepted;
      },
    }) as (editor: unknown) => Promise<boolean>;
    const editor = {
      isConnected: true,
      querySelectorAll: () => keys.slice(0, 2).map((draftKey) => ({ dataset: { draftKey } })),
    };
    expect(await confirm(editor)).toBe(false);
    expect([...drafts.keys()]).toEqual(keys);
    accepted = true;
    expect(await confirm(editor)).toBe(true);
    expect([...drafts.keys()]).toEqual([keys[2]]);
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
      lorebookKeys: () => ["harbor"],
      withBusyForm: async (_form: unknown, action: () => Promise<void>) => action(),
      api: async (path: string, options: { body: string }) => {
        writes.push({ path, payload: JSON.parse(options.body) });
      },
      completeFormSave: (form: unknown) => completed.push(form),
      toast: () => {},
      ui: (key: string) => key,
      loadLorebooks: async () => {},
    }) as (form: unknown) => Promise<void>;
    const form = {
      isConnected: true,
      closest: () => null,
      dataset: { lorebookForm: "triggers", entryId: "9", originalKeys: '["harbor"]' },
      elements: { constant: { checked: false } },
    };
    await save(form);
    expect(writes).toEqual([
      {
        path: "/guilds/42/lorebooks/entries/9/flags",
        payload: { lineageId: 0, bookId: 3, flags: { constant: false } },
      },
    ]);
    expect(completed.at(-1)).toBe(form);
  });

  it("retries the persona trigger card without losing an Always on selection", async () => {
    const source = await dashboardFunction("saveLorebookForm");
    const keys = await dashboardFunction("lorebookKeys");
    const writes: { route: string; body: unknown }[] = [];
    let rejectFlags = true;
    let completed = false;
    const save = runInNewContext(`${keys}; (${source})`, {
      state: { guildId: "42" },
      activeLorebookLineage: () => 77,
      lorebookScope: () => ({ lineageId: 77 }),
      document: { querySelector: () => null },
      lorebookCurrent: () => true,
      withBusyForm: (_form: unknown, action: () => Promise<void>) => action(),
      api: async (path: string, options: { body: string }) => {
        const route = path.split("/").at(-1) || "";
        writes.push({ route, body: JSON.parse(options.body) });
        if (route === "flags" && rejectFlags) throw new Error("failed");
      },
      completeFormSave: () => {
        completed = true;
      },
      toast: () => {},
      ui: (key: string) => key,
      loadLorebooks: async () => {},
    }) as (form: unknown) => Promise<void>;
    const form = {
      isConnected: true,
      closest: () => null,
      dataset: { lorebookForm: "triggers", entryId: "9", originalKeys: '["old"]' },
      elements: { keys: { value: "harbor\n/sea,glass/i" }, constant: { checked: true, disabled: false } },
    };
    await expect(save(form)).rejects.toThrow("lorebook_triggers_partial_save");
    expect(completed).toBe(false);
    rejectFlags = false;
    await save(form);
    const requests = [
      { route: "keys", body: { lineageId: 77, keys: ["harbor", "/sea,glass/i"] } },
      { route: "flags", body: { lineageId: 77, flags: { constant: true } } },
    ];
    expect(writes).toEqual([...requests, ...requests]);
    expect(completed).toBe(true);
    writes.length = 0;
    form.elements.keys.value = "old";
    form.elements.constant.checked = false;
    await save(form);
    expect(writes).toEqual([{ route: "flags", body: { lineageId: 77, flags: { constant: false } } }]);
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
    const restoreFocus = await dashboardFunction("restoreLorebookDialogFocus");
    let fail = true;
    let closed = 0;
    let focused = 0;
    let refreshed = 0;
    let payload: unknown;
    const dialog = { id: "lorebook-entry-dialog", close: () => closed++ };
    const save = runInNewContext(`${focusTarget}; ${restoreFocus}; (${source})`, {
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
      pendingSearchDestination: null,
      window: {},
      loadingBar: () => "",
      lorebookSelections: new Map(),
      lorebookSelectionKey: () => "scope",
      document: { querySelector: (selector: string) => (selector === "#lorebook-workspace" ? target : null) },
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

  it("resolves a field search from an empty lorebook to an entry in a populated book", async () => {
    const source = await dashboardFunction("loadLorebooks");
    const state = { guildId: "1", lorebookBookId: 3, lorebookData: null };
    const target = { innerHTML: "", querySelector: () => null };
    const books = [
      { lorebook_id: 3, entryCount: 0 },
      { lorebook_id: 4, entryCount: 1 },
    ];
    const requests: number[] = [];
    const selectedEntries: number[] = [];
    let focused = false;
    const load = runInNewContext(`let lorebookLoadVersion = 0; ${source}; loadLorebooks`, {
      state,
      pendingSearchDestination: { view: "lorebooks", lorebookEntryField: true },
      window: {},
      loadingBar: () => "",
      lorebookSelections: new Map(),
      lorebookSelectionKey: () => "scope",
      document: { querySelector: (selector: string) => (selector === "#lorebook-workspace" ? target : null) },
      URLSearchParams,
      lorebookCurrent: () => true,
      ui: String,
      api: (path: string) => {
        const bookId = Number(new URL(path, "http://localhost").searchParams.get("bookId"));
        requests.push(bookId);
        return Promise.resolve({ books, entries: bookId === 4 ? [{ entry_id: 12 }] : [] });
      },
      renderLorebooks: () => "library",
      initDraftForms: () => {},
      openLorebookEditor: (id: number) => selectedEntries.push(id),
      focusSearchDestination: () => {
        focused = true;
      },
    }) as (lineage: number) => Promise<void>;

    await load(0);
    expect(requests).toEqual([3, 4]);
    expect(state.lorebookBookId).toBe(4);
    expect(selectedEntries).toEqual([12]);
    expect(focused).toBe(true);
  });

  it("keeps book actions and entry creation available from the library", async () => {
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
    expect(browsing).toContain('class="browser" data-layout="list" data-view="list"');
    expect(browsing).toContain('id="lorebook-editor-host" aria-labelledby="lorebook-editor-title" hidden');
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
      '<button class="button small primary" type="button" data-lorebook-open="lorebook-entry-dialog"',
    );
    expect(browsing).toContain('data-lorebook-form="book-rename"');
    expect(browsing).toContain("novalidate hidden");
    expect(html).not.toContain("<details");
    expect(html).toContain('id="lorebook-entry-dialog"');
  });

  it("uses the book's channels for server entries and provides separate content, trigger and rule forms", async () => {
    const source = await dashboardFunction("openLorebookEditor");
    const browser = { dataset: { view: "list" }, hidden: false };
    const host = {
      hidden: true,
      innerHTML: "",
      querySelector: () => ({ focus: () => {} }),
      closest: (selector: string) => (selector === "#lorebook-workspace" ? { querySelector: () => browser } : null),
    };
    let enhanced = 0;
    const selections = new Map();
    let lineageId = 0;
    const open = runInNewContext(`(${source})`, {
      state: {
        overview: { canManage: true, channels: [{ id: "2", name: "creative" }] },
        lorebookBookId: 3,
        lorebookData: {
          books: [{ lorebook_id: 3, name: "History", channel_disc_ids: ["2"] }],
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
              channel_disc_ids: ["1"],
            },
          ],
        },
      },
      activeLorebookLineage: () => lineageId,
      lorebookSelections: selections,
      lorebookSelectionKey: () => "42/0/3",
      window: {
        TomoriControls: { enhance: () => enhanced++ },
        TomoriFX: {
          enhance: () => {},
          swap: (_element: unknown, html: string) => {
            host.innerHTML = html;
          },
        },
      },
      ui: (key: string) => key,
      escapeHtml: (value: string) => value,
      fieldLabel: (value: string) => value,
      document: { querySelector: () => host, querySelectorAll: () => [] },
      navigationIcon: () => "",
      lorebookDialog: (_id: string, _title: string, body: string) => body,
      lorebookDialogActions: () => "",
      lorebookChannels: () => '<input name="channelDiscIds">',
      cardSaveActions: () => "",
      initDraftForms: () => {},
    }) as (id: number) => void;
    open(11);
    expect(host.innerHTML).toContain('name="content"');
    expect(host.innerHTML).toContain('name="keys"');
    expect(host.innerHTML).not.toContain("<dialog");
    expect(host.innerHTML).toContain("data-lorebook-back");
    expect(host.innerHTML).toContain('name="enabled"');
    expect(host.innerHTML).toContain('data-lorebook-delete-entry="11"');
    expect(browser.dataset.view).toBe("detail");
    expect(browser.hidden).toBe(true);
    expect(host.innerHTML).toContain('data-lorebook-form="triggers"');
    expect(host.innerHTML).toContain('name="secondaryKeys"');
    expect(host.innerHTML).toContain('name="triggerChance"');
    expect(host.innerHTML).toContain('data-lorebook-open="lorebook-settings-dialog"');
    expect(host.innerHTML).toContain("creative");
    expect(host.innerHTML).not.toContain('data-lorebook-form="entry-channels"');
    expect(selections.get("42/0/3")).toEqual({ entryId: 11 });
    expect(enhanced).toBe(1);
    lineageId = 77;
    open(11);
    expect(host.hidden).toBe(false);
    expect(host.innerHTML).not.toContain('role="tablist"');
    const order = ["content", "triggers", "activation", "entry-channels"].map((name) =>
      host.innerHTML.indexOf(`data-lorebook-form="${name}"`),
    );
    expect(order[0]).toBeGreaterThan(-1);
    expect(order.every((position, index) => index === 0 || position > order[index - 1])).toBe(true);
    expect(host.innerHTML).toMatch(
      /<div class="split"><div class="col">[\s\S]*?<\/form><\/div><form[^>]+data-lorebook-form="entry-channels"/,
    );
  });
});
