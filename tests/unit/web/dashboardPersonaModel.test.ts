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

describe("dashboard persona text model", () => {
  it("does not label the test chat with the server primary model", async () => {
    const source = await dashboardFunction("renderPersonaTestChat");
    const render = runInNewContext(`(${source})`, {
      state: {
        personaTestChats: {},
        personaTestChatBusy: false,
        overview: { modelSummary: { text: { name: "server-primary" } } },
      },
      ui: (key: string) => key,
      escapeHtml: (value: string) => value,
      personaAvatar: () => "",
    }) as (persona: unknown) => string;
    const html = render({ personaId: 2, nickname: "Juno" });
    expect(html).toContain("persona_test_configured_model");
    expect(html).not.toContain("server-primary");
  });

  it("renders inherited and unavailable assignments and ignores a stale persona response", async () => {
    const source = await dashboardFunction("loadPersonaTextModel");
    const state = { guildId: "42", personaId: 1, personaPanel: "settings", view: "personas" };
    let target = { innerHTML: "" };
    const pending: ((value: unknown) => void)[] = [];
    const load = runInNewContext(`let personaModelLoadVersion = 0; ${source}; loadPersonaTextModel`, {
      state,
      document: { querySelector: () => target },
      api: () => new Promise((resolve) => pending.push(resolve)),
      ui: (key: string) => key,
      escapeHtml: (value: string) => value,
    }) as (personaId: number) => Promise<void>;
    const old = load(1);
    state.personaId = 2;
    target = { innerHTML: "" };
    const current = load(2);
    pending[1]({ selected: null, options: [{ id: 3, label: "Model" }] });
    await current;
    expect(target.innerHTML).toContain('value="" selected');
    pending[0]({ selected: 9, options: [] });
    await old;
    expect(target.innerHTML).not.toContain("persona_model_unavailable");
    const missing = load(2);
    pending[2]({ selected: 9, options: [] });
    await missing;
    expect(target.innerHTML).toContain('value="9" selected disabled');
  });

  it("saves and clears the persona assignment and reloads its selector", async () => {
    const source = await dashboardFunction("savePersonaTextModel");
    const requests: { path: string; method: string; body: string }[] = [];
    let reload = 0;
    const save = runInNewContext(`(${source})`, {
      state: { guildId: "42", personaId: 2, personaPanel: "settings" },
      api: async (path: string, options: { method: string; body: string }) => {
        requests.push({ path, ...options });
      },
      withBusyForm: async (_form: unknown, action: () => Promise<void>) => action(),
      toast: () => {},
      ui: (key: string) => key,
      loadPersonaTextModel: async () => {
        reload += 1;
      },
    }) as (form: unknown) => Promise<void>;
    const form = { dataset: { personaTextModel: "2" }, elements: { modelId: { value: "3" } } };
    await save(form);
    form.elements.modelId.value = "";
    await save(form);
    expect(requests[0].path).toBe("/guilds/42/personas/2/text-model");
    expect(requests[0].method).toBe("PUT");
    expect(JSON.parse(requests[0].body)).toEqual({ modelId: 3 });
    expect(JSON.parse(requests[1].body)).toEqual({ modelId: null });
    expect(reload).toBe(2);
  });
});
