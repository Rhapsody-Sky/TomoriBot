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

describe("dashboard memory requests", () => {
  it("ignores stale responses and failures across scopes and repeated refreshes", async () => {
    const loadSource = await dashboardFunction("loadMemories");

    const state = { guildId: "1", memoryKind: "personal", lineageId: 1, memoryData: null as unknown };
    let list = { innerHTML: "" };
    const pending: { resolve: (value: unknown) => void; reject: (reason: Error) => void }[] = [];
    const api = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    let renders = 0;
    const load = runInNewContext(`let memoryRequestId = 0; ${loadSource}; loadMemories`, {
      state,
      document: { querySelector: () => list },
      api,
      renderMemoryList: () => {
        renders += 1;
      },
      escapeHtml: (value: string) => value,
    }) as () => Promise<void>;

    const oldScope = load();
    state.guildId = "2";
    state.memoryKind = "server";
    state.lineageId = 2;
    list = { innerHTML: "" };
    const firstRefresh = load();
    const latestRefresh = load();
    const latest = { memories: [{ id: 3 }] };
    pending[2].resolve(latest);
    await latestRefresh;
    pending[1].reject(new Error("stale error"));
    pending[0].resolve({ memories: [{ id: 1 }] });
    await Promise.all([oldScope, firstRefresh]);
    expect(state.memoryData).toBe(latest);
    expect(renders).toBe(1);
    expect(list.innerHTML).not.toContain("stale error");
  });

  it("reports partial import failures and sends malformed entries for classification", async () => {
    const importSource = await dashboardFunction("importMemories");
    let body = "";
    let level = "";
    let refreshed = false;
    const importMemories = runInNewContext(`(${importSource})`, {
      state: { guildId: "1", memoryKind: "personal", lineageId: 1 },
      api: async (_path: string, options: { body: string }) => {
        body = options.body;
        return { inserted: 1, skipped: 0, invalid: 1, failed: 1 };
      },
      toast: (_message: string, type: string) => {
        level = type;
      },
      loadMemories: async () => {
        refreshed = true;
      },
    }) as (file: { text: () => Promise<string> }) => Promise<void>;
    await importMemories({ text: async () => JSON.stringify(["valid", null]) });
    expect(JSON.parse(body).memories).toEqual([{ content: "valid", tags: [] }, null]);
    expect(level).toBe("error");
    expect(refreshed).toBe(true);
  });
});
