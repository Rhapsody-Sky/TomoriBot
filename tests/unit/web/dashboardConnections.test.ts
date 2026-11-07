import { describe, expect, it, mock } from "bun:test";
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
  it("indexes every persona and keeps management settings restricted to admins", async () => {
    const source = await dashboardFunction("buildSettingsSearchIndex");
    const overview = {
      canManage: true,
      personas: [
        { personaId: 1, lineageId: 0, nickname: "Shared" },
        { personaId: 2, lineageId: 4, nickname: "Juno" },
        { personaId: 3, lineageId: 5, nickname: "Mirri" },
      ],
      personaNaming: { copy: { tab: "preferences" } },
    };
    const build = runInNewContext(`${source}; buildSettingsSearchIndex`, {
      state: { overview, providerData: {} },
      ui: String,
      document: {
        createElement: () => ({
          innerHTML: "",
          content: { querySelectorAll: () => [] },
        }),
      },
      renderProfilePanel: () => "",
      renderPersonaNaming: () => "",
      renderPersonaSettings: () => "",
      renderPersonaAppearance: () => "",
    }) as () => { personaId?: number; personaHome?: boolean; personaPanel?: string; name?: string }[];
    for (const canManage of [true, false]) {
      overview.canManage = canManage;
      const entries = build();
      expect(entries.filter((entry) => entry.personaHome).map((entry) => entry.personaId)).toEqual([2, 3]);
      for (const personaId of [2, 3]) {
        expect(entries.some((entry) => entry.personaId === personaId && entry.personaPanel === "preferences")).toBe(
          true,
        );
        expect(entries.some((entry) => entry.personaId === personaId && entry.name === "modelId")).toBe(canManage);
      }
      expect(entries.some((entry) => entry.personaId === 1)).toBe(false);
    }
  });

  it("filters channel choices while preserving stored selections outside the allowlist", async () => {
    const source = await dashboardFunction("renderChannelSelector");
    const overview = {
      allowedChannelIds: ["1"],
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
    expect(render("channelDiscIds", [])).toContain('data-channel-search="private');
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
  });

  it("keeps the measured Sprites panel when opening and closing an editor", async () => {
    const source = await dashboardFunction("loadSprites");
    const panel = { className: "", innerHTML: "" };
    let mounted: typeof panel | null = null;
    const replaceChildren = mock((child: typeof panel) => {
      mounted = child;
    });
    const drafts = new Map<string, object>();
    const load = runInNewContext(`let spriteLoadVersion = 0; ${source}; loadSprites`, {
      state: { guildId: "1", personaId: 2, view: "personas", personaPanel: "sprites" },
      api: async () => ({ sprites: [], limits: { count: 5, name: 32, instructions: 200 } }),
      document: {
        querySelector: () => ({ querySelector: () => mounted, replaceChildren }),
        createElement: () => panel,
      },
      personaEntryDrafts: drafts,
      personaEntryKey: (_personaId: number, _kind: string, key: string) => key,
      escapeHtml: String,
      ui: String,
      navigationIcon: () => "",
      fieldLabel: String,
      enhanceDashboard: () => {},
    }) as (id: number) => Promise<void>;
    await load(2);
    expect(panel.innerHTML).not.toContain("data-sprite-form");
    drafts.set("new", { name: "Juno", instructions: "", identity: false });
    await load(2);
    expect(panel.innerHTML).toContain("data-sprite-form");
    drafts.clear();
    await load(2);
    expect(panel.innerHTML).not.toContain("data-sprite-form");
    expect(replaceChildren).toHaveBeenCalledTimes(1);
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
