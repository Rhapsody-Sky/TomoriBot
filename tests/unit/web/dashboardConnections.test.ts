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
    const state = { guildId: "1", view: "personal-providers", providerData: { personal: null as unknown, server: null } };
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
