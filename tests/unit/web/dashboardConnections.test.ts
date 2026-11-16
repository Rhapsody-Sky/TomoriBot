import { describe, expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

async function dashboardFunction(name: string): Promise<string> {
  const source = await Bun.file("src/web/dashboard/assets/app.js").text();
  const ast = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let result = "";
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(result).not.toBe("");
  return result;
}

describe("dashboard connections", () => {
  it("restores the save label without turning an expired spark into button text", async () => {
    const source = await dashboardFunction("withBusyForm");
    const label = { textContent: "save" };
    const control = {
      disabled: false,
      childNodes: [label],
      get textContent() {
        return this.childNodes.map((node) => node.textContent).join("");
      },
      set textContent(text: string) {
        this.childNodes = [{ textContent: text }];
      },
      replaceChildren(fragment: { childNodes: (typeof label)[] }) {
        this.childNodes = fragment.childNodes;
      },
    };
    const savedContent = {
      childNodes: [] as (typeof label)[],
      append(...nodes: (typeof label)[]) {
        this.childNodes = nodes;
        control.childNodes = [];
      },
    };
    const withBusyForm = runInNewContext(`${source}; withBusyForm`, {
      document: { activeElement: null, createDocumentFragment: () => savedContent },
      state: { overview: {} },
      savingForms: 0,
      ui: String,
    }) as (form: object, action: () => Promise<void>) => Promise<void>;
    const classes = new Set<string>();
    const form = {
      querySelectorAll: () => [control],
      querySelector: () => control,
      contains: () => false,
      classList: {
        contains: (name: string) => classes.has(name),
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
      },
      setAttribute: () => {},
      removeAttribute: () => {},
    };
    const failure = new Error();
    for (let attempt = 0; attempt < 2; attempt++) {
      const burst = { textContent: "✦✧" };
      control.childNodes.push(burst);
      await expect(
        withBusyForm(form, async () => {
          expect(control.textContent).toBe("saving");
          expect(control.disabled).toBe(true);
          savedContent.childNodes = savedContent.childNodes.filter((node) => node !== burst);
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(control.childNodes[0]).toBe(label);
      expect(control.textContent).toBe("save");
      expect(control.disabled).toBe(false);
    }
  });

  it("indexes visible dashboard destinations for the workspace and account permissions", async () => {
    const source = await dashboardFunction("buildSettingsSearchIndex");
    const overview = {
      canManage: true,
      guild: { isDirectMessage: false },
      personas: [
        { personaId: 1, lineageId: 0, nickname: "Shared" },
        { personaId: 2, lineageId: 4, nickname: "Juno" },
        { personaId: 3, lineageId: 5, nickname: "Mirri" },
      ],
      personaNaming: { copy: { tab: "preferences" } },
      settings: { catalog: [] },
    };
    const state = {
      overview: overview as typeof overview | null,
      providerData: {},
      session: { user: { isGlobalAdmin: false } },
      publicSite: { copy: { title: "site_title", pages: "site_pages", links: "site_links" } },
    };
    const build = runInNewContext(`${source}; buildSettingsSearchIndex`, {
      state,
      ui: String,
      profileTabs: { profile: "user-round", privacy: "brain", conversation: "message-circle" },
      moderationTabs: {},
      settingsGroups: [],
      channelSettingsFields: [],
      personaKnowledgeTabs: () => [],
      settingSearchText: (element: { textContent: string }) => element.textContent,
      document: {
        createElement: () => {
          const template = {
            innerHTML: "",
            content: {
              querySelectorAll: () =>
                template.innerHTML
                  ? [{ tagName: "h3", textContent: template.innerHTML, closest: () => null, querySelector: () => null }]
                  : [],
            },
          };
          return template;
        },
      },
      renderProfilePanel: (section: string) => `${section} options`,
      renderPersonaNaming: () => "How this persona addresses you",
      renderPersonaSettings: () => "",
      renderPersonaAppearance: () => "",
      renderChannelOverrides: () => "",
    }) as () => {
      view: string;
      title?: string;
      profileTab?: string;
      personaId?: number;
      personaHome?: boolean;
      personaPanel?: string;
      name?: string;
      siteTab?: string;
      channelSelection?: boolean;
    }[];
    for (const canManage of [true, false]) {
      overview.canManage = canManage;
      const entries = build();
      expect(entries.some((entry) => entry.view === "overview" && entry.title === "overview_title")).toBe(true);
      expect(entries.some((entry) => entry.view === "settings" && entry.title === "nav_server_settings")).toBe(
        canManage,
      );
      expect(entries.some((entry) => entry.view === "channel-settings" && entry.channelSelection)).toBe(canManage);
      expect(entries.some((entry) => entry.view === "site-admin")).toBe(false);
      expect(entries.find((entry) => entry.title === "conversation options")?.profileTab).toBe("conversation");
      expect(entries.filter((entry) => entry.personaHome).map((entry) => entry.personaId)).toEqual([2, 3]);
      for (const personaId of [2, 3]) {
        expect(entries.some((entry) => entry.personaId === personaId && entry.personaPanel === "preferences")).toBe(
          true,
        );
        expect(entries.some((entry) => entry.personaId === personaId && entry.name === "modelId")).toBe(canManage);
      }
      expect(entries.some((entry) => entry.personaId === 1)).toBe(false);
    }
    overview.canManage = true;
    overview.guild.isDirectMessage = true;
    expect(build().some((entry) => entry.view === "channel-settings")).toBe(false);

    state.session.user.isGlobalAdmin = true;
    state.overview = null;
    const entriesWithoutServer = build();
    expect(entriesWithoutServer.every((entry) => entry.view === "site-admin")).toBe(true);
    expect(entriesWithoutServer.some((entry) => entry.title === "site_title")).toBe(true);
    expect(entriesWithoutServer.some((entry) => entry.siteTab === "links")).toBe(true);
  });

  it("keeps a channel field destination pending until the channel settings are visible", async () => {
    const source = await dashboardFunction("channelSearchDestination");
    const picker = {};
    const field = {};
    const fields = {};
    let channelLoaded = false;
    const form = {
      querySelector: (selector: string) =>
        selector === "[data-channel-picker]" ? picker : channelLoaded ? fields : null,
    };
    const root = { querySelector: () => form };
    const entry = { name: "channel_autochat_id", channelPickerFocused: false };
    const revealed: unknown[] = [];
    const resolve = runInNewContext(`${source}; channelSearchDestination`, {
      revealSearchDestination: (target: unknown) => revealed.push(target),
      searchField: (scope: unknown, name: string) => (scope === fields && name === entry.name ? field : null),
    }) as (root: unknown, entry: unknown) => unknown;

    expect(resolve(root, entry)).toBeNull();
    expect(resolve(root, entry)).toBeNull();
    expect(revealed).toEqual([picker]);
    channelLoaded = true;
    expect(resolve(root, entry)).toBe(field);
  });

  it("filters channel choices while preserving stored selections outside the allowlist", async () => {
    const source = await dashboardFunction("renderChannelSelector");
    const overview = {
      allowedChannelIds: ["1"],
      channelWhitelistActive: true,
      channels: [
        { id: "1", name: "general" },
        { id: "2", name: "private" },
      ],
    };
    const render = runInNewContext(`${source}; renderChannelSelector`, {
      state: { overview },
      ui: String,
      escapeHtml: String,
    });
    const filtered = render("channelDiscIds", ["2"]);
    expect(filtered).toContain('data-channel-search="general');
    expect(filtered).not.toContain('data-channel-search="private');
    expect(filtered).toContain('<label hidden><input type="checkbox" name="channelDiscIds" value="2" checked>');
    expect(render("allowedChannels", [])).toContain('data-channel-search="private');
    overview.allowedChannelIds = [];
    expect(render("channelDiscIds", [])).not.toContain("data-channel-search");
    overview.channelWhitelistActive = false;
    expect(render("channelDiscIds", [])).toContain('data-channel-search="private');
  });

  it("preserves stored admin selections when their channels are hidden from the inventory", async () => {
    const source = await dashboardFunction("renderChannelSelector");
    const overview = { channels: [{ id: "1", name: "general" }], allowedChannelIds: [] };
    const render = runInNewContext(`${source}; renderChannelSelector`, {
      state: { overview },
      ui: String,
      escapeHtml: String,
    });
    const options = { preserveMissing: true };
    expect(render("personaChannels", ["1", "2"], false, overview.channels, options)).toContain(
      '<label hidden><input type="checkbox" name="personaChannels" value="2" checked>',
    );
    const single = render("thought_log_channel_disc_id", ["2"], true, overview.channels, options);
    expect(single).toContain('name="thought_log_channel_disc_id" value="2" checked');
    expect(single).toContain('name="thought_log_channel_disc_id" value=""');
    expect(single).not.toContain('name="thought_log_channel_disc_id" value="" checked');

    const collectSource = await dashboardFunction("collectSettingsPatch");
    const collect = runInNewContext(`${collectSource}; collectSettingsPatch`);
    const input = { value: "2" };
    let unavailableChecked = true;
    const form = {
      elements: { namedItem: () => input },
      querySelector: () => (unavailableChecked ? input : null),
    };
    const section = { fields: [{ key: "thought_log_channel_disc_id", type: "select" }] };
    expect(collect(form, section)).toEqual({});
    unavailableChecked = false;
    input.value = "";
    expect(collect(form, section)).toEqual({ thought_log_channel_disc_id: null });
  });

  it("filters flat Collection channel rows within their own category", async () => {
    const source = await dashboardFunction("filterChannelGroup");
    const rows = await dashboardFunction("channelGroupRows");
    const filter = runInNewContext(`${rows}\n${source}\nfilterChannelGroup`) as (
      heading: unknown,
      query: string,
      expanded: boolean,
    ) => void;
    const nextGroup = { hidden: false, hasAttribute: () => false };
    const second = {
      hidden: false,
      dataset: { channelSearch: "memes quality not guaranteed" },
      hasAttribute: (name: string) => name === "data-channel-search",
      nextElementSibling: nextGroup,
    };
    const first = { ...second, dataset: { channelSearch: "general say hi" }, nextElementSibling: second };
    const attributes = new Map();
    const heading = {
      hidden: false,
      nextElementSibling: first,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    };
    filter(heading, "", false);
    expect(first.hidden && second.hidden).toBe(true);
    expect(attributes.get("aria-expanded")).toBe("false");
    filter(heading, "quality", true);
    expect(first.hidden).toBe(true);
    expect(second.hidden).toBe(false);
    expect(nextGroup.hidden).toBe(false);
    expect(heading.hidden).toBe(false);
    filter(heading, "unmatched", true);
    expect(heading.hidden).toBe(true);
  });

  it("ranks setting names ahead of descriptions and matches words across their location", async () => {
    const source = await dashboardFunction("filterSettingsSearch");
    const filter = runInNewContext(`${source}; filterSettingsSearch`);
    const entries = [
      { title: "Sampling", path: "Server", hint: "Temperature controls" },
      { title: "Temperature", path: "Personal", hint: "" },
      { title: "Temperature", path: "Server", hint: "" },
    ];
    expect(filter(entries, "temperature").map((entry: { title: string }) => entry.title)).toEqual([
      "Temperature",
      "Temperature",
      "Sampling",
    ]);
    expect(filter(entries, "SERVER temperature")).toHaveLength(2);
    expect(filter(entries, "not-a-setting")).toHaveLength(0);
    expect(filter(entries, "")).toHaveLength(3);
    const personaEntries = [
      { title: "nickname", path: "Personas / Juno", hint: "triggerWords" },
      { title: "triggerWords", path: "Personas / Juno", hint: "" },
      { title: "triggerWords", path: "Personas / Mirri", hint: "" },
    ];
    expect(filter(personaEntries, "Juno triggerWords")).toEqual([personaEntries[1], personaEntries[0]]);
    const serverSettings = { title: "Server Settings", path: "Server Settings", hint: "" };
    const crossServerMemory = { title: "Cross-server short-term memory", path: "My settings", hint: "" };
    expect(filter([crossServerMemory, serverSettings], "server settings")[0]).toBe(serverSettings);
  });

  it("puts sprite editing and deletion in the dialog and keeps the tile a single action", async () => {
    const tileSource = await dashboardFunction("renderSpriteTile");
    const dialogSource = await dashboardFunction("renderSpriteDialog");
    const previewSource = await dashboardFunction("renderSpritePreview");
    const shared = {
      escapeHtml: String,
      ui: String,
      navigationIcon: () => "",
      personaSticker: () => "",
      fieldLabel: String,
    };
    const sprite = {
      key: "smile",
      name: "Smile",
      instructions: "When greeting someone",
      identity: true,
      imageUrl: "/sprite.png",
    };
    const tile = runInNewContext(`(${tileSource})`, shared) as (sprite: unknown) => string;
    const dialog = runInNewContext(`${previewSource}\n${dialogSource}\nrenderSpriteDialog`, shared) as (
      personaId: number,
      sprite: unknown,
      limits: { name: number; instructions: number },
    ) => string;
    const tileHtml = tile(sprite);
    const editHtml = dialog(2, sprite, { name: 32, instructions: 200 });
    const createHtml = dialog(2, undefined, { name: 32, instructions: 200 });

    expect(tileHtml).toContain('data-sprite-edit="smile"');
    expect(tileHtml).toContain(sprite.instructions);
    expect(tileHtml).not.toContain("data-sprite-remove");
    expect(editHtml).toContain('data-sprite-key="smile"');
    expect(editHtml).toContain("data-hold data-sprite-remove");
    expect(editHtml).toMatch(
      /<label[^>]+data-upload-zone>[\s\S]*<img[^>]+src="\/sprite\.png"[\s\S]*<input type="file"[^>]*>\s*<\/label>/,
    );
    expect(editHtml.match(/type="file"/g)).toHaveLength(1);
    expect(createHtml).not.toContain("data-sprite-remove");
  });

  it("reveals save and discard only while a form differs from its baseline", async () => {
    const captureSource = await dashboardFunction("captureDraft");
    const actionsSource = await dashboardFunction("setEditActions");
    const discard = { hidden: false, hasAttribute: (name: string) => name === "data-discard-draft" };
    const save = { hidden: false, dataset: {}, previousElementSibling: discard };
    const form = {
      dataset: { draftKey: "profile/identity" },
      matches: () => false,
      querySelectorAll: () => [save],
    };
    let value = "Mirri";
    const snapshot = () => [{ name: "nickname", value }];
    const drafts = new Map();
    const capture = runInNewContext(`${actionsSource}; ${captureSource}; captureDraft`, {
      editSubmit: "button",
      window: { TomoriFX: { reflowActions: (_row: unknown, update: () => void) => update() } },
      drafts,
      formBaselines: new Map([[form, snapshot()]]),
      formSnapshot: snapshot,
    }) as (form: unknown) => void;
    capture(form);
    expect([save.hidden, discard.hidden, drafts.size]).toEqual([true, true, 0]);
    value = "Juno";
    capture(form);
    expect([save.hidden, discard.hidden, drafts.size]).toEqual([false, false, 1]);
    value = "Mirri";
    capture(form);
    expect([save.hidden, discard.hidden, drafts.size]).toEqual([true, true, 0]);
  });

  it("renders a widened PostgreSQL REAL value without floating-point noise", async () => {
    const format = await dashboardFunction("formatStoredParameterValue");
    const field = await dashboardFunction("renderSettingField");
    const render = runInNewContext(`${format}; ${field}; renderSettingField`, {
      escapeHtml: String,
      fieldLabel: String,
    }) as (field: object, value: number | null) => string;
    const topP = { type: "number", key: "llm_top_p", label: "Top P", min: 0, max: 1, step: 0.01, nullable: true };
    expect(render(topP, Math.fround(0.95))).toContain('value="0.95"');
    expect(render(topP, null)).toContain('value=""');
  });

  it("groups endpoint models by provider and preserves or repairs selected connections", async () => {
    const connectionsSource = await dashboardFunction("providerConnections");
    const selectSource = await dashboardFunction("selectProviderConnection");
    const state = { providerConnection: { personal: "endpoint:custom:5", server: null } };
    const select = runInNewContext(`${connectionsSource}; ${selectSource}; selectProviderConnection`, { state }) as (
      data: unknown,
      scope: string,
    ) => { connections: { key: string; endpoints?: unknown[] }[]; connection: { key: string } | null };
    const data = {
      providers: [
        { provider: "openrouter", displayName: "OpenRouter" },
        { provider: "custom:5", displayName: "Local" },
      ],
      endpoints: [
        { id: 1, provider: "custom:5", displayName: "Local" },
        { id: 2, provider: "custom:5", displayName: "Local" },
      ],
    };
    const initial = select(data, "personal");
    expect(initial.connections).toHaveLength(2);
    expect(initial.connection?.key).toBe("endpoint:custom:5");
    expect(initial.connections[1].endpoints).toHaveLength(2);
    expect(select({ providers: data.providers.slice(0, 1), endpoints: [] }, "personal").connection?.key).toBe(
      "provider:openrouter",
    );
    expect(select({ providers: [], endpoints: [] }, "personal").connection).toBeNull();
    expect(state.providerConnection.personal).toBeNull();
  });

  it("ignores stale provider workspace responses after a guild switch or newer refresh", async () => {
    const source = await dashboardFunction("loadProviderWorkspace");
    const state = {
      guildId: "1",
      view: "personal-providers",
      providerData: { personal: null as unknown, server: null },
    };
    const pending: ((value: unknown) => void)[] = [];
    const load = runInNewContext(
      `const providerLoadVersion = {personal: 0, server: 0}; ${source}; loadProviderWorkspace`,
      {
        state,
        api: () => new Promise((resolve) => pending.push(resolve)),
        renderView: () => {},
        toast: () => {},
      },
    ) as (scope: string) => Promise<boolean>;
    const oldGuild = load("personal");
    state.guildId = "2";
    const older = load("personal");
    const latest = load("personal");
    const expected = { providers: [] };
    pending[2](expected);
    expect(await latest).toBe(true);
    pending[1]({ old: true });
    pending[0]({ oldGuild: true });
    expect(await older).toBe(false);
    expect(await oldGuild).toBe(false);
    expect(state.providerData.personal).toBe(expected);
  });

  it("keeps the active provider selected when the submenu needs a searchable select", async () => {
    const source = await dashboardFunction("renderProviderPicker");
    const render = runInNewContext(`(${source})`, { ui: String, escapeHtml: String });
    const connections = Array.from({ length: 8 }, (_, index) => ({
      key: `endpoint:custom:${index + 1}`,
      name: `Local ${index + 1}`,
    }));
    const active = connections[2].key;
    for (const scope of ["personal", "server"]) {
      const segmented = render(connections.slice(0, 5), active, scope);
      expect(segmented.activeTab).toBe(`${scope}-connection-2`);
      expect(segmented.markup).toContain(`aria-selected="true" tabindex="0" data-connection-select="${active}"`);
      const select = render(connections, active, scope);
      expect(select.markup).toContain(`data-provider-select="${scope}" data-searchable`);
      expect(select.markup).toContain(`value="${active}" selected`);
      for (const connection of connections) expect(select.markup).toContain(`value="${connection.key}"`);
    }
  });

  it("lists only the selected provider's available models", async () => {
    const source = await dashboardFunction("renderConnectionModels");
    const render = runInNewContext(`(${source})`, {
      ui: (key: string) => key,
      escapeHtml: (value: string) => value,
    }) as (data: unknown, scope: string, provider: string) => string;
    const html = render(
      {
        models: {
          options: {
            text: [
              { provider: "one", label: "Model one" },
              { provider: "two", label: "Model two" },
            ],
          },
        },
      },
      "server",
      "one",
    );
    expect(html).toContain("Model one");
    expect(html).not.toContain("Model two");
  });
});
