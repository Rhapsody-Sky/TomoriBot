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

describe("dashboard personal models", () => {
  it("shows the scoped primary model before fallbacks and identifies disabled personal routes", async () => {
    const source = await dashboardFunction("renderFallbacks");
    const render = runInNewContext(`(${source})`, {
      ui: (key: string) => key,
      escapeHtml: (value: string) => value,
      fieldLabel: (label: string) => `<span>${label}</span>`,
      state: { overview: { profile: { copy: {} } } },
    }) as (data: unknown, scope: string) => string;
    const option = { id: 7, provider: "custom:1", label: "Sample primary" };
    const personal = render({ models: { text: { selected: option, enabled: false, options: [option] } } }, "personal");
    expect(personal.indexOf(option.label)).toBeLessThan(personal.indexOf('name="fallback-0"'));
    expect(personal).toContain("personal_model_disabled");
    expect(personal.match(/<form\b/g)).toHaveLength(1);
    expect(personal.match(/type="submit"/g)).toHaveLength(1);
    expect(personal.indexOf('name="personal_server_fallback_enabled"')).toBeLessThan(personal.indexOf("</form>"));
    const server = render({ models: { selected: { text: 7 }, options: { text: [option] } } }, "server");
    expect(server).toContain(option.label);
    expect(server).not.toContain("personal_model_disabled");
    expect(server).not.toContain('name="personal_server_fallback_enabled"');
    expect(render({ models: { text: { selected: null, options: [] } } }, "personal")).toContain(
      "personal_model_unassigned",
    );
    expect(render({ models: { text: { selected: option, enabled: true, options: [] } } }, "personal")).toContain(
      "personal_model_unavailable",
    );
    const chain = render(
      {
        fallbackRefs: [
          { type: "llm", id: 1 },
          { type: "llm", id: 2 },
        ],
      },
      "server",
    );
    expect((chain.match(/data-fallback-slot hidden/g) || []).length).toBe(2);
    expect(chain).toContain('name="fallback-1"');
    expect(chain).toContain('value="llm:2" selected');
  });

  it("saves personal fallback settings together and retries only failed writes without losing either selection", async () => {
    const source = await dashboardFunction("saveFallbacks");
    for (const failedPart of [null, "chain", "server", "both"]) {
      const calls: { path: string; body: Record<string, unknown> }[] = [];
      let fail = failedPart !== null;
      let refreshed = 0;
      const state = {
        guildId: "42",
        overview: { profile: { personalServerFallback: true } },
        providerData: { personal: { fallbackRefs: [] as { type: string; id: number }[] } },
      };
      const serverFallback = { checked: false, dataset: { originalValue: "true" } };
      const fallbackFields = Object.fromEntries(
        [0, 1, 2, 3, 4].map((index) => [`fallback-${index}`, { value: index ? "" : "llm:5" }]),
      );
      const form = {
        classList: { contains: () => false },
        dataset: { providerScope: "personal", originalFallbacks: "[]" },
        elements: {
          ...fallbackFields,
          personal_server_fallback_enabled: serverFallback,
        },
      };
      const save = runInNewContext(`(${source})`, {
        state,
        api: async (path: string, options: { body: string }) => {
          const body = JSON.parse(options.body);
          calls.push({ path, body });
          const part = path === "/profile" ? "server" : "chain";
          if (fail && (failedPart === part || failedPart === "both")) throw new Error(`failed-${part}`);
          return { profile: { personalServerFallback: body.personal_server_fallback_enabled } };
        },
        withBusyForm: async (_form: unknown, action: () => Promise<void>) => action(),
        ui: (key: string) => key,
        toast: () => {},
        refreshProviders: async () => {
          refreshed++;
        },
      }) as (form: unknown) => Promise<void>;
      let failure: (Error & { partial?: boolean }) | undefined;
      try {
        await save(form);
      } catch (error) {
        failure = error as Error & { partial?: boolean };
      }
      expect(calls.map((call) => call.path)).toEqual(["/guilds/42/providers/personal/fallbacks", "/profile"]);
      expect(calls[0].body).toEqual({ refs: [{ type: "llm", id: 5 }] });
      expect(calls[1].body).toEqual({ personal_server_fallback_enabled: false });
      expect(fallbackFields["fallback-0"].value).toBe("llm:5");
      expect(serverFallback.checked).toBe(false);
      const chainFailed = failedPart === "chain" || failedPart === "both";
      const serverFailed = failedPart === "server" || failedPart === "both";
      expect(state.providerData.personal.fallbackRefs).toEqual(chainFailed ? [] : [{ type: "llm", id: 5 }]);
      expect(state.overview.profile.personalServerFallback).toBe(serverFailed);
      if (failedPart) {
        expect(failure?.partial).toBe(failedPart !== "both");
        expect(refreshed).toBe(0);
        if (chainFailed) expect(failure?.message).toContain("fallback_chain_save_failed");
        if (serverFailed) expect(failure?.message).toContain("fallback_server_save_failed");
        if (!chainFailed) expect(failure?.message).toContain("fallback_chain_saved");
        if (!serverFailed) expect(failure?.message).toContain("fallback_server_saved");
        fail = false;
        await save(form);
        expect(calls.slice(2).map((call) => call.path)).toEqual([
          ...(chainFailed ? ["/guilds/42/providers/personal/fallbacks"] : []),
          ...(serverFailed ? ["/profile"] : []),
        ]);
      } else {
        expect(failure).toBeUndefined();
      }
      expect(refreshed).toBe(1);
      const savedCalls = calls.length;
      await save(form);
      expect(calls).toHaveLength(savedCalls);
    }
  });

  it("keeps server fallback saves scoped to the server chain", async () => {
    const calls: string[] = [];
    const save = runInNewContext(`(${await dashboardFunction("saveFallbacks")})`, {
      state: { guildId: "42", providerData: { server: {} } },
      api: async (path: string) => calls.push(path),
      withBusyForm: async (_form: unknown, action: () => Promise<void>) => action(),
      ui: (key: string) => key,
      toast: () => {},
      refreshProviders: async (scope: string) => expect(scope).toBe("server"),
    }) as (form: unknown) => Promise<void>;
    await save({
      classList: { contains: () => false },
      dataset: { providerScope: "server", originalFallbacks: '[{"type":"llm","id":1}]' },
      elements: Object.fromEntries([0, 1, 2, 3, 4].map((index) => [`fallback-${index}`, { value: "" }])),
    });
    expect(calls).toEqual(["/guilds/42/providers/server/fallbacks"]);
  });

  it("renders disabled and unavailable selections without redundant status captions or a clearing option", async () => {
    const source = await dashboardFunction("renderPersonalModels");
    const render = runInNewContext(`(${source})`, {
      ui: (key: string) => key,
      escapeHtml: (value: string) => value.replaceAll('"', "&quot;"),
      fieldLabel: (label: string, hint: string) => `<span>${label}:${hint}</span>`,
    }) as (data: unknown) => string;
    const option = { id: 7, provider: "custom:1", label: "Model" };
    const html = render({
      models: {
        text: { selected: null, enabled: false, options: [option] },
        vision: { selected: { id: 7, provider: "custom:1" }, enabled: true, options: [option] },
        embedding: { selected: { id: 7, provider: "custom:1" }, enabled: false, options: [option] },
        image: { selected: { id: 8, provider: "other" }, enabled: false, options: [option] },
        image_nai: { selected: null, enabled: false, options: [] },
        video: { selected: null, enabled: false, options: [] },
        speech_design: { selected: null, enabled: false, options: [] },
        speech_clone: { selected: null, enabled: false, options: [] },
        transcription: {
          selected: { id: 13, provider: "openrouter" },
          enabled: true,
          options: [{ id: 13, provider: "openrouter", label: "Audio model" }],
        },
      },
    });
    expect(html).not.toContain("personal_model_unassigned");
    expect(html).not.toContain("personal_model_enabled");
    expect(html).toContain("personal_model_disabled");
    expect(html).toContain("personal_model_unavailable");
    expect(html).toContain("model_speech_design");
    expect(html).toContain("model_speech_clone");
    expect(html).toContain('name="transcription"');
    expect(html).toContain('value="" disabled selected');
    expect(html).toContain('value="{&quot;provider&quot;:&quot;custom:1&quot;,&quot;modelId&quot;:7}" selected');
  });

  it("saves nullable overrides for the selected provider and refreshes", async () => {
    const source = await dashboardFunction("savePersonalParameters");
    let body = "";
    let refreshed = "";
    const fields = [
      "temperature",
      "top_p",
      "top_k",
      "frequency_penalty",
      "presence_penalty",
      "min_p",
      "max_output_tokens",
    ];
    const save = runInNewContext(`(${source})`, {
      personalParameterFields: fields.map((key) => [key]),
      state: { guildId: "42" },
      api: async (_path: string, options: { body: string }) => {
        body = options.body;
      },
      withBusyForm: async (_form: unknown, action: () => Promise<void>) => action(),
      toast: () => {},
      ui: (key: string) => key,
      refreshProviders: async (scope: string) => {
        refreshed = scope;
      },
    }) as (form: unknown) => Promise<void>;
    const elements = Object.fromEntries(fields.map((key) => [key, { value: key === "temperature" ? "0.5" : "" }]));
    elements.thinking_level = { value: "" };
    await save({ dataset: { personalParameters: "openrouter", providerScope: "personal" }, elements });
    const result = JSON.parse(body);
    expect(result.provider).toBe("openrouter");
    expect(result.patch.temperature).toBe(0.5);
    expect(result.patch.top_p).toBeNull();
    expect(result.patch).not.toHaveProperty("thinking_level");
    expect(refreshed).toBe("personal");
    elements.thinking_level.value = "high";
    await save({ dataset: { personalParameters: "openrouter", providerScope: "server" }, elements });
    expect(JSON.parse(body).patch.thinking_level).toBe("high");
    expect(refreshed).toBe("server");
  });

  it("retries only unsaved model changes after a partial failure", async () => {
    const fields = ["text", "vision"].map((name, index) => ({
      name,
      value: JSON.stringify({ provider: "openrouter", modelId: index + 1 }),
      dataset: { originalModel: "" },
    }));
    const calls: string[] = [];
    let fail = true;
    let refreshed = 0;
    const save = runInNewContext(`(${await dashboardFunction("savePersonalModel")})`, {
      state: { guildId: "42" },
      api: async (_path: string, options: { body: string }) => {
        const capability = JSON.parse(options.body).capability;
        calls.push(capability);
        if (capability === "vision" && fail) throw new Error("Request failed");
      },
      withBusyForm: async (_form: unknown, action: () => Promise<void>) => action(),
      toast: () => {},
      ui: (key: string) => key,
      refreshProviders: async () => {
        refreshed++;
      },
    }) as (form: unknown) => Promise<void>;
    const form = { querySelectorAll: () => fields };
    await expect(save(form)).rejects.toThrow();
    expect(refreshed).toBe(0);
    fail = false;
    await save(form);
    expect(calls).toEqual(["text", "vision", "vision"]);
    expect(refreshed).toBe(1);
    await save(form);
    expect(calls).toHaveLength(3);
  });

  it("saves the chosen personal model and refreshes the personal workspace", async () => {
    const source = await dashboardFunction("savePersonalModel");
    let request: { path: string; method: string; body: string } | undefined;
    let refreshed = "";
    const save = runInNewContext(`(${source})`, {
      state: { guildId: "42" },
      api: async (path: string, options: { method: string; body: string }) => {
        request = { path, ...options };
      },
      withBusyForm: async (_form: unknown, action: () => Promise<void>) => action(),
      toast: () => {},
      ui: (key: string) => key,
      refreshProviders: async (scope: string) => {
        refreshed = scope;
      },
    }) as (form: unknown) => Promise<void>;
    await save({
      querySelectorAll: () => [
        {
          name: "image_nai",
          value: JSON.stringify({ provider: "novelai", modelId: 7 }),
          dataset: { originalModel: "" },
        },
        { name: "text", value: "unchanged", dataset: { originalModel: "unchanged" } },
        { name: "vision", value: "", dataset: { originalModel: "" } },
      ],
    });
    expect(request?.path).toBe("/guilds/42/providers/personal/model");
    expect(request?.method).toBe("PATCH");
    expect(JSON.parse(request?.body ?? "null")).toEqual({ capability: "image_nai", provider: "novelai", modelId: 7 });
    expect(refreshed).toBe("personal");
  });
});
