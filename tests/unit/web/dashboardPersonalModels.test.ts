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
  it("renders unassigned, enabled, disabled and unavailable selections without a clearing option", async () => {
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
      },
    });
    expect(html).toContain("personal_model_unassigned");
    expect(html).toContain("personal_model_enabled");
    expect(html).toContain("personal_model_disabled");
    expect(html).toContain("personal_model_unavailable");
    expect(html).toContain("model_speech_design");
    expect(html).toContain("model_speech_clone");
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
      dataset: { personalModel: "image_nai" },
      elements: { model: { value: JSON.stringify({ provider: "novelai", modelId: 7 }) } },
    });
    expect(request?.path).toBe("/guilds/42/providers/personal/model");
    expect(request?.method).toBe("PATCH");
    expect(JSON.parse(request?.body ?? "null")).toEqual({ capability: "image_nai", provider: "novelai", modelId: 7 });
    expect(refreshed).toBe("personal");
  });
});
