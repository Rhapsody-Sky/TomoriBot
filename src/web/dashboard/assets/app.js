(() => {
  const BASE = "/settings/api";
  const app = document.querySelector("#app");
  const toastRegion = document.querySelector("#toast-region");
  const palettes = [
    { id: "lilya", label: "Lilya", color: "oklch(.72 .12 195)" },
    { id: "aphel", label: "Aphel", color: "oklch(.72 .13 350)" },
    { id: "nerine", label: "Nerine", color: "oklch(.72 .12 145)" },
    { id: "tomori", label: "Tomori", color: "oklch(.72 .16 28)" },
    { id: "zaya", label: "Zaya", color: "oklch(.72 .15 300)" },
    { id: "locke", label: "Locke", color: "oklch(.43 .16 20)" },
    { id: "temari", label: "Temari", color: "oklch(.55 .17 250)" },
  ];
  const loginMessages = [
    "Not today satan",
    "Vibing",
    "What do you want",
    "Beep boop motherfucker",
    "Touch grass",
    "Skill issue",
    "Who summoned me",
    "I'm literally right here",
    "Bro...",
    "Send help (and snacks)",
    "Tomori.exe has stopped responding",
    "Out of office: permanently",
    "Loading... just kidding i'm already here",
    "This is fine",
    "Error 404: filter not found",
    "I'm baby",
    "BRB fighting a god",
    "Cosplaying as a functional adult",
    "I don't have adhd i have... oh look a bird",
    "Currently accepting headpats",
    "Do not cite the deep magic to me",
    "I heard someone was talking about me",
    "No thoughts just vibes",
    "Grr i'm scary",
    "I'm not arguing i'm just explaining why i'm right",
    "Yapping mode: activated",
    "I need an adult",
    "I am an adult... wait",
    "Dramatic chipmunk energy",
    "I'm in your walls",
  ];
  const loginMessage = loginMessages[Math.floor(Math.random() * loginMessages.length)];

  const readAppearance = (key, fallback) => {
    try {
      return localStorage.getItem(`tomoribot.dashboard.${key}`) || fallback;
    } catch {
      return fallback;
    }
  };

  const appearance = {
    palette: readAppearance("palette", "tomori"),
    theme: readAppearance("theme", "dark"),
    surface: readAppearance("surface", "glass"),
    colorMode: readAppearance("colorMode", "colorful"),
    motion: readAppearance("motion", "full"),
    lighting: { dark: { angle: 350, spread: 150, intensity: 50 }, light: { angle: 45, spread: 300, intensity: 50 } },
  };
  try {
    const stored = JSON.parse(readAppearance("lighting", "null"));
    for (const theme of ["dark", "light"]) {
      for (const [key, min, max] of [
        ["angle", 0, 359],
        ["spread", 50, 500],
        ["intensity", 0, 200],
      ]) {
        const value = stored?.[theme]?.[key];
        if (Number.isFinite(value) && value >= min && value <= max) appearance.lighting[theme][key] = value;
      }
    }
  } catch {}

  const applyAppearance = () => {
    document.body.dataset.palette = palettes.some((palette) => palette.id === appearance.palette)
      ? appearance.palette
      : "tomori";
    document.body.dataset.theme = appearance.theme === "light" ? "light" : "dark";
    document.body.dataset.surface = appearance.surface === "solid" ? "solid" : "glass";
    document.body.dataset.colorMode = appearance.colorMode === "reduced" ? "reduced" : "colorful";
    document.body.dataset.motion = ["full", "subtle", "off"].includes(appearance.motion) ? appearance.motion : "full";
    const light = appearance.lighting[document.body.dataset.theme];
    document.body.style.setProperty("--glass-angle", `${(light.angle + 180) % 360}deg`);
    document.body.style.setProperty("--light-spread", light.spread / 100);
    document.body.style.setProperty("--light-intensity", light.intensity / 100);
  };

  const saveAppearance = () => {
    applyAppearance();
    try {
      localStorage.setItem("tomoribot.dashboard.palette", appearance.palette);
      localStorage.setItem("tomoribot.dashboard.theme", appearance.theme);
      for (const key of ["surface", "colorMode", "motion"])
        localStorage.setItem(`tomoribot.dashboard.${key}`, appearance[key]);
      localStorage.setItem("tomoribot.dashboard.lighting", JSON.stringify(appearance.lighting));
      const status = document.querySelector("#design-status");
      if (status) status.textContent = ui("appearance_saved");
    } catch {
      toast(ui("appearance_session_only"), "warning");
    }
  };

  const syncAppearanceControls = () => {
    document.querySelectorAll("[data-palette-choice]").forEach((button) => {
      const isActive = button.dataset.paletteChoice === appearance.palette;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    const themeIcon = document.querySelector("[data-theme-toggle] span");
    if (themeIcon) themeIcon.textContent = appearance.theme === "dark" ? "\u2600" : "\u263e";
    const themeButton = document.querySelector("#design-theme");
    if (themeButton) {
      themeButton.textContent = ui(appearance.theme === "dark" ? "design_light" : "design_dark");
      themeButton.setAttribute("aria-pressed", String(appearance.theme === "light"));
    }
    const surfaceButton = document.querySelector("[data-surface-toggle]");
    if (surfaceButton) surfaceButton.setAttribute("aria-pressed", String(appearance.surface === "glass"));
    for (const key of ["colorMode", "motion"]) {
      const input = document.querySelector(`[data-design-setting="${key}"]`);
      if (input) input.value = appearance[key];
    }
    for (const key of ["angle", "spread", "intensity"]) {
      const input = document.querySelector(`[data-light-setting="${key}"]`);
      if (input) input.value = appearance.lighting[document.body.dataset.theme][key];
    }
  };

  applyAppearance();

  const ui = (key) => state.overview.interfaceCopy[key];

  const settingsGroups = [
    {
      id: "conversation",
      label: "Conversation",
      panels: [
        {
          eyebrow: "Conversation",
          title: "Context",
          description: "Server instructions, persistent notes, recent messages, and local time available to Tomori.",
          wide: true,
          sources: [
            {
              section: "chat",
              fields: ["system_prompt", "context_note", "context_note_depth", "message_fetch_limit", "timezone_offset"],
            },
            { section: "capabilities", fields: ["time_awareness_enabled"] },
          ],
        },
        {
          eyebrow: "Conversation",
          title: "Triggers & cooldowns",
          description: "When Tomori responds, how personas match, and how frequently another response is allowed.",
          sources: [
            {
              section: "triggers",
            },
            {
              section: "chat",
              fields: ["match_limit", "cascade_limit"],
            },
          ],
        },
        {
          eyebrow: "Conversation",
          title: "Output",
          descriptionKey: "output_hint",
          sources: [
            {
              section: "chat",
              fields: [
                "humanizer_degree",
                "send_message_limit",
                "response_prefill",
                "response_reviewer_prompt",
                "response_review_items",
              ],
            },
            {
              section: "capabilities",
              fields: ["response_drafting_enabled", "emoji_usage_enabled", "sticker_usage_enabled"],
            },
          ],
        },
        { section: "nsfw" },
      ],
    },
    {
      id: "models",
      label: "Models & sampling",
      panels: [
        {
          descriptionKey: "models_hint",
          sources: [
            { section: "modelBehavior", fields: ["llm_temperature", "thinking_level"] },
            { section: "chat", fields: ["model_randomizer_enabled"] },
          ],
        },
        { section: "sampling" },
      ],
    },
    {
      id: "channels",
      labelKey: "channels",
      panels: [
        { section: "channelScope", fields: ["rp_channel_ids"], titleKey: "channels", descriptionKey: "channels_hint" },
        { section: "autochat" },
        { section: "welcome" },
      ],
    },
    {
      id: "memory",
      labelKey: "memory",
      panels: [
        {
          titleKey: "learning",
          descriptionKey: "learning_hint",
          sources: [
            {
              section: "memberPermissions",
              fields: [
                "personal_memories_enabled",
                "server_memteaching_enabled",
                "attribute_memteaching_enabled",
                "sampledialogue_memteaching_enabled",
                "self_teaching_enabled",
              ],
            },
            { section: "memory", fields: ["memory_tagging_enabled"] },
            { section: "capabilities", fields: ["user_info_updates_enabled"] },
          ],
        },
        {
          titleKey: "boundaries",
          descriptionKey: "boundaries_hint",
          sources: [
            { section: "memory", fields: ["channel_memory_enabled"] },
            {
              section: "channelScope",
              fields: ["private_channel_ids", "crosschannel_blocklist_ids", "stm_privacy_bypass"],
            },
          ],
        },
        {
          section: "stm",
          sources: [{ section: "capabilities", fields: ["short_term_memory_enabled"] }, { section: "stm" }],
        },
      ],
    },
    {
      id: "media",
      labelKey: "tools",
      panels: [
        {
          section: "capabilities",
          titleKey: "tools",
          descriptionKey: "tools_hint",
          fields: [
            "tool_use_enabled",
            "web_search_enabled",
            "manage_message_enabled",
            "thread_creation_enabled",
            "imagegen_enabled",
            "videogen_enabled",
            "user_blocking_enabled",
            "conditioning_interactions_enabled",
            "dice_rolling_enabled",
            "danbooru_enabled",
          ],
        },
        {
          section: "speech",
          sources: [{ section: "capabilities", fields: ["voice_message_enabled"] }, { section: "speech" }],
        },
        { section: "novelai" },
      ],
    },
    {
      id: "diagnostics",
      labelKey: "diagnostics",
      panels: [
        { section: "notices" },
        {
          titleKey: "diagnostics",
          descriptionKey: "diagnostics_hint",
          sources: [
            { section: "modelBehavior", fields: ["hide_respond_embed"] },
            { section: "memberPermissions", fields: ["hide_impersonation_embeds", "prompt_snapshot_enabled"] },
            { section: "chat", fields: ["self_debug_enabled"] },
            { section: "channelScope", fields: ["thought_log_channel_disc_id"] },
          ],
        },
      ],
    },
  ];

  const state = {
    session: null,
    csrfToken: "",
    guildId: "",
    overview: null,
    view: "overview",
    memoryKind: "personal",
    lineageId: 0,
    memoryData: null,
    personaId: 0,
    personaPanel: "personal",
    lorebookBookId: null,
    lorebookData: null,
    lorebookImportReceipt: null,
    personaTestChats: {},
    personaTestChatBusy: false,
    avatarRevision: 0,
    providerData: { personal: null, server: null },
    providerConnection: { personal: null, server: null },
    providerPanel: { personal: "connections", server: "connections" },
    serverStats: null,
    serverStatsLoading: false,
    serverStatsError: "",
    statsTimeframe: "all_time",
    statsRange: null,
    statsRangeEditing: false,
    statsHistoryModel: null,
    settingsGroup: "conversation",
    loading: false,
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const fieldLabel = (label, hint = "") => `
    <span class="field-label">
      <strong>${escapeHtml(label)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </span>`;

  const formatDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ""
      : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  };

  const formatStatNumber = (value) =>
    new Intl.NumberFormat(undefined, {
      notation: Math.abs(Number(value) || 0) >= 10000 ? "compact" : "standard",
      maximumFractionDigits: 1,
    }).format(Number(value) || 0);

  const formatUsd = (value) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: Number(value) > 0 && Number(value) < 0.01 ? 4 : 2,
      maximumFractionDigits: 4,
    }).format(Number(value) || 0);

  const parseTags = (value) =>
    [
      ...new Set(
        String(value || "")
          .split(/[,\n]/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ].slice(0, 80);

  const personaAvatar = (persona, extraClass = "") => {
    const initial =
      String(persona?.nickname || "?")
        .trim()
        .slice(0, 1) || "?";
    const classes = `persona-avatar${extraClass ? ` ${extraClass}` : ""}`;
    const avatarUrl = persona?.avatarUrl
      ? `${persona.avatarUrl}${persona.avatarUrl.includes("?") ? "&" : "?"}v=${state.avatarRevision}`
      : "";
    return avatarUrl
      ? `<img src="${escapeHtml(avatarUrl)}" alt="" class="${classes}" data-avatar-fallback="${escapeHtml(initial)}">`
      : `<span class="${classes} persona-avatar-fallback">${escapeHtml(initial)}</span>`;
  };

  const toast = (message, kind = "success") => {
    const element = document.createElement("div");
    element.className = `toast ${kind === "error" ? "danger" : kind}`;
    element.setAttribute("role", kind === "error" ? "alert" : "status");
    element.textContent = message;
    if (kind === "error") {
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.textContent = "\u00d7";
      dismiss.setAttribute("aria-label", state.overview ? ui("dismiss") : "Dismiss message");
      dismiss.addEventListener("click", () => element.remove());
      element.append(dismiss);
    }
    toastRegion.append(element);
    toastRegion.scrollTop = toastRegion.scrollHeight;
    requestAnimationFrame(() => element.classList.add("toast-visible"));
    if (kind !== "error")
      setTimeout(() => {
        element.classList.remove("toast-visible");
        setTimeout(() => element.remove(), 180);
      }, 3500);
  };

  const draftForms =
    "[data-profile-section], [data-settings-sections], [data-persona-naming], [data-lorebook-form], #stm-categories-form";
  const drafts = new Map();
  const formBaselines = new WeakMap();
  let savingForms = 0;

  function formSnapshot(form) {
    return Array.from(form.querySelectorAll("input[name], select[name], textarea[name]"), (input) => ({
      name: input.name,
      value: input.value,
      checked: input.type === "checkbox" ? input.checked : undefined,
    }));
  }

  function restoreSnapshot(form, values) {
    form.querySelectorAll("input[name], select[name], textarea[name]").forEach((input) => {
      const value = values.find(
        (entry) => entry.name === input.name && (entry.checked === undefined || entry.value === input.value),
      );
      if (!value) return;
      if (value.checked !== undefined) input.checked = value.checked;
      else input.value = value.value;
    });
    form.querySelectorAll("[data-naming-mode]").forEach((mode) => {
      form.elements[mode.dataset.namingMode].disabled = mode.value !== "custom";
    });
    resizeAutoGrowTextareas(form);
  }

  function initDraftForms(root) {
    root.querySelectorAll(draftForms).forEach((form) => {
      if (formBaselines.has(form)) return;
      const key = form.dataset.profileSection
        ? `profile/${form.dataset.profileSection}`
        : `${state.guildId}/${form.dataset.settingsKey || (form.dataset.personaNaming ? `naming/${form.dataset.personaNaming}` : "stm-categories")}`;
      form.dataset.draftKey = key;
      formBaselines.set(form, formSnapshot(form));
      const status = document.createElement("div");
      status.className = "draft-status";
      status.hidden = true;
      status.innerHTML = `<span>${escapeHtml(ui("unsaved"))}</span><button class="button  " type="button" data-discard-draft>${escapeHtml(ui("discard"))}</button>`;
      form.append(status);
      if (!form.querySelector("input[name], select[name], textarea[name]")) {
        form.querySelector('button[type="submit"]').disabled = true;
      }
      if (drafts.has(key)) restoreSnapshot(form, drafts.get(key));
      captureDraft(form);
    });
  }

  function captureDraft(form) {
    if (!form || !formBaselines.has(form)) return;
    const values = formSnapshot(form);
    const changed = JSON.stringify(values) !== JSON.stringify(formBaselines.get(form));
    if (changed) drafts.set(form.dataset.draftKey, values);
    else drafts.delete(form.dataset.draftKey);
    form.querySelector(".draft-status").hidden = !changed;
  }

  function completeFormSave(form) {
    drafts.delete(form.dataset.draftKey);
    formBaselines.set(form, formSnapshot(form));
    form.querySelector(".draft-status")?.setAttribute("hidden", "");
    form.querySelector(".form-error")?.remove();
  }

  function showFormError(form, error, partial = false) {
    form.querySelector(".form-error")?.remove();
    const message = document.createElement("div");
    message.className = "form-error";
    message.setAttribute("role", "alert");
    message.textContent = `${error.message} ${ui(partial ? "partial" : "retry")}`;
    form.querySelector(".form-actions")?.before(message);
  }

  window.addEventListener("beforeunload", (event) => {
    if (!drafts.size && !savingForms) return;
    event.preventDefault();
    event.returnValue = "";
  });

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (state.csrfToken && options.method && options.method !== "GET") {
      headers.set("X-CSRF-Token", state.csrfToken);
    }
    const response = await fetch(`${BASE}${path}`, { ...options, headers });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.error?.message || `Request failed (${response.status})`);
      error.code = data?.error?.code || "request_failed";
      throw error;
    }
    return data;
  }

  function renderLoggedOut() {
    app.innerHTML = `
      <main class="login-screen">
        <div class="login-brand">
          <img src="/settings/assets/tomori_companion_logo.svg" alt="TomoriBot" class="login-logo">
          <div class="login-rule"></div>
          <p class="login-kicker">Tomoribot Control</p>
          <h1>${escapeHtml(loginMessage)}</h1>
          <p class="login-copy">Sign in with Discord to manage your own Tomori data and the servers you administer.</p>
          <a class="button primary login-button" href="/settings/login">Continue with Discord</a>
        </div>
      </main>`;
  }

  function renderBootScreen() {
    if (app.querySelector(".boot-screen")) return;
    app.innerHTML = `<div class="boot-screen"><img src="/settings/assets/tomori_companion_logo.svg" alt="TomoriBot" class="boot-logo"><div class="loading"></div></div>`;
  }

  function renderNoGuilds() {
    app.innerHTML = `
      <main class="login-screen">
        <div class="login-brand">
          <img src="/settings/assets/tomori_companion_logo.svg" alt="TomoriBot" class="login-logo">
          <p class="login-kicker">No shared servers</p>
          <h1>TomoriBot is not in one of your servers yet.</h1>
          <a class="button secondary login-button" href="/settings/logout">Sign out</a>
        </div>
      </main>`;
  }

  function navButton(id, label, adminOnly = false) {
    if (adminOnly && !state.overview?.canManage) return "";
    return `<a href="#${id}" data-nav="${id}" aria-current="${state.view === id ? "location" : "false"}">${navigationIcon(navigationIcons[id])}<span class="sidebar-link-label">${escapeHtml(label)}</span></a>`;
  }

  function renderShell() {
    const guilds = state.session?.guilds || [];
    const selected = guilds.find((guild) => guild.id === state.guildId) || guilds[0];
    const user = state.session?.user;
    app.innerHTML = `
      <div class="dashboard-shell">
        <header class="topbar">
          <button class="button icon mobile-nav-trigger" type="button" data-navigation-menu="dashboard-navigation" aria-label="${escapeHtml(ui("navigation_menu"))}">${navigationIcon("menu")}</button>
          <button class="brand brand-button" type="button" data-nav="overview" aria-label="Open overview">
            <img src="/settings/assets/tomori_companion_logo.svg" alt="" class="topbar-logo">
            <span class="brand-copy"><strong>TomoriBot</strong><small>companion control</small></span>
          </button>
          <div class="topbar-server-access">
            <button class="button topbar-server-button" type="button" data-server-picker-open aria-haspopup="dialog" aria-label="${escapeHtml(ui("switch_server"))}">
              ${
                selected?.iconUrl
                  ? `<img class="server-icon" src="${escapeHtml(selected.iconUrl)}" alt="">`
                  : `<span class="server-icon server-icon-fallback">${escapeHtml((selected?.name || "?").slice(0, 1))}</span>`
              }
              <span class="server-label"><small>${escapeHtml(ui("server"))}</small><strong>${escapeHtml(selected?.name || ui("switch_server"))}</strong></span>${navigationIcon("arrow-up-down")}
            </button>
          </div>
          <button class="button" id="design-trigger" type="button" popovertarget="design-settings" aria-label="${escapeHtml(ui("design_title"))}" data-tooltip="${escapeHtml(ui("design_title"))}"><span class="palette-orb" aria-hidden="true"></span><span class="design-trigger-label">${escapeHtml(ui("design_title"))}</span></button>
        </header>
        <div class="shell"><div class="sidebar-rail"><aside class="sidebar" data-variant="detailed">
          <nav class="nav-stack sidebar-sections" id="dashboard-navigation" aria-label="Dashboard">
            <section class="sidebar-group"><h2 class="group-label">Workspace</h2><div class="sidebar-group-links">
            ${navButton("overview", "Overview")}
            ${navButton("profile", ui("my_settings"))}
            ${navButton("personal-memory", "Global memory")}
            ${navButton("lorebooks", ui("lorebooks"))}
            ${navButton("personas", "Personas")}
            ${navButton("personal-providers", "My providers")}
            </div></section>
            ${
              state.overview?.canManage
                ? `<section class="sidebar-group"><h2 class="group-label">Administration</h2><div class="sidebar-group-links">
                   ${navButton("server-providers", "Server providers", true)}
                   ${navButton("settings", "Server settings", true)}</div></section>`
                : ""
            }
          </nav>
          <section class="sidebar-context sidebar-account" aria-label="${escapeHtml(ui("account"))}"><div class="row">
            ${
              user?.avatarUrl
                ? `<img src="${escapeHtml(user.avatarUrl)}" alt="" class="user-avatar">`
                : `<span class="user-avatar user-avatar-fallback">${escapeHtml((user?.displayName || "?").slice(0, 1))}</span>`
            }
            <div><small>${escapeHtml(ui("account"))}</small><strong>${escapeHtml(user?.displayName || "")}</strong></div></div>
            <a class="button" href="/settings/logout">${navigationIcon("log-out")}${escapeHtml(ui("log_out"))}</a>
          </section>
        </aside></div>
        <main class="dashboard-page" id="workspace"></main>
        </div>
      </div>
      <dialog id="navigation-sheet" class="sidebar-drawer" aria-labelledby="navigation-sheet-title"><header class="sidebar-drawer-heading"><h2 id="navigation-sheet-title">${escapeHtml(ui("navigation_menu"))}</h2><button class="button icon" type="button" data-navigation-close aria-label="${escapeHtml(ui("navigation_close"))}">${navigationIcon("x")}</button></header><div class="sidebar-drawer-body"></div></dialog>
      ${renderDesignSettings()}
      <dialog id="server-picker-dialog" class="wide" aria-labelledby="server-picker-title">
        <div class="stack">
          <header class="panel-header">
            <div class="heading"><p class="eyebrow">Your Tomori spaces</p><h2 id="server-picker-title">Switch server</h2>
              <p>Select the server you want to view or manage.</p>
            </div>
            <button class="button icon" type="button" data-server-picker-close aria-label="Close server selection">${navigationIcon("x")}</button>
          </header>
          <div class="persona-picker-grid">
            ${guilds
              .map(
                (guild) =>
                  `<button class="persona-choice" aria-pressed="${guild.id === state.guildId}" type="button" data-guild-select="${escapeHtml(guild.id)}">
                  ${
                    guild.iconUrl
                      ? `<img src="${escapeHtml(guild.iconUrl)}" alt="" class="avatar">`
                      : `<span class="avatar avatar-fallback">${escapeHtml((guild.name || "?").slice(0, 1))}</span>`
                  }
                  <span class="server-choice-copy"><strong>${escapeHtml(guild.name)}</strong><small>${guild.memberCount ?? "?"} members</small></span>
                  <span class="server-choice-access">${guild.canManage ? "Manage" : "Member"}</span>
                </button>`,
              )
              .join("")}
          </div>
        </div>
      </dialog>
      <dialog id="confirm-dialog" class="dialog" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <form method="dialog" class="stack">
          <header class="panel-header"><div class="heading"><p class="eyebrow">Please confirm</p><h2 id="confirm-title">Confirm action</h2><p id="confirm-message"></p></div></header>
          <div class="actions">
            <button value="cancel" class="button ">Cancel</button>
            <button value="confirm" class="button danger">Confirm</button>
          </div>
        </form>
      </dialog>
      <dialog id="memory-dialog" class="dialog" aria-labelledby="memory-dialog-title">
        <form method="dialog" class="stack" id="memory-edit-form">
          <header class="panel-header"><div class="heading"><p class="eyebrow">Memory</p><h2 id="memory-dialog-title">Update this memory</h2></div></header>
          <label class="field"><span class="field-label">Memory</span><textarea name="content" rows="6" required></textarea></label>
          <label class="field" data-memory-tags><span class="field-label">Tags</span><input name="tags" type="text" placeholder="character, preference"></label>
          <input name="memoryId" type="hidden">
          <div class="actions">
            <button type="button" class="button " data-dialog-close="memory-dialog">Cancel</button>
            <button value="save" class="button primary">Save changes</button>
          </div>
        </form>
      </dialog>
      <dialog id="persona-create-dialog" class="dialog wide" aria-labelledby="persona-create-title">
        <form class="stack" id="persona-create-form">
          <header class="panel-header"><div class="heading"><p class="eyebrow">New alter persona</p><h2 id="persona-create-title">Create a persona</h2><p>The new persona starts with this server's model configuration. You can refine every field afterward.</p></div></header>
          <div class="grid">
            <label class="field">${fieldLabel("Name", "The display name and first trigger word.")}<input name="nickname" maxlength="100" required></label>
            <label class="field">${fieldLabel("Trigger words", "Additional comma-separated names or phrases.")}<input name="triggerWords" placeholder="nickname, alias"></label>
            <label class="field span-all">${fieldLabel("Description", "A concise identity attribute used in conversation context.")}<textarea name="description" rows="3" required></textarea></label>
            <label class="field span-all">${fieldLabel("Visual character prompt", "Optional visual description used when generating images of this persona.")}<textarea name="personaPrompt" rows="5"></textarea></label>
            <label class="field">${fieldLabel("Sample user message", "Optional first half of an example exchange.")}<textarea name="sampleInput" rows="3"></textarea></label>
            <label class="field">${fieldLabel("Sample persona reply", "Required when a sample user message is provided.")}<textarea name="sampleOutput" rows="3"></textarea></label>
          </div>
          <div class="actions">
            <button type="button" class="button " data-dialog-close="persona-create-dialog">Cancel</button>
            <button type="submit" class="button primary">Create persona</button>
          </div>
        </form>
      </dialog>
      <dialog id="persona-import-dialog" class="dialog" aria-labelledby="persona-import-title">
        <form class="stack" id="persona-import-form">
          <header class="panel-header"><div class="heading"><p class="eyebrow">Import alter persona</p><h2 id="persona-import-title">Import a persona</h2><p>Tomori persona exports and SillyTavern cards are supported as PNG or JSON.</p></div></header>
          <label class="field">${fieldLabel("Persona file", "The embedded avatar is imported when the PNG contains one.")}<input name="file" type="file" accept=".png,.json,image/png,application/json" required></label>
          <fieldset class="stack">
            <legend>Memory identity</legend>
            <label class="choice">
              <input type="radio" name="identityMode" value="fork" checked>
              <span class="field-label">New identity<small>Starts a separate personal-memory lineage.</small></span>
            </label>
            <label class="choice">
              <input type="radio" name="identityMode" value="preserve">
              <span class="field-label">Preserve identity<small>Reuses the imported lineage when it is available.</small></span>
            </label>
          </fieldset>
          <div class="actions">
            <button type="button" class="button " data-dialog-close="persona-import-dialog">Cancel</button>
            <button type="submit" class="button primary">Import persona</button>
          </div>
        </form>
      </dialog>`;
    renderView();
    syncAppearanceControls();
    enhanceDashboard(app);
  }

  function renderDesignSettings() {
    return `<div id="design-settings" class="design-settings" popover role="dialog" aria-labelledby="design-title">
      <header class="panel-header"><div class="heading"><h2 id="design-title">${escapeHtml(ui("design_title"))}</h2><p>${escapeHtml(ui("design_hint"))}</p></div><button class="button  icon" type="button" popovertarget="design-settings" popovertargetaction="hide" aria-label="${escapeHtml(ui("navigation_close"))}">${navigationIcon("x")}</button></header>
      <div class="stack"><div class="row"><button class="button " id="design-theme" type="button" data-theme-toggle>${escapeHtml(ui("design_light"))}</button><button class="button " type="button" data-surface-toggle aria-pressed="${appearance.surface === "glass"}">${escapeHtml(ui("design_glass"))}</button></div>
      <div class="field"><span class="field-label">${escapeHtml(ui("design_palette"))}</span><div class="palette-list">${palettes.map((palette) => `<button class="palette-choice palette-${palette.id}" type="button" data-palette-choice="${palette.id}" aria-pressed="${appearance.palette === palette.id}"><span class="palette-orb" aria-hidden="true"></span><span>${palette.label}</span></button>`).join("")}</div></div>
      <label class="field">${fieldLabel(ui("design_color_mode"))}<select data-design-setting="colorMode"><option value="colorful">${escapeHtml(ui("design_colorful"))}</option><option value="reduced">${escapeHtml(ui("design_reduced"))}</option></select></label>
      <div class="preview-controls"><label class="field">${fieldLabel(ui("design_angle"), ui("design_angle_hint"))}<input type="number" min="0" max="359" step="1" data-light-setting="angle" data-scrub></label>
      <label class="field">${fieldLabel(ui("design_spread"))}<input type="range" min="50" max="500" step="10" data-light-setting="spread"></label><label class="field">${fieldLabel(ui("design_intensity"))}<input type="range" min="0" max="200" step="5" data-light-setting="intensity"></label></div>
      <label class="field">${fieldLabel(ui("design_motion"))}<select data-design-setting="motion">${["full", "subtle", "off"].map((value) => `<option value="${value}">${escapeHtml(ui(`design_motion_${value}`))}</option>`).join("")}</select></label></div>
      <div class="actions form-actions"><button class="button " type="button" data-design-reset>${escapeHtml(ui("design_reset"))}</button></div><p class="hint" id="design-status" role="status">${escapeHtml(ui("appearance_saved"))}</p>
    </div>`;
  }

  function enhanceDashboard(container) {
    window.TomoriControls?.configure(
      Object.fromEntries(
        [
          "control_adjust",
          "control_drop_file",
          "control_choose_file",
          "control_file_invalid",
          "control_file_ready",
          "control_choose_section",
          "control_close_dialog",
          "control_sections",
          "control_hold_delete",
          "control_keep_holding",
          "control_hold_confirmed",
        ].map((key) => [key, ui(key)]),
      ),
      (button) => confirmAction(button.dataset.confirmTitle, button.dataset.confirmDescription),
    );
    window.TomoriControls?.enhance(container);
    window.TomoriControls?.enhanceTabs(container);
    container.querySelectorAll("[data-palette-choice]").forEach((button) => {
      button.style.setProperty(
        "--swatch-color",
        palettes.find((palette) => palette.id === button.dataset.paletteChoice).color,
      );
    });
    container.querySelectorAll("[data-bar-height]").forEach((bar) => {
      bar.style.setProperty("--bar-height", `${bar.dataset.barHeight}%`);
      bar.querySelector(".bar-input").style.height = `${bar.dataset.inputShare}%`;
      bar.querySelector(".bar-output").style.height = `${100 - Number(bar.dataset.inputShare)}%`;
    });
    container.querySelectorAll("[data-share-value]").forEach((bar) => {
      bar.style.width = `${bar.dataset.shareValue}%`;
    });
  }

  function pageHeader(eyebrow, title, copy, actions = "") {
    return `<header class="page-header">
      <div class="heading">${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ""}<h1>${escapeHtml(title)}</h1>${copy ? `<p>${escapeHtml(copy)}</p>` : ""}</div>
      ${actions ? `<div class="actions">${actions}</div>` : ""}
    </header>`;
  }

  const navigationIcons = {
    overview: "house",
    personas: "users-round",
    profile: "user-round",
    "personal-memory": "brain",
    lorebooks: "book-open",
    lorebook: "book-open",
    "personal-providers": "plug",
    "server-providers": "plug",
    settings: "settings-2",
    conversation: "message-circle",
    models: "sliders-horizontal",
    channels: "radio",
    memory: "brain",
    media: "image",
    diagnostics: "bell",
    personal: "brain",
    server: "book-open",
    preferences: "user-round",
    appearance: "palette",
    sprites: "image",
  };

  function navigationIcon(name) {
    return `<svg class="glyph" aria-hidden="true" focusable="false"><use href="/settings/assets/navigation-icons.svg?v=3#${name}"></use></svg>`;
  }

  function refreshButton(action, label, scope = "") {
    return `<button class="button icon" data-${action}-refresh="${escapeHtml(scope)}" type="button" aria-label="${escapeHtml(label)}" data-tooltip="${escapeHtml(label)}">${navigationIcon("refresh-cw")}</button>`;
  }

  function initNavigationMenus() {
    const sidebar = document.querySelector(".sidebar");
    const drawer = document.querySelector("#navigation-sheet");
    document.querySelectorAll(".nav-stack [data-nav]").forEach((link) => {
      link.setAttribute("aria-current", link.dataset.nav === state.view ? "location" : "false");
    });
    if (drawer.open) drawer.close();
    document.querySelector(".sidebar-rail").append(sidebar);
    window.TomoriControls?.enhanceTabs(document.querySelector("#workspace"));
  }

  function openNavigationSheet() {
    const drawer = document.querySelector("#navigation-sheet");
    drawer.querySelector(".sidebar-drawer-body").append(document.querySelector(".sidebar"));
    drawer.showModal();
    drawer.querySelector('[data-nav][aria-current="location"]')?.focus();
  }

  function focusNavigation(selector) {
    const target = document.querySelector(selector);
    if (target?.dataset.nav && matchMedia("(max-width: 800px)").matches) {
      document.querySelector("[data-navigation-menu]")?.focus({ preventScroll: true });
    } else if (target) {
      if (!window.TomoriControls?.focusTab(target)) target.focus({ preventScroll: true });
    }
  }

  function renderView() {
    const workspace = document.querySelector("#workspace");
    if (!workspace || !state.overview) return;
    switch (state.view) {
      case "profile":
        renderProfile(workspace);
        break;
      case "personal-memory":
        state.memoryKind = "personal";
        state.lineageId = 0;
        renderGlobalMemories(workspace);
        break;
      case "lorebooks":
        workspace.innerHTML = `${pageHeader(ui("lorebook_eyebrow"), ui("lorebook_serverwide"), ui("lorebook_page_hint"))}<div id="lorebook-workspace"></div>`;
        loadLorebooks(0);
        break;
      case "personal-providers":
        renderProviders(workspace, "personal");
        break;
      case "personas":
        renderPersonaWorkspace(workspace);
        break;
      case "server-providers":
        renderProviders(workspace, "server");
        break;
      case "settings":
        renderSettings(workspace);
        break;
      default:
        renderOverview(workspace);
    }
    initDraftForms(workspace);
    enhanceDashboard(workspace);
    initNavigationMenus();
    workspace.querySelectorAll(".tabs, .tabs").forEach((nav) => {
      const active = nav.querySelector('[aria-current="page"]');
      if (!active) return;
      const bounds = nav.getBoundingClientRect();
      const button = active.getBoundingClientRect();
      if (button.right > bounds.right) nav.scrollLeft += button.right - bounds.right;
      else if (button.left < bounds.left) nav.scrollLeft += button.left - bounds.left;
    });
  }

  function renderOverview(workspace) {
    const overview = state.overview;
    workspace.innerHTML = `
      ${pageHeader(ui("overview_title"), overview.guild.name, ui("overview_hint"))}
      ${renderServerStats()}`;

    if (!state.serverStats && !state.serverStatsLoading && !state.serverStatsError) {
      loadServerStats();
    }
  }

  function renderStatsRanking(title, eyebrow, entries, valueFormatter) {
    return `<section class="panel activity-ranking">
      <div class="panel-header"><div class="heading"><p class="eyebrow">${escapeHtml(eyebrow)}</p><h3>${escapeHtml(title)}</h3></div></div>
      <div class="stack">
        ${
          entries.length
            ? entries
                .map(
                  (entry, index) => `<div class="activity-ranking-row">
                    <span class="hint">${index + 1}</span>
                    <div class="heading"><strong>${escapeHtml(entry.name)}</strong>
                    <span class="hint">${escapeHtml(valueFormatter(entry))}</span></div>
                  </div>`,
                )
                .join("")
            : `<p class="hint">${escapeHtml(ui("stats_empty"))}</p>`
        }
      </div>
    </section>`;
  }

  function statsModelUsage(stats, selectedModel = null) {
    const { totals } = stats;
    if (selectedModel !== null) {
      const days = (stats.history?.models || []).filter((entry) => entry.model === selectedModel);
      const inputTokens = days.reduce((sum, day) => sum + day.inputTokens, 0);
      const outputTokens = days.reduce((sum, day) => sum + day.outputTokens, 0);
      const cost = stats.models.find((model) => model.name === selectedModel)?.cost ?? null;
      return { inputTokens, outputTokens, cost, models: [{ name: selectedModel, inputTokens, outputTokens, cost }] };
    }
    const models = [...stats.models];
    const remainingInput = Math.max(0, totals.inputTokens - models.reduce((sum, model) => sum + model.inputTokens, 0));
    const remainingOutput = Math.max(
      0,
      totals.outputTokens - models.reduce((sum, model) => sum + model.outputTokens, 0),
    );
    if (remainingInput + remainingOutput > 0) {
      models.push({
        name: ui("stats_other_models"),
        inputTokens: remainingInput,
        outputTokens: remainingOutput,
        cost: Math.max(0, totals.estimatedCost - models.reduce((sum, model) => sum + model.cost, 0)),
      });
    }
    return { inputTokens: totals.inputTokens, outputTokens: totals.outputTokens, cost: totals.estimatedCost, models };
  }

  function renderModelUsage(stats, selectedModel = null) {
    const usage = statsModelUsage(stats, selectedModel);
    const { models } = usage;
    const totalTokens = usage.inputTokens + usage.outputTokens;
    const exactNumber = (value) => new Intl.NumberFormat().format(value);
    const row = (model, total = false) => {
      const tokens = model.inputTokens + model.outputTokens;
      const share = totalTokens > 0 ? Math.min(100, (tokens / totalTokens) * 100) : 0;
      return `<tr>
        <th scope="row"><strong>${escapeHtml(model.name)}</strong></th>
        <td class="model-share-cell" data-label="${escapeHtml(ui("stats_model_share"))}">${total ? "" : `<span>${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(share)}%</span><div class="share-track" aria-hidden="true"><span data-share-value="${share}"></span></div>`}</td>
        <td data-label="${escapeHtml(ui("stats_input"))}">${exactNumber(model.inputTokens)}</td>
        <td data-label="${escapeHtml(ui("stats_output"))}">${exactNumber(model.outputTokens)}</td>
        <td data-label="${escapeHtml(ui("stats_total_tokens"))}">${exactNumber(tokens)}</td>
        <td data-label="${escapeHtml(ui("stats_cost"))}">${model.cost === null ? `<span title="${escapeHtml(ui("stats_cost_unavailable"))}">-</span>` : formatUsd(model.cost)}</td>
      </tr>`;
    };
    return `<section class="panel model-usage-section">
      <div class="panel-header"><div class="heading"><h3>${escapeHtml(ui("stats_models"))}</h3><p>${escapeHtml(ui("stats_models_hint"))}</p></div></div>
      ${
        models.length
          ? `<div class="table-wrap"><table><caption>${escapeHtml(ui("stats_models"))}</caption>
        <thead><tr><th scope="col">${escapeHtml(ui("stats_model"))}</th><th scope="col">${escapeHtml(ui("stats_model_share"))}</th><th scope="col">${escapeHtml(ui("stats_input"))}</th><th scope="col">${escapeHtml(ui("stats_output"))}</th><th scope="col">${escapeHtml(ui("stats_total_tokens"))}</th><th scope="col">${escapeHtml(ui("stats_cost"))}</th></tr></thead>
        <tbody>${models.map((model) => row(model)).join("")}</tbody>
        <tfoot>${row({ name: selectedModel ?? ui("stats_server_total"), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cost: usage.cost }, true)}</tfoot>
      </table></div>`
          : `<p class="hint">${escapeHtml(ui("stats_empty"))}</p>`
      }
      <p class="hint">${escapeHtml(ui("stats_tokens_hint"))} ${escapeHtml(ui("stats_cost_hint"))}</p>
    </section>`;
  }

  function buildUsageHistory(history) {
    const start = new Date(`${history.from}T00:00:00Z`);
    const end = new Date(`${history.through}T00:00:00Z`);
    const monthly = (end - start) / 86400000 > 61;
    const totals = new Map();
    let peakDay = null;
    for (const day of history.days) {
      const key = monthly ? day.date.slice(0, 7) : day.date;
      const bucket = totals.get(key) || { inputTokens: 0, outputTokens: 0 };
      bucket.inputTokens += day.inputTokens;
      bucket.outputTokens += day.outputTokens;
      totals.set(key, bucket);
      if (!peakDay || day.inputTokens + day.outputTokens > peakDay.inputTokens + peakDay.outputTokens) peakDay = day;
    }
    const points = [];
    for (const cursor = new Date(start); cursor <= end; ) {
      const date = cursor.toISOString().split("T")[0];
      const key = monthly ? date.slice(0, 7) : date;
      const next = new Date(cursor);
      if (monthly) next.setUTCMonth(next.getUTCMonth() + 1, 1);
      else next.setUTCDate(next.getUTCDate() + 1);
      const through = new Date(Math.min(end.getTime(), next.getTime() - 86400000)).toISOString().split("T")[0];
      points.push({ date, through, ...(totals.get(key) || { inputTokens: 0, outputTokens: 0 }) });
      cursor.setTime(next.getTime());
    }
    return { monthly, points, peakDay };
  }

  function historyDate(date) {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
  }

  function historyPointLabel(point) {
    return point.date === point.through
      ? historyDate(point.date)
      : `${historyDate(point.date)} / ${historyDate(point.through)}`;
  }

  function historyPointValues(point) {
    const number = (value) => new Intl.NumberFormat().format(value);
    return `<strong>${escapeHtml(historyPointLabel(point))}</strong><div class="row"><span>${escapeHtml(ui("stats_input"))}: <b>${number(point.inputTokens)}</b></span><span>${escapeHtml(ui("stats_output"))}: <b>${number(point.outputTokens)}</b></span><span>${escapeHtml(ui("stats_total_tokens"))}: <b>${number(point.inputTokens + point.outputTokens)}</b></span></div>`;
  }

  function renderUsageHistory(stats) {
    if (!stats.history)
      return `<div class="usage-history-panel"><h3>${escapeHtml(ui("stats_history"))}</h3><p class="hint">${escapeHtml(ui("stats_history_error"))}</p><button class="button" type="button" data-stats-retry>${escapeHtml(ui("stats_retry"))}</button></div>`;
    const history =
      state.statsHistoryModel === null
        ? stats.history
        : { ...stats.history, days: stats.history.models.filter((entry) => entry.model === state.statsHistoryModel) };
    const { points, monthly, peakDay } = buildUsageHistory(history);
    const maximum = Math.max(1, ...points.map((point) => point.inputTokens + point.outputTokens));
    const peakIndex = points.findIndex((point) => point.inputTokens + point.outputTokens === maximum);
    const selectedIndex = Math.max(0, peakIndex);
    const number = (value) => new Intl.NumberFormat().format(value);
    const usage = statsModelUsage(stats, state.statsHistoryModel);
    const totalTokens = usage.inputTokens + usage.outputTokens;
    return `<div class="usage-history-panel">
      <div class="analytics-grid"><div class="chart-panel">
      <div class="heading"><h3>${escapeHtml(ui("stats_history"))}</h3><p class="hint">${escapeHtml(ui(state.statsHistoryModel === null ? (monthly ? "stats_history_monthly" : "stats_history_daily") : monthly ? "stats_history_selected_monthly" : "stats_history_selected_daily"))}</p>
      <div class="chart-legend"><span><i class="legend-dot" aria-hidden="true"></i>${escapeHtml(ui("stats_input"))}</span><span><i class="legend-dot output" aria-hidden="true"></i>${escapeHtml(ui("stats_output"))}</span></div>
      </div>
      ${
        peakIndex < 0
          ? `<p class="hint">${escapeHtml(ui("stats_empty"))}</p>`
          : `
      <div class="usage-chart">
        <div class="chart-axis" aria-hidden="true"><span>${formatStatNumber(maximum)}</span><span>${formatStatNumber(maximum / 2)}</span><span>0</span></div>
        <div class="chart-plot" role="group" aria-label="${escapeHtml(ui("stats_history"))}">
          ${points
            .map((point, index) => {
              const total = point.inputTokens + point.outputTokens;
              const inputShare = total ? (point.inputTokens / total) * 100 : 0;
              const label = `${historyPointLabel(point)}. ${ui("stats_input")}: ${number(point.inputTokens)}. ${ui("stats_output")}: ${number(point.outputTokens)}. ${ui("stats_total_tokens")}: ${number(point.inputTokens + point.outputTokens)}.`;
              return `<button class="chart-column" type="button" data-history-index="${index}" aria-pressed="${index === selectedIndex}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${total ? `<span class="bar-stack" data-bar-height="${(total / maximum) * 100}" data-input-share="${inputShare}"><span class="bar-input"></span><span class="bar-output"></span></span>` : ""}</button>`;
            })
            .join("")}
        </div>
      </div>
      <div class="chart-months" aria-hidden="true"><span>${escapeHtml(historyDate(stats.history.from))}</span><span>${escapeHtml(historyDate(stats.history.through))}</span></div>
      <div class="chart-readout history-readout" role="status" aria-live="polite">${historyPointValues(points[selectedIndex])}</div>`
      }
      </div><aside class="usage-split"><h3>${escapeHtml(ui("stats_model_share"))}</h3><div class="stack">
        ${
          usage.models.length
            ? usage.models
                .map((model) => {
                  const share = totalTokens
                    ? Math.min(100, ((model.inputTokens + model.outputTokens) / totalTokens) * 100)
                    : 0;
                  return `<div><div class="share-line"><strong>${escapeHtml(model.name)}</strong><span>${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(share)}%</span></div><div class="share-track" aria-hidden="true"><span data-share-value="${share}"></span></div></div>`;
                })
                .join("")
            : `<p class="hint">${escapeHtml(ui("stats_empty"))}</p>`
        }
      </div>${peakDay && peakIndex >= 0 ? `<div class="subsection"><h3>${escapeHtml(ui("stats_history_peak"))}</h3><strong>${escapeHtml(historyDate(peakDay.date))}</strong><p class="hint">${number(peakDay.inputTokens + peakDay.outputTokens)} ${escapeHtml(ui("stats_history_tokens"))}</p></div>` : ""}</aside></div>
      <details class="history-values"><summary>${escapeHtml(ui("stats_history_values"))}</summary>
        <div class="table-wrap"><table><caption>${escapeHtml(ui("stats_history_values"))}</caption><thead><tr><th scope="col">${escapeHtml(ui("stats_history_period"))}</th><th scope="col">${escapeHtml(ui("stats_input"))}</th><th scope="col">${escapeHtml(ui("stats_output"))}</th><th scope="col">${escapeHtml(ui("stats_total_tokens"))}</th></tr></thead><tbody>${points.map((point) => `<tr><th scope="row">${escapeHtml(historyPointLabel(point))}</th><td data-label="${escapeHtml(ui("stats_input"))}">${number(point.inputTokens)}</td><td data-label="${escapeHtml(ui("stats_output"))}">${number(point.outputTokens)}</td><td data-label="${escapeHtml(ui("stats_total_tokens"))}">${number(point.inputTokens + point.outputTokens)}</td></tr>`).join("")}</tbody></table></div>
      </details>
      <p class="hint">${escapeHtml(ui("stats_history_hint"))}</p>
    </div>`;
  }

  function selectHistoryPoint(target) {
    const history = state.serverStats?.history;
    if (!history) return;
    const filtered =
      state.statsHistoryModel === null
        ? history
        : { ...history, days: history.models.filter((entry) => entry.model === state.statsHistoryModel) };
    const point = buildUsageHistory(filtered).points[Number(target.dataset.historyIndex)];
    const panel = target.closest(".usage-history-panel");
    if (!point || !panel) return;
    panel.querySelector(".history-readout").innerHTML = historyPointValues(point);
    panel.querySelectorAll("[data-history-index]").forEach((bar) => {
      bar.setAttribute("aria-pressed", String(bar === target));
    });
  }

  function renderServerStats() {
    const timeframeOptions = [
      ["today", ui("stats_today")],
      ["week", ui("stats_week")],
      ["month", ui("stats_month")],
      ["year", ui("stats_year")],
      ["all_time", ui("stats_all_time")],
      ["custom", ui("stats_custom")],
    ];
    const models = [...new Set((state.serverStats?.history?.models || []).map((entry) => entry.model))].sort();
    if (!models.includes(state.statsHistoryModel)) state.statsHistoryModel = null;
    const timeframeControls = `<div class="analytics-toolbar">
      <label class="field"><span class="field-label">${escapeHtml(ui("stats_model"))}</span><select data-history-model ${state.serverStats?.history?.models ? "" : "disabled"}><option value="">${escapeHtml(ui("stats_server_total"))}</option>${models.map((model) => `<option value="${escapeHtml(`model:${model}`)}" ${state.statsHistoryModel === model ? "selected" : ""}>${escapeHtml(model || "(unknown)")}</option>`).join("")}</select></label>
      <label class="field"><span class="field-label">${escapeHtml(ui("stats_timeframe"))}</span><select data-history-timeframe>
      ${timeframeOptions
        .map(
          ([value, label]) =>
            `<option value="${value}" ${state.statsTimeframe === value ? "selected" : ""}>${escapeHtml(label)}</option>`,
        )
        .join("")}</select></label>
    </div>
    <form class="entry-form usage-range-editor" id="stats-range-form" ${state.statsRangeEditing ? "" : "hidden"}>
      <div class="grid"><label class="field">${fieldLabel(ui("stats_from"))}<input type="date" name="from" required max="${new Date().toISOString().slice(0, 10)}" value="${state.statsRange?.from || ""}"></label><label class="field">${fieldLabel(ui("stats_through"))}<input type="date" name="through" required max="${new Date().toISOString().slice(0, 10)}" value="${state.statsRange?.through || ""}"></label></div>
      <p class="hint">${escapeHtml(ui("stats_range_hint"))}</p><div class="actions entry-actions"><button class="button" type="button" data-stats-range-cancel>${escapeHtml(ui("persona_cancel"))}</button><button class="button primary" type="submit">${escapeHtml(ui("stats_apply_range"))}</button></div>
    </form>
    ${state.statsTimeframe === "custom" && state.statsRange ? `<div class="row usage-range-summary"><p class="hint">${state.statsRange.from} / ${state.statsRange.through} (UTC)</p><button class="button" type="button" data-stats-range-edit>${escapeHtml(ui("stats_edit_range"))}</button></div>` : ""}`;

    const statsHeader = `<header class="panel-header"><div class="heading"><p class="eyebrow">${escapeHtml(ui("stats_server_total"))}</p><h2>${escapeHtml(ui("stats_title"))}</h2><p>${escapeHtml(ui("stats_scope_hint"))}</p></div></header>${timeframeControls}`;
    let content = `<section class="panel stack">${statsHeader}<p class="hint" role="status">${escapeHtml(ui("stats_loading"))}</p></section>`;
    if (state.serverStatsError) {
      content = `<section class="panel stack">${statsHeader}<strong>${escapeHtml(ui("stats_error"))}</strong><span>${escapeHtml(state.serverStatsError)}</span><button class="button" type="button" data-stats-retry>${escapeHtml(ui("stats_retry"))}</button></section>`;
    } else if (state.serverStats) {
      const { totals } = state.serverStats;
      const usage = statsModelUsage(state.serverStats, state.statsHistoryModel);
      const selectedLabel = state.statsHistoryModel ?? ui("stats_server_total");
      content = `<section class="panel stack">${statsHeader}
        ${state.serverStatsLoading ? `<p class="hint" role="status">${escapeHtml(ui("stats_loading"))} ${escapeHtml(ui("stats_showing"))} ${escapeHtml(timeframeOptions.find(([value]) => value === state.serverStats.timeframe)?.[1] || "")}</p>` : ""}
        ${state.serverStats.history?.models === null ? `<p class="hint">${escapeHtml(ui("stats_history_filter_error"))}</p>` : ""}
        <div class="stat-grid">
          <div class="stat-tile"><div class="stat-copy"><small>${escapeHtml(ui("stats_input"))}</small><strong>${formatStatNumber(usage.inputTokens)}</strong><small>${escapeHtml(selectedLabel)}</small></div></div>
          <div class="stat-tile"><div class="stat-copy"><small>${escapeHtml(ui("stats_output"))}</small><strong>${formatStatNumber(usage.outputTokens)}</strong><small>${escapeHtml(selectedLabel)}</small></div></div>
          <div class="stat-tile"><div class="stat-copy"><small>${escapeHtml(ui("stats_total_tokens"))}</small><strong>${formatStatNumber(usage.inputTokens + usage.outputTokens)}</strong><small>${escapeHtml(selectedLabel)}</small></div></div>
          <div class="stat-tile"><div class="stat-copy"><small>${escapeHtml(ui("stats_cost"))}</small><strong>${usage.cost === null ? "-" : formatUsd(usage.cost)}</strong><small>${escapeHtml(usage.cost === null ? ui("stats_cost_unavailable") : selectedLabel)}</small></div></div>
        </div>
        ${renderUsageHistory(state.serverStats)}
        </section>
        ${renderModelUsage(state.serverStats, state.statsHistoryModel)}
        <section class="panel"><div class="panel-header"><div class="heading"><h3>${escapeHtml(ui("stats_server_activity"))}</h3><p>${escapeHtml(ui("stats_server_activity_hint"))}</p></div></div>
        <dl class="server-activity-list">
          <div><dt>${escapeHtml(ui("stats_generations"))}</dt><dd>${formatStatNumber(totals.textGenerations)}</dd><small>${escapeHtml(ui("stats_generations_hint"))}</small></div>
          <div><dt>${escapeHtml(ui("stats_replies"))}</dt><dd>${formatStatNumber(totals.messages)}</dd><small>${escapeHtml(ui("stats_replies_hint"))}</small></div>
          <div><dt>${escapeHtml(ui("stats_commands"))}</dt><dd>${formatStatNumber(totals.commands)}</dd></div>
          <div><dt>${escapeHtml(ui("stats_images"))}</dt><dd>${formatStatNumber(totals.imageGenerations)}</dd></div>
          <div><dt>${escapeHtml(ui("stats_videos"))}</dt><dd>${formatStatNumber(totals.videoGenerations)}</dd></div>
        </dl></section>
        <div class="grid activity-grid">
          ${renderStatsRanking(ui("stats_personas"), ui("stats_top_five"), state.serverStats.personas, (entry) => `${formatStatNumber(entry.count)} ${ui("stats_reply_unit")}`)}
          ${renderStatsRanking(ui("stats_tools"), ui("stats_top_five"), state.serverStats.tools, (entry) => `${formatStatNumber(entry.count)} ${ui("stats_use_unit")}`)}
          ${renderStatsRanking(ui("stats_commands"), ui("stats_top_five"), state.serverStats.topCommands, (entry) => `${formatStatNumber(entry.count)} ${ui("stats_use_unit")}`)}
        </div>`;
    }

    const mostActivePersona = state.serverStats?.personas[0];
    const activeIdentity = state.overview.personas.find(
      (persona) => persona.lineageId === mostActivePersona?.lineageId,
    );
    return `<section class="server-stats-section stack" aria-busy="${state.serverStatsLoading}">
      <div class="grid overview-stat-grid">
        <div class="stat-tile"><div class="stat-copy"><div><p class="eyebrow">${escapeHtml(ui("overview_personas"))}</p><strong>${formatStatNumber(state.overview.personas.length)}</strong></div></div></div>
        <div class="stat-tile"><div class="stat-copy"><div><p class="eyebrow">${escapeHtml(ui("stats_most_active_persona"))}</p><strong>${mostActivePersona ? escapeHtml(mostActivePersona.name) : "-"}</strong><small>${mostActivePersona ? `${formatStatNumber(mostActivePersona.count)} ${escapeHtml(ui("stats_reply_unit"))}` : escapeHtml(ui(state.serverStatsLoading ? "stats_loading" : "stats_empty"))}</small></div>${activeIdentity ? personaAvatar(activeIdentity, "avatar") : ""}</div></div>
      </div>
      ${content}
    </section>`;
  }

  function updateServerStatsSection() {
    if (state.view !== "overview") return;
    const current = document.querySelector(".server-stats-section");
    if (!current) return;
    const focusedFilter = current.contains(document.activeElement)
      ? document.activeElement.closest(".analytics-toolbar .field")?.querySelector("select") || document.activeElement
      : null;
    const focusSelector = focusedFilter?.matches("[data-history-model]")
      ? "[data-history-model]"
      : focusedFilter?.matches("[data-history-timeframe]")
        ? "[data-history-timeframe]"
        : null;
    const template = document.createElement("template");
    template.innerHTML = renderServerStats();
    const next = template.content.firstElementChild;
    if (next) {
      current.replaceWith(next);
      enhanceDashboard(next);
    }
    if (focusSelector) {
      const select = next?.querySelector(focusSelector);
      (select?.closest(".field")?.querySelector(".select-trigger") || select)?.focus({ preventScroll: true });
    }
  }

  async function loadServerStats() {
    const guildId = state.guildId;
    const timeframe = state.statsTimeframe;
    const range = state.statsRange;
    state.serverStatsLoading = true;
    state.serverStatsError = "";
    updateServerStatsSection();
    try {
      const query = new URLSearchParams({ timeframe });
      if (timeframe === "custom" && range) {
        query.set("from", range.from);
        query.set("through", range.through);
      }
      const response = await api(`/guilds/${guildId}/stats?${query}`);
      if (state.guildId !== guildId || state.statsTimeframe !== timeframe || state.statsRange !== range) return;
      state.serverStats = response.stats;
    } catch (error) {
      if (state.guildId !== guildId || state.statsTimeframe !== timeframe || state.statsRange !== range) return;
      state.serverStatsError = error.message;
    } finally {
      if (state.guildId === guildId && state.statsTimeframe === timeframe && state.statsRange === range) {
        state.serverStatsLoading = false;
        updateServerStatsSection();
      }
    }
  }

  function renderProfilePanel(section) {
    const profile = state.overview.profile;
    return `<form class="panel stack" data-profile-section="${section}">
        <div class="panel-header"><div class="heading"><p class="eyebrow">Personal</p><h2>${escapeHtml(ui(section))}</h2><p>${escapeHtml(ui(`${section}_hint`))}</p></div></div>
        ${
          section === "profile"
            ? `
        <div class="grid">
          <label class="field">${fieldLabel("Nickname", "Your personal display name when Tomori refers to you. Empty uses your current Discord display name.")}<input name="user_nickname" value="${escapeHtml(profile.nickname ?? "")}" maxlength="${profile.limits.nickname}"></label>
          <label class="field">${fieldLabel(profile.copy.gender, profile.copy.genderHint)}<input name="gender_identity" value="${escapeHtml(profile.genderIdentity ?? "")}" maxlength="${profile.limits.identity}"></label>
          <label class="field">${fieldLabel(profile.copy.pronouns, profile.copy.pronounsHint)}<input name="pronouns" value="${escapeHtml(profile.pronouns ?? "")}" maxlength="${profile.limits.identity}"></label>
          <label class="field">${fieldLabel(profile.copy.addressingStyle, profile.copy.addressingStyleHint)}<select name="addressing_style">
            ${[
              ["", profile.copy.styleDefault],
              ["neutral", profile.copy.styleNeutral],
              ["masculine", profile.copy.styleMasculine],
              ["feminine", profile.copy.styleFeminine],
            ]
              .map(
                ([value, label]) =>
                  `<option value="${value}"${(profile.addressingStyle ?? "") === value ? " selected" : ""}>${escapeHtml(label)}</option>`,
              )
              .join("")}
          </select></label>
        </div>
        <label class="field">${fieldLabel("Physical appearance tags", "Comma-separated traits used when image generation needs to depict you.")}<input name="physical_appearance_tags" value="${escapeHtml((profile.physicalAppearanceTags || []).join(", "))}"></label>
        `
            : ""
        }
        ${
          section === "privacy"
            ? `
          <label class="field">${fieldLabel("Privacy level", "Controls which personal memory features may store information about you.")}
            <select name="privacy_level">
              <option value="0"${profile.privacyLevel === 0 ? " selected" : ""}>Minimal</option>
              <option value="1"${profile.privacyLevel === 1 ? " selected" : ""}>Partial</option>
              <option value="2"${profile.privacyLevel === 2 ? " selected" : ""}>Full opt-out</option>
            </select>
          </label>
          <label class="toggle span-all"><span class="field-label"><strong>Cross-server short-term memory</strong><small>Share recent context between servers you use.</small></span>
            <input name="shortterm_cache_crossserver_opt_in" type="checkbox"${profile.crossServerShortTermMemory ? " checked" : ""}>
          </label>
        `
            : ""
        }
        ${
          section === "conversation"
            ? `
        <div class="grid">
          <label class="field">${fieldLabel("Personal trigger mode", "Overrides or follows the server's deliberate persona-trigger behavior for you.")}
            <select name="personal_dtm">
              ${["off", "follow", "on"].map((value) => `<option value="${value}"${profile.personalDtm === value ? " selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("")}
            </select>
          </label>
          <label class="field">${fieldLabel("Personal tool mode", "Overrides or follows the server's deliberate tool-use behavior for your requests.")}
            <select name="personal_deliberate_tool_mode">
              ${["off", "follow", "on"].map((value) => `<option value="${value}"${profile.personalDeliberateToolMode === value ? " selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("")}
            </select>
          </label>
          <label class="field">${fieldLabel("Timezone offset", "Your UTC offset for personal date and time context. Empty follows the server default.")}<input name="timezone_offset" type="number" min="-12" max="14" step="0.25" value="${profile.timezoneOffset ?? ""}"></label>
        </div>
        <label class="toggle span-all"><span class="field-label"><strong>${escapeHtml(profile.copy.nudgeOptOut)}</strong><small>${escapeHtml(profile.copy.nudgeOptOutHint)}</small></span>
          <input name="natural_nudge_opt_out" type="checkbox"${profile.naturalNudgeOptOut ? " checked" : ""}>
        </label>
        <label class="field">${fieldLabel("Impersonation prompt", "Instructions Tomori uses when generating a message in your voice.")}<textarea name="impersonation_prompt" rows="5">${escapeHtml(profile.impersonationPrompt || "")}</textarea></label>
        `
            : ""
        }
        ${
          section === "fallback"
            ? `
        <label class="toggle span-all"><span class="field-label"><strong>${escapeHtml(profile.copy.serverFallback)}</strong><small>${escapeHtml(profile.copy.serverFallbackHint)}</small></span>
          <input name="personal_server_fallback_enabled" type="checkbox"${profile.personalServerFallback ? " checked" : ""}>
        </label>`
            : ""
        }
        <div class="actions form-actions"><button class="button primary" type="submit">${escapeHtml(ui("save"))}</button></div>
      </form>`;
  }

  function renderProfile(workspace) {
    workspace.innerHTML = `${pageHeader("Personal", ui("my_settings"), "These preferences belong to you, not to the selected server.")}
      <div class="columns">${["profile", "privacy", "conversation"].map(renderProfilePanel).join("")}</div>`;
  }

  function renderMemoryCollection({ personal, global = false, persona = null }) {
    const serverWritesDisabled =
      !personal && !state.overview.canManage && !state.overview.memoryPolicy.serverMemoryTeachingEnabled;
    const personalCreationDisabled = personal && state.overview.profile.privacyLevel === 2;
    const title = global
      ? "Global personal memory"
      : personal
        ? `${persona.nickname}'s memories about you`
        : "Server knowledge";
    const copy = global
      ? "Private facts available to your Tomori experience across persona lineages."
      : personal
        ? "Private facts about you that are only available to this persona when you are around."
        : state.overview.canManage
          ? `Shared facts for ${persona.nickname}. As an administrator, you can manage every entry.`
          : `Shared facts you personally taught ${persona.nickname}. Other members' entries remain hidden.`;

    return `
      <section class="panel">
        <header class="panel-header"><div class="heading"><p class="eyebrow">${personal ? "Personal" : "Shared server context"}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div>
        <div class="actions">
          ${refreshButton("memory", ui("refresh_memories"))}
          <button class="button " data-memory-export type="button"${personal ? "" : " disabled"}>Export</button>
          <button class="button " data-memory-import type="button"${personal ? "" : " disabled"}>Import</button>
          <input id="memory-import-file" type="file" accept="application/json,.json" hidden>
        </div></header>
      <div class="stack">
      ${personal ? "" : `<p class="notice info">${escapeHtml(ui("memory_server_transfer_unavailable"))}</p>`}
      ${
        serverWritesDisabled || personalCreationDisabled
          ? `<div class="notice info"><strong>${personalCreationDisabled ? "New personal memories are disabled by your privacy setting." : "Member teaching is disabled for this server."}</strong><p>Existing entries remain visible according to your access.</p></div>`
          : `<form class="stack" id="memory-compose-form">
              <label class="field">${fieldLabel("New memory", "Write one concise fact. Its visibility follows the memory scope shown above.")}<textarea name="content" rows="3" required placeholder="A concise fact Tomori should remember"></textarea></label>
              <div class="stack">
                ${personal ? `<label class="field">${fieldLabel("Tags", ui("memory_personal_tags_hint"))}<input name="tags" placeholder="preference, character"></label>` : ""}
                <div class="actions"><button class="button primary" type="submit">Add memory</button></div>
              </div>
            </form>`
      }
      <section id="memory-list" class="stack"><div class="loading" role="status" aria-label="Loading memories"></div></section></div></section>`;
  }

  function renderGlobalMemories(workspace) {
    state.memoryKind = "personal";
    state.lineageId = 0;
    workspace.innerHTML = `
      ${pageHeader("Personal", "Global memory", "This is the only memory scope that is not attached to a persona.")}
      <div class="stack">${renderMemoryCollection({ personal: true, global: true })}</div>`;
    loadMemories();
  }

  let memoryRequestId = 0;

  async function loadMemories() {
    const list = document.querySelector("#memory-list");
    if (!list) return;
    const requestId = ++memoryRequestId;
    const { guildId, memoryKind, lineageId } = state;
    const isCurrent = () =>
      requestId === memoryRequestId &&
      state.guildId === guildId &&
      state.memoryKind === memoryKind &&
      state.lineageId === lineageId &&
      document.querySelector("#memory-list") === list;
    list.innerHTML = `<div class="notice">Loading memories...</div>`;
    try {
      const path = `/guilds/${guildId}/memories/${memoryKind}?lineageId=${lineageId}`;
      const data = await api(path);
      if (!isCurrent()) return;
      state.memoryData = data;
      renderMemoryList();
    } catch (error) {
      if (!isCurrent()) return;
      list.innerHTML = `<div class="empty"><strong>Memories could not be loaded.</strong><span>${escapeHtml(error.message)}</span></div>`;
    }
  }

  function renderMemoryList() {
    const list = document.querySelector("#memory-list");
    if (!list) return;
    const rows = state.memoryData?.memories || [];
    if (!rows.length) {
      list.innerHTML = `<div class="empty"><strong>No memories in this scope.</strong><span>The first one you add will appear here.</span></div>`;
      return;
    }
    const serverWritesDisabled =
      state.memoryKind === "server" &&
      !state.overview.canManage &&
      !state.overview.memoryPolicy.serverMemoryTeachingEnabled;
    list.innerHTML = rows
      .map(
        (memory) => `<article class="memory-row">
          <div class="stack">
            <span class="badge">#${memory.id}</span>
            <p>${escapeHtml(memory.content)}</p>
            <div class="row hint">
              ${state.memoryKind === "personal" ? (memory.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") : ""}
              ${memory.updatedAt || memory.createdAt ? `<time>${escapeHtml(formatDate(memory.updatedAt || memory.createdAt))}</time>` : ""}
              ${state.memoryKind === "server" && state.overview.canManage && memory.taughtByUserId ? `<small>Teacher #${memory.taughtByUserId}</small>` : ""}
            </div>
          </div>
          ${
            memory.editable === false || serverWritesDisabled
              ? ""
              : `<div class="actions">
                  <button class="button  " data-memory-edit="${memory.id}" type="button">Edit</button>
                  <button class="button danger " data-memory-delete="${memory.id}" type="button">Delete</button>
                </div>`
          }
        </article>`,
      )
      .join("");
  }

  let lorebookLoadVersion = 0;
  const lorebookSelections = new Map();

  function lorebookSelectionKey(lineageId) {
    return `${state.guildId}/${lineageId}/${lineageId === 0 ? state.lorebookBookId || 0 : 0}`;
  }

  function lorebookScope(lineageId, bookId = state.lorebookBookId) {
    return { lineageId, ...(lineageId === 0 && bookId ? { bookId } : {}) };
  }

  function lorebookCurrent(lineageId, target, guildId) {
    const persona = state.overview?.personas.find((entry) => entry.personaId === state.personaId);
    return (
      state.guildId === guildId &&
      document.querySelector("#lorebook-workspace") === target &&
      (lineageId === 0
        ? state.view === "lorebooks"
        : state.view === "personas" && state.personaPanel === "lorebook" && persona?.lineageId === lineageId)
    );
  }

  async function loadLorebooks(lineageId) {
    const target = document.querySelector("#lorebook-workspace");
    if (!target) return;
    const guildId = state.guildId;
    const version = ++lorebookLoadVersion;
    const currentView = target.querySelector(".mailbox")?.dataset.view || "list";
    const bookId = lineageId === 0 ? state.lorebookBookId : null;
    target.innerHTML = `<p role="status">${escapeHtml(ui("lorebook_loading"))}</p>`;
    try {
      const query = new URLSearchParams({ lineageId: String(lineageId) });
      if (bookId) query.set("bookId", String(bookId));
      const data = await api(`/guilds/${guildId}/lorebooks?${query}`);
      if (
        version !== lorebookLoadVersion ||
        !lorebookCurrent(lineageId, target, guildId) ||
        (lineageId === 0 && bookId !== state.lorebookBookId)
      )
        return;
      if (lineageId === 0 && !data.books.some((book) => book.lorebook_id === bookId)) {
        state.lorebookBookId = data.books[0]?.lorebook_id ?? null;
        if (state.lorebookBookId) return loadLorebooks(lineageId);
      }
      state.lorebookData = data;
      target.innerHTML = renderLorebooks(lineageId, data);
      initDraftForms(target);
      window.TomoriControls?.enhance(target);
      const selected = lorebookSelections.get(lorebookSelectionKey(lineageId));
      const selectedEntry = data.entries.find((entry) => entry.entry_id === selected?.entryId) || data.entries[0];
      if (selectedEntry) {
        openLorebookEditor(
          selectedEntry.entry_id,
          selectedEntry.entry_id === selected?.entryId ? selected.section : "content",
          false,
        );
        target.querySelector(".mailbox").dataset.view = currentView;
      }
    } catch (error) {
      if (version !== lorebookLoadVersion || !lorebookCurrent(lineageId, target, guildId)) return;
      if (lineageId === 0 && bookId && error.code === "lorebook_missing" && state.lorebookBookId === bookId) {
        state.lorebookBookId = null;
        return loadLorebooks(lineageId);
      }
      target.innerHTML = `<div class="notice error stack" role="alert"><strong>${escapeHtml(ui("lorebook_failed"))}</strong><span>${escapeHtml(error.message)}</span><button class="button secondary" type="button" data-lorebook-retry="${lineageId}">${escapeHtml(ui("sprite_retry"))}</button></div>`;
    }
  }

  function lorebookChannels(ids, editable) {
    const channels = state.overview.channels || [];
    const missing = ids.filter((id) => !channels.some((channel) => channel.id === id));
    if (!editable) {
      const names = ids.map((id) => channels.find((channel) => channel.id === id)?.name || id);
      return `<p>${escapeHtml(ui("lorebook_channels"))}: ${escapeHtml(names.join(", ") || ui("lorebook_channels_hint"))}</p>`;
    }
    const setting = `<a href="/settings?guild=${encodeURIComponent(state.guildId)}#channel-scoped-memory" data-lorebook-channel-settings>${escapeHtml(ui("lorebook_channel_settings_link"))}</a>`;
    const dependency = escapeHtml(ui("lorebook_channels_dependency")).replace("{setting}", () => setting);
    return `<fieldset class="stack"><legend>${escapeHtml(ui("lorebook_channels"))}</legend><p class="hint">${escapeHtml(ui("lorebook_channels_hint"))} ${dependency}</p>${missing.length ? `<p class="hint">${escapeHtml(ui("lorebook_missing_channels"))}</p>` : ""}<div class="grid">${channels.map((channel) => `<label class="choice"><input name="channelDiscIds" type="checkbox" value="${escapeHtml(channel.id)}"${ids.includes(channel.id) ? " checked" : ""}><span class="field-label">${escapeHtml(channel.name)}</span></label>`).join("")}</div>${missing.map((id) => `<input name="channelDiscIds" type="checkbox" value="${escapeHtml(id)}" data-missing-channel checked hidden>`).join("")}</fieldset>`;
  }

  function lorebookEntry(entry) {
    return `<button class="mail-item" type="button" data-lorebook-edit-entry="${entry.entry_id}" data-lorebook-editor-section="content" data-lorebook-search="${escapeHtml(`${entry.title} ${entry.content} ${entry.keys.join(" ")}`.toLowerCase())}" aria-current="false"><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.content)}</small><small>${escapeHtml(ui(entry.enabled ? "lorebook_enabled" : "lorebook_disabled"))}</small></button>`;
  }

  function lorebookUsage(entry) {
    if (!entry.enabled) return ui("lorebook_usage_disabled");
    if (entry.trigger_chance === 0) return ui("lorebook_usage_zero");
    if (entry.constant) return ui("lorebook_usage_always");
    const list = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });
    const words = (keys) => list.format(keys.map((key) => `"${key}"`));
    const sentences = [
      ui("lorebook_usage_keys")
        .replace("{keys}", () => words(entry.keys))
        .replace("{messages}", () => String(entry.scan_depth)),
    ];
    if (entry.secondary_keys.length) {
      const key = ["lorebook_usage_any", "lorebook_usage_not_all", "lorebook_usage_none", "lorebook_usage_all"][
        entry.selective_logic
      ];
      sentences.push(ui(key).replace("{words}", () => words(entry.secondary_keys)));
    }
    if (entry.trigger_chance < 100)
      sentences.push(ui("lorebook_usage_chance").replace("{chance}", () => String(entry.trigger_chance)));
    return sentences.join(" ");
  }

  function openLorebookEditor(entryId, section = "content", navigate = true) {
    const entry = state.lorebookData.entries.find((item) => item.entry_id === entryId);
    if (!entry) return;
    const lineageId = activeLorebookLineage();
    const prefix = `lorebook/${lineageId}/${lineageId === 0 ? state.lorebookBookId : 0}/${entry.entry_id}`;
    const canManage = state.overview.canManage;
    const actions = `<div class="actions form-actions entry-actions"><button class="button primary" type="submit">${escapeHtml(ui("lorebook_save"))}</button></div>`;
    const deleteButton = `<button class="button danger hold-button" type="button" data-hold data-lorebook-delete-entry="${entryId}" data-confirm-title="${escapeHtml(ui("lorebook_delete_title").replace("{name}", () => entry.title))}" data-confirm-description="${escapeHtml(ui("lorebook_delete_entry_confirm"))}"><span>${escapeHtml(ui("control_hold_delete"))}</span></button>`;
    lorebookSelections.set(lorebookSelectionKey(lineageId), { entryId, section });
    let body;
    if (!canManage) {
      body = `<label class="field">${fieldLabel(ui("lorebook_content"))}<textarea rows="9" readonly>${escapeHtml(entry.content)}</textarea></label><p class="hint">${escapeHtml(lorebookUsage(entry))}</p>${lineageId === 0 ? "" : lorebookChannels(entry.channel_disc_ids, false)}`;
    } else if (section === "content") {
      body = `<form class="entry-form" data-lorebook-form="content" data-entry-id="${entryId}" data-settings-key="${prefix}/content"><label class="field">${fieldLabel(ui("lorebook_title"), ui("lorebook_title_hint"))}<input name="title" maxlength="128" value="${escapeHtml(entry.title)}" required></label><label class="field">${fieldLabel(ui("lorebook_content"))}<textarea name="content" maxlength="4000" rows="9" required>${escapeHtml(entry.content)}</textarea></label><label class="toggle"><span class="field-label">${escapeHtml(ui("lorebook_enabled"))}</span><input name="enabled" type="checkbox" role="switch"${entry.enabled ? " checked" : ""}></label><div class="actions form-actions entry-actions">${deleteButton}<button class="button primary" type="submit">${escapeHtml(ui("lorebook_save"))}</button></div></form>`;
    } else if (section === "matching") {
      body = `<p class="hint">${escapeHtml(ui("lorebook_matching_hint"))}</p>
        <form class="entry-form" data-lorebook-form="constant" data-entry-id="${entryId}" data-settings-key="${prefix}/constant"><label class="toggle"><span class="field-label">${escapeHtml(ui("lorebook_constant"))}<small>${escapeHtml(ui(entry.keys.length ? "lorebook_constant_hint" : "lorebook_constant_no_keys"))}</small></span><input name="constant" type="checkbox" role="switch"${entry.constant ? " checked" : ""}${entry.keys.length ? "" : " disabled"}></label>${entry.keys.length ? actions : ""}</form>
        <form class="entry-form" data-lorebook-form="keys" data-entry-id="${entryId}" data-settings-key="${prefix}/keys" data-original-keys="${escapeHtml(JSON.stringify(entry.keys))}"><label class="field">${fieldLabel(ui("lorebook_keys"), ui("lorebook_keys_hint"))}<textarea name="keys" rows="4">${escapeHtml(entry.keys.join("\n"))}</textarea></label><p class="hint">${escapeHtml(ui("lorebook_regex_hint"))}</p>${actions}</form>
        ${lineageId === 0 ? "" : `<form class="entry-form" data-lorebook-form="entry-channels" data-entry-id="${entryId}" data-settings-key="${prefix}/channels" data-original-channels="${escapeHtml(JSON.stringify(entry.channel_disc_ids))}">${lorebookChannels(entry.channel_disc_ids, true)}${entry.legacy_channel_tags?.length ? `<p class="hint">${escapeHtml(ui("lorebook_pending_channels"))}: ${escapeHtml(entry.legacy_channel_tags.join(", "))}</p>` : ""}${actions}</form>`}`;
    } else {
      body = `<p class="hint">${escapeHtml(ui("lorebook_rules_hint"))}</p>${entry.constant ? `<p class="notice info">${escapeHtml(ui("lorebook_rules_always"))}</p>` : ""}
        <form class="entry-form" data-lorebook-form="activation" data-entry-id="${entryId}" data-settings-key="${prefix}/activation" data-original-keys="${escapeHtml(JSON.stringify(entry.secondary_keys))}">
          <label class="field">${fieldLabel(ui("lorebook_secondary"), ui("lorebook_secondary_hint"))}<textarea name="secondaryKeys" rows="3">${escapeHtml(entry.secondary_keys.join("\n"))}</textarea></label>
          <label class="field">${fieldLabel(ui("lorebook_logic"), ui("lorebook_logic_hint"))}<select name="selectiveLogic">${["lorebook_logic_any", "lorebook_logic_not_all", "lorebook_logic_not_any", "lorebook_logic_all"].map((key, index) => `<option value="${index}"${entry.selective_logic === index ? " selected" : ""}>${escapeHtml(ui(key))}</option>`).join("")}</select></label>
          <div class="grid"><label class="field">${fieldLabel(ui("lorebook_scan"), ui("lorebook_scan_hint"))}<input type="number" name="scanDepth" min="1" max="100" value="${entry.scan_depth}" data-scrub required></label><label class="field">${fieldLabel(ui("lorebook_chance"), ui("lorebook_chance_hint"))}<input type="number" name="triggerChance" min="0" max="100" value="${entry.trigger_chance}" data-scrub required></label></div>
          <label class="field">${fieldLabel(ui("lorebook_order"), ui("lorebook_order_hint"))}<input type="number" name="insertionOrder" min="-2147483648" max="2147483647" value="${entry.insertion_order}" data-scrub required></label>
          <p class="hint">${escapeHtml(ui("lorebook_placement"))}: ${escapeHtml(ui(entry.placement === 0 ? "lorebook_before" : "lorebook_after"))}. ${escapeHtml(ui("lorebook_placement_hint"))}</p>${actions}
        </form>`;
    }
    const tabs = canManage
      ? `<nav class="tabs" role="tablist" aria-label="${escapeHtml(ui("lorebook_entry_settings"))}">${["content", "matching", "rules"].map((key) => `<button type="button" role="tab" data-lorebook-edit-entry="${entryId}" data-lorebook-editor-section="${key}" aria-selected="${key === section}" tabindex="${key === section ? 0 : -1}">${escapeHtml(ui({ content: "lorebook_content", matching: "lorebook_when_used", rules: "lorebook_additional_rules" }[key]))}</button>`).join("")}</nav>`
      : "";
    const host = document.querySelector("#lorebook-editor-host");
    if (!host) return;
    host.innerHTML = `<button class="button mail-back" type="button" data-lorebook-back>${navigationIcon("arrow-left")}${escapeHtml(ui("lorebook_back_entries"))}</button><header class="panel-header"><div class="heading"><h3>${escapeHtml(entry.title)}</h3></div></header>${tabs}<div class="stack">${body}</div>${canManage && section !== "content" ? `<div class="actions entry-actions">${deleteButton}</div>` : ""}`;
    initDraftForms(host);
    window.TomoriControls?.enhance(host);
    document.querySelectorAll(".mail-item[data-lorebook-edit-entry]").forEach((item) => {
      item.setAttribute("aria-current", String(Number(item.dataset.lorebookEditEntry) === entryId));
    });
    if (navigate) {
      host.closest(".mailbox").dataset.view = "detail";
      host.querySelector("[data-lorebook-back]")?.focus({ preventScroll: true });
    }
  }

  function lorebookDialog(id, title, form) {
    return `<dialog id="${id}"${id === "lorebook-entry-dialog" ? ' class="wide"' : ""} aria-labelledby="${id}-title"><header class="panel-header"><div class="heading"><h2 id="${id}-title">${escapeHtml(title)}</h2></div><button class="button icon" type="button" data-dialog-close="${id}" aria-label="${escapeHtml(ui("lorebook_close"))}" data-tooltip="${escapeHtml(ui("lorebook_close"))}">${navigationIcon("x")}</button></header><div class="stack">${form}</div></dialog>`;
  }

  function lorebookDialogActions(id, label) {
    return `<div class="actions form-actions"><button class="button" type="button" data-dialog-close="${id}">${escapeHtml(ui("lorebook_cancel"))}</button><button class="button primary" type="submit">${escapeHtml(label)}</button></div>`;
  }

  function lorebookDialogFocusTarget(id) {
    if (id === "lorebook-create-dialog" || id === "lorebook-import-new-dialog")
      return '[popovertarget="lorebook-collection-actions"]';
    if (id === "lorebook-import-dialog" || id === "lorebook-settings-dialog")
      return '[popovertarget="lorebook-book-actions"]';
    return `[data-lorebook-open="${id}"]`;
  }

  function lorebookChoices(books) {
    return books.length
      ? books
          .map(
            (item) =>
              `<button type="button" class="folder-button" data-lorebook-select="${item.lorebook_id}" aria-pressed="${item.lorebook_id === state.lorebookBookId}">${navigationIcon("book-open")}<span>${escapeHtml(item.name)}${item.enabled ? "" : ` (${escapeHtml(ui("lorebook_disabled"))})`}</span><small>${escapeHtml(String(item.entryCount))}</small></button>`,
          )
          .join("")
      : `<p class="hint">${escapeHtml(ui("lorebook_no_books"))}</p>`;
  }

  function renderLorebooks(lineageId, data) {
    const canManage = state.overview.canManage;
    const serverwide = lineageId === 0;
    const book = serverwide ? data.books.find((item) => item.lorebook_id === state.lorebookBookId) : null;
    const name = serverwide
      ? book?.name
      : state.overview.personas.find((item) => item.lineageId === lineageId)?.nickname;
    const scopeKey = `lorebook/${lineageId}/${book?.lorebook_id || 0}`;
    const available = !serverwide || Boolean(book);
    const collectionActions = canManage
      ? `<button class="button" type="button" popovertarget="lorebook-collection-actions" aria-expanded="false">${navigationIcon("ellipsis")}${escapeHtml(ui("lorebook_collection_actions"))}</button><div id="lorebook-collection-actions" class="action-menu" popover aria-label="${escapeHtml(ui("lorebook_collection_actions"))}"><button class="button" type="button" data-lorebook-open="lorebook-create-dialog" aria-haspopup="dialog">${escapeHtml(ui("lorebook_new_book"))}</button><button class="button" type="button" data-lorebook-open="lorebook-import-new-dialog" aria-haspopup="dialog">${escapeHtml(ui("lorebook_import_new"))}</button></div>`
      : "";
    const bookActions = available
      ? `<div class="entry-actions"><button class="button" type="button" popovertarget="lorebook-book-actions" aria-expanded="false">${navigationIcon("ellipsis")}${escapeHtml(ui("lorebook_book_actions"))}</button><div id="lorebook-book-actions" class="action-menu" popover aria-label="${escapeHtml(ui("lorebook_book_actions"))}"><button class="button" type="button" data-lorebook-open="lorebook-import-dialog" aria-haspopup="dialog">${escapeHtml(ui("lorebook_transfer"))}</button>${book && canManage ? `<button class="button" type="button" data-lorebook-rename data-action-menu-preserve-focus>${escapeHtml(ui("lorebook_edit_book"))}</button><button class="button" type="button" data-lorebook-open="lorebook-settings-dialog" aria-haspopup="dialog">${escapeHtml(ui("lorebook_settings"))}</button><hr><button class="button danger" type="button" data-lorebook-delete-book>${escapeHtml(ui("lorebook_delete_book"))}</button>` : ""}</div></div>`
      : "";
    const transfer = available
      ? lorebookDialog(
          "lorebook-import-dialog",
          ui("lorebook_transfer"),
          `
      <div class="row">${navigationIcon("book-open")}<dl class="meta-stack"><dt>${escapeHtml(ui(serverwide ? "lorebook_selected" : "lorebook_persona"))}</dt><dd dir="auto">${escapeHtml(name)}</dd></dl></div>
      <section class="subsection stack"><h3>${escapeHtml(ui("lorebook_export_heading"))}</h3><p class="hint">${escapeHtml(ui("lorebook_export_hint"))}</p><button class="button secondary" type="button" data-lorebook-export>${escapeHtml(ui("lorebook_export"))}</button></section>
      ${canManage ? `<form class="subsection stack" data-lorebook-import-form><h3>${escapeHtml(ui("lorebook_import_heading"))}</h3><p class="hint">${escapeHtml(ui("lorebook_transfer_hint"))}</p><label class="field">${fieldLabel(ui("lorebook_import"))}<input name="file" type="file" accept=".json,application/json" required></label><label class="field">${fieldLabel(ui("lorebook_import_mode"), ui("lorebook_import_mode_hint"))}<select name="mode"><option value="append">${escapeHtml(ui("lorebook_append"))}</option><option value="replace">${escapeHtml(ui("lorebook_replace"))}</option></select></label>${lorebookDialogActions("lorebook-import-dialog", ui("lorebook_import"))}</form>` : ""}
    `,
        )
      : "";
    return `<div class="stack" data-lorebook-library><div class="mailbox${serverwide ? "" : " lorebook-mailbox-persona"}" data-view="list">
      ${serverwide ? `<nav class="mail-folders" aria-label="${escapeHtml(ui("lorebooks"))}"><p class="hint">${escapeHtml(ui("lorebooks"))}</p>${lorebookChoices(data.books)}<footer class="actions entry-actions">${collectionActions}</footer></nav>` : ""}
      <section class="mail-list" aria-label="${escapeHtml(name || ui("lorebooks"))}">
        ${
          available
            ? `<div class="mail-book-header" data-lorebook-book-summary><div class="heading"><h3>${escapeHtml(name)}</h3><small role="status" data-lorebook-results>${escapeHtml(ui("lorebook_entry_count").replace("{count}", String(data.entries.length)))}</small></div>${bookActions}</div>
          ${book && canManage ? `<form class="entry-form" data-lorebook-form="book-rename" data-settings-key="${scopeKey}/rename" novalidate hidden><label class="field">${fieldLabel(ui("lorebook_book_name"))}<input name="name" maxlength="128" value="${escapeHtml(book.name)}" required aria-describedby="lorebook-name-error"><span class="error" id="lorebook-name-error" hidden></span></label><div class="actions form-actions entry-actions"><button class="button" type="button" data-lorebook-rename-cancel>${escapeHtml(ui("lorebook_cancel"))}</button><button class="button primary" type="submit">${escapeHtml(ui("lorebook_save_name"))}</button></div></form>` : ""}
          ${book && !book.enabled ? `<p class="notice warning">${escapeHtml(ui("lorebook_collection_paused"))}</p>` : ""}
          <label class="field inline"><span class="field-label">${escapeHtml(ui("lorebook_search"))}</span><input type="search" data-lorebook-search-input></label>
        ${state.lorebookImportReceipt?.key === scopeKey ? `<div class="notice success stack" role="status"><strong>${escapeHtml(ui("lorebook_import_receipt"))}</strong><span>${escapeHtml(state.lorebookImportReceipt.text)}</span></div>` : ""}
        <div class="mail-items">${data.entries.map((entry) => lorebookEntry(entry)).join("")}</div>
        <div class="empty" data-lorebook-empty${data.entries.length ? " hidden" : ""}><strong>${escapeHtml(ui("lorebook_empty"))}</strong><p class="muted">${escapeHtml(ui("lorebook_empty_hint"))}</p></div>
        <div class="empty" data-lorebook-no-results hidden><strong>${escapeHtml(ui("lorebook_no_results"))}</strong><p class="muted">${escapeHtml(ui("lorebook_search_hint"))}</p></div>
        ${canManage ? `<footer class="actions entry-actions"><button class="button primary" type="button" data-lorebook-open="lorebook-entry-dialog" aria-haspopup="dialog">${navigationIcon("plus")}${escapeHtml(ui("lorebook_new_entry"))}</button></footer>` : ""}`
            : `<div class="empty">${navigationIcon("book-open")}<h3>${escapeHtml(ui("lorebook_no_books"))}</h3><p class="muted">${escapeHtml(ui("lorebook_no_books_hint"))}</p></div>`
        }
      </section>
      <article class="mail-detail" id="lorebook-editor-host" aria-label="${escapeHtml(ui("lorebook_entry_settings"))}"><p class="hint">${escapeHtml(ui("lorebook_select_entry"))}</p></article>
    </div>
    ${canManage && serverwide ? lorebookDialog("lorebook-create-dialog", ui("lorebook_new_book"), `<p class="hint">${escapeHtml(ui("lorebook_create_hint"))}</p><form class="stack" data-lorebook-form="book-create" data-settings-key="lorebook/books/new"><label class="field">${fieldLabel(ui("lorebook_book_name"))}<input name="name" maxlength="128" required autofocus></label>${lorebookDialogActions("lorebook-create-dialog", ui("lorebook_new_book"))}</form>`) + lorebookDialog("lorebook-import-new-dialog", ui("lorebook_import_new"), `<form class="stack" data-lorebook-import-form data-lorebook-import-new><label class="field">${fieldLabel(ui("lorebook_book_name"))}<input name="name" maxlength="128" required autofocus></label><label class="field">${fieldLabel(ui("lorebook_import"))}<input name="file" type="file" accept=".json,application/json" required></label>${lorebookDialogActions("lorebook-import-new-dialog", ui("lorebook_import"))}</form>`) : ""}
    ${
      book && canManage
        ? lorebookDialog(
            "lorebook-settings-dialog",
            ui("lorebook_settings_title").replace("{name}", () => book.name),
            `<p class="hint">${escapeHtml(ui("lorebook_settings_hint"))}</p>
      <label class="toggle"><span class="field-label">${escapeHtml(ui("lorebook_enabled"))}<small>${escapeHtml(ui("lorebook_collection_enabled_hint"))}</small></span><input type="checkbox" role="switch" data-lorebook-book-enabled${book.enabled ? " checked" : ""}></label>
      <form class="stack" data-lorebook-form="book-channels" data-settings-key="${scopeKey}/channels" data-original-channels="${escapeHtml(JSON.stringify(book.channel_disc_ids || []))}">${lorebookChannels(book.channel_disc_ids || [], true)}<div class="actions form-actions"><button class="button primary" type="submit">${escapeHtml(ui("lorebook_save_channels"))}</button></div></form>
      `,
          )
        : ""
    }
    ${canManage && available ? lorebookDialog("lorebook-entry-dialog", ui("lorebook_new_entry"), `<div class="row">${navigationIcon("book-open")}<dl class="meta-stack"><dt>${escapeHtml(ui(serverwide ? "lorebook_selected" : "lorebook_persona"))}</dt><dd dir="auto">${escapeHtml(name)}</dd></dl></div><p class="hint">${escapeHtml(ui("lorebook_new_entry_hint"))}</p><form class="stack" data-lorebook-form="create" data-settings-key="${scopeKey}/new" data-original-channels="[]"><label class="field">${fieldLabel(ui("lorebook_title"), ui("lorebook_title_hint"))}<input name="title" maxlength="128" required autofocus></label><label class="field">${fieldLabel(ui("lorebook_content"), ui("lorebook_content_hint"))}<textarea name="content" maxlength="4000" rows="6" required></textarea></label><label class="field">${fieldLabel(ui("lorebook_keys"), ui("lorebook_new_keys_hint"))}<textarea name="keys" rows="3"></textarea></label>${lineageId === 0 ? "" : lorebookChannels([], true)}${lorebookDialogActions("lorebook-entry-dialog", ui("lorebook_new_entry"))}</form>`) : ""}
    ${transfer}</div>`;
  }

  function activeLorebookLineage() {
    if (state.view === "lorebooks") return 0;
    return state.overview.personas.find((entry) => entry.personaId === state.personaId)?.lineageId;
  }

  async function lorebookSelectedChannels(form) {
    const inputs = [...form.querySelectorAll('input[name="channelDiscIds"]')];
    const original = JSON.parse(form.dataset.originalChannels || "[]");
    const selected = inputs.filter((input) => input.checked).map((input) => input.value);
    const changed = selected.length !== original.length || selected.some((id) => !original.includes(id));
    if (changed && inputs.some((input) => input.dataset.missingChannel !== undefined)) {
      if (!(await confirmAction(ui("lorebook_channels"), ui("lorebook_missing_channels")))) return null;
      return inputs
        .filter((input) => input.checked && input.dataset.missingChannel === undefined)
        .map((input) => input.value);
    }
    return selected;
  }

  function lorebookKeys(form, name) {
    const value = form.elements[name].value;
    const original = form.dataset.originalKeys ? JSON.parse(form.dataset.originalKeys) : null;
    return original && original.join("\n") === value
      ? original
      : value
          .split(/\r?\n/)
          .map((key) => key.trim())
          .filter(Boolean);
  }

  async function saveLorebookForm(form) {
    const lineageId = activeLorebookLineage();
    if (lineageId === undefined) return;
    const scope = lorebookScope(lineageId);
    const guildId = state.guildId;
    const target = document.querySelector("#lorebook-workspace");
    const kind = form.dataset.lorebookForm;
    if (kind === "book-rename") {
      const input = form.elements.name;
      const value = input.value.trim();
      const message = !value
        ? ui("lorebook_title_required")
        : state.lorebookData.books.some(
              (book) => book.lorebook_id !== scope.bookId && book.name.toLowerCase() === value.toLowerCase(),
            )
          ? ui("lorebook_title_duplicate")
          : "";
      const error = form.querySelector(".error");
      error.textContent = message;
      error.hidden = !message;
      input.setAttribute("aria-invalid", String(Boolean(message)));
      if (message) {
        input.focus();
        return;
      }
    }
    let path = "";
    let method = "PATCH";
    let payload;
    if (kind === "book-create" || kind === "book-rename") {
      path = kind === "book-create" ? "/books" : `/books/${scope.bookId}`;
      method = kind === "book-create" ? "POST" : "PATCH";
      payload = { name: form.elements.name.value };
    } else if (kind === "book-channels") {
      const channelDiscIds = await lorebookSelectedChannels(form);
      if (!channelDiscIds) return;
      path = `/books/${scope.bookId}`;
      payload = { channelDiscIds };
    } else if (kind === "content") {
      path = `/entries/${form.dataset.entryId}/content`;
      payload = { ...scope, title: form.elements.title.value, content: form.elements.content.value };
    } else if (kind === "keys") {
      path = `/entries/${form.dataset.entryId}/keys`;
      payload = { ...scope, keys: lorebookKeys(form, "keys") };
    } else if (kind === "constant") {
      path = `/entries/${form.dataset.entryId}/flags`;
      payload = { ...scope, flags: { [kind]: form.elements[kind].checked } };
    } else if (kind === "entry-channels") {
      const channelDiscIds = await lorebookSelectedChannels(form);
      if (!channelDiscIds) return;
      path = `/entries/${form.dataset.entryId}/channels`;
      payload = { ...scope, channelDiscIds };
    } else if (kind === "entry" || kind === "create") {
      const channelDiscIds = lineageId === 0 ? [] : await lorebookSelectedChannels(form);
      if (!channelDiscIds) return;
      path = kind === "create" ? "/entries" : `/entries/${form.dataset.entryId}`;
      method = kind === "create" ? "POST" : "PATCH";
      payload = {
        ...scope,
        title: form.elements.title.value,
        content: form.elements.content.value,
        keys: lorebookKeys(form, "keys"),
        channelDiscIds,
      };
    } else if (kind === "activation") {
      path = `/entries/${form.dataset.entryId}/activation`;
      payload = {
        ...scope,
        secondaryKeys: lorebookKeys(form, "secondaryKeys"),
        selectiveLogic: Number(form.elements.selectiveLogic.value),
        scanDepth: Number(form.elements.scanDepth.value),
        triggerChance: Number(form.elements.triggerChance.value),
        insertionOrder: Number(form.elements.insertionOrder.value),
      };
    } else return;
    if (
      !form.isConnected ||
      !lorebookCurrent(lineageId, target, guildId) ||
      (lineageId === 0 && (scope.bookId ?? null) !== state.lorebookBookId)
    )
      return;
    const enabled = kind === "content" ? form.elements.enabled.checked : null;
    const result = await withBusyForm(form, async () => {
      const response = await api(`/guilds/${guildId}/lorebooks${path}`, { method, body: JSON.stringify(payload) });
      if (kind === "content") {
        try {
          await api(`/guilds/${guildId}/lorebooks/entries/${form.dataset.entryId}/flags`, {
            method: "PATCH",
            body: JSON.stringify({ ...scope, flags: { enabled } }),
          });
        } catch {
          throw new Error(ui("lorebook_partial_save"));
        }
      }
      return response;
    });
    if (
      !lorebookCurrent(lineageId, target, guildId) ||
      (lineageId === 0 && (scope.bookId ?? null) !== state.lorebookBookId)
    )
      return;
    if (kind === "book-create" && result?.bookId) state.lorebookBookId = result.bookId;
    const dialog = form.closest("dialog");
    dialog?.close();
    completeFormSave(form);
    toast(ui("lorebook_saved"));
    await loadLorebooks(lineageId);
    if (dialog) {
      const selector =
        dialog.id === "lorebook-edit-dialog"
          ? `[data-lorebook-edit-entry="${form.dataset.entryId}"]`
          : lorebookDialogFocusTarget(dialog.id);
      document.querySelector(selector)?.focus({ preventScroll: true });
    } else if (form.dataset.entryId) {
      document
        .querySelector(`[data-lorebook-form="${kind}"][data-entry-id="${form.dataset.entryId}"] button[type="submit"]`)
        ?.focus({ preventScroll: true });
    } else if (kind === "book-rename")
      document.querySelector('[popovertarget="lorebook-book-actions"]')?.focus({ preventScroll: true });
  }

  async function importLorebook(form) {
    const lineageId = activeLorebookLineage();
    const file = form.elements.file.files[0];
    if (lineageId === undefined || !file) return;
    const guildId = state.guildId;
    const target = document.querySelector("#lorebook-workspace");
    const selectedBookId = state.lorebookBookId;
    const mode = form.hasAttribute("data-lorebook-import-new") ? "new" : form.elements.mode.value;
    const scope = mode === "new" ? { lineageId } : lorebookScope(lineageId);
    if (mode === "replace" && !(await confirmAction(ui("lorebook_replace"), ui("lorebook_replace_confirm")))) return;
    if (file.size > 2 * 1024 * 1024) throw new Error(ui("lorebook_import_too_large"));
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error(ui("lorebook_import_invalid"));
    }
    const body = JSON.stringify({
      ...scope,
      mode,
      ...(mode === "new" ? { name: form.elements.name.value } : {}),
      data,
    });
    if (new TextEncoder().encode(body).length > 2 * 1024 * 1024) throw new Error(ui("lorebook_import_too_large"));
    if (
      !form.isConnected ||
      !lorebookCurrent(lineageId, target, guildId) ||
      (lineageId === 0 && selectedBookId !== state.lorebookBookId)
    )
      return;
    const result = await withBusyForm(form, async () =>
      api(`/guilds/${guildId}/lorebooks/import`, { method: "POST", body }),
    );
    if (!lorebookCurrent(lineageId, target, guildId) || (lineageId === 0 && selectedBookId !== state.lorebookBookId))
      return;
    if (mode === "new") state.lorebookBookId = result.bookId;
    const report = result.report;
    const parts = [
      ...(result.added === undefined ? [] : [["lorebook_receipt_inserted", result.added]]),
      ["lorebook_receipt_skipped", (result.skipped || 0) + report.skippedEntries],
      ["lorebook_receipt_unsupported", report.unsupportedKeys],
      ["lorebook_receipt_ignored", report.ignoredEntries],
      ["lorebook_receipt_collapsed", report.collapsedPlacement],
    ];
    state.lorebookImportReceipt = {
      key: `lorebook/${lineageId}/${lineageId === 0 ? state.lorebookBookId || 0 : 0}`,
      text: parts.map(([key, count]) => `${ui(key)}: ${count}`).join(" / "),
    };
    const dialog = form.closest("dialog");
    dialog.close();
    toast(ui("lorebook_import_receipt"), "success");
    await loadLorebooks(lineageId);
    document.querySelector(lorebookDialogFocusTarget(dialog.id))?.focus({ preventScroll: true });
  }

  async function exportLorebook() {
    const lineageId = activeLorebookLineage();
    if (lineageId === undefined) return;
    const query = new URLSearchParams(
      Object.entries(lorebookScope(lineageId)).map(([key, value]) => [key, String(value)]),
    );
    const data = await api(`/guilds/${state.guildId}/lorebooks/export?${query}`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "lorebook.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const personaEntryDrafts = new Map();
  const personaEntryKey = (personaId, kind, index) => `${state.guildId}/${personaId}/${kind}/${index}`;

  function shiftPersonaEntryDrafts(personaId, kind, removedIndex) {
    const prefix = `${state.guildId}/${personaId}/${kind}/`;
    const entries = [...personaEntryDrafts.entries()].filter(([key]) => key.startsWith(prefix));
    for (const [key] of entries) personaEntryDrafts.delete(key);
    for (const [key, value] of entries) {
      const index = key.slice(prefix.length);
      if (index === "new") personaEntryDrafts.set(key, value);
      else if (Number(index) !== removedIndex)
        personaEntryDrafts.set(`${prefix}${Number(index) > removedIndex ? Number(index) - 1 : index}`, value);
    }
  }

  function renderPersonaSettings(persona) {
    const formHeader = (eyebrow, title, description) =>
      `<header class="panel-header"><div class="heading"><p class="eyebrow">${eyebrow}</p><h2>${title}</h2><p>${description}</p></div></header>`;
    const saveActions = `<footer class="actions form-actions entry-actions"><button class="button primary" type="submit">${escapeHtml(ui("persona_save"))}</button></footer>`;
    const attributes = persona.attributes || [];
    const dialogues = persona.sampleDialogues || [];
    return `<div class="workspace">
      <div class="stack">
        ${state.overview.canManage ? `<div id="persona-text-model" data-persona-id="${persona.personaId}"><p role="status">${escapeHtml(ui("persona_model_loading"))}</p></div>` : ""}
        <form class="panel" data-persona-id="${persona.personaId}" data-persona-section="identity">
          ${formHeader("Identity", "Display identity", "The name used by this persona in conversation.")}
          <label class="field">${fieldLabel("Nickname", "The name shown in messages, prompts, and dashboard views. A new name is also added as a trigger when room is available.")}<input name="nickname" value="${escapeHtml(persona.nickname)}" minlength="1" maxlength="100" required></label>
          ${saveActions}
        </form>

        <form class="panel" data-persona-id="${persona.personaId}" data-persona-section="prompt">
          ${formHeader("Conversation", "Triggers", "Names and phrases that can activate this persona in conversation.")}
          <label class="field">${fieldLabel("Trigger words", "Comma-separated names or phrases that can activate this persona.")}<input name="triggerWords" value="${escapeHtml((persona.triggerWords || []).join(", "))}"></label>
          ${saveActions}
        </form>

        <section class="panel" data-persona-id="${persona.personaId}">
          <header class="panel-header"><div class="heading"><p class="eyebrow">Character</p><h2>Attributes</h2></div><button class="button" type="button" data-entry-add="attribute">${escapeHtml(ui("persona_add_attribute"))}</button></header>
          <div class="entry-list">${attributes.map((attribute, index) => renderPersonaEntry(persona, "attribute", index, attribute)).join("")}${personaEntryDrafts.has(personaEntryKey(persona.personaId, "attribute", "new")) ? renderPersonaEntry(persona, "attribute", "new", { text: "", isPublic: false }) : ""}</div>
        </section>

        <section class="panel" data-persona-id="${persona.personaId}">
          <header class="panel-header"><div class="heading"><p class="eyebrow">Voice</p><h2>Sample dialogues</h2><p>Example exchanges teach the model how this persona tends to respond.</p></div><button class="button" type="button" data-entry-add="dialogue">${escapeHtml(ui("persona_add_dialogue"))}</button></header>
          <div class="entry-list">${dialogues.map((dialogue, index) => renderPersonaEntry(persona, "dialogue", index, dialogue)).join("")}${personaEntryDrafts.has(personaEntryKey(persona.personaId, "dialogue", "new")) ? renderPersonaEntry(persona, "dialogue", "new", { input: "", output: "" }) : ""}</div>
        </section>

        <form class="panel" data-persona-id="${persona.personaId}" data-persona-section="context">
          ${formHeader("Context", "Pinned context note", "Persistent context inserted at the configured depth.")}
          <label class="field">${fieldLabel("Context note", "Persona-specific context inserted into the assembled conversation.")}<textarea name="contextNote" rows="5">${escapeHtml(persona.contextNote || "")}</textarea></label>
          <label class="field">${fieldLabel("Depth", "How far back in the prompt the note is inserted.")}<input name="contextNoteDepth" type="number" min="0" max="100" value="${persona.contextNoteDepth || 0}"></label>
          ${saveActions}
        </form>

        ${
          persona.isAlter
            ? `<section class="panel" data-persona-id="${persona.personaId}">
                <header class="panel-header"><div class="heading"><p class="eyebrow">Danger zone</p><h2>Delete alter persona</h2><p>This removes the server's persona configuration. Memories remain governed by their own ownership and retention rules.</p></div>
                </header><button class="button danger hold-button persona-delete-button" type="button" data-hold data-persona-delete="${persona.personaId}" data-confirm-title="${escapeHtml(ui("persona_delete_title").replace("{name}", () => persona.nickname))}" data-confirm-description="${escapeHtml(ui("persona_delete_description"))}" aria-label="${escapeHtml(ui("persona_delete_title").replace("{name}", () => persona.nickname))}"><span>${escapeHtml(ui("control_hold_delete"))}</span></button>
              </section>`
            : ""
        }
      </div>
      ${renderPersonaTestChat(persona)}
    </div>`;
  }

  function renderPersonaEntry(persona, kind, index, saved) {
    const key = personaEntryKey(persona.personaId, kind, index);
    const draft = personaEntryDrafts.get(key);
    const value = draft || saved;
    const attributes = kind === "attribute";
    const fields = attributes
      ? `<label class="field"><span class="field-label">${escapeHtml(ui("persona_attribute"))}</span><textarea name="text" rows="2" required>${escapeHtml(value.text)}</textarea></label><label class="toggle"><span class="field-label">${escapeHtml(ui("persona_attribute_public"))}</span><input name="isPublic" type="checkbox" role="switch"${value.isPublic ? " checked" : ""}></label>`
      : `<label class="field"><span class="field-label">${escapeHtml(ui("persona_dialogue_user"))}</span><textarea name="input" rows="3" required>${escapeHtml(value.input)}</textarea></label><label class="field"><span class="field-label">${escapeHtml(persona.nickname)}</span><textarea name="output" rows="3" required>${escapeHtml(value.output)}</textarea></label>`;
    const read = attributes
      ? `<div class="entry-copy"><p class="read-text">${escapeHtml(saved.text)}</p>${saved.isPublic ? `<span class="entry-visibility">${navigationIcon("users-round")}<span>${escapeHtml(ui("persona_attribute_public"))}</span></span>` : ""}</div>`
      : `<dl class="dialogue-copy"><dt>${escapeHtml(ui("persona_dialogue_user"))}</dt><dd class="read-text" data-read-field="user">${escapeHtml(saved.input)}</dd><dt>${escapeHtml(persona.nickname)}</dt><dd class="read-text" data-read-field="persona">${escapeHtml(saved.output)}</dd></dl>`;
    return `<article class="inline-entry" data-entry-kind="${kind}" data-entry-index="${index}" data-persona-id="${persona.personaId}">${draft ? `<form class="entry-form" data-persona-entry-form>${fields}<div class="actions"><button class="button" type="button" data-entry-cancel>${escapeHtml(ui("persona_cancel"))}</button><button class="button primary" type="submit">${escapeHtml(ui("persona_save"))}</button></div></form>` : `<div class="entry-read">${read}<div class="entry-actions"><button class="button" type="button" data-entry-edit>${escapeHtml(ui("persona_edit"))}</button><button class="button icon danger" type="button" data-entry-delete aria-label="${escapeHtml(ui("persona_delete_entry"))}" data-tooltip="${escapeHtml(ui("persona_delete_entry"))}">${navigationIcon("trash-2")}</button></div></div>`}</article>`;
  }

  function renderPersonaTestChat(persona) {
    const chat = state.personaTestChats[persona.personaId] || [];
    return `<aside class="panel chat persona-test-panel" data-persona-id="${persona.personaId}">
        <header class="panel-header"><div class="heading"><p class="eyebrow">Private preview</p><h2>Test ${escapeHtml(persona.nickname)}</h2></div>
          <button class="button" type="button" data-test-chat-reset="${persona.personaId}"${chat.length ? "" : " disabled"}>Reset</button>
        </header>
        <div class="messages test-chat-messages" role="log" aria-live="polite">
          ${
            chat.length
              ? chat
                  .map((message) => {
                    const segments =
                      message.role === "assistant" && message.segments?.length
                        ? message.segments
                        : [{ content: message.content, sprite: null }];
                    return segments
                      .map(
                        (segment) => `<article class="bubble${message.role === "user" ? " user" : ""}">
                        ${
                          message.role === "user"
                            ? "<span>You</span>"
                            : `<div class="row">${personaAvatar(segment.sprite ? { nickname: segment.sprite.name, avatarUrl: segment.sprite.imageUrl } : persona)}<strong>${escapeHtml(segment.sprite?.displayName || persona.nickname)}</strong>${segment.sprite ? `<small>${escapeHtml(segment.sprite.name)}</small>` : ""}</div>`
                        }
                        <p>${escapeHtml(segment.content)}</p>
                      </article>`,
                      )
                      .join("");
                  })
                  .join("")
              : `<p class="hint">Start a clean test conversation.</p>`
          }
          ${state.personaTestChatBusy ? `<p class="hint" role="status">${escapeHtml(ui("persona_model_loading"))}</p>` : ""}
        </div>
        <form class="composer" id="persona-test-chat-form" data-persona-id="${persona.personaId}">
          <label class="sr-only" for="persona-test-input">Test message</label>
          <textarea id="persona-test-input" name="message" rows="3" maxlength="4000" placeholder="Message ${escapeHtml(persona.nickname)}..." required${state.personaTestChatBusy ? " disabled" : ""}></textarea>
          <div class="composer-footer"><span class="hint">${escapeHtml(ui("persona_test_configured_model"))}</span><button class="button primary" type="submit"${state.personaTestChatBusy ? " disabled" : ""}>Send</button></div>
        </form>
      </aside>`;
  }

  function renderPersonaAppearance(persona) {
    const formHeader = (eyebrow, title, description) =>
      `<header class="panel-header"><div class="heading"><p class="eyebrow">${eyebrow}</p><h2>${title}</h2><p>${description}</p></div></header>`;
    const saveActions = `<footer class="actions form-actions entry-actions"><button class="button primary" type="submit">${escapeHtml(ui("persona_save"))}</button></footer>`;

    return `<div class="stack">
      <section class="panel" data-persona-id="${persona.personaId}">
        <header class="panel-header"><div class="heading"><p class="eyebrow">Portrait</p><h2>Persona avatar</h2><p>${persona.isAlter ? "Used by this persona's webhook messages." : "Updates TomoriBot's server-specific Discord avatar."}</p></div></header>
        <div class="media-settings"><div class="media-item"><label class="avatar-upload media-upload" data-upload-zone>
          ${personaAvatar(persona, "avatar")}
          <span class="media-overlay">Change avatar</span>
          <input id="persona-avatar-file-${persona.personaId}" data-persona-avatar-file="${persona.personaId}" type="file" accept=".png,.jpg,.jpeg,.gif,image/png,image/jpeg,image/gif" aria-label="Change avatar">
        </label><button class="button" type="button" data-persona-avatar-remove="${persona.personaId}">Remove</button></div></div>
      </section>
        <form class="panel" data-persona-id="${persona.personaId}" data-persona-section="prompt">
          ${formHeader("Image generation", "Visual character prompt", "A visual description Tomori can also use when generating images. This is not the persona's main conversation prompt.")}
          <label class="field">${fieldLabel("Visual description", "Describe the character's stable visual identity, clothing, features, and other image-generation details.")}<textarea name="personaPrompt" rows="10">${escapeHtml(persona.personaPrompt || "")}</textarea></label>
          ${saveActions}
        </form>
        <form class="panel" data-persona-id="${persona.personaId}" data-persona-section="appearance">
          ${formHeader("Image generation", "Appearance tags", "Reusable visual traits added when this persona appears in generated images.")}
          <label class="field">${fieldLabel("Physical appearance tags", "Comma-separated visual traits reused when generating this persona.")}<input name="physicalAppearanceTags" value="${escapeHtml((persona.physicalAppearanceTags || []).join(", "))}"></label>
          ${saveActions}
        </form>
    </div>`;
  }

  function renderPersonaNaming(persona) {
    const { values, copy, maxLength } = state.overview.personaNaming;
    const preference = values[persona.personaId] || {};
    return `<form class="panel" data-persona-naming="${persona.personaId}">
      <header class="panel-header"><div class="heading"><h2>${escapeHtml(copy.title)}</h2><p>${escapeHtml(copy.description)}</p></div></header>
      <p class="hint">${escapeHtml(copy.hint)}</p>
      <div class="grid">${["nickname", "prefix", "suffix"]
        .map((key) => {
          const value = preference[key];
          const mode = value == null ? "inherit" : value === "" && key !== "nickname" ? "none" : "custom";
          return `<fieldset class="stack"><legend>${escapeHtml(copy[key])}</legend>
          <label class="field"><span class="sr-only">${escapeHtml(copy[key])}</span><select name="${key}Mode" data-naming-mode="${key}">
            ${["inherit", "custom", ...(key === "nickname" ? [] : ["none"])].map((option) => `<option value="${option}"${mode === option ? " selected" : ""}>${escapeHtml(copy[option])}</option>`).join("")}
          </select></label>
          <label class="field"><span class="field-label">${escapeHtml(copy.value)}</span><input name="${key}" maxlength="${maxLength}" value="${escapeHtml(value ?? "")}" required${mode === "custom" ? "" : " disabled"}></label>
        </fieldset>`;
        })
        .join("")}</div>
      <div class="actions"><button class="button" type="submit" name="action" value="reset" formnovalidate>${escapeHtml(copy.reset)}</button><button class="button primary" type="submit">${escapeHtml(copy.save)}</button></div>
    </form>`;
  }

  function renderStmCategories() {
    const { values, copy } = state.overview.settings.stmCategories;
    return `<form class="panel stack settings-panel is-wide" id="stm-categories-form">
      <div class="panel-header"><div class="heading"><h2>${escapeHtml(copy.title)}</h2><p>${escapeHtml(copy.description)}</p></div></div>
      <p class="hint">${escapeHtml(copy.hint)}</p>
      <div class="stack">${Array.from({ length: 5 }, (_, index) => {
        const category = values[index];
        return `<fieldset class="stack" data-stm-slot><legend class="sr-only">${escapeHtml(copy.label)} ${index + 1}</legend>
          <label class="field">${fieldLabel(`${copy.label} ${index + 1}`)}<input name="label${index}" maxlength="997" value="${escapeHtml(category?.label ?? "")}"></label>
          <label class="field">${fieldLabel(copy.categoryDescription)}<textarea name="description${index}" rows="2" maxlength="997" data-auto-grow>${escapeHtml(category?.description ?? "")}</textarea></label>
        </fieldset>`;
      }).join("")}</div>
      <p class="hint">${escapeHtml(copy.warning)}</p>
      <div class="actions form-actions"><button class="button " type="submit" name="action" value="reset" formnovalidate>${escapeHtml(copy.reset)}</button><button class="button primary" type="submit">${escapeHtml(copy.save)}</button></div>
    </form>`;
  }

  function renderPersonaPicker(personas, selectedId) {
    return `<dialog id="persona-picker-dialog" class="wide" aria-labelledby="persona-picker-title"><header class="panel-header"><div class="heading"><h2 id="persona-picker-title">${escapeHtml(ui("persona_choose"))}</h2></div><button class="button icon" type="button" data-persona-picker-close aria-label="${escapeHtml(ui("persona_cancel"))}">${navigationIcon("x")}</button></header><div class="stack"><label class="field"><span class="field-label sr-only">${escapeHtml(ui("persona_search"))}</span><input type="search" data-persona-picker-search placeholder="${escapeHtml(ui("persona_search"))}"></label><div class="persona-picker-grid">
      ${personas.map((entry) => `<button class="persona-choice" type="button" data-persona-search="${escapeHtml(entry.nickname.toLowerCase())}" data-persona-select="${entry.personaId}" aria-pressed="${entry.personaId === selectedId}">${personaAvatar(entry, "avatar")}<span><strong>${escapeHtml(entry.nickname)}</strong><small>${entry.isAlter ? "Alter" : "Main"} / #${entry.lineageId}</small></span></button>`).join("")}
    </div></div></dialog>`;
  }

  function renderPersonaWorkspace(workspace) {
    const personas = (state.overview.personas || []).filter((persona) => persona.lineageId !== 0);
    const personaActions = state.overview.canManage
      ? `<button class="button secondary" type="button" data-persona-import-open>Import</button>
         <button class="button primary" type="button" data-persona-create-open>New persona</button>`
      : "";
    if (!personas.length) {
      workspace.innerHTML = `${pageHeader("Persona workspace", "Personas", "Create or import an identity for this server.", personaActions)}
        <div class="empty"><strong>No personas are available in this server.</strong></div>`;
      return;
    }
    if (!personas.some((persona) => persona.personaId === state.personaId)) {
      state.personaId = personas[0].personaId;
    }
    if (!state.overview.canManage && ["settings", "appearance", "sprites"].includes(state.personaPanel)) {
      state.personaPanel = "personal";
    }

    const persona = personas.find((entry) => entry.personaId === state.personaId) || personas[0];
    const memoryPanel = ["personal", "server"].includes(state.personaPanel);
    if (memoryPanel) {
      state.memoryKind = state.personaPanel === "server" ? "server" : "personal";
      state.lineageId = persona.lineageId;
    }

    workspace.innerHTML = `
      ${pageHeader(
        "Persona workspace",
        "Personas",
        "Choose an identity, then work with the memories and settings that belong to its lineage.",
        personaActions,
      )}
      ${renderPersonaPicker(personas, persona.personaId)}
      <section class="persona-focus" data-glow>
        ${persona.avatarUrl ? `<div class="persona-atmosphere" aria-hidden="true"><img src="${escapeHtml(persona.avatarUrl)}" alt=""></div>` : ""}
        <div class="persona-identity"><p class="eyebrow">${persona.isAlter ? "Alter persona" : "Main persona"}</p><h2>${escapeHtml(persona.nickname)}</h2><button class="button persona-picker-trigger" type="button" data-persona-picker-open aria-haspopup="dialog">${escapeHtml(ui("persona_choose"))}${navigationIcon("arrow-up-down")}</button></div>
        <div class="persona-art">${persona.avatarUrl ? `<img src="${escapeHtml(persona.avatarUrl)}" alt="${escapeHtml(persona.nickname)}" data-avatar-fallback="${escapeHtml(persona.nickname.slice(0, 1))}">` : personaAvatar(persona)}</div>
      </section>
        <nav class="tabs" aria-label="${escapeHtml(persona.nickname)} workspace" role="tablist">
          <button type="button" role="tab" aria-selected="${state.personaPanel === "personal"}" data-persona-panel="personal">Personal memory</button>
          <button type="button" role="tab" aria-selected="${state.personaPanel === "server"}" data-persona-panel="server">Server knowledge</button>
          <button type="button" role="tab" aria-selected="${state.personaPanel === "lorebook"}" data-persona-panel="lorebook">${escapeHtml(ui("lorebooks"))}</button>
          <button type="button" role="tab" aria-selected="${state.personaPanel === "preferences"}" data-persona-panel="preferences">${escapeHtml(state.overview.personaNaming.copy.tab)}</button>
          ${
            state.overview.canManage
              ? `<button type="button" role="tab" aria-selected="${state.personaPanel === "settings"}" data-persona-panel="settings">Persona settings</button>
                 <button type="button" role="tab" aria-selected="${state.personaPanel === "appearance"}" data-persona-panel="appearance">Appearance &amp; image prompt</button>
                 <button type="button" role="tab" aria-selected="${state.personaPanel === "sprites"}" data-persona-panel="sprites">${escapeHtml(ui("sprites"))}</button>`
              : ""
          }
        </nav>
      <div class="persona-panel-content">
        ${
          state.personaPanel === "lorebook"
            ? `<div id="lorebook-workspace"></div>`
            : state.personaPanel === "preferences"
              ? renderPersonaNaming(persona)
              : state.personaPanel === "settings"
                ? renderPersonaSettings(persona)
                : state.personaPanel === "appearance"
                  ? renderPersonaAppearance(persona)
                  : state.personaPanel === "sprites"
                    ? `<div class="workspace"><section id="sprite-workspace"><p role="status">${escapeHtml(ui("sprite_loading"))}</p></section>${renderPersonaTestChat(persona)}</div>`
                    : renderMemoryCollection({
                        personal: state.personaPanel === "personal",
                        persona,
                      })
        }
      </div>`;

    if (state.personaPanel === "lorebook") {
      loadLorebooks(persona.lineageId);
    } else if (memoryPanel) {
      loadMemories();
    } else if (state.personaPanel === "sprites") {
      loadSprites(persona.personaId);
    } else {
      resizeAutoGrowTextareas(workspace);
      if (state.personaPanel === "settings" && state.overview.canManage) loadPersonaTextModel(persona.personaId);
    }
  }

  let personaModelLoadVersion = 0;

  async function loadPersonaTextModel(personaId) {
    const version = ++personaModelLoadVersion;
    const guildId = state.guildId;
    const target = document.querySelector("#persona-text-model");
    if (!target) return;
    const current = () =>
      version === personaModelLoadVersion &&
      guildId === state.guildId &&
      personaId === state.personaId &&
      state.view === "personas" &&
      state.personaPanel === "settings" &&
      document.querySelector("#persona-text-model") === target;
    try {
      const data = await api(`/guilds/${guildId}/personas/${personaId}/text-model`);
      if (!current()) return;
      const available = data.options.some((option) => option.id === data.selected);
      const unavailable =
        data.selected !== null && !available
          ? `<option value="${data.selected}" selected disabled>${escapeHtml(ui("persona_model_unavailable"))}</option>`
          : "";
      const options = data.options
        .map(
          (option) =>
            `<option value="${option.id}"${option.id === data.selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
        )
        .join("");
      target.innerHTML = `<form class="panel" data-persona-text-model="${personaId}">
        <header class="panel-header"><div class="heading"><h2>${escapeHtml(ui("persona_model_title"))}</h2><p>${escapeHtml(ui("persona_model_hint"))}</p></div></header>
        <label class="field"><span class="field-label">${escapeHtml(ui("persona_model_label"))}</span><select name="modelId"><option value=""${data.selected === null ? " selected" : ""}>${escapeHtml(ui("persona_model_inherit"))}</option>${unavailable}${options}</select></label>
        <footer class="actions form-actions entry-actions"><button class="button primary" type="submit">${escapeHtml(ui("persona_model_save"))}</button></footer>
      </form>`;
      enhanceDashboard(target);
    } catch {
      if (current()) target.innerHTML = `<p role="alert">${escapeHtml(ui("persona_model_failed"))}</p>`;
    }
  }

  async function savePersonaTextModel(form) {
    const personaId = Number(form.dataset.personaTextModel);
    const guildId = state.guildId;
    const value = form.elements.modelId.value;
    await withBusyForm(form, async () => {
      await api(`/guilds/${guildId}/personas/${personaId}/text-model`, {
        method: "PUT",
        body: JSON.stringify({ modelId: value ? Number(value) : null }),
      });
    });
    toast(ui("persona_model_saved"));
    if (guildId === state.guildId && personaId === state.personaId && state.personaPanel === "settings") {
      await loadPersonaTextModel(personaId);
    }
  }

  let spriteLoadVersion = 0;

  function setSpriteFieldError(input, message) {
    const prior = input.getAttribute("aria-describedby");
    if (prior) document.getElementById(prior)?.remove();
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    if (!message) return;
    const id = `sprite-name-error-${crypto.randomUUID()}`;
    const error = document.createElement("small");
    error.id = id;
    error.className = "error";
    error.textContent = message;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", id);
    input.after(error);
  }

  async function loadSprites(personaId) {
    const version = ++spriteLoadVersion;
    const guildId = state.guildId;
    const current = () =>
      version === spriteLoadVersion &&
      guildId === state.guildId &&
      personaId === state.personaId &&
      state.view === "personas" &&
      state.personaPanel === "sprites";
    try {
      const data = await api(`/guilds/${guildId}/personas/${personaId}/sprites`);
      if (!current()) return;
      const root = document.querySelector("#sprite-workspace");
      const editor = (sprite) => {
        const key = personaEntryKey(personaId, "sprite", sprite?.key || "new");
        const draft = personaEntryDrafts.get(key);
        const value = draft || sprite || {};
        const image = draft?.preview || sprite?.imageUrl;
        return `<form class="sprite-card" data-sprite-form novalidate data-persona-id="${personaId}" ${sprite ? `data-sprite-key="${escapeHtml(sprite.key)}"` : ""}>
          <div class="sprite-image" ${draft ? "data-upload-zone" : ""}>${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(value.name || "")}" data-sprite-image><span hidden>${escapeHtml(ui("sprite_image_missing"))}</span>` : ""}${draft ? `<label class="media-upload sprite-image-upload"><span class="media-overlay">${escapeHtml(ui("sprite_file"))}</span><input type="file" name="file" accept="image/png,image/jpeg,image/gif,.png,.jpg,.jpeg,.gif" aria-label="${escapeHtml(ui("sprite_file"))}"></label>` : ""}</div>
          ${
            draft
              ? `<div class="entry-form sprite-form"><label class="field">${fieldLabel(ui("sprite_name"), ui("sprite_name_hint"))}<input name="name" maxlength="${data.limits.name}" value="${escapeHtml(value.name || "")}" required></label>
          <label class="field">${fieldLabel(ui("sprite_instructions"), ui("sprite_instructions_hint"))}<textarea name="instructions" maxlength="${data.limits.instructions}" rows="3">${escapeHtml(value.instructions || "")}</textarea></label>
          <label class="toggle"><span class="field-label">${escapeHtml(ui("sprite_identity"))}<small>${escapeHtml(ui("sprite_identity_hint"))}</small></span><input type="checkbox" role="switch" name="identity" ${value.identity ? "checked" : ""}></label>
          <div class="sprite-actions"><button class="button" type="button" data-sprite-cancel>${escapeHtml(ui("persona_cancel"))}</button><button class="button primary" type="submit">${escapeHtml(ui("persona_save"))}</button></div></div>`
              : `<div class="sprite-copy"><h3>${escapeHtml(sprite.name)}</h3><p class="hint read-text">${escapeHtml(sprite.instructions || "")}</p></div><div class="sprite-actions"><button class="button" type="button" data-sprite-edit>${escapeHtml(ui("persona_edit"))}</button><button class="button danger hold-button" type="button" data-hold data-sprite-remove data-confirm-title="${escapeHtml(ui("sprite_remove_title"))}" data-confirm-description="${escapeHtml(ui("sprite_remove_detail"))}"><span>${escapeHtml(ui("control_hold_delete"))}</span></button></div>`
          }
        </form>`;
      };
      root.innerHTML = `<section class="panel"><header class="panel-header"><div class="heading"><h2>${escapeHtml(ui("sprites"))} <small>${data.sprites.length} / ${data.limits.count}</small></h2><p>${escapeHtml(ui("sprites_hint"))}</p></div><div class="actions"><button class="button" type="button" popovertarget="sprite-actions">${navigationIcon("ellipsis")}${escapeHtml(ui("sprite_actions"))}</button><div id="sprite-actions" class="action-menu" popover aria-label="${escapeHtml(ui("sprite_actions"))}"><button class="button" type="button" data-sprite-new>${escapeHtml(ui("sprite_add"))}</button><button type="button" class="button" data-sprite-import>${escapeHtml(ui("sprite_import"))}</button><button type="button" class="button" data-sprite-export ${data.sprites.length ? "" : "disabled"}>${escapeHtml(ui("sprite_export"))}</button></div><input type="file" accept=".zip,application/zip" data-sprite-archive hidden></div></header>
        ${data.inherited ? `<p class="hint">${escapeHtml(ui("sprite_inherited"))}</p>` : ""}
        ${data.sprites.length ? "" : `<p class="hint">${escapeHtml(ui("sprite_empty"))}</p>`}
        <div class="entry-list sprite-grid">${data.sprites.map(editor).join("")}${personaEntryDrafts.has(personaEntryKey(personaId, "sprite", "new")) ? editor(null) : ""}</div></section>`;
      root._sprites = data.sprites;
      window.TomoriControls?.enhance(root);
    } catch (error) {
      if (!current()) return;
      document.querySelector("#sprite-workspace").innerHTML =
        `<div class="empty"><strong>${escapeHtml(ui("sprite_load_failed"))}</strong><span>${escapeHtml(error.message)}</span><button class="button secondary" type="button" data-sprite-retry>${escapeHtml(ui("sprite_retry"))}</button></div>`;
    }
  }

  function selectOptions(field, value) {
    if (field.type === "persona") {
      return `<option value="">None</option>${state.overview.personas
        .map(
          (persona) =>
            `<option value="${persona.personaId}"${Number(value) === persona.personaId ? " selected" : ""}>${escapeHtml(persona.nickname)}</option>`,
        )
        .join("")}`;
    }
    if ((field.key === "thought_log_channel_disc_id" || field.key === "welcome_channel_disc_id") && !field.options) {
      return `<option value="">None</option>${state.overview.channels
        .map(
          (channel) =>
            `<option value="${channel.id}"${String(value) === channel.id ? " selected" : ""}>${escapeHtml(channel.parentName ? `${channel.parentName} / ${channel.name}` : channel.name)}</option>`,
        )
        .join("")}`;
    }
    return (field.options || [])
      .map(
        (option) =>
          `<option value="${escapeHtml(option.value)}"${String(value) === String(option.value) ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
      )
      .join("");
  }

  function renderSettingField(field, value) {
    if (field.type === "toggle") {
      return `<label class="toggle span-all"><span class="field-label"><strong>${escapeHtml(field.label)}</strong>${field.hint ? `<small>${escapeHtml(field.hint)}</small>` : ""}</span>
        <input name="${escapeHtml(field.key)}" type="checkbox"${value ? " checked" : ""}></label>`;
    }
    if (field.type === "textarea") {
      return `<label class="field span-all">${fieldLabel(field.label, field.hint)}<textarea name="${escapeHtml(field.key)}" rows="5">${escapeHtml(value ?? "")}</textarea></label>`;
    }
    if (field.type === "channels") {
      const selected = new Set(Array.isArray(value) ? value.map(String) : []);
      const options = state.overview.channels
        .map(
          (channel) =>
            `<label class="choice"><input type="checkbox" name="${escapeHtml(field.key)}" value="${channel.id}"${selected.has(channel.id) ? " checked" : ""}><span><strong>#${escapeHtml(channel.name)}</strong>${channel.parentName ? `<small>${escapeHtml(channel.parentName)}</small>` : ""}</span></label>`,
        )
        .join("");
      return `<fieldset class="field span-all choice-field"><legend>${escapeHtml(field.label)}</legend>${field.hint ? `<p class="hint">${escapeHtml(field.hint)}</p>` : ""}<div class="grid">${options || '<p class="hint">No text channels are available.</p>'}</div></fieldset>`;
    }
    if (field.type === "multiselect") {
      const notices = field.key === "tool_notice_hidden_keys";
      const selected = new Set(Array.isArray(value) ? value.map(String) : []);
      const options = (field.options || [])
        .map((option) =>
          notices
            ? `<label class="toggle span-all"><span class="field-label"><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.description)}</small></span><input type="checkbox" role="switch" name="${escapeHtml(field.key)}" value="${escapeHtml(option.value)}"${selected.has(String(option.value)) ? " checked" : ""}></label>`
            : `<label class="choice"><input type="checkbox" name="${escapeHtml(field.key)}" value="${escapeHtml(option.value)}"${selected.has(String(option.value)) ? " checked" : ""}><span><strong>${escapeHtml(option.label)}</strong>${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}</span></label>`,
        )
        .join("");
      return `<fieldset class="field span-all choice-field" data-setting-field="${escapeHtml(field.key)}"><legend>${escapeHtml(field.label)}</legend>${field.hint ? `<p class="hint">${escapeHtml(field.hint)}</p>` : ""}<div class="${notices ? "stack" : "grid"}">${options}</div></fieldset>`;
    }
    if (field.type === "select" || field.type === "persona") {
      return `<label class="field">${fieldLabel(field.label, field.hint)}<select name="${escapeHtml(field.key)}">${selectOptions(field, value)}</select></label>`;
    }
    if (field.type === "number") {
      return `<label class="field">${fieldLabel(field.label, field.hint)}<input name="${escapeHtml(field.key)}" type="number" min="${field.min}" max="${field.max}" step="${field.step || 1}" value="${value ?? ""}"${field.nullable ? "" : " required"}></label>`;
    }
    return `<label class="field span-all">${fieldLabel(field.label, field.hint)}<input name="${escapeHtml(field.key)}" value="${escapeHtml(Array.isArray(value) ? value.join(", ") : (value ?? ""))}"></label>`;
  }

  function renderSettingsPanel(panel) {
    const settings = state.overview.settings;
    const sectionById = new Map(settings.catalog.map((section) => [section.id, section]));
    const sources = (panel.sources || [{ section: panel.section, fields: panel.fields }]).flatMap((source) => {
      const section = sectionById.get(source.section);
      if (!section) return [];
      const fields = source.fields
        ? source.fields.flatMap((key) => {
            const field = section.fields.find((candidate) => candidate.key === key);
            return field ? [field] : [];
          })
        : section.fields;
      return [{ section, fields }];
    });
    if (!sources.length) return "";
    const primarySection = sectionById.get(panel.section) || sources[0].section;
    const title = panel.titleKey ? ui(panel.titleKey) : panel.title || primarySection.title;
    const description = panel.descriptionKey
      ? ui(panel.descriptionKey)
      : panel.description || primarySection.description;
    const panelKey = sources
      .map(({ section, fields }) => `${section.id}:${fields.map((field) => field.key).join("+")}`)
      .join("/");
    return `<form class="panel stack settings-panel${panel.wide ? " is-wide" : ""}" data-settings-key="${escapeHtml(panelKey)}" data-settings-sections="${sources.map((source) => source.section.id).join(",")}" data-settings-panel-title="${escapeHtml(title)}">
        <div class="panel-header"><div class="heading"><p class="eyebrow">${escapeHtml(panel.eyebrow || primarySection.eyebrow)}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div></div>
        <div class="grid">
          ${sources
            .flatMap(({ section, fields }) =>
              fields.map((field) => renderSettingField(field, settings.values[section.id]?.[field.key])),
            )
            .join("")}
        </div>
        <div class="actions form-actions"><button class="button primary" type="submit">Save changes</button></div>
      </form>`;
  }

  function renderSettings(workspace) {
    if (!state.overview.settings) {
      workspace.innerHTML = `<div class="empty"><strong>Manage Server permission required.</strong></div>`;
      return;
    }
    const activeGroup = settingsGroups.find((group) => group.id === state.settingsGroup) || settingsGroups[0];
    const settingsContent = `<div class="columns">
      ${activeGroup.panels.map(renderSettingsPanel).join("")}
      ${activeGroup.id === "memory" ? renderStmCategories() : ""}
    </div>`;
    workspace.innerHTML = `
      ${pageHeader(
        "Administration",
        "Server settings",
        ui("settings_hint"),
        refreshButton("overview", ui("refresh_all")),
      )}
      <nav class="tabs" aria-label="Server settings groups">
        ${settingsGroups
          .map(
            (group) =>
              `<button class="settings-tab${group.id === activeGroup.id ? " is-active" : ""}" type="button" aria-current="${group.id === activeGroup.id ? "page" : "false"}" data-settings-group="${group.id}">${escapeHtml(group.labelKey ? ui(group.labelKey) : group.label)}</button>`,
          )
          .join("")}
      </nav>
      ${settingsContent}`;
    resizeAutoGrowTextareas(workspace);
  }

  function openChannelMemorySettings() {
    if (!state.overview.canManage) return;
    document.querySelectorAll("dialog[open]").forEach((dialog) => {
      dialog.close();
    });
    state.view = "settings";
    state.settingsGroup = "memory";
    renderShell();
    const input = document.querySelector('[name="channel_memory_enabled"]');
    input?.scrollIntoView({ block: "center" });
    input?.focus({ preventScroll: true });
  }

  function providerChoiceOptions(data) {
    return (data.choices || [])
      .map((choice) => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.name)}</option>`)
      .join("");
  }

  function renderEndpointRows(data) {
    if (!data.endpoints?.length) {
      return `<p class="hint">No custom endpoints.</p>`;
    }
    return data.endpoints
      .map(
        (endpoint) => `<article class="subsection">
          <div class="row">
            <div class="heading"><p class="eyebrow">${escapeHtml(endpoint.capability)} / ${escapeHtml(endpoint.apiStyle)}</p><h3>${escapeHtml(endpoint.displayName)}</h3><small>${escapeHtml(endpoint.endpointUrl)}</small></div>
          </div>
          ${endpoint.modelName ? `<p>${escapeHtml(endpoint.modelName)}</p>` : ""}
          <div class="row">
            ${endpoint.requiresAuth ? "<span>Auth</span>" : ""}
            ${endpoint.hasTools ? "<span>Tools</span>" : ""}
            ${endpoint.seesImages ? "<span>Vision</span>" : ""}
            ${endpoint.supportsStructOutput ? "<span>Structured output</span>" : ""}
          </div>
        </article>`,
      )
      .join("");
  }

  function renderOpenRouterRows(data, scope) {
    if (!data.openRouterModels?.length) {
      return `<p class="hint">${escapeHtml(ui("connection_no_models"))}</p>`;
    }
    return data.openRouterModels
      .map(
        (model) => `<article class="panel-header">
          <div class="heading"><span class="eyebrow">${escapeHtml(model.capability)}</span><h3>${escapeHtml(model.codename)}</h3></div>
          <div class="actions"><button class="button danger" type="button" data-openrouter-delete="${escapeHtml(model.codename)}" data-openrouter-capability="${escapeHtml(model.capability)}" data-provider-scope="${scope}" data-tooltip="${escapeHtml(ui("connection_remove_registration_hint"))}">${escapeHtml(ui("connection_remove_registration"))}</button></div>
        </article>`,
      )
      .join("");
  }

  function renderServerModels(data) {
    const workspace = data.models;
    if (!workspace) return "";
    const fields = [
      ["text", "Primary text model", "Used for normal server conversations.", false],
      ["vision", "Vision model", "Used when the primary text model cannot inspect images.", true],
      ["embedding", "Embedding model", "Creates and searches vectors for memories and documents.", false],
      ["image", "Image model", "Default model for standard image generation providers.", true],
      ["imageNai", "NovelAI image model", "Dedicated model used by the NovelAI image pipeline.", true],
      ["video", "Video model", "Default model used for video generation.", false],
    ];
    const renderOptions = (kind, allowNone) => {
      const selected = workspace.selected?.[kind] ?? null;
      const noneLabel = selected === null && !allowNone ? "Not configured" : "Disabled";
      const none = allowNone || selected === null ? `<option value="">${noneLabel}</option>` : "";
      const options = (workspace.options?.[kind] || [])
        .map(
          (option) =>
            `<option value="${option.id}"${option.id === selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
        )
        .join("");
      return `${none}${options}`;
    };
    return `<form class="panel stack provider-panel server-model-panel" id="server-models-form">
      <div class="panel-header"><div class="heading"><p class="eyebrow">Server defaults</p><h2>Primary models</h2><p>Global model choices used unless a persona, channel, or personal provider overrides them.</p></div></div>
      <div class="grid">
        ${fields
          .map(
            ([kind, label, description, allowNone]) =>
              `<label class="field">${fieldLabel(label, description)}<select name="${kind}"${kind === "text" ? " required" : ""}>${renderOptions(kind, allowNone)}</select></label>`,
          )
          .join("")}
      </div>
      <div class="actions"><button class="button primary" type="submit">Save primary models</button></div>
    </form>`;
  }

  function renderPersonalModels(data) {
    if (!data.models) return "";
    return `<form class="panel stack provider-panel server-model-panel" data-personal-model>
      <div class="panel-header"><div class="heading"><p class="eyebrow">${escapeHtml(ui("model_routing"))}</p><h2>${escapeHtml(ui("personal_models"))}</h2><p>${escapeHtml(ui("personal_models_hint"))}</p></div></div>
      <div class="grid">
        ${["text", "vision", "embedding", "image", "image_nai", "video", "speech_design", "speech_clone"]
          .map((capability) => {
            const model = data.models[capability];
            const selected = model.selected;
            const hasSelected =
              selected &&
              model.options.some((option) => option.id === selected.id && option.provider === selected.provider);
            const placeholder = selected && !hasSelected ? "personal_model_unavailable" : "personal_model_choose";
            const options = model.options
              .map((option) => {
                const value = JSON.stringify({ provider: option.provider, modelId: option.id });
                return `<option value="${escapeHtml(value)}"${selected && option.id === selected.id && option.provider === selected.provider ? " selected" : ""}>${escapeHtml(option.label)}</option>`;
              })
              .join("");
            const original = hasSelected ? JSON.stringify({ provider: selected.provider, modelId: selected.id }) : "";
            return `<label class="field">${fieldLabel(ui(`model_${capability}`), selected && !model.enabled ? ui("personal_model_disabled") : undefined)}<select name="${capability}" data-original-model="${escapeHtml(original)}"${model.options.length ? "" : " disabled"}><option value="" disabled${hasSelected ? "" : " selected"}>${escapeHtml(ui(placeholder))}</option>${options}</select></label>`;
          })
          .join("")}
      </div>
      <div class="actions"><button class="button primary" type="submit">${escapeHtml(ui("personal_model_save"))}</button></div>
    </form>`;
  }

  async function savePersonalModel(form) {
    const changed = [...form.querySelectorAll("select[data-original-model]")].filter(
      (field) => !field.disabled && field.value && field.value !== field.dataset.originalModel,
    );
    if (!changed.length) return;
    await withBusyForm(form, async () => {
      for (const field of changed) {
        const value = field.value;
        await api(`/guilds/${state.guildId}/providers/personal/model`, {
          method: "PATCH",
          body: JSON.stringify({ capability: field.name, ...JSON.parse(value) }),
        });
        field.dataset.originalModel = value;
      }
    });
    toast(ui("personal_model_saved"));
    await refreshProviders("personal");
  }

  const personalParameterFields = [
    ["temperature", 0, 2, "any"],
    ["top_p", 0, 1, "any"],
    ["top_k", 0, 256, 1],
    ["frequency_penalty", -2, 2, "any"],
    ["presence_penalty", -2, 2, "any"],
    ["min_p", 0, 1, "any"],
    ["max_output_tokens", 1, 131072, 1],
  ];

  function renderPersonalParameters(data, scope = "personal") {
    const parameters = data.parameters || [];
    return `<section class="panel provider-panel">
      <div class="panel-header"><div class="heading"><p class="eyebrow">${escapeHtml(ui("connection_provider"))}</p><h2>${escapeHtml(ui(`${scope}_parameters`))}</h2><p>${escapeHtml(ui(`${scope}_parameters_hint`))}</p></div></div>
      ${
        parameters.length
          ? parameters
              .map(
                (
                  provider,
                ) => `<form class="stack" data-personal-parameters="${escapeHtml(provider.provider)}" data-provider-scope="${scope}">
        <h3>${escapeHtml(provider.displayName)}</h3>
        <div class="grid">
          ${personalParameterFields.map(([key, min, max, step]) => `<label class="field">${fieldLabel(ui(`parameter_${key}`))}<input type="number" name="${key}" min="${min}" max="${max}" step="${step}" value="${provider[key] ?? ""}" placeholder="${escapeHtml(ui("parameter_unset"))}"></label>`).join("")}
          <label class="field">${fieldLabel(ui("parameter_thinking_level"))}<select name="thinking_level">
            <option value="" disabled${provider.thinking_level == null ? " selected" : ""}>${escapeHtml(ui("parameter_unset"))}</option>
            ${["auto", "none", "minimal", "low", "medium", "high"].map((value) => `<option value="${value}"${provider.thinking_level === value ? " selected" : ""}>${escapeHtml(ui(`thinking_${value}`))}</option>`).join("")}
          </select></label>
        </div>
        <div class="actions"><button class="button primary" type="submit">${escapeHtml(ui("personal_parameters_save"))}</button></div>
      </form>`,
              )
              .join("")
          : `<p class="hint">${escapeHtml(ui("personal_parameters_empty"))}</p>`
      }
    </section>`;
  }

  async function savePersonalParameters(form) {
    const scope = form.dataset.providerScope;
    const patch = Object.fromEntries(
      personalParameterFields.map(([key]) => {
        const value = form.elements[key].value;
        return [key, value === "" ? null : Number(value)];
      }),
    );
    if (form.elements.thinking_level.value) patch.thinking_level = form.elements.thinking_level.value;
    await withBusyForm(form, async () => {
      await api(`/guilds/${state.guildId}/providers/${scope}/parameters`, {
        method: "PATCH",
        body: JSON.stringify({ provider: form.dataset.personalParameters, patch }),
      });
    });
    toast(ui(`${scope}_parameters_saved`));
    await refreshProviders(scope);
  }

  function renderFallbacks(data, scope) {
    const personal = scope === "personal";
    const selected = personal ? data.models?.text?.selected : data.models?.selected?.text;
    const primary = personal
      ? data.models?.text?.options?.find(
          (option) => option.id === selected?.id && option.provider === selected?.provider,
        )
      : data.models?.options?.text?.find((option) => option.id === selected);
    const primaryLabel = primary?.label || ui(selected ? "personal_model_unavailable" : "personal_model_unassigned");
    const lastFilled = (data.fallbackRefs || []).reduce((last, ref, index) => (ref ? index : last), -1);
    const profile = state.overview.profile;
    return `<section class="panel provider-panel"><form id="fallback-form" data-provider-scope="${scope}" data-original-fallbacks="${escapeHtml(JSON.stringify((data.fallbackRefs || []).filter(Boolean)))}">
      <div class="panel-header"><div class="heading"><p class="eyebrow">Failover</p><h2>${escapeHtml(ui(scope === "personal" ? "personal_fallbacks" : "server_fallbacks"))}</h2><p>${escapeHtml(ui(scope === "personal" ? "personal_fallbacks_hint" : "server_fallbacks_hint"))}</p>${data.randomizerEnabled ? `<p>${escapeHtml(ui("fallback_randomizer_hint"))}</p>` : ""}</div></div>
      <ol class="chain">
        <li>${fieldLabel(ui("fallback_primary"))}<strong>${escapeHtml(primaryLabel)}</strong>${personal && selected && !data.models.text.enabled ? `<small>${escapeHtml(ui("personal_model_disabled"))}</small>` : ""}</li>
        ${[0, 1, 2, 3, 4]
          .map((index) => {
            const selected = data.fallbackRefs?.[index];
            const value = selected ? `${selected.type}:${selected.id}` : "";
            const options = (data.fallbackOptions || [])
              .map((option) => {
                const key = `${option.ref.type}:${option.ref.id}`;
                return `<option value="${key}"${key === value ? " selected" : ""}>${escapeHtml(option.label)}</option>`;
              })
              .join("");
            const unavailable =
              value && !(data.fallbackOptions || []).some((option) => `${option.ref.type}:${option.ref.id}` === value)
                ? `<option value="${value}" selected>${escapeHtml(ui("fallback_unavailable"))} (${escapeHtml(value)})</option>`
                : "";
            return `<li data-fallback-slot${index > lastFilled + 1 ? " hidden" : ""}><label class="field">${fieldLabel(`Fallback ${index + 1}`)}<select name="fallback-${index}"><option value="">None</option>${unavailable}${options}</select></label></li>`;
          })
          .join("")}
      </ol>
      ${personal ? `<div class="subsection"><label class="toggle"><span class="field-label"><strong>${escapeHtml(profile.copy.serverFallback)}</strong><small>${escapeHtml(profile.copy.serverFallbackHint)}</small></span><input name="personal_server_fallback_enabled" type="checkbox" data-original-value="${profile.personalServerFallback}"${profile.personalServerFallback ? " checked" : ""}></label></div>` : ""}
      <div class="actions form-actions"><button class="button primary" type="submit">${escapeHtml(ui("save"))}</button></div>
    </form></section>`;
  }

  async function saveFallbacks(form) {
    if (form.classList.contains("is-saving")) return;
    const scope = form.dataset.providerScope;
    const refs = [0, 1, 2, 3, 4].flatMap((index) => {
      const value = form.elements[`fallback-${index}`].value;
      if (!value) return [];
      const [type, id] = value.split(":");
      return [{ type, id: Number(id) }];
    });
    const serialized = JSON.stringify(refs);
    const serverFallback = form.elements.personal_server_fallback_enabled;
    const enabled = serverFallback?.checked;
    const saveChain = serialized !== form.dataset.originalFallbacks;
    const saveServerFallback = scope === "personal" && String(enabled) !== serverFallback.dataset.originalValue;
    if (!saveChain && !saveServerFallback) return;
    const saved = [];
    const failed = [];
    await withBusyForm(form, async () => {
      if (saveChain) {
        try {
          await api(`/guilds/${state.guildId}/providers/${scope}/fallbacks`, {
            method: "PATCH",
            body: JSON.stringify({ refs }),
          });
          form.dataset.originalFallbacks = serialized;
          state.providerData[scope].fallbackRefs = refs;
          saved.push(ui("fallback_chain_saved"));
        } catch (error) {
          failed.push(`${ui("fallback_chain_save_failed")} ${error.message}`);
        }
      }
      if (saveServerFallback) {
        try {
          const result = await api("/profile", {
            method: "PATCH",
            body: JSON.stringify({ personal_server_fallback_enabled: enabled }),
          });
          state.overview.profile = result.profile;
          serverFallback.dataset.originalValue = String(enabled);
          saved.push(ui("fallback_server_saved"));
        } catch (error) {
          failed.push(`${ui("fallback_server_save_failed")} ${error.message}`);
        }
      }
    });
    if (failed.length) {
      throw Object.assign(new Error([...saved, ...failed].join(" ")), { partial: saved.length > 0 });
    }
    toast(ui("fallback_saved"));
    await refreshProviders(scope);
  }

  function providerConnections(data) {
    const endpoints = data.endpoints || [];
    const providers = (data.providers || []).filter(
      (provider) => !endpoints.some((endpoint) => endpoint.provider === provider.provider),
    );
    const endpointGroups = new Map();
    for (const endpoint of endpoints) {
      const group = endpointGroups.get(endpoint.provider) || [];
      group.push(endpoint);
      endpointGroups.set(endpoint.provider, group);
    }
    return [
      ...providers.map((provider) => ({
        key: `provider:${provider.provider}`,
        provider,
        endpoint: null,
        name: provider.displayName,
      })),
      ...Array.from(endpointGroups, ([name, group]) => ({
        key: `endpoint:${name}`,
        endpoint: group[0],
        endpoints: group,
        provider: (data.providers || []).find((provider) => provider.provider === name),
        name: group[0].displayName,
      })),
    ];
  }

  function selectProviderConnection(data, scope) {
    const connections = providerConnections(data);
    const connection =
      connections.find((entry) => entry.key === state.providerConnection[scope]) || connections[0] || null;
    state.providerConnection[scope] = connection?.key || null;
    return { connections, connection };
  }

  function renderConnectionModels(data, scope, provider) {
    if (!provider || provider.startsWith("custom:")) return "";
    const kinds =
      scope === "personal"
        ? ["text", "vision", "embedding", "image", "image_nai", "video", "speech_design", "speech_clone"]
        : ["text", "vision", "embedding", "image", "imageNai", "video"];
    const groups = kinds
      .map((kind) => {
        const options = scope === "personal" ? data.models?.[kind]?.options : data.models?.options?.[kind];
        const models = (options || []).filter((option) => option.provider === provider);
        if (!models.length) return "";
        const key = kind === "imageNai" ? "image_nai" : kind;
        return `<tr><th scope="row">${escapeHtml(ui(`model_${key}`))}</th><td>${models.map((model) => escapeHtml(model.label)).join(", ")}</td></tr>`;
      })
      .join("");
    return `<div class="subsection stack"><h3>${escapeHtml(ui("connection_available_models"))}</h3>${groups ? `<div class="table-wrap"><table><tbody>${groups}</tbody></table></div>` : `<p>${escapeHtml(ui("connection_no_available_models"))}</p>`}</div>`;
  }

  function renderConnectionDetail(data, scope, connection) {
    if (!connection)
      return `<div class="hint"><strong>${escapeHtml(ui("connection_empty"))}</strong><p>${escapeHtml(ui("connection_select"))}</p></div>`;
    const provider = connection.provider;
    const endpoint = connection.endpoint;
    const providerName = provider?.provider || endpoint?.provider;
    const parameters = (data.parameters || []).filter((entry) => entry.provider === providerName);
    const canReplace = provider && !endpoint && !provider.provider.startsWith("custom:");
    const canRemove = endpoint || (scope === "personal" && provider && !provider.provider.startsWith("custom:"));
    const menuId = `connection-actions-${scope}`;
    const actions =
      canReplace || canRemove
        ? `<button class="button icon" type="button" popovertarget="${menuId}" aria-label="${escapeHtml(ui("connection_actions"))}" data-tooltip="${escapeHtml(ui("connection_actions"))}">${navigationIcon("ellipsis")}</button><div id="${menuId}" class="action-menu" popover aria-label="${escapeHtml(ui("connection_actions"))}">${canReplace ? `<button class="button" type="button" data-provider-open="${escapeHtml(provider.provider)}">${escapeHtml(ui("connection_replace_key"))}</button>` : ""}${endpoint ? `<button class="button danger" type="button" data-endpoint-delete="${endpoint.id}" data-provider-scope="${scope}">Remove connection</button>` : canRemove ? `<button class="button danger" type="button" data-provider-delete="${escapeHtml(provider.provider)}">Remove</button>` : ""}</div>`
        : "";
    return `<div class="${parameters.length || providerName?.toLowerCase() === "openrouter" ? "grid" : "stack"}">
      <section class="panel provider-panel"><header class="panel-header"><div class="heading"><h2>${escapeHtml(connection.name)}</h2>${provider ? `<small>${provider.hasApiKey ? "Encrypted key stored" : "No key stored"}</small>` : ""}</div><div class="actions">${actions}</div></header>${endpoint ? renderEndpointRows({ endpoints: connection.endpoints }) : ""}${renderConnectionModels(data, scope, providerName)}${providerName?.toLowerCase() === "openrouter" ? `<div class="subsection stack"><h3>${escapeHtml(ui("connection_registered_models"))}</h3>${renderOpenRouterRows(data, scope)}</div>` : ""}</section>
      <div class="stack">
      ${
        providerName?.toLowerCase() === "openrouter"
          ? `<section class="panel provider-panel">
        <div class="panel-header"><div class="heading"><p class="eyebrow">${escapeHtml(ui("connection_provider"))}</p><h2>${escapeHtml(ui("connection_models"))}</h2><p>${escapeHtml(ui("connection_models_hint"))}</p></div></div>
        <form id="openrouter-form" data-provider-scope="${scope}">
          <div class="grid"><label class="field">${fieldLabel("Capability", "Determines which Tomori model selector may use this registration.")}<select name="capability"><option value="text">Text</option><option value="embedding">Embeddings</option><option value="image">Images</option><option value="video">Video</option><option value="decision">Decision</option></select></label>
          <label class="field">${fieldLabel("Model codename", "Exact OpenRouter identifier, usually in provider/model-name format.")}<input name="modelName" placeholder="provider/model-name" maxlength="240" required></label></div>
          <div class="actions"><button class="button primary" type="submit">${escapeHtml(ui("connection_register_model"))}</button></div>
        </form>
      </section>`
          : ""
      }
      ${parameters.length ? renderPersonalParameters({ parameters }, scope) : ""}
      </div>
    </div>`;
  }

  function renderProviders(workspace, scope) {
    const data = state.providerData[scope];
    const personal = scope === "personal";
    if (!data) {
      workspace.innerHTML = `${pageHeader(personal ? "Personal" : "Administration", personal ? "My providers" : "Server providers", "Loading provider configuration.")}<div class="notice info"><span></span>Loading providers</div>`;
      loadProviderWorkspace(scope);
      return;
    }
    const { connections, connection } = selectProviderConnection(data, scope);

    workspace.innerHTML = `
      ${pageHeader(
        personal ? "Personal" : "Administration",
        personal ? "My providers" : "Server providers",
        personal
          ? data.byokRequired
            ? "This server requires personal provider credentials."
            : "Your encrypted credentials and active personal capabilities."
          : "Server-owned credentials, endpoints, registrations, and failover.",
        refreshButton("provider", ui("refresh_providers"), scope),
      )}
      <nav class="tabs" aria-label="${escapeHtml(personal ? "My providers" : "Server providers")}">${[
        ["connections", "connections"],
        ["models", "primary_models"],
        ["fallbacks", "connection_fallbacks"],
      ]
        .map(
          ([id, key]) =>
            `<button type="button" aria-selected="${state.providerPanel[scope] === id}" aria-current="${state.providerPanel[scope] === id ? "page" : "false"}" data-provider-panel="${id}" data-provider-scope="${scope}">${escapeHtml(ui(key))}</button>`,
        )
        .join("")}</nav>
      <section class="stack" aria-label="${escapeHtml(ui("connections"))}"${state.providerPanel[scope] === "connections" ? "" : " hidden"}>
        <div class="row provider-toolbar">
        ${connections.length ? `<nav class="tabs" aria-label="${escapeHtml(ui("connections"))}">${connections.map((entry) => `<button type="button" data-connection-select="${escapeHtml(entry.key)}" data-provider-scope="${scope}" aria-selected="${entry.key === connection?.key}">${escapeHtml(entry.name)}</button>`).join("")}</nav>` : ""}
        <div class="actions"><button class="button secondary" type="button" data-provider-open aria-haspopup="dialog">${escapeHtml(ui("add_provider"))}</button><button class="button secondary" type="button" data-endpoint-open aria-haspopup="dialog">${escapeHtml(ui("endpoint_register_new"))}</button></div>
        </div>${renderConnectionDetail(data, scope, connection)}
      </section>
      <section class="stack" aria-label="${escapeHtml(ui("model_routing"))}"${state.providerPanel[scope] === "models" ? "" : " hidden"}>${personal ? renderPersonalModels(data) : renderServerModels(data)}${personal ? "" : renderSettingsPanel({ section: "byok" })}</section>
      <section class="stack" aria-label="${escapeHtml(ui("connection_fallbacks"))}"${state.providerPanel[scope] === "fallbacks" ? "" : " hidden"}>${renderFallbacks(data, scope)}</section>
      <dialog id="provider-dialog"  aria-labelledby="provider-dialog-title">
        <form class="stack" id="provider-credential-form" data-provider-scope="${scope}">
          <div class="panel-header"><div class="heading"><p class="eyebrow">${escapeHtml(ui("connections"))}</p><h2 id="provider-dialog-title">${escapeHtml(ui("add_provider"))}</h2></div></div>
          <label class="field">${fieldLabel("Provider", "Service this credential belongs to and the capabilities it may unlock.")}<select name="provider">${providerChoiceOptions(data)}</select></label><label class="field">${fieldLabel("API key", "Stored encrypted. Existing secret values are never returned to the browser.")}<input name="apiKey" type="password" autocomplete="new-password" minlength="10" required></label>
          <label class="toggle"><span class="field-label">Validate before saving<small>Tests the credential with its provider before replacing the stored key.</small></span><input name="validateApiKey" type="checkbox" role="switch" checked></label>
          <div class="actions"><button class="button" type="button" data-dialog-close="provider-dialog">${escapeHtml(ui("endpoint_cancel"))}</button><button class="button primary" type="submit">Store encrypted key</button></div>
        </form>
      </dialog>
      <dialog id="endpoint-dialog" class="wide" aria-labelledby="endpoint-dialog-title">
        <form class="stack" id="endpoint-form" data-provider-scope="${scope}">
          <div class="panel-header"><div class="heading"><p class="eyebrow">Custom</p><h2 id="endpoint-dialog-title">${escapeHtml(ui("endpoint_register_new"))}</h2></div></div>
          <div class="grid">
            <label class="field">${fieldLabel("Internal label", "Stable letters, numbers, underscores, or dashes used to identify this endpoint.")}<input name="label" pattern="[A-Za-z0-9_-]+" maxlength="48" required></label>
            <label class="field span-all">${fieldLabel("Endpoint URL", "Base URL Tomori connects to. It is tested before registration.")}<input name="endpointUrl" type="url" required></label>
            <label class="field">${fieldLabel("Capability", "Type of generation or processing this connection provides.")}<select name="capability">
              <option value="text">Text</option><option value="embedding">Embeddings</option><option value="image">Images</option><option value="video">Video</option><option value="speech">Speech</option><option value="transcription">Transcription</option>
            </select></label>
            <label class="field">${fieldLabel("API style", "Protocol and request format implemented by the endpoint.")}<select name="apiStyle">
              <option value="openai-compatible">OpenAI compatible</option><option value="comfyui">ComfyUI</option><option value="ollama-native">Ollama native</option><option value="elevenlabs">ElevenLabs</option><option value="elevenlabs-transcription">ElevenLabs transcription</option><option value="tts-clone">TTS clone</option><option value="openai-compatible-transcription">OpenAI transcription</option>
            </select></label>
            <label class="field">${fieldLabel("Model name", "Optional model identifier sent to endpoints that host more than one model.")}<input name="modelName" maxlength="180"></label>
            <label class="field">${fieldLabel("Auth token", "Optional bearer token or API secret, stored encrypted.")}<input name="authToken" type="password" autocomplete="new-password"></label>
            <label class="field">${fieldLabel("Context size", "Maximum context window reported for this text model, in tokens.")}<input name="numCtx" type="number" min="512" max="2000000"></label>
          </div>
          <fieldset class="subsection">
            <legend>${escapeHtml(ui("endpoint_features"))}</legend>
            <p class="hint">${escapeHtml(ui("endpoint_features_hint"))}</p>
            <div class="grid">
            ${[
              ["hasTools", "endpoint_tools"],
              ["seesImages", "endpoint_images"],
              ["seesVideos", "endpoint_videos"],
              ["supportsStructOutput", "endpoint_structured"],
              ["strictRoleAlternation", "endpoint_roles"],
              ["supportsPrefixCompletion", "endpoint_prefix"],
            ]
              .map(
                ([name, key]) =>
                  `<label class="toggle"><span class="field-label">${escapeHtml(ui(key))}<small>${escapeHtml(ui(`${key}_hint`))}</small></span><input name="${name}" type="checkbox" role="switch"></label>`,
              )
              .join("")}
            </div>
          </fieldset>
          <div class="actions"><button class="button" type="button" data-dialog-close="endpoint-dialog">${escapeHtml(ui("endpoint_cancel"))}</button><button class="button primary" type="submit">Test and register</button></div>
        </form>
      </dialog>`;
  }

  const providerLoadVersion = { personal: 0, server: 0 };

  async function loadProviderWorkspace(scope, notify = false) {
    const version = ++providerLoadVersion[scope];
    const guildId = state.guildId;
    const current = () => version === providerLoadVersion[scope] && guildId === state.guildId;
    try {
      const data = await api(`/guilds/${guildId}/providers/${scope}`);
      if (!current()) return false;
      state.providerData[scope] = data;
      const expectedView = scope === "personal" ? "personal-providers" : "server-providers";
      if (state.view === expectedView) renderView();
      if (notify) toast("Providers refreshed");
      return true;
    } catch (error) {
      if (!current()) return false;
      toast(error.message, "error");
      const workspace = document.querySelector("#workspace");
      const expectedView = scope === "personal" ? "personal-providers" : "server-providers";
      if (workspace && state.view === expectedView)
        workspace.innerHTML = `<div class="empty"><strong>${escapeHtml(error.message)}</strong></div>`;
      return false;
    }
  }

  function collectSettingsPatch(form, section) {
    const patch = {};
    for (const field of section.fields) {
      const input = form.elements.namedItem(field.key);
      if (field.type === "channels" || field.type === "multiselect") {
        const choices = form.querySelectorAll(`input[type="checkbox"][name="${field.key}"]`);
        if (choices.length > 0) {
          patch[field.key] = Array.from(choices)
            .filter((option) => option.checked)
            .map((option) => option.value);
        }
        continue;
      }
      if (!input) continue;
      if (field.type === "toggle") patch[field.key] = input.checked;
      else if (field.type === "number")
        patch[field.key] = input.value === "" && field.nullable ? null : Number(input.value);
      else if (field.type === "persona") patch[field.key] = input.value === "" ? null : Number(input.value);
      else if (field.type === "select" && (field.key.endsWith("_disc_id") || field.nullable)) {
        patch[field.key] = input.value === "" ? null : input.value;
      } else if (field.type === "select") {
        const option = field.options?.find((entry) => String(entry.value) === input.value);
        patch[field.key] = typeof option?.value === "number" ? Number(input.value) : input.value;
      } else if (field.type === "tags") patch[field.key] = parseTags(input.value);
      else patch[field.key] = input.value === "" && field.nullable ? null : input.value;
    }
    return patch;
  }

  async function selectGuild(guildId) {
    state.guildId = guildId;
    state.overview = null;
    state.memoryData = null;
    state.providerData = { personal: null, server: null };
    state.providerConnection = { personal: null, server: null };
    state.lorebookBookId = null;
    state.lorebookData = null;
    state.lorebookImportReceipt = null;
    state.serverStats = null;
    state.serverStatsLoading = false;
    state.serverStatsError = "";
    state.lineageId = 0;
    state.personaId = 0;
    state.personaPanel = "personal";
    state.personaTestChats = {};
    state.personaTestChatBusy = false;
    renderBootScreen();
    try {
      state.overview = await api(`/guilds/${guildId}/overview`);
      renderShell();
    } catch (error) {
      app.innerHTML = `<main class="login-screen"><div class="login-brand"><img src="/settings/assets/tomori_companion_logo.svg" alt="TomoriBot" class="login-logo"><h1>This server could not be loaded.</h1><p class="login-copy">${escapeHtml(error.message)}</p><button class="button secondary" id="retry-boot">Retry</button></div></main>`;
      document.querySelector("#retry-boot")?.addEventListener("click", () => selectGuild(guildId));
    }
  }

  async function refreshOverview(message = "Dashboard refreshed", discardKeys = []) {
    const overview = await api(`/guilds/${state.guildId}/overview`);
    discardKeys.forEach((key) => {
      drafts.delete(key);
    });
    state.overview = overview;
    renderShell();
    toast(message);
  }

  function confirmAction(title, message) {
    const dialog = document.querySelector("#confirm-dialog");
    if (!dialog?.showModal) return Promise.resolve(window.confirm(message));
    dialog.querySelector("#confirm-title").textContent = title;
    dialog.querySelector("#confirm-message").textContent = message;
    dialog.returnValue = "cancel";
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    });
  }

  async function deleteMemory(memoryId) {
    if (!(await confirmAction("Delete memory?", "This removes the memory immediately and cannot be undone."))) return;
    try {
      await api(`/guilds/${state.guildId}/memories/${state.memoryKind}/${memoryId}?lineageId=${state.lineageId}`, {
        method: "DELETE",
      });
      toast("Memory deleted");
      await loadMemories();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function refreshProviders(scope, message) {
    const guildId = state.guildId;
    state.providerData[scope] = null;
    if (scope === "server") {
      const overview = await api(`/guilds/${guildId}/overview`);
      if (guildId !== state.guildId) return;
      state.overview = overview;
    }
    const loaded = await loadProviderWorkspace(scope);
    if (loaded && message) toast(message);
  }

  async function deleteProvider(provider) {
    if (!(await confirmAction("Remove provider?", "The encrypted personal provider profile will be deleted."))) return;
    try {
      await api(`/guilds/${state.guildId}/providers/personal/${encodeURIComponent(provider)}`, {
        method: "DELETE",
      });
      await refreshProviders("personal", "Provider removed");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function deleteEndpoint(scope, endpointId) {
    if (
      !(await confirmAction(
        "Remove connection?",
        "This removes the endpoint connection and all models registered on it. Active text providers must be changed first.",
      ))
    )
      return;
    try {
      await api(`/guilds/${state.guildId}/providers/${scope}/endpoints/${endpointId}`, {
        method: "DELETE",
      });
      await refreshProviders(scope, "Endpoint removed");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function deleteOpenRouter(scope, capability, modelName) {
    if (!(await confirmAction(ui("connection_remove_registration_title"), ui("connection_remove_registration_hint")))) {
      return;
    }
    try {
      await api(`/guilds/${state.guildId}/providers/${scope}/openrouter`, {
        method: "DELETE",
        body: JSON.stringify({ capability, modelName }),
      });
      await refreshProviders(scope, ui("connection_registration_removed"));
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function withBusyForm(form, action) {
    if (form.classList.contains("is-saving")) return;
    savingForms += 1;
    const controls = Array.from(form.querySelectorAll("button, input, select, textarea"));
    const disabledStates = controls.map((control) => control.disabled);
    const focused = form.contains(document.activeElement) ? document.activeElement : null;
    const submit = focused?.matches('button[type="submit"]')
      ? focused
      : form.querySelector('button[type="submit"]:not([value="reset"])');
    const submitLabel = submit?.textContent;
    if (submit && state.overview) submit.textContent = ui("saving");
    controls.forEach((control) => {
      control.disabled = true;
    });
    form.classList.add("is-saving");
    form.setAttribute("aria-busy", "true");
    try {
      return await action();
    } finally {
      controls.forEach((control, index) => {
        control.disabled = disabledStates[index];
      });
      form.classList.remove("is-saving");
      form.removeAttribute("aria-busy");
      if (submit) submit.textContent = submitLabel;
      if (focused?.isConnected) focused.focus({ preventScroll: true });
      savingForms -= 1;
    }
  }

  function openMemoryEditor(memoryId) {
    const memory = state.memoryData?.memories?.find((entry) => entry.id === memoryId);
    const dialog = document.querySelector("#memory-dialog");
    if (!memory || !dialog?.showModal) return;
    const form = dialog.querySelector("#memory-edit-form");
    form.elements.content.value = memory.content;
    form.elements.tags.value = (memory.tags || []).join(", ");
    form.querySelector("[data-memory-tags]").hidden = state.memoryKind !== "personal";
    form.elements.memoryId.value = memory.id;
    dialog.showModal();
  }

  async function exportMemories() {
    try {
      const data = await api(
        `/guilds/${state.guildId}/memories/export?kind=${state.memoryKind}&lineageId=${state.lineageId}`,
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tomoribot-${state.memoryKind}-memories-${state.lineageId}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast("Memory export created");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function importMemories(file) {
    try {
      const data = JSON.parse(await file.text());
      const memoriesPayload = Array.isArray(data) ? data : data.memories;
      if (!Array.isArray(memoriesPayload)) throw new Error("This file does not contain a memory list.");
      const result = await api(`/guilds/${state.guildId}/memories/import`, {
        method: "POST",
        body: JSON.stringify({
          kind: state.memoryKind,
          lineageId: state.lineageId,
          memories: memoriesPayload.map((entry) => (typeof entry === "string" ? { content: entry, tags: [] } : entry)),
        }),
      });
      const summary = `Imported ${result.inserted}; duplicates ${result.skipped}; invalid ${result.invalid}; failed ${result.failed}`;
      toast(summary, result.failed ? "error" : result.invalid || !result.inserted ? "warning" : "success");
      await loadMemories();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function refreshPersonas(personaId, message) {
    if (message) toast(message);
    state.overview = await api(`/guilds/${state.guildId}/overview`);
    if (personaId && state.overview.personas.some((persona) => persona.personaId === personaId)) {
      state.personaId = personaId;
    }
    state.avatarRevision += 1;
    renderView();
  }

  function resizeAutoGrowTextarea(textarea) {
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    textarea.rows = 1;
    const styles = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
    const padding = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0);
    textarea.rows = Math.max(3, Math.ceil((textarea.scrollHeight - padding) / lineHeight));
  }

  function resizeAutoGrowTextareas(root = document) {
    root.querySelectorAll("textarea[data-auto-grow]").forEach(resizeAutoGrowTextarea);
  }

  function scrollTestChat() {
    requestAnimationFrame(() => {
      const messages = document.querySelector(".test-chat-messages");
      if (messages) messages.scrollTop = messages.scrollHeight;
    });
  }

  function updatePersonaTestChat(personaId) {
    const panel = document.querySelector(`.persona-test-panel[data-persona-id="${personaId}"]`);
    const persona = state.overview?.personas.find((entry) => entry.personaId === personaId);
    if (panel && persona) {
      panel.outerHTML = renderPersonaTestChat(persona);
      scrollTestChat();
    }
  }

  async function removePersonaAvatar(personaId) {
    if (!(await confirmAction("Remove avatar?", "The persona will return to its default avatar."))) return;
    try {
      await api(`/guilds/${state.guildId}/personas/${personaId}/avatar`, { method: "DELETE" });
      await refreshPersonas(personaId, "Avatar removed");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function removePersona(personaId) {
    const persona = state.overview.personas.find((entry) => entry.personaId === personaId);
    if (!persona) return;
    try {
      await api(`/guilds/${state.guildId}/personas/${personaId}`, { method: "DELETE" });
      delete state.personaTestChats[personaId];
      state.personaId = 0;
      await refreshPersonas(0, "Persona deleted");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function removeDialogue(personaId, index) {
    if (!(await confirmAction("Delete sample dialogue?", "This example will be removed from the persona."))) return;
    try {
      await api(`/guilds/${state.guildId}/personas/${personaId}/dialogues/${index}`, { method: "DELETE" });
      shiftPersonaEntryDrafts(personaId, "dialogue", index);
      await refreshPersonas(personaId, "Sample dialogue deleted");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  document.addEventListener(
    "error",
    (event) => {
      const image = event.target;
      if (image instanceof HTMLImageElement && image.hasAttribute("data-sprite-image")) {
        image.hidden = true;
        image.nextElementSibling.hidden = false;
        return;
      }
      if (!(image instanceof HTMLImageElement) || !image.dataset.avatarFallback) return;
      const fallback = document.createElement("span");
      fallback.className = `${image.className} persona-avatar-fallback`;
      fallback.textContent = image.dataset.avatarFallback;
      image.replaceWith(fallback);
    },
    true,
  );

  matchMedia("(max-width: 800px)").addEventListener("change", () => {
    document.querySelector("#navigation-sheet[open]")?.close();
  });

  document.addEventListener(
    "close",
    (event) => {
      if (event.target.id !== "navigation-sheet") return;
      const sidebar = event.target.querySelector(".sidebar");
      if (sidebar) document.querySelector(".sidebar-rail").append(sidebar);
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    const historyPoint = event.target.closest?.("[data-history-index]");
    if (historyPoint && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      selectHistoryPoint(historyPoint);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const input = event.target instanceof Element ? event.target.closest("#persona-test-input") : null;
    if (!input || input.disabled || state.personaTestChatBusy) return;
    event.preventDefault();
    input.form?.requestSubmit();
  });

  document.addEventListener("dragover", (event) => {
    const zone = event.target.closest?.("[data-upload-zone]");
    if (!zone?.querySelector('input[type="file"]')) return;
    event.preventDefault();
    zone.classList.add("is-dragging");
  });

  document.addEventListener("dragleave", (event) => {
    const zone = event.target.closest?.("[data-upload-zone]");
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("is-dragging");
  });

  document.addEventListener("drop", (event) => {
    const zone = event.target.closest?.("[data-upload-zone]");
    const input = zone?.querySelector('input[type="file"]');
    if (!input) return;
    event.preventDefault();
    zone.classList.remove("is-dragging");
    const file = event.dataTransfer?.files[0];
    if (!file || !["image/png", "image/jpeg", "image/gif"].includes(file.type)) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  document.addEventListener("input", (event) => {
    const lighting = event.target.closest("[data-light-setting]");
    if (lighting?.validity.valid) {
      appearance.lighting[appearance.theme][lighting.dataset.lightSetting] = Number(lighting.value);
      saveAppearance();
      return;
    }
    captureDraft(event.target.closest(draftForms));
    if (event.target.matches("[data-persona-picker-search]")) {
      const query = event.target.value.trim().toLowerCase();
      document.querySelectorAll("[data-persona-search]").forEach((choice) => {
        choice.hidden = !choice.dataset.personaSearch.includes(query);
      });
    }
    const entryForm = event.target.closest("[data-persona-entry-form]");
    if (entryForm) {
      const entry = entryForm.closest("[data-entry-kind]");
      const key = personaEntryKey(entry.dataset.personaId, entry.dataset.entryKind, entry.dataset.entryIndex);
      personaEntryDrafts.set(
        key,
        entry.dataset.entryKind === "attribute"
          ? { text: entryForm.elements.text.value, isPublic: entryForm.elements.isPublic.checked }
          : { input: entryForm.elements.input.value, output: entryForm.elements.output.value },
      );
    }
    const spriteForm = event.target.closest("[data-sprite-form]");
    if (spriteForm?.elements.name) {
      if (event.target === spriteForm.elements.name) setSpriteFieldError(event.target, "");
      const key = personaEntryKey(spriteForm.dataset.personaId, "sprite", spriteForm.dataset.spriteKey || "new");
      const draft = personaEntryDrafts.get(key);
      if (draft)
        Object.assign(draft, {
          name: spriteForm.elements.name.value,
          instructions: spriteForm.elements.instructions.value,
          identity: spriteForm.elements.identity.checked,
        });
    }
    if (event.target.matches('[data-lorebook-form="book-rename"] input[name="name"]')) {
      event.target.removeAttribute("aria-invalid");
      const error = event.target.form.querySelector(".error");
      error.hidden = true;
      error.textContent = "";
    }
    if (event.target.matches("[data-lorebook-search-input]")) {
      const query = event.target.value.trim().toLowerCase();
      document.querySelectorAll("[data-lorebook-search]").forEach((entry) => {
        entry.hidden = !entry.dataset.lorebookSearch.includes(query);
      });
      const entries = [...document.querySelectorAll("[data-lorebook-search]")];
      const shown = entries.filter((entry) => !entry.hidden).length;
      document.querySelector("[data-lorebook-no-results]").hidden = !query || shown > 0;
      document.querySelector("[data-lorebook-empty]").hidden = Boolean(query) || entries.length > 0;
      document.querySelector("[data-lorebook-results]").textContent = ui("lorebook_entry_count").replace(
        "{count}",
        String(shown),
      );
    }
    const textarea = event.target.closest?.("textarea[data-auto-grow]");
    if (textarea) resizeAutoGrowTextarea(textarea);
  });

  document.addEventListener("focusin", (event) => {
    const point = event.target.closest?.("[data-history-index]");
    if (point) selectHistoryPoint(point);
  });

  document.addEventListener("pointerover", (event) => {
    const point = event.target.closest?.("[data-history-index]");
    if (point && !point.contains(event.relatedTarget)) selectHistoryPoint(point);
  });

  async function handleDashboardAction(event) {
    if (event.target.closest("[data-stats-range-cancel], [data-stats-range-edit]")) {
      state.statsRangeEditing = !!event.target.closest("[data-stats-range-edit]");
      updateServerStatsSection();
      return;
    }
    if (
      event.type === "holdcomplete" &&
      !event.target.matches("[data-lorebook-delete-entry], [data-sprite-remove], [data-persona-delete]")
    )
      return;
    if (
      savingForms &&
      event.target.closest(
        "[data-lorebook-select], [data-lorebook-edit-entry], [data-lorebook-open], [data-lorebook-channel-settings], [data-lorebook-back], [data-lorebook-rename], [data-lorebook-rename-cancel]",
      )
    ) {
      event.preventDefault();
      toast(ui("saving"));
      return;
    }
    if (event.target.closest("[data-lorebook-channel-settings]")) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openChannelMemorySettings();
      return;
    }
    const lorebookRetry = event.target.closest("[data-lorebook-retry]");
    if (lorebookRetry) return loadLorebooks(Number(lorebookRetry.dataset.lorebookRetry));
    if (event.target.closest("[data-lorebook-back]")) {
      document.querySelector("#lorebook-workspace .mailbox").dataset.view = "list";
      document.querySelector('.mail-item[aria-current="true"]')?.focus({ preventScroll: true });
      return;
    }
    const renameBook = event.target.closest("[data-lorebook-rename], [data-lorebook-rename-cancel]");
    if (renameBook) {
      const form = document.querySelector('[data-lorebook-form="book-rename"]');
      const cancel = renameBook.hasAttribute("data-lorebook-rename-cancel");
      if (cancel) {
        restoreSnapshot(form, formBaselines.get(form));
        captureDraft(form);
        form.querySelector(".form-error")?.remove();
        form.querySelector(".error").hidden = true;
        form.elements.name.removeAttribute("aria-invalid");
      }
      form.hidden = cancel;
      document.querySelector("[data-lorebook-book-summary]").hidden = !cancel;
      (cancel ? document.querySelector('[popovertarget="lorebook-book-actions"]') : form.elements.name)?.focus();
      return;
    }
    const bookChoice = event.target.closest("[data-lorebook-select]");
    if (bookChoice) {
      bookChoice.closest("dialog")?.close();
      state.lorebookBookId = Number(bookChoice.dataset.lorebookSelect);
      document.querySelector("#lorebook-workspace .mailbox").dataset.view = "list";
      await loadLorebooks(0);
      const picker = document.querySelector("[data-lorebook-library-trigger]");
      const focus = picker?.getClientRects().length
        ? picker
        : document.querySelector(`[data-lorebook-select="${state.lorebookBookId}"]`);
      focus?.focus({ preventScroll: true });
      return;
    }
    const entryEditor = event.target.closest("[data-lorebook-edit-entry]");
    if (entryEditor) {
      const sectionChange = Boolean(entryEditor.closest(".tabs"));
      openLorebookEditor(
        Number(entryEditor.dataset.lorebookEditEntry),
        entryEditor.dataset.lorebookEditorSection,
        !sectionChange,
      );
      if (sectionChange) {
        const host = document.querySelector("#lorebook-editor-host");
        const picker = host.querySelector(".tab-selection");
        (picker?.getClientRects().length ? picker : host.querySelector('[role="tab"][aria-selected="true"]'))?.focus({
          preventScroll: true,
        });
      }
      return;
    }
    const lorebookOpen = event.target.closest("[data-lorebook-open]");
    if (lorebookOpen) {
      lorebookOpen.closest("dialog")?.close();
      document.getElementById(lorebookOpen.dataset.lorebookOpen).showModal();
      return;
    }
    if (event.target.closest("[data-lorebook-export]")) {
      try {
        await exportLorebook();
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }
    const lorebookDelete = event.target.closest("[data-lorebook-delete-entry], [data-lorebook-delete-book]");
    if (lorebookDelete) {
      if (lorebookDelete.hasAttribute("data-lorebook-delete-entry") && event.type !== "holdcomplete") return;
      const lineageId = activeLorebookLineage();
      const guildId = state.guildId;
      const target = document.querySelector("#lorebook-workspace");
      const scope = lorebookScope(lineageId);
      const isBook = lorebookDelete.hasAttribute("data-lorebook-delete-book");
      const name = isBook
        ? state.lorebookData.books.find((book) => book.lorebook_id === scope.bookId).name
        : state.lorebookData.entries.find(
            (entry) => entry.entry_id === Number(lorebookDelete.dataset.lorebookDeleteEntry),
          ).title;
      if (
        isBook &&
        !(await confirmAction(
          ui("lorebook_delete_title").replace("{name}", () => name),
          ui(isBook ? "lorebook_delete_book_confirm" : "lorebook_delete_entry_confirm"),
        ))
      )
        return;
      if (!lorebookCurrent(lineageId, target, guildId) || (lineageId === 0 && scope.bookId !== state.lorebookBookId)) {
        lorebookDelete.dispatchEvent(new Event("holdreset"));
        return;
      }
      const query = new URLSearchParams(Object.entries(scope).map(([key, value]) => [key, String(value)]));
      const path = isBook
        ? `/books/${scope.bookId}`
        : `/entries/${lorebookDelete.dataset.lorebookDeleteEntry}?${query}`;
      lorebookDelete.disabled = true;
      try {
        await api(`/guilds/${guildId}/lorebooks${path}`, { method: "DELETE" });
        if (!lorebookCurrent(lineageId, target, guildId) || (lineageId === 0 && scope.bookId !== state.lorebookBookId))
          return;
        if (isBook) state.lorebookBookId = null;
        toast(ui("lorebook_deleted"));
        await loadLorebooks(lineageId);
      } catch (error) {
        lorebookDelete.disabled = false;
        lorebookDelete.dispatchEvent(new Event("holdreset"));
        toast(error.message, "error");
      }
      return;
    }
    if (event.target.closest("[data-sprite-retry]")) return loadSprites(state.personaId);
    const spriteAction = event.target.closest("[data-sprite-edit], [data-sprite-cancel], [data-sprite-new]");
    if (spriteAction) {
      const form = spriteAction.closest("[data-sprite-form]");
      const spriteKey = form?.dataset.spriteKey || "new";
      const key = personaEntryKey(state.personaId, "sprite", spriteKey);
      if (spriteAction.hasAttribute("data-sprite-cancel")) {
        const draft = personaEntryDrafts.get(key);
        if (draft?.preview) URL.revokeObjectURL(draft.preview);
        personaEntryDrafts.delete(key);
      } else if (!personaEntryDrafts.has(key)) {
        const sprite = document.querySelector("#sprite-workspace")._sprites.find((item) => item.key === spriteKey);
        personaEntryDrafts.set(key, sprite ? { ...sprite } : { name: "", instructions: "", identity: false });
      }
      await loadSprites(state.personaId);
      return;
    }
    if (event.target.closest("[data-sprite-import]")) {
      document.querySelector("[data-sprite-archive]").click();
      return;
    }
    const spriteRemove = event.target.closest("[data-sprite-remove]");
    if (spriteRemove) {
      if (event.type !== "holdcomplete") return;
      const form = spriteRemove.closest("[data-sprite-form]");
      const personaId = Number(form.dataset.personaId);
      const path = `/guilds/${state.guildId}/personas/${personaId}/sprites?key=${encodeURIComponent(form.dataset.spriteKey)}`;
      try {
        await withBusyForm(form, async () => {
          const result = await api(path, { method: "DELETE" });
          await refreshPersonas(personaId, result.message);
        });
      } catch (error) {
        spriteRemove.dispatchEvent(new Event("holdreset"));
        toast(error.message, "error");
      }
      return;
    }
    const spriteExport = event.target.closest("[data-sprite-export]");
    if (spriteExport) {
      spriteExport.disabled = true;
      try {
        const response = await fetch(`${BASE}/guilds/${state.guildId}/personas/${state.personaId}/sprites/export`);
        if (!response.ok) throw new Error((await response.json()).error.message);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "sprites.zip";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        const skipped = Number(response.headers.get("X-Sprite-Skipped") || 0);
        toast(ui("sprite_exported").replace("{skipped}", String(skipped)), skipped ? "warning" : "success");
      } catch (error) {
        toast(error.message, "error");
      } finally {
        spriteExport.disabled = false;
      }
      return;
    }
    const navigationMenu = event.target.closest("[data-navigation-menu]");
    if (navigationMenu) {
      openNavigationSheet(navigationMenu);
      return;
    }
    const sheet = document.querySelector("#navigation-sheet");
    if (event.target.closest("[data-navigation-close]")) {
      sheet.close();
      return;
    }
    if (event.target === sheet) {
      const bounds = sheet.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        sheet.close();
      return;
    }
    if (
      savingForms &&
      event.target.closest(
        "[data-nav], [data-persona-select], [data-persona-panel], [data-settings-group], [data-provider-panel], [data-guild-select], [data-overview-refresh]",
      )
    ) {
      toast(ui("saving"));
      return;
    }
    const signOut = event.target.closest('a[href="/settings/logout"]');
    if (signOut?.closest("#navigation-sheet")) sheet.close();
    if (signOut && drafts.size) {
      event.preventDefault();
      if (await confirmAction(ui("discard_title"), ui("leave_detail"))) {
        drafts.clear();
        window.location.assign(signOut.href);
      }
      return;
    }
    const discard = event.target.closest("[data-discard-draft]");
    if (discard) {
      const form = discard.form;
      if (await confirmAction(ui("discard_title"), ui("discard_detail"))) {
        restoreSnapshot(form, formBaselines.get(form));
        captureDraft(form);
        form.querySelector(".form-error")?.remove();
        form.querySelector('button[type="submit"]:not([value="reset"])')?.focus({ preventScroll: true });
      }
      return;
    }
    const serverPicker = document.querySelector("#server-picker-dialog");
    if (event.target === serverPicker) {
      serverPicker.close();
      return;
    }
    if (event.target.closest("[data-server-picker-open]")) {
      serverPicker?.showModal();
      return;
    }
    if (event.target.closest("[data-server-picker-close]")) {
      serverPicker?.close();
      return;
    }
    const guildSelect = event.target.closest("[data-guild-select]");
    if (guildSelect) {
      serverPicker?.close();
      if (guildSelect.dataset.guildSelect !== state.guildId) {
        await selectGuild(guildSelect.dataset.guildSelect);
      }
      return;
    }
    const historyPoint = event.target.closest("[data-history-index]");
    if (historyPoint) {
      selectHistoryPoint(historyPoint);
      return;
    }
    if (event.target.closest("[data-stats-retry]")) {
      state.serverStatsError = "";
      loadServerStats();
      return;
    }
    const paletteChoice = event.target.closest("[data-palette-choice]");
    if (event.target.closest("[data-surface-toggle]")) {
      appearance.surface = appearance.surface === "glass" ? "solid" : "glass";
      saveAppearance();
      syncAppearanceControls();
      return;
    }
    if (event.target.closest("[data-design-reset]")) {
      Object.assign(appearance, {
        theme: "dark",
        palette: "tomori",
        surface: "glass",
        colorMode: "colorful",
        motion: "full",
        lighting: {
          dark: { angle: 350, spread: 150, intensity: 50 },
          light: { angle: 45, spread: 300, intensity: 50 },
        },
      });
      saveAppearance();
      syncAppearanceControls();
      enhanceDashboard(document.querySelector("#design-settings"));
      return;
    }
    if (paletteChoice) {
      appearance.palette = paletteChoice.dataset.paletteChoice;
      saveAppearance();
      syncAppearanceControls();
      return;
    }
    if (event.target.closest("[data-theme-toggle]")) {
      appearance.theme = appearance.theme === "dark" ? "light" : "dark";
      saveAppearance();
      syncAppearanceControls();
      return;
    }
    const dialogClose = event.target.closest("[data-dialog-close]");
    if (dialogClose) {
      document.querySelector(`#${dialogClose.dataset.dialogClose}`)?.close();
      return;
    }
    const connectionTab = event.target.closest("button[data-connection-select]");
    if (connectionTab) {
      state.providerConnection[connectionTab.dataset.providerScope] = connectionTab.dataset.connectionSelect;
      renderView();
      focusNavigation(`button[data-connection-select="${CSS.escape(connectionTab.dataset.connectionSelect)}"]`);
      return;
    }
    const providerPanel = event.target.closest("[data-provider-panel]");
    if (providerPanel) {
      state.providerPanel[providerPanel.dataset.providerScope] = providerPanel.dataset.providerPanel;
      renderView();
      focusNavigation(`[data-provider-panel="${providerPanel.dataset.providerPanel}"]`);
      return;
    }
    const providerOpen = event.target.closest("[data-provider-open]");
    if (providerOpen) {
      const form = document.querySelector("#provider-credential-form");
      form.reset();
      if (providerOpen.dataset.providerOpen) form.elements.provider.value = providerOpen.dataset.providerOpen;
      document.querySelector("#provider-dialog")?.showModal();
      return;
    }
    if (event.target.closest("[data-endpoint-open]")) {
      document.querySelector("#endpoint-dialog")?.showModal();
      return;
    }
    if (event.target.closest("[data-persona-create-open]")) {
      document.querySelector("#persona-create-dialog")?.showModal();
      return;
    }
    if (event.target.closest("[data-persona-import-open]")) {
      document.querySelector("#persona-import-dialog")?.showModal();
      return;
    }
    const avatarChoose = event.target.closest("[data-persona-avatar-choose]");
    if (avatarChoose) {
      document.querySelector(`#persona-avatar-file-${avatarChoose.dataset.personaAvatarChoose}`)?.click();
      return;
    }
    const avatarRemove = event.target.closest("[data-persona-avatar-remove]");
    if (avatarRemove) {
      await removePersonaAvatar(Number(avatarRemove.dataset.personaAvatarRemove));
      return;
    }
    const personaDelete = event.target.closest("[data-persona-delete]");
    if (personaDelete) {
      if (event.type !== "holdcomplete") return;
      await removePersona(Number(personaDelete.dataset.personaDelete));
      return;
    }
    const chatReset = event.target.closest("[data-test-chat-reset]");
    if (chatReset) {
      const personaId = Number(chatReset.dataset.testChatReset);
      if (state.personaTestChats[personaId]?.length) {
        if (!(await confirmAction("Reset test chat?", "This clears the local preview conversation."))) return;
        state.personaTestChats[personaId] = [];
        updatePersonaTestChat(personaId);
      }
      return;
    }
    if (event.target.closest("[data-persona-picker-open]")) {
      const dialog = document.querySelector("#persona-picker-dialog");
      dialog.showModal();
      dialog.querySelector("[data-persona-picker-search]").focus();
      return;
    }
    if (event.target.closest("[data-persona-picker-close]")) {
      document.querySelector("#persona-picker-dialog")?.close();
      return;
    }
    const entryAdd = event.target.closest("[data-entry-add]");
    const entryAction = event.target.closest("[data-entry-edit], [data-entry-cancel], [data-entry-delete]");
    if (entryAdd || entryAction) {
      const persona = state.overview.personas.find((item) => item.personaId === state.personaId);
      const entry = entryAction?.closest("[data-entry-kind]");
      const kind = entryAdd?.dataset.entryAdd || entry.dataset.entryKind;
      const index = entry ? entry.dataset.entryIndex : "new";
      const key = personaEntryKey(persona.personaId, kind, index);
      const collection = kind === "attribute" ? persona.attributes || [] : persona.sampleDialogues || [];
      if (entryAction?.hasAttribute("data-entry-delete")) {
        if (kind === "dialogue") await removeDialogue(persona.personaId, Number(index));
        else if (await confirmAction(ui("persona_delete_entry"), ui("persona_delete_attribute_detail"))) {
          try {
            await api(`/guilds/${state.guildId}/personas/${persona.personaId}/attributes`, {
              method: "PUT",
              body: JSON.stringify({ attributes: collection.filter((_, i) => i !== Number(index)) }),
            });
            shiftPersonaEntryDrafts(persona.personaId, "attribute", Number(index));
            await refreshPersonas(persona.personaId, ui("persona_saved"));
          } catch (error) {
            toast(error.message, "error");
          }
        }
        return;
      }
      if (entryAction?.hasAttribute("data-entry-cancel")) personaEntryDrafts.delete(key);
      else if (!personaEntryDrafts.has(key))
        personaEntryDrafts.set(
          key,
          index === "new"
            ? kind === "attribute"
              ? { text: "", isPublic: false }
              : { input: "", output: "" }
            : { ...collection[Number(index)] },
        );
      if (entry) {
        if (index === "new" && !personaEntryDrafts.has(key)) entry.remove();
        else entry.outerHTML = renderPersonaEntry(persona, kind, index, collection[Number(index)]);
      } else if (!document.querySelector(`[data-entry-kind="${kind}"][data-entry-index="new"]`)) {
        entryAdd
          .closest("section")
          .querySelector(".entry-list")
          .insertAdjacentHTML("beforeend", renderPersonaEntry(persona, kind, index, {}));
      }
      document.querySelector(`[data-entry-kind="${kind}"][data-entry-index="${index}"] textarea`)?.focus();
      return;
    }
    const personaSelect = event.target.closest("[data-persona-select]");
    if (personaSelect) {
      state.view = "personas";
      state.personaId = Number(personaSelect.dataset.personaSelect);
      state.memoryData = null;
      renderView();
      focusNavigation("[data-persona-picker-open]");
      return;
    }
    const personaPanel = event.target.closest("[data-persona-panel]");
    if (personaPanel) {
      state.personaPanel = personaPanel.dataset.personaPanel;
      state.memoryData = null;
      renderView();
      focusNavigation(`[data-persona-panel="${state.personaPanel}"]`);
      return;
    }
    const settingsGroup = event.target.closest("[data-settings-group]");
    if (settingsGroup) {
      state.settingsGroup = settingsGroup.dataset.settingsGroup;
      renderView();
      focusNavigation(`[data-settings-group="${state.settingsGroup}"]`);
      return;
    }
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      state.view = nav.dataset.nav;
      state.memoryData = null;
      renderShell();
      focusNavigation(`.nav-stack [data-nav="${state.view}"]`);
      return;
    }
    const edit = event.target.closest("[data-memory-edit]");
    if (edit) return openMemoryEditor(Number(edit.dataset.memoryEdit));
    const remove = event.target.closest("[data-memory-delete]");
    if (remove) return deleteMemory(Number(remove.dataset.memoryDelete));
    if (event.target.closest("[data-memory-refresh]")) {
      await loadMemories();
      toast("Memories refreshed");
    }
    if (event.target.closest("[data-memory-export]")) await exportMemories();
    if (event.target.closest("[data-memory-import]")) document.querySelector("#memory-import-file")?.click();
    const providerRefresh = event.target.closest("[data-provider-refresh]");
    if (providerRefresh) await refreshProviders(providerRefresh.dataset.providerRefresh, "Providers refreshed");
    const providerDelete = event.target.closest("[data-provider-delete]");
    if (providerDelete) await deleteProvider(providerDelete.dataset.providerDelete);
    const endpointDelete = event.target.closest("[data-endpoint-delete]");
    if (endpointDelete) {
      await deleteEndpoint(endpointDelete.dataset.providerScope, Number(endpointDelete.dataset.endpointDelete));
    }
    const openRouterDelete = event.target.closest("[data-openrouter-delete]");
    if (openRouterDelete) {
      await deleteOpenRouter(
        openRouterDelete.dataset.providerScope,
        openRouterDelete.dataset.openrouterCapability,
        openRouterDelete.dataset.openrouterDelete,
      );
    }
    if (event.target.closest("[data-overview-refresh]")) {
      const currentKeys = [...drafts.keys()].filter(
        (key) => key.startsWith(`${state.guildId}/`) || key.startsWith("profile/"),
      );
      if (currentKeys.length && !(await confirmAction(ui("discard_title"), ui("refresh_detail")))) return;
      try {
        await refreshOverview("Server settings refreshed", currentKeys);
      } catch (error) {
        toast(error.message, "error");
      }
    }
  }
  document.addEventListener("click", handleDashboardAction);
  document.addEventListener("holdcomplete", handleDashboardAction);

  document.addEventListener("change", async (event) => {
    if (event.target.matches('#fallback-form select[name^="fallback-"]')) {
      const slots = [...event.target.form.querySelectorAll("[data-fallback-slot]")];
      const lastFilled = slots.reduce((last, slot, index) => (slot.querySelector("select").value ? index : last), -1);
      slots.forEach((slot, index) => {
        slot.hidden = index > lastFilled + 1;
      });
    }
    if (event.target.matches("[data-design-setting]")) {
      appearance[event.target.dataset.designSetting] = event.target.value;
      saveAppearance();
      return;
    }
    if (event.target.matches("[data-lorebook-flag], [data-lorebook-book-enabled]")) {
      const input = event.target;
      const lineageId = activeLorebookLineage();
      const guildId = state.guildId;
      const target = document.querySelector("#lorebook-workspace");
      const scope = lorebookScope(lineageId);
      const isBook = input.hasAttribute("data-lorebook-book-enabled");
      const dialog = input.closest("dialog");
      const path = isBook ? `/books/${scope.bookId}` : `/entries/${input.dataset.entryId}/flags`;
      const payload = isBook
        ? { enabled: input.checked }
        : { ...scope, flags: { [input.dataset.lorebookFlag]: input.checked } };
      input.disabled = true;
      try {
        await api(`/guilds/${guildId}/lorebooks${path}`, { method: "PATCH", body: JSON.stringify(payload) });
        if (lorebookCurrent(lineageId, target, guildId) && (lineageId !== 0 || scope.bookId === state.lorebookBookId)) {
          await loadLorebooks(lineageId);
          if (!lorebookCurrent(lineageId, target, guildId)) return;
          if (dialog?.dataset.entryId) openLorebookEditor(Number(dialog.dataset.entryId), dialog.dataset.section);
          else if (dialog) document.getElementById(dialog.id)?.showModal();
          toast(ui("lorebook_saved"));
        }
      } catch (error) {
        input.checked = !input.checked;
        input.disabled = false;
        const form = dialog?.querySelector("form");
        if (form) showFormError(form, error);
        toast(error.message, "error");
      }
      return;
    }
    if (event.target.matches("[data-history-model]")) {
      state.statsHistoryModel = event.target.value ? event.target.value.slice(6) : null;
      updateServerStatsSection();
      return;
    }
    if (event.target.matches("[data-history-timeframe]")) {
      if (event.target.value === "custom") {
        state.statsRangeEditing = true;
        updateServerStatsSection();
        document.querySelector('#stats-range-form input[name="from"]')?.focus();
        return;
      }
      state.statsRangeEditing = false;
      if (event.target.value !== state.statsTimeframe) {
        state.statsTimeframe = event.target.value;
        state.serverStatsError = "";
        loadServerStats();
      }
      return;
    }
    if (event.target.matches('[data-sprite-form] input[type="file"]')) {
      const form = event.target.closest("[data-sprite-form]");
      const key = personaEntryKey(form.dataset.personaId, "sprite", form.dataset.spriteKey || "new");
      const draft = personaEntryDrafts.get(key);
      const file = event.target.files[0];
      if (draft && file) {
        if (draft.preview) URL.revokeObjectURL(draft.preview);
        draft.file = file;
        draft.preview = URL.createObjectURL(file);
        await loadSprites(Number(form.dataset.personaId));
      }
      return;
    }
    if (event.target.matches("[data-sprite-archive]")) {
      const file = event.target.files?.[0];
      if (!file) return;
      const personaId = state.personaId;
      const path = `/guilds/${state.guildId}/personas/${personaId}/sprites/import`;
      const root = document.querySelector("#sprite-workspace");
      try {
        await withBusyForm(root, async () => {
          if (!(await confirmAction(ui("sprite_import"), ui("sprite_import_detail")))) return;
          const body = new FormData();
          body.set("file", file);
          const result = await api(path, { method: "POST", body });
          toast(result.message, result.failed ? "warning" : "success");
          await refreshPersonas(personaId);
        });
      } catch (error) {
        toast(error.message, "error");
      } finally {
        event.target.value = "";
      }
      return;
    }
    captureDraft(event.target.closest(draftForms));
    const namingMode = event.target.closest("[data-naming-mode]");
    if (namingMode) {
      namingMode.form.elements[namingMode.dataset.namingMode].disabled = namingMode.value !== "custom";
    }
    if (event.target.id === "memory-import-file" && event.target.files?.[0]) {
      await importMemories(event.target.files[0]);
      event.target.value = "";
    }
    const avatarInput = event.target.closest("[data-persona-avatar-file]");
    if (avatarInput?.files?.[0]) {
      const personaId = Number(avatarInput.dataset.personaAvatarFile);
      const body = new FormData();
      body.set("file", avatarInput.files[0]);
      avatarInput.disabled = true;
      try {
        await api(`/guilds/${state.guildId}/personas/${personaId}/avatar`, {
          method: "PUT",
          body,
        });
        await refreshPersonas(personaId, "Avatar updated");
      } catch (error) {
        avatarInput.disabled = false;
        toast(error.message, "error");
      }
      avatarInput.value = "";
      return;
    }
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id === "stats-range-form") {
      event.preventDefault();
      const { from, through } = event.target.elements;
      if (from.value > through.value) {
        toast(ui("stats_range_invalid"), "error");
        return;
      }
      state.statsRange = { from: from.value, through: through.value };
      state.statsTimeframe = "custom";
      state.statsRangeEditing = false;
      await loadServerStats();
      return;
    }
    if (event.target.classList.contains("is-saving")) {
      event.preventDefault();
      return;
    }
    if (event.target.matches("[data-lorebook-form], [data-lorebook-import-form]")) {
      event.preventDefault();
      try {
        if (event.target.hasAttribute("data-lorebook-import-form")) await importLorebook(event.target);
        else await saveLorebookForm(event.target);
      } catch (error) {
        if (event.target.closest("dialog")) showFormError(event.target, error);
        toast(error.message, "error");
      }
      return;
    }
    if (event.target.matches("[data-sprite-form]")) {
      event.preventDefault();
      const form = event.target;
      if (!form.elements.name.validity.valid || !form.elements.name.value.trim()) {
        setSpriteFieldError(form.elements.name, form.elements.name.validationMessage || ui("sprite_name_hint"));
        form.elements.name.focus();
        return;
      }
      const personaId = Number(form.dataset.personaId);
      const editing = form.hasAttribute("data-sprite-key");
      const path = `/guilds/${state.guildId}/personas/${personaId}/sprites${editing ? `?key=${encodeURIComponent(form.dataset.spriteKey)}` : ""}`;
      const body = new FormData(form);
      body.set("identity", String(form.elements.identity.checked));
      const key = personaEntryKey(personaId, "sprite", form.dataset.spriteKey || "new");
      const draft = personaEntryDrafts.get(key);
      if (draft?.file) body.set("file", draft.file);
      else body.delete("file");
      if (!editing && !draft?.file) {
        toast(ui("sprite_file_hint"), "error");
        return;
      }
      try {
        await withBusyForm(form, async () => {
          if (!editing && !(await confirmAction(ui("sprite_add"), ui("sprite_add_detail")))) return;
          const result = await api(path, { method: editing ? "PUT" : "POST", body });
          if (draft?.preview) URL.revokeObjectURL(draft.preview);
          personaEntryDrafts.delete(key);
          await refreshPersonas(personaId, result.message);
        });
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }
    if (event.target.id === "persona-create-form") {
      event.preventDefault();
      const form = event.target;
      try {
        let result;
        await withBusyForm(form, async () => {
          result = await api(`/guilds/${state.guildId}/personas`, {
            method: "POST",
            body: JSON.stringify({
              nickname: form.elements.nickname.value,
              description: form.elements.description.value,
              triggerWords: parseTags(form.elements.triggerWords.value),
              personaPrompt: form.elements.personaPrompt.value || null,
              sampleInput: form.elements.sampleInput.value || null,
              sampleOutput: form.elements.sampleOutput.value || null,
            }),
          });
        });
        document.querySelector("#persona-create-dialog")?.close();
        form.reset();
        state.personaPanel = "settings";
        await refreshPersonas(result?.persona?.personaId, "Persona created");
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }

    if (event.target.id === "persona-import-form") {
      event.preventDefault();
      const form = event.target;
      const body = new FormData(form);
      try {
        let result;
        await withBusyForm(form, async () => {
          result = await api(`/guilds/${state.guildId}/personas/import`, {
            method: "POST",
            body,
          });
        });
        document.querySelector("#persona-import-dialog")?.close();
        form.reset();
        state.personaPanel = "settings";
        await refreshPersonas(result?.persona?.personaId, "Persona imported");
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }

    const entryForm = event.target.closest("[data-persona-entry-form]");
    if (entryForm) {
      event.preventDefault();
      const entry = entryForm.closest("[data-entry-kind]");
      const personaId = Number(entry.dataset.personaId);
      const kind = entry.dataset.entryKind;
      const index = entry.dataset.entryIndex;
      const key = personaEntryKey(personaId, kind, index);
      const persona = state.overview.personas.find((item) => item.personaId === personaId);
      const value =
        kind === "attribute"
          ? { text: entryForm.elements.text.value, isPublic: entryForm.elements.isPublic.checked }
          : { input: entryForm.elements.input.value, output: entryForm.elements.output.value };
      try {
        await withBusyForm(entryForm, async () => {
          if (kind === "attribute") {
            const attributes = [...(persona.attributes || [])];
            if (index === "new") attributes.push(value);
            else attributes[Number(index)] = value;
            await api(`/guilds/${state.guildId}/personas/${personaId}/attributes`, {
              method: "PUT",
              body: JSON.stringify({ attributes }),
            });
          } else {
            await api(`/guilds/${state.guildId}/personas/${personaId}/dialogues${index === "new" ? "" : `/${index}`}`, {
              method: index === "new" ? "POST" : "PATCH",
              body: JSON.stringify(value),
            });
          }
        });
        personaEntryDrafts.delete(key);
        await refreshPersonas(personaId, ui("persona_saved"));
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }
    if (event.target.id === "persona-test-chat-form") {
      event.preventDefault();
      if (state.personaTestChatBusy) return;
      const form = event.target;
      const personaId = Number(form.dataset.personaId);
      const content = form.elements.message.value.trim();
      if (!content) return;
      const history = [...(state.personaTestChats[personaId] || []).slice(-23), { role: "user", content }];
      state.personaTestChats[personaId] = history;
      state.personaTestChatBusy = true;
      updatePersonaTestChat(personaId);
      try {
        const result = await api(`/guilds/${state.guildId}/personas/test-chat`, {
          method: "POST",
          body: JSON.stringify({ personaId, messages: history.map(({ role, content }) => ({ role, content })) }),
        });
        state.personaTestChats[personaId] = [
          ...history,
          { role: "assistant", content: result.content, segments: result.segments },
        ].slice(-24);
      } catch (error) {
        toast(error.message, "error");
      } finally {
        state.personaTestChatBusy = false;
        updatePersonaTestChat(state.personaId);
      }
      return;
    }

    if (event.target.id === "provider-credential-form") {
      event.preventDefault();
      const form = event.target;
      const scope = form.dataset.providerScope;
      const provider = form.elements.provider.value;
      try {
        await withBusyForm(form, async () => {
          await api(`/guilds/${state.guildId}/providers/${scope}/credentials`, {
            method: "POST",
            body: JSON.stringify({
              provider: form.elements.provider.value,
              apiKey: form.elements.apiKey.value,
              validateApiKey: form.elements.validateApiKey.checked,
            }),
          });
        });
        form.reset();
        document.querySelector("#provider-dialog")?.close();
        state.providerConnection[scope] = `provider:${provider}`;
        toast("Provider key stored");
        await refreshProviders(scope);
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }

    if (event.target.id === "endpoint-form") {
      event.preventDefault();
      const form = event.target;
      const scope = form.dataset.providerScope;
      try {
        await withBusyForm(form, async () => {
          await api(`/guilds/${state.guildId}/providers/${scope}/endpoints`, {
            method: "POST",
            body: JSON.stringify({
              label: form.elements.label.value,
              endpointUrl: form.elements.endpointUrl.value,
              capability: form.elements.capability.value,
              apiStyle: form.elements.apiStyle.value,
              modelName: form.elements.modelName.value || null,
              authToken: form.elements.authToken.value || null,
              numCtx: form.elements.numCtx.value ? Number(form.elements.numCtx.value) : null,
              hasTools: form.elements.hasTools.checked,
              seesImages: form.elements.seesImages.checked,
              seesVideos: form.elements.seesVideos.checked,
              supportsStructOutput: form.elements.supportsStructOutput.checked,
              strictRoleAlternation: form.elements.strictRoleAlternation.checked,
              supportsPrefixCompletion: form.elements.supportsPrefixCompletion.checked,
            }),
          });
        });
        form.reset();
        document.querySelector("#endpoint-dialog")?.close();
        toast("Endpoint tested and registered");
        await refreshProviders(scope);
      } catch (error) {
        showFormError(form, error);
      }
      return;
    }

    if (event.target.id === "openrouter-form") {
      event.preventDefault();
      const form = event.target;
      const scope = form.dataset.providerScope;
      try {
        let result;
        await withBusyForm(form, async () => {
          result = await api(`/guilds/${state.guildId}/providers/${scope}/openrouter`, {
            method: "POST",
            body: JSON.stringify({
              capability: form.elements.capability.value,
              modelName: form.elements.modelName.value,
            }),
          });
        });
        form.reset();
        const message =
          result?.status === "already_available"
            ? "This model is already in Tomori's built-in OpenRouter catalog"
            : result?.status === "already_registered"
              ? "This OpenRouter model was already registered for this scope"
              : "OpenRouter model registered";
        toast(message);
        await refreshProviders(scope);
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }

    if (event.target.matches("[data-persona-text-model]")) {
      event.preventDefault();
      try {
        await savePersonaTextModel(event.target);
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }

    if (event.target.matches("[data-personal-parameters]")) {
      event.preventDefault();
      try {
        await savePersonalParameters(event.target);
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }

    if (event.target.matches("[data-personal-model]")) {
      event.preventDefault();
      try {
        await savePersonalModel(event.target);
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }

    if (event.target.id === "server-models-form") {
      event.preventDefault();
      const form = event.target;
      const readModelId = (name) => {
        const value = form.elements[name].value;
        return value ? Number(value) : null;
      };
      try {
        await withBusyForm(form, async () => {
          await api(`/guilds/${state.guildId}/providers/server/models`, {
            method: "PATCH",
            body: JSON.stringify({
              text: readModelId("text"),
              vision: readModelId("vision"),
              embedding: readModelId("embedding"),
              image: readModelId("image"),
              imageNai: readModelId("imageNai"),
              video: readModelId("video"),
            }),
          });
        });
        toast("Primary models saved");
        await refreshProviders("server");
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }

    if (event.target.id === "fallback-form") {
      event.preventDefault();
      const form = event.target;
      try {
        await saveFallbacks(form);
      } catch (error) {
        showFormError(form, error, error.partial);
      }
      return;
    }

    if (event.target.matches("[data-profile-section]")) {
      event.preventDefault();
      const form = event.target;
      const patch = {};
      for (const input of form.querySelectorAll("input[name], select[name], textarea[name]")) {
        if (input.type === "checkbox") patch[input.name] = input.checked;
        else if (input.name === "privacy_level") patch[input.name] = Number(input.value);
        else if (input.name === "timezone_offset") patch[input.name] = input.value === "" ? null : Number(input.value);
        else if (input.name === "physical_appearance_tags") patch[input.name] = parseTags(input.value);
        else patch[input.name] = input.value || null;
      }
      try {
        await withBusyForm(form, async () => {
          const result = await api("/profile", { method: "PATCH", body: JSON.stringify(patch) });
          state.overview.profile = result.profile;
          completeFormSave(form);
        });
        toast("Profile saved");
      } catch (error) {
        showFormError(form, error);
      }
      return;
    }

    if (event.target.id === "memory-compose-form") {
      event.preventDefault();
      const form = event.target;
      try {
        await api(`/guilds/${state.guildId}/memories/${state.memoryKind}`, {
          method: "POST",
          body: JSON.stringify({
            lineageId: state.lineageId,
            content: form.elements.content.value,
            tags: state.memoryKind === "personal" ? parseTags(form.elements.tags.value).slice(0, 5) : [],
          }),
        });
        form.reset();
        toast("Memory saved");
        await loadMemories();
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }

    if (event.target.id === "memory-edit-form") {
      event.preventDefault();
      const form = event.target;
      if (event.submitter?.value !== "save") return;
      try {
        await api(`/guilds/${state.guildId}/memories/${state.memoryKind}/${form.elements.memoryId.value}`, {
          method: "PATCH",
          body: JSON.stringify({
            lineageId: state.lineageId,
            content: form.elements.content.value,
            tags: state.memoryKind === "personal" ? parseTags(form.elements.tags.value).slice(0, 5) : [],
          }),
        });
        document.querySelector("#memory-dialog").close();
        toast("Memory updated");
        await loadMemories();
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }

    const namingForm = event.target.closest("[data-persona-naming]");
    const categoriesForm = event.target.closest("#stm-categories-form");
    if (namingForm || categoriesForm) {
      event.preventDefault();
      const form = namingForm || categoriesForm;
      const overview = state.overview;
      const guildId = state.guildId;
      const data = namingForm ? overview.personaNaming : overview.settings.stmCategories;
      const reset = event.submitter?.value === "reset";
      const personaId = Number(namingForm?.dataset.personaNaming);
      const payload = namingForm
        ? Object.fromEntries(
            ["nickname", "prefix", "suffix"].map((key) => {
              const mode = reset ? "inherit" : form.elements[`${key}Mode`].value;
              return [key, mode === "inherit" ? null : mode === "none" ? "" : form.elements[key].value];
            }),
          )
        : {
            categories: reset
              ? []
              : Array.from({ length: 5 }, (_, index) => ({
                  label: form.elements[`label${index}`].value.trim(),
                  description: form.elements[`description${index}`].value.trim(),
                })).filter(({ label, description }) => label || description),
          };
      try {
        await withBusyForm(form, async () => {
          if (reset && !(await confirmAction(data.copy.resetTitle, data.copy.resetDetail))) return;
          if (categoriesForm && !reset && !(await confirmAction(data.copy.confirm, data.copy.warning))) return;
          const result = await api(
            namingForm ? `/guilds/${guildId}/personas/${personaId}/naming` : `/guilds/${guildId}/stm/categories`,
            { method: "PUT", body: JSON.stringify(payload) },
          );
          if (namingForm) {
            const lineageId = overview.personas.find((persona) => persona.personaId === personaId)?.lineageId;
            for (const persona of overview.personas.filter((entry) => entry.lineageId === lineageId)) {
              data.values[persona.personaId] = result.preference;
            }
          } else {
            data.values = result.categories;
          }
          completeFormSave(form);
          if (state.overview === overview && form.isConnected) {
            const workspace = form.closest("#workspace");
            const scrollTop = workspace.scrollTop;
            form.outerHTML = namingForm
              ? renderPersonaNaming(overview.personas.find((persona) => persona.personaId === personaId))
              : renderStmCategories();
            initDraftForms(workspace);
            resizeAutoGrowTextareas(document);
            workspace.scrollTop = scrollTop;
            workspace
              .querySelector(
                namingForm
                  ? "[data-persona-naming] button[type=submit]:not([value=reset])"
                  : "#stm-categories-form button[type=submit]:not([value=reset])",
              )
              ?.focus({ preventScroll: true });
          }
          toast(data.copy.saved);
        });
      } catch (error) {
        showFormError(form, error);
      }
      return;
    }

    const settingsForm = event.target.closest("[data-settings-sections]");
    if (settingsForm) {
      event.preventDefault();
      const sections = settingsForm.dataset.settingsSections
        .split(",")
        .map((sectionId) => state.overview.settings.catalog.find((entry) => entry.id === sectionId))
        .filter(Boolean);
      let savedSections = 0;
      try {
        await withBusyForm(settingsForm, async () => {
          for (const section of sections) {
            const result = await api(`/guilds/${state.guildId}/settings/${section.id}`, {
              method: "PATCH",
              body: JSON.stringify(collectSettingsPatch(settingsForm, section)),
            });
            state.overview.settings.values[section.id] = result.values;
            if (section.id === "byok") state.providerData.personal = null;
            const savedFields = new Set(section.fields.map((field) => field.key));
            const values = formSnapshot(settingsForm);
            formBaselines.set(
              settingsForm,
              formBaselines
                .get(settingsForm)
                .map((value, index) => (savedFields.has(value.name) ? values[index] : value)),
            );
            captureDraft(settingsForm);
            savedSections += 1;
          }
          completeFormSave(settingsForm);
        });
        toast(`${settingsForm.dataset.settingsPanelTitle || "Settings"} saved`);
      } catch (error) {
        showFormError(settingsForm, error, savedSections > 0);
      }
      return;
    }

    const personaForm = event.target.closest("[data-persona-section]");
    if (personaForm) {
      event.preventDefault();
      const card = personaForm.closest("[data-persona-id]");
      const section = personaForm.dataset.personaSection;
      const values = personaForm.elements;
      const personaId = Number(card.dataset.personaId);
      const currentPersona = state.overview.personas.find((persona) => persona.personaId === personaId);
      const payload =
        section === "identity"
          ? { nickname: values.nickname.value }
          : section === "prompt"
            ? {
                triggerWords: values.triggerWords
                  ? parseTags(values.triggerWords.value)
                  : currentPersona?.triggerWords || [],
                personaPrompt: values.personaPrompt
                  ? values.personaPrompt.value || null
                  : currentPersona?.personaPrompt || null,
              }
            : section === "context"
              ? {
                  contextNote: values.contextNote.value || null,
                  contextNoteDepth: Number(values.contextNoteDepth.value),
                }
              : { physicalAppearanceTags: parseTags(values.physicalAppearanceTags.value) };
      try {
        await api(`/guilds/${state.guildId}/personas/${personaId}/${section}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        toast("Persona section saved");
        state.overview = await api(`/guilds/${state.guildId}/overview`);
        renderView();
      } catch (error) {
        toast(error.message, "error");
      }
    }
  });

  async function boot() {
    try {
      const session = await api("/session");
      state.session = session;
      state.csrfToken = session.csrfToken;
      if (!session.guilds.length) return renderNoGuilds();
      const guildId = new URLSearchParams(window.location.search).get("guild");
      const guild = session.guilds.find((item) => item.id === guildId) || session.guilds[0];
      await selectGuild(guild.id);
      if (window.location.hash === "#channel-scoped-memory") openChannelMemorySettings();
    } catch {
      renderLoggedOut();
    }
  }

  boot();
})();
