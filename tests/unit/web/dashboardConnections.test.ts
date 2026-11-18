import { describe, expect, it } from "bun:test";
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
    const source = await Promise.all(
      ["dashboardNavigation", "personaSections", "buildSettingsSearchIndex", "filterSettingsSearch"].map(
        dashboardFunction,
      ),
    );
    const overview = {
      canManage: true,
      guild: { isDirectMessage: false },
      personas: [
        { personaId: 1, lineageId: 0, nickname: "Shared" },
        { personaId: 2, lineageId: 4, nickname: "Juno" },
        { personaId: 3, lineageId: 5, nickname: "Mirri" },
      ],
      personaNaming: { copy: { tab: "preferences" } },
      personaNamingHabits: {},
      settings: { catalog: [] },
    };
    const state = {
      overview: overview as typeof overview | null,
      providerData: {},
      session: { user: { isGlobalAdmin: false } },
      publicSite: {
        copy: {
          title: "site_title",
          admin: "site_admin",
          pages: "site_pages",
          links: "site_links",
          show_on_login: "show_on_login",
          show_in_sidebar: "show_in_sidebar",
        },
      },
    };
    const {
      buildSettingsSearchIndex: build,
      filterSettingsSearch: filter,
      dashboardNavigation: navigation,
    } = runInNewContext(
      `${source.join("\n")}\n({ buildSettingsSearchIndex, filterSettingsSearch, dashboardNavigation })`,
      {
        state,
        ui: String,
        profileTabs: { profile: "user-round", privacy: "brain", conversation: "message-circle" },
        moderationTabs: {},
        settingsGroups: [],
        channelSettingsFields: [],
        settingSearchText: (element: { textContent: string }) => element.textContent,
        document: {
          createElement: () => {
            const template = {
              innerHTML: "",
              content: {
                querySelectorAll: () =>
                  template.innerHTML
                    ? [
                        {
                          tagName: "h3",
                          textContent: template.innerHTML,
                          closest: () => null,
                          querySelector: () => null,
                        },
                      ]
                    : [],
              },
            };
            return template;
          },
        },
        renderProfilePanel: (section: string) => `${section} options`,
        renderPersonaNaming: () => "How this persona addresses you",
        renderPersonaIdentity: () => "Display identity",
        renderPersonaBehaviour: () => "Sample dialogues",
        renderPersonaAppearance: () => "",
        renderChannelOverrides: () => "",
      },
    ) as {
      buildSettingsSearchIndex: () => SearchEntry[];
      filterSettingsSearch: (entries: SearchEntry[], query: string) => SearchEntry[];
      dashboardNavigation: () => { title: string; links: { view: string }[] }[];
    };
    type SearchEntry = {
      view: string;
      title: string;
      path: string;
      statsRangeEditing?: boolean;
      profileTab?: string;
      personaId?: number;
      personaHome?: boolean;
      personaPanel?: string;
      name?: string;
      siteTab?: string;
      channelSelection?: boolean;
    };
    const commonPages = {
      my_settings: "profile",
      my_memories: "personal-memory",
      nav_personal_providers: "personal-providers",
      overview_title: "overview",
      personas_title: "personas",
      spotlights: "personal-spotlights",
      server_lorebooks: "lorebooks",
    };
    const managerPages = {
      nav_server_providers: "server-providers",
      channel_settings: "channel-settings",
      moderation: "moderation",
      nav_server_settings: "settings",
      nudge_title: "natural-nudges",
    };
    for (const canManage of [true, false]) {
      overview.canManage = canManage;
      const entries = build();
      expect(navigation().map(({ links }) => links.map(({ view }) => view))).toEqual([
        ["overview", "personas", "lorebooks", "personal-spotlights"],
        ["profile", "personal-memory", "personal-providers"],
        ...(canManage ? [["settings", "channel-settings", "server-providers", "moderation", "natural-nudges"]] : []),
      ]);
      for (const [title, view] of Object.entries({ ...commonPages, ...(canManage ? managerPages : {}) })) {
        expect(filter(entries, title)[0]).toMatchObject({ view, title });
      }
      expect(filter(entries, "global_memory")[0]).toMatchObject({ view: "personal-memory", title: "my_memories" });
      expect(filter(entries, "Juno persona_lorebooks")[0]).toMatchObject({
        personaId: 2,
        personaPanel: "lorebook",
        path: "personas_title / Juno / persona_knowledge",
      });
      if (!canManage) {
        for (const view of Object.values(managerPages))
          expect(entries.some((entry) => entry.view === view)).toBe(false);
      }
      expect(filter(entries, "stats_title")[0]).toMatchObject({ view: "overview", title: "stats_title" });
      expect(filter(entries, "stats_custom")[0]).toMatchObject({
        view: "overview",
        statsRangeEditing: true,
        name: "from",
      });
      expect(filter(entries, "spotlight_auto")[0]).toMatchObject({
        view: "personal-spotlights",
        name: "autoTriggerPersonaId",
      });
      expect(filter(entries, "spotlight_hours")[0]).toMatchObject({
        view: "personal-spotlights",
        name: "durationHours",
      });
      expect(entries.some((entry) => entry.view === "channel-settings" && entry.channelSelection)).toBe(canManage);
      expect(entries.some((entry) => entry.view === "site-admin")).toBe(false);
      expect(entries.find((entry) => entry.title === "conversation options")?.profileTab).toBe("conversation");
      expect(entries.filter((entry) => entry.personaHome).map((entry) => entry.personaId)).toEqual([2, 3]);
      for (const personaId of [2, 3]) {
        expect(entries.some((entry) => entry.personaId === personaId && entry.personaPanel === "preferences")).toBe(
          true,
        );
        expect(entries.some((entry) => entry.personaId === personaId && entry.name === "modelId")).toBe(canManage);
        expect(entries.some((entry) => entry.personaId === personaId && entry.personaPanel === "conditioning")).toBe(
          canManage,
        );
      }
      if (canManage) {
        for (const [query, personaPanel, path] of [
          ["Display identity", "identity", "persona_character_tab / persona_identity_tab"],
          ["Sample dialogues", "behaviour", "persona_character_tab / persona_behaviour_tab"],
          ["persona_model_title", "behaviour", "persona_character_tab / persona_behaviour_tab"],
          ["sprites", "sprites", "persona_appearance_tab"],
          ["persona_conditioning_tab", "conditioning", "persona_character_tab"],
        ]) {
          expect(filter(entries, `Juno ${query}`)[0]).toMatchObject({
            personaId: 2,
            personaPanel,
            path: `personas_title / Juno / ${path}`,
          });
        }
      }
      expect(entries.some((entry) => entry.personaId === 1)).toBe(false);
    }
    overview.canManage = true;
    overview.guild.isDirectMessage = true;
    const dmEntries = build();
    for (const view of ["channel-settings", "moderation", "personal-spotlights"])
      expect(dmEntries.some((entry) => entry.view === view)).toBe(false);
    expect(dmEntries.some((entry) => entry.personaPanel === "channels" || entry.personaPanel === "conditioning")).toBe(
      false,
    );

    state.session.user.isGlobalAdmin = true;
    state.overview = null;
    const entriesWithoutServer = build();
    expect(entriesWithoutServer.every((entry) => entry.view === "site-admin")).toBe(true);
    expect(filter(entriesWithoutServer, "site_title")[0]).toMatchObject({ view: "site-admin", path: "site_admin" });
    expect(entriesWithoutServer.some((entry) => entry.siteTab === "links")).toBe(true);
    expect(filter(entriesWithoutServer, "show_on_login")[0]).toMatchObject({ siteTab: "links", name: "showOnLogin" });
    expect(filter(entriesWithoutServer, "show_in_sidebar")[0]).toMatchObject({
      siteTab: "links",
      name: "showInSidebar",
    });
  });

  it("waits for the external links tab before revealing a link setting or the add button", async () => {
    const source = await dashboardFunction("focusSearchDestination");
    const field = { matches: () => false };
    const addLink = { matches: () => false };
    const stage = { querySelector: () => addLink };
    let linksLoaded = false;
    let linkExists = true;
    const root = {
      querySelector: (selector: string) =>
        linksLoaded && selector === '#site-admin-stage[aria-labelledby="site-tab-links"]' ? stage : null,
    };
    const destination = { view: "site-admin", guildId: null, siteTab: "links", name: "showOnLogin" };
    const revealed: unknown[] = [];
    const context = {
      state: { view: "site-admin", guildId: null },
      pendingSearchDestination: destination as typeof destination | null,
      document: { querySelector: () => root },
      searchField: (scope: unknown, name: string) =>
        scope === stage && name === destination.name && linkExists ? field : null,
      revealSearchDestination: (target: unknown) => revealed.push(target),
    };
    const focus = runInNewContext(`${source}\nfocusSearchDestination`, context) as () => void;
    focus();
    expect(context.pendingSearchDestination).toEqual(destination);
    expect(revealed).toEqual([]);
    linksLoaded = true;
    focus();
    expect(context.pendingSearchDestination).toBeNull();
    expect(revealed).toEqual([field]);
    context.pendingSearchDestination = destination;
    linkExists = false;
    focus();
    expect(revealed).toEqual([field, addLink]);
  });

  it("opens the spotlight field in the selected channel after replacing the workspace", async () => {
    const source = await Promise.all(["handleDashboardAction", "renderPersonalSpotlights"].map(dashboardFunction));
    const channel = "123456789012345681";
    const host = {
      dataset: {} as { spotlightChannel?: string },
      isConnected: true,
      setAttribute: () => {},
      removeAttribute: () => {},
    };
    const workspace = {
      querySelector: (selector: string) => (selector === "[data-spotlight-content]" ? host : { disabled: false }),
    };
    const result = { dataset: { settingsSearchResult: "0" }, closest: () => ({ close: () => {} }) };
    const event = {
      target: { closest: (selector: string) => (selector === "[data-settings-search-result]" ? result : null) },
    };
    const { promise: renderedChannel, resolve } = Promise.withResolvers<string | undefined>();
    const search = runInNewContext(
      `${source.join("\n")}\nfunction renderShell() { renderPersonalSpotlights(workspace); }\nhandleDashboardAction`,
      {
        document: { querySelectorAll: () => [], querySelector: () => ({ dataset: { spotlightChannel: channel } }) },
        workspace,
        state: { view: "personal-spotlights", guildId: "123456789012345678" },
        setDashboardView: () => {},
        savingForms: 0,
        settingsSearchEntries: [{ view: "personal-spotlights", name: "durationHours" }],
        localEditForms: "[data-settings-key]",
        pendingSearchDestination: null,
        confirmDashboardSectionChange: async () => true,
        confirmDraftDiscard: async () => true,
        setTimeout: () => {},
        ui: String,
        escapeHtml: String,
        navigationIcon: String,
        loadingBar: String,
        api: async () => ({}),
        renderPersonalSpotlightWorkspace: (content: typeof host) => resolve(content.dataset.spotlightChannel),
      },
    ) as (event: object) => Promise<void>;
    await search(event);
    expect(await renderedChannel).toBe(channel);
  });

  it("carries all checked channels into a search destination on Channel settings", async () => {
    const source = await dashboardFunction("handleDashboardAction");
    const channels = ["123456789012345679", "123456789012345680"];
    const result = { dataset: { settingsSearchResult: "0" }, closest: () => ({ close: () => {} }) };
    const context = {
      state: { view: "channel-settings", guildId: "123456789012345678" },
      settingsSearchEntries: [{ view: "channel-settings", channelTab: "settings", channelSelection: true }],
      document: {
        querySelectorAll: (selector: string) =>
          selector.includes("selectedChannels") ? channels.map((value) => ({ value })) : [],
      },
      localEditForms: "[data-settings-key]",
      pendingSearchDestination: null,
      channelTab: "settings",
      savingForms: 0,
      confirmDashboardSectionChange: async () => true,
      setDashboardView: () => {},
      renderShell: () => {},
    };
    const search = runInNewContext(`${source}\nhandleDashboardAction`, context) as (event: object) => Promise<void>;
    await search({
      target: { closest: (selector: string) => (selector === "[data-settings-search-result]" ? result : null) },
    });
    expect(context.pendingSearchDestination).toMatchObject({ selectedChannels: channels });
  });

  it("keeps link drafts on canceled navigation even when the link editor is out of view", async () => {
    const source = await Promise.all(["confirmDashboardSectionChange", "confirmDraftDiscard"].map(dashboardFunction));
    const link = "site/9bcd3efa-4408-4389-819a-93091ae8f0ec";
    const settings = "123456789012345678/conversation";
    const drafts = new Map([
      [link, [{ name: "title", value: "Support" }]],
      [settings, []],
    ]);
    let accepted = false;
    const confirm = runInNewContext(`${source.join("\n")}\nconfirmDashboardSectionChange`, {
      state: { view: "site-admin" },
      document: { querySelector: () => ({ isConnected: true, querySelectorAll: () => [] }) },
      drafts,
      siteDraftPrefix: "site/",
      confirmAction: async () => accepted,
      ui: String,
    }) as () => Promise<boolean>;
    expect(await confirm()).toBe(false);
    expect(drafts.has(link)).toBe(true);
    accepted = true;
    expect(await confirm()).toBe(true);
    expect(drafts.has(link)).toBe(false);
    expect(drafts.has(settings)).toBe(true);
  });

  it("resolves page fragments through the same access rules as the dashboard sidebar", async () => {
    const source = await Promise.all(
      ["dashboardViewFromHash", "availableDashboardView", "dashboardNavigation"].map(dashboardFunction),
    );
    const overview = { guild: { isDirectMessage: false }, canManage: false };
    const { dashboardViewFromHash: fromHash, availableDashboardView: available } = runInNewContext(
      `${source.join("\n")}\n({ dashboardViewFromHash, availableDashboardView })`,
      { state: { overview }, ui: String },
    ) as {
      dashboardViewFromHash: (hash: string) => string;
      availableDashboardView: (view: string) => string;
    };
    expect(available(fromHash("#personas"))).toBe("personas");
    expect(available(fromHash("#moderation"))).toBe("overview");
    expect(available(fromHash("#site-admin"))).toBe("overview");
    overview.canManage = true;
    expect(available(fromHash("#channel-scoped-memory"))).toBe("settings");
    overview.guild.isDirectMessage = true;
    expect(available(fromHash("#channel-settings"))).toBe("overview");
  });

  it("reports the number of visible results when dashboard search exceeds its limit", async () => {
    await initializeLocalizer();
    const source = await Promise.all(["filterSettingsSearch", "updateSettingsSearch"].map(dashboardFunction));
    const entries = Array.from({ length: 61 }, (_, i) => ({
      title: `Setting ${i + 1}`,
      path: "Personas",
      hint: i < 60 ? "Channel" : "",
    }));
    const input = { value: "" };
    const list = { innerHTML: "" };
    const count = { textContent: "" };
    const elements: Record<string, object> = { input, "[data-search-results]": list, "[data-search-count]": count };
    const dialog = { querySelector: (selector: string) => elements[selector] };
    const copy = (key: string, variables?: Record<string, number>) =>
      localizedCopy("en-US", `general.dashboard.interface_${key}`, variables);
    const update = runInNewContext(`${source.join("\n")}\nupdateSettingsSearch`, {
      state: {},
      settingsSearchEntries: entries,
      ui: copy,
      escapeHtml: String,
    }) as (dialog: object) => void;
    for (const [query, shown, key, variables] of [
      ["Personas", 60, "settings_search_limited_count", { shown: 60, count: 61 }],
      ["Channel", 60, "settings_search_count", { count: 60 }],
      ["Missing title", 0, "settings_search_empty", undefined],
    ] as const) {
      input.value = query;
      update(dialog);
      expect(list.innerHTML.match(/data-settings-search-result=/g) ?? []).toHaveLength(shown);
      expect(count.textContent).toBe(copy(key, variables));
    }
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
