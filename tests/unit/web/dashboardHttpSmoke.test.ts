import { describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import { createDashboardApp } from "@/web/dashboard/server";

const fakeClient = {
  application: { id: "123456789012345678" },
  user: { id: "123456789012345678" },
  guilds: { cache: new Map() },
} as unknown as Client;

describe("dashboard HTTP shell", () => {
  const { app } = createDashboardApp(fakeClient);

  it("serves the branded HTML shell with security headers", async () => {
    const response = await app.request("http://localhost/settings");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(html).toContain("TomoriBot Control Room");
    expect(html).toContain("/settings/assets/tomori_companion_logo.svg");
    expect(html).toContain("/settings/assets/companion.css");
    expect(html).toContain("/settings/assets/app.js");
  });

  it("serves every dashboard asset from the source tree", async () => {
    for (const [asset, contentType] of [
      ["app.css", "text/css"],
      ["companion.css", "text/css"],
      ["app.js", "application/javascript"],
      ["tomoribot_logo.png", "image/png"],
      ["tomori_companion_logo.svg", "image/svg+xml"],
      ["tomori_texture5.png", "image/png"],
      ["noto-sans-jp.ttf", "font/ttf"],
    ]) {
      const response = await app.request(`http://localhost/settings/assets/${asset}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(contentType);
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(100);
    }
  });

  it("ships the persona workspace and checkbox-based multi selections", async () => {
    const response = await app.request("/settings/assets/app.js");
    const source = await response.text();
    const css = await (await app.request("/settings/assets/app.css")).text();
    const companionCss = await (await app.request("/settings/assets/companion.css")).text();

    expect(source).toContain('data-persona-panel="personal"');
    expect(source).toContain('data-persona-panel="server"');
    expect(source).toContain('data-persona-panel="appearance"');
    expect(source).toContain("Appearance &amp; image prompt");
    expect(source).toContain("Visual character prompt");
    expect(source).toContain("This is not the persona's main conversation prompt");
    expect(source).toContain("data-auto-grow");
    expect(source).toContain("resizeAutoGrowTextarea");
    expect(source).not.toContain("Core identity, behavior, speaking style, and boundaries");
    expect(source).toContain("data-persona-create-open");
    expect(source).toContain("data-persona-import-open");
    expect(source).toContain("data-persona-attributes");
    expect(source).toContain('id="persona-test-chat-form"');
    expect(source).toContain("event.ctrlKey");
    expect(source).toContain("input.form?.requestSubmit()");
    expect(css).toContain(".test-chat-compose .button");
    expect(css).toContain("justify-self: end");
    expect(css).toContain(".persona-test-panel {\n  position: sticky;\n  top: 0;");
    expect(css).toContain("height: calc(100dvh - 94px)");
    expect(css).toContain(".test-chat-messages");
    expect(css).toContain(".test-chat-assistant");
    expect(css).toContain("background: var(--primary-soft)");
    expect(css).toContain(".test-chat-compose textarea");
    expect(css).toContain("field-sizing: content");
    expect(css).toContain(".persona-appearance-grid");
    expect(css).toContain(".avatar-editor-showcase .persona-appearance-avatar");
    expect(css).toContain("height: clamp(180px, 20vw, 260px)");
    expect(css).toContain(".memory-item:hover");
    expect(css).toContain("background: var(--surface-raised)");
    expect(css).toContain("background: var(--surface-solid)");
    expect(companionCss).toContain(".switch-row input:checked + i::after");
    expect(companionCss).toContain("transform: translateX(21px)");
    expect(companionCss).toContain(".nav-stack {\n  gap: 3px;\n  overflow-x: hidden;\n  overflow-y: auto;");
    expect(source).toContain("data-avatar-fallback");
    expect(source).toContain("'s memories about you");
    expect(source).toContain("Private facts about you that are only available to this persona when you are around.");
    expect(source).toContain("data-palette-choice");
    expect(source).toContain("data-theme-toggle");
    expect(source).toContain("function renderBootScreen()");
    expect(source).not.toContain("/settings/assets/tomoribot_logo.png");
    expect(source).toContain("const loginMessages = [");
    expect(source).toContain("Math.floor(Math.random() * loginMessages.length)");
    expect(source).toContain("motherfucker");
    expect(source).not.toContain("Your Tomori, in one quiet place.");
    expect(source).toContain("syncAppearanceControls()");
    expect(source).toContain("updateServerStatsSection()");
    expect(source).toContain(`aria-busy="\${state.serverStatsLoading}"`);
    expect(source).toContain("fieldLabel(field.label, field.hint)");
    expect(source).toContain("field-hint");
    expect(source).toContain('class="check-option"');
    expect(source).toContain('label: "Models & sampling"');
    expect(source).toContain('title: "Context"');
    expect(source).toContain('title: "Triggers & cooldowns"');
    expect(source).toContain('title: "Output"');
    expect(source).toContain('fields: ["match_limit", "cascade_limit"]');
    expect(source).toContain("data-settings-sections");
    expect(source).not.toContain("settings-category-heading");
    expect(source).toContain('id="server-models-form"');
    expect(source).toContain("already_available");
    expect(source).toContain("Built-in OpenRouter models come from Tomori's catalog");
    expect(source).not.toContain("selectedOptions");
    expect(source).not.toContain(" multiple ");
    expect(source).toContain("data-server-picker-open");
    expect(source).toContain('id="server-picker-dialog"');
    expect(source).toContain("data-guild-select");
    expect(source).not.toContain('id="guild-switcher"');
    expect(source).toContain("data-stats-timeframe");
    expect(source).toContain("/stats?timeframe=");
    expect(source).toContain("<h2>Personas</h2>");
    expect(css).toContain(".server-picker-grid");
    expect(css).toContain("@keyframes server-choice-enter");
    expect(css).toContain(".stats-summary-grid");
  });

  it("rejects unauthenticated API access", async () => {
    const response = await app.request("http://localhost/settings/api/session");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "auth_required",
        message: "Sign in required.",
      },
    });
  });

  it("protects the server statistics endpoint", async () => {
    const response = await app.request("http://localhost/settings/api/guilds/123456789012345678/stats?timeframe=week");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "auth_required",
        message: "Sign in required.",
      },
    });
  });
});
