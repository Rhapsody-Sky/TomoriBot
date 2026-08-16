(() => {
  const BASE = "/settings/api";
  const app = document.querySelector("#app");
  const toastRegion = document.querySelector("#toast-region");
  const palettes = [
    { id: "lilya", label: "Lilya" },
    { id: "aphel", label: "Aphel" },
    { id: "nerine", label: "Nerine" },
    { id: "tomori", label: "Tomori" },
    { id: "zaya", label: "Zaya" },
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
  };

  const applyAppearance = () => {
    document.body.dataset.palette = palettes.some((palette) => palette.id === appearance.palette)
      ? appearance.palette
      : "tomori";
    document.body.dataset.theme = appearance.theme === "light" ? "light" : "dark";
  };

  const saveAppearance = () => {
    applyAppearance();
    try {
      localStorage.setItem("tomoribot.dashboard.palette", appearance.palette);
      localStorage.setItem("tomoribot.dashboard.theme", appearance.theme);
    } catch {
      // Appearance still works for the current page when storage is unavailable.
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
  };

  applyAppearance();

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
          description: "How generated responses are shaped, split, varied, and accompanied by diagnostics.",
          sources: [
            {
              section: "chat",
              fields: ["humanizer_degree", "send_message_limit", "self_debug_enabled", "model_randomizer_enabled"],
            },
          ],
        },
      ],
    },
    {
      id: "models",
      label: "Models & sampling",
      sections: ["modelBehavior", "sampling"],
    },
    {
      id: "access",
      label: "Access & channels",
      sections: ["capabilities", "memberPermissions", "channelScope", "autochat", "welcome"],
    },
    {
      id: "memory",
      label: "Memory & notices",
      sections: ["memory", "notices"],
    },
    {
      id: "media",
      label: "Media",
      sections: ["speech", "novelai", "nsfw"],
    },
    {
      id: "providers",
      label: "Provider policy",
      sections: ["byok"],
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
    personaTestChats: {},
    personaTestChatBusy: false,
    avatarRevision: 0,
    providerData: { personal: null, server: null },
    serverStats: null,
    serverStatsLoading: false,
    serverStatsError: "",
    statsTimeframe: "all_time",
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
    element.className = `toast toast-${kind}`;
    element.textContent = message;
    toastRegion.append(element);
    requestAnimationFrame(() => element.classList.add("toast-visible"));
    setTimeout(() => {
      element.classList.remove("toast-visible");
      setTimeout(() => element.remove(), 180);
    }, 3500);
  };

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
          <a class="button button-primary login-button" href="/settings/login">Continue with Discord</a>
        </div>
      </main>`;
  }

  function renderBootScreen() {
    if (app.querySelector(".boot-screen")) return;
    app.innerHTML = `<div class="boot-screen"><img src="/settings/assets/tomori_companion_logo.svg" alt="TomoriBot" class="boot-logo"><div class="boot-line"></div></div>`;
  }

  function renderNoGuilds() {
    app.innerHTML = `
      <main class="login-screen">
        <div class="login-brand">
          <img src="/settings/assets/tomori_companion_logo.svg" alt="TomoriBot" class="login-logo">
          <p class="login-kicker">No shared servers</p>
          <h1>TomoriBot is not in one of your servers yet.</h1>
          <a class="button button-secondary login-button" href="/settings/logout">Sign out</a>
        </div>
      </main>`;
  }

  function navButton(id, label, adminOnly = false) {
    if (adminOnly && !state.overview?.canManage) return "";
    return `<button class="nav-item${state.view === id ? " is-active" : ""}" data-nav="${id}" type="button">
      <span class="nav-mark" aria-hidden="true"></span><span>${escapeHtml(label)}</span>
    </button>`;
  }

  function renderShell() {
    const guilds = state.session?.guilds || [];
    const selected = guilds.find((guild) => guild.id === state.guildId) || guilds[0];
    const user = state.session?.user;
    app.innerHTML = `
      <div class="dashboard-shell">
        <header class="topbar">
          <button class="brand-button" type="button" data-nav="overview" aria-label="Open overview">
            <img src="/settings/assets/tomori_companion_logo.svg" alt="" class="topbar-logo">
            <span class="brand-copy"><strong>TomoriBot</strong><small>companion control</small></span>
          </button>
          <div class="topbar-server-access">
            <span class="workspace-mode">${state.overview?.canManage ? "Administrator workspace" : "Personal workspace"}</span>
            <button class="mobile-server-button" type="button" data-server-picker-open aria-haspopup="dialog">
              ${
                selected?.iconUrl
                  ? `<img src="${escapeHtml(selected.iconUrl)}" alt="">`
                  : `<span>${escapeHtml((selected?.name || "?").slice(0, 1))}</span>`
              }
              <strong>${escapeHtml(selected?.name || "Choose server")}</strong>
            </button>
          </div>
          <div class="appearance-controls" aria-label="Appearance">
            <div class="palette-picker" role="group" aria-label="Persona palette">
              ${palettes
                .map(
                  (palette) =>
                    `<button class="palette-swatch palette-${palette.id}${appearance.palette === palette.id ? " is-active" : ""}" type="button" data-palette-choice="${palette.id}" title="${palette.label} palette" aria-label="${palette.label} palette" aria-pressed="${appearance.palette === palette.id}"></button>`,
                )
                .join("")}
            </div>
            <button class="appearance-toggle" type="button" data-theme-toggle title="Toggle light or dark theme" aria-label="Toggle light or dark theme">
              <span aria-hidden="true">${appearance.theme === "dark" ? "☀" : "☾"}</span>
            </button>
          </div>
          <div class="user-area">
            ${
              user?.avatarUrl
                ? `<img src="${escapeHtml(user.avatarUrl)}" alt="" class="user-avatar">`
                : `<span class="user-avatar user-avatar-fallback">${escapeHtml((user?.displayName || "?").slice(0, 1))}</span>`
            }
            <span class="user-name">${escapeHtml(user?.displayName || "")}</span>
            <a class="icon-link" href="/settings/logout" title="Sign out" aria-label="Sign out">Log out</a>
          </div>
        </header>
        <aside class="sidebar">
          <nav class="nav-stack" aria-label="Dashboard">
            <span class="nav-label">Workspace</span>
            ${navButton("overview", "Overview")}
            ${navButton("profile", "My profile")}
            ${navButton("personal-memory", "Global memory")}
            ${navButton("personas", "Personas")}
            ${navButton("personal-providers", "My providers")}
            ${
              state.overview?.canManage
                ? `<span class="nav-label nav-label-admin">Administration</span>
                   ${navButton("server-providers", "Server providers", true)}
                   ${navButton("settings", "Server settings", true)}`
                : ""
            }
          </nav>
          <button class="sidebar-server" type="button" data-server-picker-open aria-haspopup="dialog" title="Switch server">
            ${
              selected?.iconUrl
                ? `<img src="${escapeHtml(selected.iconUrl)}" alt="" class="server-icon">`
                : `<span class="server-icon server-icon-fallback">${escapeHtml((selected?.name || "?").slice(0, 1))}</span>`
            }
            <div><strong>${escapeHtml(selected?.name || "")}</strong><span>${selected?.memberCount ?? "?"} members</span></div>
            <span class="server-switch-mark" aria-hidden="true">&#8645;</span>
          </button>
        </aside>
        <main class="workspace" id="workspace"></main>
      </div>
      <dialog id="server-picker-dialog" class="dialog server-picker-dialog" aria-labelledby="server-picker-title">
        <div class="server-picker-surface">
          <div class="server-picker-heading">
            <div><p class="dialog-kicker">Your Tomori spaces</p><h2 id="server-picker-title">Switch server</h2>
              <p>Select the server you want to view or manage.</p>
            </div>
            <button class="server-picker-close" type="button" data-server-picker-close aria-label="Close server selection">&times;</button>
          </div>
          <div class="server-picker-grid">
            ${guilds
              .map(
                (guild) =>
                  `<button class="server-choice${guild.id === state.guildId ? " is-active" : ""}" type="button" data-guild-select="${escapeHtml(guild.id)}">
                  ${
                    guild.iconUrl
                      ? `<img src="${escapeHtml(guild.iconUrl)}" alt="" class="server-choice-icon">`
                      : `<span class="server-choice-icon server-choice-fallback">${escapeHtml((guild.name || "?").slice(0, 1))}</span>`
                  }
                  <span class="server-choice-copy"><strong>${escapeHtml(guild.name)}</strong><small>${guild.memberCount ?? "?"} members</small></span>
                  <span class="server-choice-access">${guild.canManage ? "Manage" : "Member"}</span>
                </button>`,
              )
              .join("")}
          </div>
        </div>
      </dialog>
      <dialog id="confirm-dialog" class="dialog">
        <form method="dialog" class="dialog-surface">
          <p class="dialog-kicker">Please confirm</p>
          <h2 id="confirm-title">Confirm action</h2>
          <p id="confirm-message"></p>
          <div class="dialog-actions">
            <button value="cancel" class="button button-quiet">Cancel</button>
            <button value="confirm" class="button button-danger">Confirm</button>
          </div>
        </form>
      </dialog>
      <dialog id="memory-dialog" class="dialog">
        <form method="dialog" class="dialog-surface" id="memory-edit-form">
          <p class="dialog-kicker">Edit memory</p>
          <h2>Update this memory</h2>
          <label class="field"><span>Memory</span><textarea name="content" rows="6" required></textarea></label>
          <label class="field"><span>Tags</span><input name="tags" type="text" placeholder="character, preference"></label>
          <input name="memoryId" type="hidden">
          <div class="dialog-actions">
            <button value="cancel" class="button button-quiet">Cancel</button>
            <button value="save" class="button button-primary">Save changes</button>
          </div>
        </form>
      </dialog>
      <dialog id="persona-create-dialog" class="dialog dialog-wide">
        <form class="dialog-surface" id="persona-create-form">
          <p class="dialog-kicker">New alter persona</p>
          <h2>Create a persona</h2>
          <p>The new persona starts with this server's model configuration. You can refine every field afterward.</p>
          <div class="form-grid">
            <label class="field">${fieldLabel("Name", "The display name and first trigger word.")}<input name="nickname" maxlength="100" required></label>
            <label class="field">${fieldLabel("Trigger words", "Additional comma-separated names or phrases.")}<input name="triggerWords" placeholder="nickname, alias"></label>
            <label class="field field-wide">${fieldLabel("Description", "A concise identity attribute used in conversation context.")}<textarea name="description" rows="3" required></textarea></label>
            <label class="field field-wide">${fieldLabel("Visual character prompt", "Optional visual description used when generating images of this persona.")}<textarea name="personaPrompt" rows="5"></textarea></label>
            <label class="field">${fieldLabel("Sample user message", "Optional first half of an example exchange.")}<textarea name="sampleInput" rows="3"></textarea></label>
            <label class="field">${fieldLabel("Sample persona reply", "Required when a sample user message is provided.")}<textarea name="sampleOutput" rows="3"></textarea></label>
          </div>
          <div class="dialog-actions">
            <button type="button" class="button button-quiet" data-dialog-close="persona-create-dialog">Cancel</button>
            <button type="submit" class="button button-primary">Create persona</button>
          </div>
        </form>
      </dialog>
      <dialog id="persona-import-dialog" class="dialog">
        <form class="dialog-surface" id="persona-import-form">
          <p class="dialog-kicker">Import alter persona</p>
          <h2>Import a persona</h2>
          <p>Tomori persona exports and SillyTavern cards are supported as PNG or JSON.</p>
          <label class="field">${fieldLabel("Persona file", "The embedded avatar is imported when the PNG contains one.")}<input name="file" type="file" accept=".png,.json,image/png,application/json" required></label>
          <fieldset class="choice-field">
            <legend>Memory identity</legend>
            <label class="check-option">
              <input type="radio" name="identityMode" value="fork" checked>
              <span><strong>New identity</strong><small>Starts a separate personal-memory lineage.</small></span>
            </label>
            <label class="check-option">
              <input type="radio" name="identityMode" value="preserve">
              <span><strong>Preserve identity</strong><small>Reuses the imported lineage when it is available.</small></span>
            </label>
          </fieldset>
          <div class="dialog-actions">
            <button type="button" class="button button-quiet" data-dialog-close="persona-import-dialog">Cancel</button>
            <button type="submit" class="button button-primary">Import persona</button>
          </div>
        </form>
      </dialog>`;
    renderView();
  }

  function pageHeader(eyebrow, title, copy, actions = "") {
    return `<div class="page-heading">
      <div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(copy)}</p></div>
      ${actions ? `<div class="page-actions">${actions}</div>` : ""}
    </div>`;
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
  }

  function renderOverview(workspace) {
    const overview = state.overview;
    const mainPersona = overview.personas[0];
    const model = overview.modelSummary?.text;
    workspace.innerHTML = `
      ${pageHeader("Control room", overview.guild.name, "A live view of this TomoriBot installation and your access.")}
      <section class="metric-strip" aria-label="Server summary">
        <div><span>Personas</span><strong>${overview.personas.length}</strong></div>
        <div><span>Text model</span><strong class="metric-text">${escapeHtml(model?.name || "Not configured")}</strong></div>
        <div><span>Personal memory</span><strong>${overview.memoryPolicy.personalMemoryUseEnabled ? "Active" : "Paused"}</strong></div>
        <div><span>Access</span><strong>${overview.canManage ? "Manage Server" : "Member"}</strong></div>
      </section>
      <div class="overview-grid">
        <section class="panel overview-primary">
          <div class="panel-heading"><div><p class="eyebrow">Active identity</p><h2>${escapeHtml(mainPersona?.nickname || "Tomori")}</h2></div>
            ${personaAvatar(mainPersona, "persona-avatar-large")}
          </div>
          <div class="signal-list">
            <div><span>Trigger words</span><strong>${mainPersona?.triggerWords?.length || 0}</strong></div>
            <div><span>Context depth</span><strong>${mainPersona?.contextNoteDepth || 0}</strong></div>
            <div><span>Server teaching</span><strong>${overview.memoryPolicy.serverMemoryTeachingEnabled ? "Members enabled" : "Admins only"}</strong></div>
            <div><span>Self teaching</span><strong>${overview.memoryPolicy.selfTeachingEnabled ? "Enabled" : "Disabled"}</strong></div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-heading"><div><p class="eyebrow">Models</p><h2>Generation chain</h2></div></div>
          <div class="model-line"><span class="status-dot"></span><div><strong>${escapeHtml(model?.name || "Not configured")}</strong><span>${escapeHtml(model?.provider || "Text provider")}</span></div></div>
          ${
            overview.modelSummary?.vision
              ? `<div class="model-line"><span class="status-dot status-dot-cyan"></span><div><strong>${escapeHtml(overview.modelSummary.vision.name)}</strong><span>${escapeHtml(overview.modelSummary.vision.provider)} vision</span></div></div>`
              : ""
          }
          ${
            (overview.modelSummary?.fallbacks || [])
              .map(
                (fallback, index) =>
                  `<div class="fallback-line"><span>${index + 1}</span><strong>${escapeHtml(fallback.label)}</strong></div>`,
              )
              .join("") || `<p class="empty-copy">No fallback chain is active.</p>`
          }
        </section>
      </div>
      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Personas</p><h2>Personas</h2></div>
          <button class="button button-secondary" data-nav="personas">Open persona workspace</button>
        </div>
        <div class="persona-row">
          ${overview.personas
            .map(
              (persona) => `<article class="persona-tile">
                ${personaAvatar(persona)}
                <div><strong>${escapeHtml(persona.nickname)}</strong><span>${persona.isAlter ? "Alter persona" : "Main persona"}</span></div>
                <span class="lineage">#${persona.lineageId}</span>
              </article>`,
            )
            .join("")}
        </div>
      </section>
      ${renderServerStats()}`;

    if (!state.serverStats && !state.serverStatsLoading && !state.serverStatsError) {
      loadServerStats();
    }
  }

  function renderStatsRanking(title, eyebrow, entries, valueFormatter) {
    return `<section class="stats-ranking">
      <div class="stats-ranking-heading"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h3>${escapeHtml(title)}</h3></div></div>
      <div class="stats-ranking-list">
        ${
          entries.length
            ? entries
                .map(
                  (entry, index) => `<div class="stats-ranking-row">
                    <span class="stats-rank">${index + 1}</span>
                    <strong>${escapeHtml(entry.name)}</strong>
                    <span>${escapeHtml(valueFormatter(entry))}</span>
                  </div>`,
                )
                .join("")
            : `<p class="stats-empty">No activity in this period yet.</p>`
        }
      </div>
    </section>`;
  }

  function renderServerStats() {
    const timeframeOptions = [
      ["today", "Today"],
      ["week", "7 days"],
      ["month", "30 days"],
      ["year", "Year"],
      ["all_time", "All time"],
    ];
    const timeframeControls = `<div class="stats-timeframes" role="group" aria-label="Statistics timeframe">
      ${timeframeOptions
        .map(
          ([value, label]) =>
            `<button type="button" data-stats-timeframe="${value}" class="${state.statsTimeframe === value ? "is-active" : ""}" aria-pressed="${state.statsTimeframe === value}">${label}</button>`,
        )
        .join("")}
    </div>`;

    let content = `<div class="stats-loading" role="status"><span></span><strong>Loading server activity...</strong></div>`;
    if (state.serverStatsError) {
      content = `<div class="stats-error"><strong>Statistics are unavailable right now.</strong><span>${escapeHtml(state.serverStatsError)}</span><button class="button button-quiet" type="button" data-stats-retry>Try again</button></div>`;
    } else if (state.serverStats) {
      const { totals } = state.serverStats;
      content = `
        <div class="stats-summary-grid">
          <div><span>Persona replies</span><strong>${formatStatNumber(totals.messages)}</strong></div>
          <div><span>Commands used</span><strong>${formatStatNumber(totals.commands)}</strong></div>
          <div><span>Input tokens</span><strong>${formatStatNumber(totals.inputTokens)}</strong></div>
          <div><span>Output tokens</span><strong>${formatStatNumber(totals.outputTokens)}</strong></div>
          <div><span>Images</span><strong>${formatStatNumber(totals.imageGenerations)}</strong></div>
          <div><span>Videos</span><strong>${formatStatNumber(totals.videoGenerations)}</strong></div>
          <div class="stats-cost"><span>Estimated model cost</span><strong>${formatUsd(totals.estimatedCost)}</strong><small>${formatStatNumber(totals.textGenerations)} text generations</small></div>
        </div>
        <div class="stats-ranking-grid">
          ${renderStatsRanking("Popular personas", "Conversation", state.serverStats.personas, (entry) => `${formatStatNumber(entry.count)} replies`)}
          ${renderStatsRanking(
            "Most used models",
            "Generation",
            state.serverStats.models,
            (entry) => `${formatStatNumber(entry.inputTokens + entry.outputTokens)} tokens`,
          )}
          ${renderStatsRanking("Top tools", "Capabilities", state.serverStats.tools, (entry) => `${formatStatNumber(entry.count)} uses`)}
          ${renderStatsRanking("Top commands", "Discord", state.serverStats.topCommands, (entry) => `${formatStatNumber(entry.count)} uses`)}
        </div>`;
    }

    return `<section class="section-band server-stats-section" aria-busy="${state.serverStatsLoading}">
      <div class="section-heading stats-section-heading">
        <div><p class="eyebrow">Server statistics</p><h2>Activity at a glance</h2><p>Usage collected by Tomori's existing statistics system.</p></div>
        ${timeframeControls}
      </div>
      ${content}
    </section>`;
  }

  function updateServerStatsSection() {
    if (state.view !== "overview") return;
    const current = document.querySelector(".server-stats-section");
    if (!current) return;
    const template = document.createElement("template");
    template.innerHTML = renderServerStats();
    const next = template.content.firstElementChild;
    if (next) current.replaceWith(next);
  }

  async function loadServerStats() {
    const guildId = state.guildId;
    const timeframe = state.statsTimeframe;
    state.serverStatsLoading = true;
    state.serverStatsError = "";
    updateServerStatsSection();
    try {
      const response = await api(`/guilds/${guildId}/stats?timeframe=${encodeURIComponent(timeframe)}`);
      if (state.guildId !== guildId || state.statsTimeframe !== timeframe) return;
      state.serverStats = response.stats;
    } catch (error) {
      if (state.guildId !== guildId || state.statsTimeframe !== timeframe) return;
      state.serverStatsError = error.message;
    } finally {
      if (state.guildId === guildId && state.statsTimeframe === timeframe) {
        state.serverStatsLoading = false;
        updateServerStatsSection();
      }
    }
  }

  function renderProfile(workspace) {
    const profile = state.overview.profile;
    workspace.innerHTML = `
      ${pageHeader("Personal", "My profile", "These preferences belong to you, not to the selected server.")}
      <form class="panel form-panel" id="profile-form">
        <div class="panel-heading"><div><p class="eyebrow">Identity</p><h2>Personal defaults</h2></div></div>
        <div class="form-grid">
          <label class="field">${fieldLabel("Nickname", "Your personal display name when Tomori refers to you.")}<input name="user_nickname" value="${escapeHtml(profile.nickname)}" maxlength="80" required></label>
          <label class="field">${fieldLabel("Privacy level", "Controls which personal memory features may store information about you.")}
            <select name="privacy_level">
              <option value="0"${profile.privacyLevel === 0 ? " selected" : ""}>Minimal</option>
              <option value="1"${profile.privacyLevel === 1 ? " selected" : ""}>Partial</option>
              <option value="2"${profile.privacyLevel === 2 ? " selected" : ""}>Full opt-out</option>
            </select>
          </label>
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
          <label class="field">${fieldLabel("Timezone offset", "Your UTC offset for personal date and time context. Empty follows the server default.")}<input name="timezone_offset" type="number" min="-12" max="14" value="${profile.timezoneOffset ?? ""}"></label>
        </div>
        <label class="switch-row"><span><strong>Cross-server short-term memory</strong><small>Share recent context between servers you use.</small></span>
          <input name="shortterm_cache_crossserver_opt_in" type="checkbox"${profile.crossServerShortTermMemory ? " checked" : ""}><i></i>
        </label>
        <label class="field">${fieldLabel("Impersonation prompt", "Instructions Tomori uses when generating a message in your voice.")}<textarea name="impersonation_prompt" rows="5">${escapeHtml(profile.impersonationPrompt || "")}</textarea></label>
        <label class="field">${fieldLabel("Physical appearance tags", "Comma-separated traits used when image generation needs to depict you.")}<input name="physical_appearance_tags" value="${escapeHtml((profile.physicalAppearanceTags || []).join(", "))}"></label>
        <div class="form-actions"><button class="button button-primary" type="submit">Save profile</button></div>
      </form>`;
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
      <section class="memory-command-bar">
        <div><p class="eyebrow">${personal ? "Personal" : "Shared server context"}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div>
        <div class="toolbar-actions">
          <button class="button button-quiet" data-memory-refresh type="button">Refresh</button>
          <button class="button button-quiet" data-memory-export type="button">Export</button>
          <button class="button button-quiet" data-memory-import type="button">Import</button>
          <input id="memory-import-file" type="file" accept="application/json,.json" hidden>
        </div>
      </section>
      ${
        serverWritesDisabled || personalCreationDisabled
          ? `<div class="memory-policy-note"><strong>${personalCreationDisabled ? "New personal memories are disabled by your privacy setting." : "Member teaching is disabled for this server."}</strong><span>Existing entries remain visible according to your access.</span></div>`
          : `<form class="memory-compose panel" id="memory-compose-form">
              <label class="field">${fieldLabel("New memory", "Write one concise fact. Its visibility follows the memory scope shown above.")}<textarea name="content" rows="3" required placeholder="A concise fact Tomori should remember"></textarea></label>
              <div class="compose-row">
                <label class="field">${fieldLabel("Tags", "Optional comma-separated labels that help classify and retrieve this memory.")}<input name="tags" placeholder="preference, character"></label>
                <button class="button button-primary" type="submit">Add memory</button>
              </div>
            </form>`
      }
      <section id="memory-list" class="memory-list"><div class="loading-block">Loading memories...</div></section>`;
  }

  function renderGlobalMemories(workspace) {
    state.memoryKind = "personal";
    state.lineageId = 0;
    workspace.innerHTML = `
      ${pageHeader("Personal", "Global memory", "This is the only memory scope that is not attached to a persona.")}
      <div class="memory-workspace">${renderMemoryCollection({ personal: true, global: true })}</div>`;
    loadMemories();
  }

  async function loadMemories() {
    const list = document.querySelector("#memory-list");
    if (!list) return;
    list.innerHTML = `<div class="loading-block">Loading memories...</div>`;
    try {
      const path = `/guilds/${state.guildId}/memories/${state.memoryKind}?lineageId=${state.lineageId}`;
      state.memoryData = await api(path);
      renderMemoryList();
    } catch (error) {
      list.innerHTML = `<div class="empty-state"><strong>Memories could not be loaded.</strong><span>${escapeHtml(error.message)}</span></div>`;
    }
  }

  function renderMemoryList() {
    const list = document.querySelector("#memory-list");
    if (!list) return;
    const rows = state.memoryData?.memories || [];
    if (!rows.length) {
      list.innerHTML = `<div class="empty-state"><strong>No memories in this scope.</strong><span>The first one you add will appear here.</span></div>`;
      return;
    }
    const serverWritesDisabled =
      state.memoryKind === "server" &&
      !state.overview.canManage &&
      !state.overview.memoryPolicy.serverMemoryTeachingEnabled;
    list.innerHTML = rows
      .map(
        (memory) => `<article class="memory-item">
          <div class="memory-index">#${memory.id}</div>
          <div class="memory-body">
            <p>${escapeHtml(memory.content)}</p>
            <div class="memory-meta">
              ${(memory.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
              ${memory.updatedAt || memory.createdAt ? `<time>${escapeHtml(formatDate(memory.updatedAt || memory.createdAt))}</time>` : ""}
              ${state.memoryKind === "server" && state.overview.canManage && memory.taughtByUserId ? `<small>Teacher #${memory.taughtByUserId}</small>` : ""}
            </div>
          </div>
          ${
            memory.editable === false || serverWritesDisabled
              ? ""
              : `<div class="memory-actions">
                  <button class="button button-quiet button-small" data-memory-edit="${memory.id}" type="button">Edit</button>
                  <button class="button button-danger button-small" data-memory-delete="${memory.id}" type="button">Delete</button>
                </div>`
          }
        </article>`,
      )
      .join("");
  }

  function renderPersonaSettings(persona) {
    const formHeader = (eyebrow, title, description) =>
      `<div class="panel-heading"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2><p>${description}</p></div><button class="button button-secondary button-small" type="submit">Save</button></div>`;
    const attributes = persona.attributes || [];
    const dialogues = persona.sampleDialogues || [];
    const chat = state.personaTestChats[persona.personaId] || [];
    const model = state.overview.modelSummary?.text;

    return `<div class="persona-studio">
      <div class="persona-editor-stack">
        <form class="panel persona-settings-panel" data-persona-id="${persona.personaId}" data-persona-section="identity">
          ${formHeader("Identity", "Display identity", "The name used by this persona in conversation.")}
          <label class="field">${fieldLabel("Nickname", "The name shown in messages, prompts, and dashboard views. A new name is also added as a trigger when room is available.")}<input name="nickname" value="${escapeHtml(persona.nickname)}" minlength="2" maxlength="32" required></label>
        </form>

        <form class="panel persona-settings-panel" data-persona-id="${persona.personaId}" data-persona-section="prompt">
          ${formHeader("Conversation", "Triggers", "Names and phrases that can activate this persona in conversation.")}
          <label class="field">${fieldLabel("Trigger words", "Comma-separated names or phrases that can activate this persona.")}<input name="triggerWords" value="${escapeHtml((persona.triggerWords || []).join(", "))}"></label>
        </form>

        <form class="panel persona-settings-panel" data-persona-id="${persona.personaId}" data-persona-attributes>
          ${formHeader("Character", "Attributes", "Facts supplied to the model as part of this persona's identity. Public attributes may be visible to other personas.")}
          <div class="attribute-editor-list" data-attribute-list>
            ${
              attributes.length
                ? attributes
                    .map(
                      (attribute) => `<div class="attribute-editor-row">
                        <textarea name="attributeText" rows="2" maxlength="2000" data-auto-grow required>${escapeHtml(attribute.text)}</textarea>
                        <label class="inline-check"><input name="attributePublic" type="checkbox"${attribute.isPublic ? " checked" : ""}><span>Public</span></label>
                        <button class="button button-quiet button-small" type="button" data-attribute-remove aria-label="Remove attribute">Remove</button>
                      </div>`,
                    )
                    .join("")
                : `<p class="editor-empty" data-attribute-empty>No attributes yet.</p>`
            }
          </div>
          <div class="form-actions form-actions-split">
            <button class="button button-quiet button-small" type="button" data-attribute-add>Add attribute</button>
          </div>
        </form>

        <section class="panel persona-settings-panel" data-persona-id="${persona.personaId}">
          <div class="panel-heading"><div><p class="eyebrow">Voice</p><h2>Sample dialogues</h2><p>Example exchanges teach the model how this persona tends to respond.</p></div></div>
          <div class="dialogue-editor-list">
            ${
              dialogues.length
                ? dialogues
                    .map(
                      (
                        dialogue,
                        index,
                      ) => `<form class="dialogue-editor" data-persona-dialogue="${index}" data-persona-id="${persona.personaId}">
                        <div class="dialogue-editor-heading"><span>Example ${index + 1}</span><button class="button button-danger button-small" type="button" data-dialogue-delete="${index}" data-persona-id="${persona.personaId}">Delete</button></div>
                        <label class="field">${fieldLabel("User", "The example input.")}<textarea name="input" rows="3" required>${escapeHtml(dialogue.input)}</textarea></label>
                        <label class="field">${fieldLabel(persona.nickname, "The persona's example response.")}<textarea name="output" rows="3" required>${escapeHtml(dialogue.output)}</textarea></label>
                        <div class="form-actions"><button class="button button-secondary button-small" type="submit">Save example</button></div>
                      </form>`,
                    )
                    .join("")
                : `<p class="editor-empty">No sample dialogues yet.</p>`
            }
          </div>
          <form class="dialogue-editor dialogue-editor-new" data-persona-dialogue-new data-persona-id="${persona.personaId}">
            <div class="dialogue-editor-heading"><span>Add example</span></div>
            <label class="field">${fieldLabel("User", "A representative message or situation.")}<textarea name="input" rows="3" required></textarea></label>
            <label class="field">${fieldLabel(persona.nickname, "How the persona should answer.")}<textarea name="output" rows="3" required></textarea></label>
            <div class="form-actions"><button class="button button-secondary button-small" type="submit">Add example</button></div>
          </form>
        </section>

        <form class="panel persona-settings-panel" data-persona-id="${persona.personaId}" data-persona-section="context">
          ${formHeader("Context", "Pinned context note", "Persistent context inserted at the configured depth.")}
          <label class="field">${fieldLabel("Context note", "Persona-specific context inserted into the assembled conversation.")}<textarea name="contextNote" rows="5">${escapeHtml(persona.contextNote || "")}</textarea></label>
          <label class="field">${fieldLabel("Depth", "How far back in the prompt the note is inserted.")}<input name="contextNoteDepth" type="number" min="0" max="100" value="${persona.contextNoteDepth || 0}"></label>
        </form>

        ${
          persona.isAlter
            ? `<section class="panel persona-settings-panel danger-panel" data-persona-id="${persona.personaId}">
                <div><p class="eyebrow">Danger zone</p><h2>Delete alter persona</h2><p>This removes the server's persona configuration. Memories remain governed by their own ownership and retention rules.</p></div>
                <button class="button button-danger" type="button" data-persona-delete="${persona.personaId}">Delete persona</button>
              </section>`
            : ""
        }
      </div>

      <aside class="panel persona-test-panel" data-persona-id="${persona.personaId}">
        <div class="persona-test-heading">
          <div>${personaAvatar(persona)}<span><p class="eyebrow">Private preview</p><h2>Test ${escapeHtml(persona.nickname)}</h2></span></div>
          <button class="button button-quiet button-small" type="button" data-test-chat-reset="${persona.personaId}"${chat.length ? "" : " disabled"}>Reset</button>
        </div>
        <div class="test-chat-model"><span>${escapeHtml(model?.name || "Configured text model")}</span><small>No Discord messages or memory writes</small></div>
        <div class="test-chat-messages" aria-live="polite">
          ${
            chat.length
              ? chat
                  .map(
                    (message) => `<article class="test-chat-message test-chat-${message.role}">
                      <span>${message.role === "user" ? "You" : escapeHtml(persona.nickname)}</span>
                      <p>${escapeHtml(message.content)}</p>
                    </article>`,
                  )
                  .join("")
              : `<div class="test-chat-empty"><strong>Start a clean test conversation.</strong><span>The preview uses the current saved persona settings. Save edits before testing them.</span></div>`
          }
          ${state.personaTestChatBusy ? `<div class="test-chat-typing"><span></span><span></span><span></span></div>` : ""}
        </div>
        <form class="test-chat-compose" id="persona-test-chat-form" data-persona-id="${persona.personaId}">
          <label class="sr-only" for="persona-test-input">Test message</label>
          <textarea id="persona-test-input" name="message" rows="3" maxlength="4000" placeholder="Message ${escapeHtml(persona.nickname)}..." required${state.personaTestChatBusy ? " disabled" : ""}></textarea>
          <button class="button button-primary" type="submit"${state.personaTestChatBusy ? " disabled" : ""}>Send</button>
        </form>
      </aside>
    </div>`;
  }

  function renderPersonaAppearance(persona) {
    const formHeader = (eyebrow, title, description) =>
      `<div class="panel-heading"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2><p>${description}</p></div><button class="button button-secondary button-small" type="submit">Save</button></div>`;

    return `<div class="persona-appearance-grid">
      <section class="panel persona-settings-panel persona-avatar-panel persona-avatar-showcase" data-persona-id="${persona.personaId}">
        <div class="panel-heading">
          <div><p class="eyebrow">Portrait</p><h2>Persona avatar</h2><p>${persona.isAlter ? "Used by this persona's webhook messages." : "Updates TomoriBot's server-specific Discord avatar."}</p></div>
        </div>
        <div class="avatar-editor avatar-editor-showcase">
          ${personaAvatar(persona, "persona-appearance-avatar")}
          <div>
            <strong>${escapeHtml(persona.nickname)}</strong>
            <span>${persona.isPointer ? "This shared preset will become a local copy when edited." : "PNG, JPEG, or GIF."}</span>
            <div class="toolbar-actions avatar-actions">
              <button class="button button-secondary button-small" type="button" data-persona-avatar-choose="${persona.personaId}">Change avatar</button>
              <button class="button button-quiet button-small" type="button" data-persona-avatar-remove="${persona.personaId}">Remove</button>
            </div>
            <input class="sr-only" id="persona-avatar-file-${persona.personaId}" data-persona-avatar-file="${persona.personaId}" type="file" accept=".png,.jpg,.jpeg,.gif,image/png,image/jpeg,image/gif">
          </div>
        </div>
      </section>
      <div class="persona-appearance-editor">
        <form class="panel persona-settings-panel" data-persona-id="${persona.personaId}" data-persona-section="prompt">
          ${formHeader("Image generation", "Visual character prompt", "A visual description Tomori can also use when generating images. This is not the persona's main conversation prompt.")}
          <label class="field">${fieldLabel("Visual description", "Describe the character's stable visual identity, clothing, features, and other image-generation details.")}<textarea name="personaPrompt" rows="10">${escapeHtml(persona.personaPrompt || "")}</textarea></label>
        </form>
        <form class="panel persona-settings-panel" data-persona-id="${persona.personaId}" data-persona-section="appearance">
          ${formHeader("Image generation", "Appearance tags", "Reusable visual traits added when this persona appears in generated images.")}
          <label class="field">${fieldLabel("Physical appearance tags", "Comma-separated visual traits reused when generating this persona.")}<input name="physicalAppearanceTags" value="${escapeHtml((persona.physicalAppearanceTags || []).join(", "))}"></label>
        </form>
      </div>
    </div>`;
  }

  function renderPersonaWorkspace(workspace) {
    const personas = (state.overview.personas || []).filter((persona) => persona.lineageId !== 0);
    const personaActions = state.overview.canManage
      ? `<button class="button button-secondary" type="button" data-persona-import-open>Import</button>
         <button class="button button-primary" type="button" data-persona-create-open>New persona</button>`
      : "";
    if (!personas.length) {
      workspace.innerHTML = `${pageHeader("Persona workspace", "Personas", "Create or import an identity for this server.", personaActions)}
        <div class="empty-state"><strong>No personas are available in this server.</strong></div>`;
      return;
    }
    if (!personas.some((persona) => persona.personaId === state.personaId)) {
      state.personaId = personas[0].personaId;
    }
    if (!state.overview.canManage && ["settings", "appearance"].includes(state.personaPanel)) {
      state.personaPanel = "personal";
    }

    const persona = personas.find((entry) => entry.personaId === state.personaId) || personas[0];
    const memoryPanel = !["settings", "appearance"].includes(state.personaPanel);
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
      <nav class="persona-picker" aria-label="Personas">
        ${personas
          .map(
            (
              entry,
            ) => `<button class="persona-picker-item${entry.personaId === persona.personaId ? " is-active" : ""}" type="button" data-persona-select="${entry.personaId}" aria-pressed="${entry.personaId === persona.personaId}">
              ${personaAvatar(entry)}
              <span><strong>${escapeHtml(entry.nickname)}</strong><small>${entry.isAlter ? "Alter" : "Main"} / #${entry.lineageId}</small></span>
            </button>`,
          )
          .join("")}
      </nav>
      <section class="persona-focus">
        <div class="persona-focus-identity">
          ${personaAvatar(persona, "persona-focus-avatar")}
          <div><p class="eyebrow">${persona.isAlter ? "Alter persona" : "Main persona"}</p><h2>${escapeHtml(persona.nickname)}</h2><span>Lineage ${persona.lineageId} / ${(persona.triggerWords || []).length} trigger words</span></div>
        </div>
        <nav class="persona-tabs" role="tablist" aria-label="${escapeHtml(persona.nickname)} workspace">
          <button class="persona-tab${state.personaPanel === "personal" ? " is-active" : ""}" type="button" role="tab" aria-selected="${state.personaPanel === "personal"}" data-persona-panel="personal">Personal memory</button>
          <button class="persona-tab${state.personaPanel === "server" ? " is-active" : ""}" type="button" role="tab" aria-selected="${state.personaPanel === "server"}" data-persona-panel="server">Server knowledge</button>
          ${
            state.overview.canManage
              ? `<button class="persona-tab${state.personaPanel === "settings" ? " is-active" : ""}" type="button" role="tab" aria-selected="${state.personaPanel === "settings"}" data-persona-panel="settings">Persona settings</button>
                 <button class="persona-tab${state.personaPanel === "appearance" ? " is-active" : ""}" type="button" role="tab" aria-selected="${state.personaPanel === "appearance"}" data-persona-panel="appearance">Appearance &amp; image prompt</button>`
              : ""
          }
        </nav>
      </section>
      <div class="persona-panel-content">
        ${
          state.personaPanel === "settings"
            ? renderPersonaSettings(persona)
            : state.personaPanel === "appearance"
              ? renderPersonaAppearance(persona)
              : renderMemoryCollection({
                  personal: state.personaPanel === "personal",
                  persona,
                })
        }
      </div>`;

    if (memoryPanel) {
      loadMemories();
    } else {
      resizeAutoGrowTextareas(workspace);
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
      return `<label class="switch-row"><span><strong>${escapeHtml(field.label)}</strong>${field.hint ? `<small>${escapeHtml(field.hint)}</small>` : ""}</span>
        <input name="${escapeHtml(field.key)}" type="checkbox"${value ? " checked" : ""}><i></i></label>`;
    }
    if (field.type === "textarea") {
      return `<label class="field field-wide">${fieldLabel(field.label, field.hint)}<textarea name="${escapeHtml(field.key)}" rows="5">${escapeHtml(value ?? "")}</textarea></label>`;
    }
    if (field.type === "channels") {
      const selected = new Set(Array.isArray(value) ? value.map(String) : []);
      const options = state.overview.channels
        .map(
          (channel) =>
            `<label class="check-option"><input type="checkbox" name="${escapeHtml(field.key)}" value="${channel.id}"${selected.has(channel.id) ? " checked" : ""}><span><strong>#${escapeHtml(channel.name)}</strong>${channel.parentName ? `<small>${escapeHtml(channel.parentName)}</small>` : ""}</span></label>`,
        )
        .join("");
      return `<fieldset class="field field-wide choice-field"><legend>${escapeHtml(field.label)}</legend>${field.hint ? `<p class="field-hint">${escapeHtml(field.hint)}</p>` : ""}<div class="check-grid">${options || '<p class="choice-empty">No text channels are available.</p>'}</div></fieldset>`;
    }
    if (field.type === "multiselect") {
      const selected = new Set(Array.isArray(value) ? value.map(String) : []);
      const options = (field.options || [])
        .map(
          (option) =>
            `<label class="check-option"><input type="checkbox" name="${escapeHtml(field.key)}" value="${escapeHtml(option.value)}"${selected.has(String(option.value)) ? " checked" : ""}><span><strong>${escapeHtml(option.label)}</strong></span></label>`,
        )
        .join("");
      return `<fieldset class="field field-wide choice-field"><legend>${escapeHtml(field.label)}</legend>${field.hint ? `<p class="field-hint">${escapeHtml(field.hint)}</p>` : ""}<div class="check-grid check-grid-compact">${options}</div></fieldset>`;
    }
    if (field.type === "select" || field.type === "persona") {
      return `<label class="field">${fieldLabel(field.label, field.hint)}<select name="${escapeHtml(field.key)}">${selectOptions(field, value)}</select></label>`;
    }
    if (field.type === "number") {
      return `<label class="field">${fieldLabel(field.label, field.hint)}<input name="${escapeHtml(field.key)}" type="number" min="${field.min}" max="${field.max}" step="${field.step || 1}" value="${value ?? ""}"${field.nullable ? "" : " required"}></label>`;
    }
    return `<label class="field field-wide">${fieldLabel(field.label, field.hint)}<input name="${escapeHtml(field.key)}" value="${escapeHtml(Array.isArray(value) ? value.join(", ") : (value ?? ""))}"></label>`;
  }

  function renderSettings(workspace) {
    const settings = state.overview.settings;
    if (!settings) {
      workspace.innerHTML = `<div class="empty-state"><strong>Manage Server permission required.</strong></div>`;
      return;
    }
    const activeGroup = settingsGroups.find((group) => group.id === state.settingsGroup) || settingsGroups[0];
    const sectionById = new Map(settings.catalog.map((section) => [section.id, section]));
    const renderPanel = (panel) => {
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
      const primarySection = sources[0].section;
      return `<form class="panel settings-panel${panel.wide ? " is-wide" : ""}" data-settings-sections="${sources.map((source) => source.section.id).join(",")}" data-settings-panel-title="${escapeHtml(panel.title || primarySection.title)}">
        <div class="panel-heading"><div><p class="eyebrow">${escapeHtml(panel.eyebrow || primarySection.eyebrow)}</p><h2>${escapeHtml(panel.title || primarySection.title)}</h2><p>${escapeHtml(panel.description || primarySection.description)}</p></div></div>
        <div class="settings-fields">
          ${sources
            .flatMap(({ section, fields }) =>
              fields.map((field) => renderSettingField(field, settings.values[section.id]?.[field.key])),
            )
            .join("")}
        </div>
        <div class="form-actions"><button class="button button-primary" type="submit">Save changes</button></div>
      </form>`;
    };
    const visiblePanels =
      activeGroup.panels ||
      settings.catalog
        .filter((section) => activeGroup.sections.includes(section.id))
        .map((section) => ({
          section: section.id,
          eyebrow: section.eyebrow,
          title: section.title,
          description: section.description,
        }));
    const settingsContent = `<div class="settings-grid${activeGroup.id === "conversation" ? " settings-grid-conversation" : ""}">
      ${visiblePanels.map(renderPanel).join("")}
    </div>`;
    workspace.innerHTML = `
      ${pageHeader(
        "Administration",
        "Server settings",
        "Each panel maps to one current TomoriBot config domain and saves independently.",
        `<button class="button button-secondary" data-overview-refresh type="button">Refresh all</button>`,
      )}
      <nav class="settings-tabs" role="tablist" aria-label="Server settings groups">
        ${settingsGroups
          .map(
            (group) =>
              `<button class="settings-tab${group.id === activeGroup.id ? " is-active" : ""}" type="button" role="tab" aria-selected="${group.id === activeGroup.id}" data-settings-group="${group.id}">${escapeHtml(group.label)}</button>`,
          )
          .join("")}
      </nav>
      ${settingsContent}`;
  }

  const providerCapabilities = [
    ["text", "Text"],
    ["vision", "Vision"],
    ["embedding", "Embeddings"],
    ["image", "Images"],
    ["video", "Video"],
  ];

  function providerChoiceOptions(data) {
    return (data.choices || [])
      .map((choice) => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.name)}</option>`)
      .join("");
  }

  function renderProviderRows(data, scope) {
    if (!data.providers?.length) {
      return `<div class="empty-state compact-empty"><strong>No saved providers.</strong></div>`;
    }
    return data.providers
      .map((provider) => {
        const enabled = new Set(provider.enabledCapabilities || []);
        const capabilityControls =
          scope === "personal"
            ? `<div class="capability-grid">${providerCapabilities
                .map(([capability, label]) => {
                  const configured = provider.configuredCapabilities?.[capability];
                  return `<label class="capability-toggle${configured ? "" : " is-unavailable"}">
                    <input type="checkbox" data-provider-capability="${capability}" data-provider="${escapeHtml(provider.provider)}"${enabled.has(capability) ? " checked" : ""}${configured ? "" : " disabled"}>
                    <span>${label}</span>
                  </label>`;
                })
                .join("")}</div>`
            : "";
        const removable =
          scope === "personal" && !provider.provider.startsWith("custom:")
            ? `<button class="button button-danger button-small" type="button" data-provider-delete="${escapeHtml(provider.provider)}">Remove</button>`
            : "";
        return `<article class="provider-row">
          <div class="provider-row-heading">
            <div><span class="provider-scope">${scope === "personal" ? "Personal" : "Server"} provider</span><strong>${escapeHtml(provider.displayName)}</strong><small>${provider.hasApiKey ? "Encrypted key stored" : "No key stored"}</small></div>
            ${removable}
          </div>
          ${capabilityControls}
        </article>`;
      })
      .join("");
  }

  function renderEndpointRows(data, scope) {
    if (!data.endpoints?.length) {
      return `<div class="empty-state compact-empty"><strong>No custom endpoints.</strong></div>`;
    }
    return data.endpoints
      .map(
        (endpoint) => `<article class="provider-row endpoint-row">
          <div class="provider-row-heading">
            <div><span class="provider-scope">${escapeHtml(endpoint.capability)} / ${escapeHtml(endpoint.apiStyle)}</span><strong>${escapeHtml(endpoint.displayName)}</strong><small>${escapeHtml(endpoint.endpointUrl)}</small></div>
            <button class="button button-danger button-small" type="button" data-endpoint-delete="${endpoint.id}" data-provider-scope="${scope}">Remove</button>
          </div>
          <div class="endpoint-flags">
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
      return `<div class="empty-state compact-empty"><strong>No additional scoped registrations.</strong><p>Built-in OpenRouter models come from Tomori's catalog and appear in selectors once an OpenRouter provider profile is configured.</p></div>`;
    }
    return data.openRouterModels
      .map(
        (model) => `<article class="provider-row provider-row-inline">
          <div><span class="provider-scope">${escapeHtml(model.capability)}</span><strong>${escapeHtml(model.codename)}</strong></div>
          <button class="button button-danger button-small" type="button" data-openrouter-delete="${escapeHtml(model.codename)}" data-openrouter-capability="${escapeHtml(model.capability)}" data-provider-scope="${scope}">Remove</button>
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
    return `<form class="panel provider-panel server-model-panel" id="server-models-form">
      <div class="panel-heading"><div><p class="eyebrow">Server defaults</p><h2>Primary models</h2><p>Global model choices used unless a persona, channel, or personal provider overrides them.</p></div></div>
      <div class="form-grid server-model-grid">
        ${fields
          .map(
            ([kind, label, description, allowNone]) =>
              `<label class="field">${fieldLabel(label, description)}<select name="${kind}"${kind === "text" ? " required" : ""}>${renderOptions(kind, allowNone)}</select></label>`,
          )
          .join("")}
      </div>
      <div class="form-actions"><button class="button button-primary" type="submit">Save primary models</button></div>
    </form>`;
  }

  function renderFallbacks(data) {
    const options = (data.fallbackOptions || [])
      .map((option) => `<option value="${option.ref.type}:${option.ref.id}">${escapeHtml(option.label)}</option>`)
      .join("");
    return `<form class="panel provider-panel" id="fallback-form">
      <div class="panel-heading"><div><p class="eyebrow">Failover</p><h2>Fallback chain</h2><p>Ordered text models used when the primary model fails.</p></div></div>
      <div class="fallback-editor">
        ${[0, 1, 2, 3, 4]
          .map((index) => {
            const selected = data.fallbackRefs?.[index];
            const value = selected ? `${selected.type}:${selected.id}` : "";
            return `<label class="field">${fieldLabel(`Fallback ${index + 1}`, index === 0 ? "First alternative tried when the primary text model fails." : `Used only if fallback ${index} also fails.`)}<select name="fallback-${index}"><option value="">None</option>${options.replace(`value="${value}"`, `value="${value}" selected`)}</select></label>`;
          })
          .join("")}
      </div>
      <div class="form-actions"><button class="button button-primary" type="submit">Save chain</button></div>
    </form>`;
  }

  function renderProviders(workspace, scope) {
    const data = state.providerData[scope];
    const personal = scope === "personal";
    if (!data) {
      workspace.innerHTML = `${pageHeader(personal ? "Personal" : "Administration", personal ? "My providers" : "Server providers", "Loading provider configuration.")}<div class="loading-panel"><span></span>Loading providers</div>`;
      loadProviderWorkspace(scope);
      return;
    }

    workspace.innerHTML = `
      ${pageHeader(
        personal ? "Personal" : "Administration",
        personal ? "My providers" : "Server providers",
        personal
          ? data.byokRequired
            ? "This server requires personal provider credentials."
            : "Your encrypted credentials and active personal capabilities."
          : "Server-owned credentials, endpoints, registrations, and failover.",
        `<button class="button button-secondary" type="button" data-provider-refresh="${scope}">Refresh</button>`,
      )}
      ${personal ? "" : renderServerModels(data)}
      <div class="provider-layout">
        <form class="panel provider-panel" id="provider-credential-form" data-provider-scope="${scope}">
          <div class="panel-heading"><div><p class="eyebrow">Credentials</p><h2>Add or replace a key</h2></div></div>
          <div class="form-grid">
            <label class="field">${fieldLabel("Provider", "Service this credential belongs to and the capabilities it may unlock.")}<select name="provider">${providerChoiceOptions(data)}</select></label>
            <label class="field">${fieldLabel("API key", "Stored encrypted. Existing secret values are never returned to the browser.")}<input name="apiKey" type="password" autocomplete="new-password" minlength="10" required></label>
          </div>
          <label class="switch-row"><span><strong>Validate before saving</strong><small>Tests the credential with its provider before replacing the stored key.</small></span><input name="validateApiKey" type="checkbox" checked><i></i></label>
          <div class="form-actions"><button class="button button-primary" type="submit">Store encrypted key</button></div>
        </form>
        <section class="panel provider-panel">
          <div class="panel-heading"><div><p class="eyebrow">Saved</p><h2>${personal ? "My provider profiles" : "Server provider profiles"}</h2></div></div>
          <div class="provider-list">${renderProviderRows(data, scope)}</div>
        </section>
        <form class="panel provider-panel" id="endpoint-form" data-provider-scope="${scope}">
          <div class="panel-heading"><div><p class="eyebrow">Custom</p><h2>Register endpoint</h2></div></div>
          <div class="form-grid">
            <label class="field">${fieldLabel("Internal label", "Stable letters, numbers, underscores, or dashes used to identify this endpoint.")}<input name="label" pattern="[A-Za-z0-9_-]+" maxlength="48" required></label>
            <label class="field">${fieldLabel("Display name", "Human-readable name shown in model and provider selectors.")}<input name="displayName" maxlength="120" required></label>
            <label class="field field-wide">${fieldLabel("Endpoint URL", "Base URL Tomori connects to. It is tested before registration.")}<input name="endpointUrl" type="url" required></label>
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
          <div class="option-grid">
            ${[
              ["hasTools", "Tools"],
              ["seesImages", "Vision"],
              ["seesVideos", "Video input"],
              ["supportsStructOutput", "Structured output"],
              ["strictRoleAlternation", "Strict roles"],
              ["supportsPrefixCompletion", "Prefix completion"],
            ]
              .map(
                ([name, label]) =>
                  `<label class="capability-toggle"><input name="${name}" type="checkbox"><span>${label}</span></label>`,
              )
              .join("")}
          </div>
          <div class="form-actions"><button class="button button-primary" type="submit">Test and register</button></div>
        </form>
        <section class="panel provider-panel">
          <div class="panel-heading"><div><p class="eyebrow">Endpoints</p><h2>Registered connections</h2></div></div>
          <div class="provider-list">${renderEndpointRows(data, scope)}</div>
        </section>
        <form class="panel provider-panel" id="openrouter-form" data-provider-scope="${scope}">
          <div class="panel-heading"><div><p class="eyebrow">OpenRouter</p><h2>Scoped model registration</h2></div></div>
          <div class="form-grid">
            <label class="field">${fieldLabel("Capability", "Determines which Tomori model selector may use this registration.")}<select name="capability"><option value="text">Text</option><option value="embedding">Embeddings</option><option value="image">Images</option><option value="video">Video</option></select></label>
            <label class="field">${fieldLabel("Model codename", "Exact OpenRouter identifier, usually in provider/model-name format.")}<input name="modelName" placeholder="provider/model-name" maxlength="240" required></label>
          </div>
          <div class="form-actions"><button class="button button-primary" type="submit">Register model</button></div>
        </form>
        <section class="panel provider-panel">
          <div class="panel-heading"><div><p class="eyebrow">Registry</p><h2>Additional scoped registrations</h2><p>Custom OpenRouter catalog entries registered only for this ${personal ? "user" : "server"}.</p></div></div>
          <div class="provider-list">${renderOpenRouterRows(data, scope)}</div>
        </section>
      </div>
      ${personal ? "" : renderFallbacks(data)}`;
  }

  async function loadProviderWorkspace(scope, notify = false) {
    try {
      state.providerData[scope] = await api(`/guilds/${state.guildId}/providers/${scope}`);
      const expectedView = scope === "personal" ? "personal-providers" : "server-providers";
      if (state.view === expectedView) renderView();
      if (notify) toast("Providers refreshed");
      return true;
    } catch (error) {
      toast(error.message, "error");
      const workspace = document.querySelector("#workspace");
      if (workspace)
        workspace.innerHTML = `<div class="empty-state"><strong>${escapeHtml(error.message)}</strong></div>`;
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
      app.innerHTML = `<main class="login-screen"><div class="login-brand"><img src="/settings/assets/tomori_companion_logo.svg" alt="TomoriBot" class="login-logo"><h1>This server could not be loaded.</h1><p class="login-copy">${escapeHtml(error.message)}</p><button class="button button-secondary" id="retry-boot">Retry</button></div></main>`;
      document.querySelector("#retry-boot")?.addEventListener("click", () => selectGuild(guildId));
    }
  }

  async function refreshOverview(message = "Dashboard refreshed") {
    const overview = await api(`/guilds/${state.guildId}/overview`);
    state.overview = overview;
    renderShell();
    toast(message);
  }

  function confirmAction(title, message) {
    const dialog = document.querySelector("#confirm-dialog");
    if (!dialog?.showModal) return Promise.resolve(window.confirm(message));
    dialog.querySelector("#confirm-title").textContent = title;
    dialog.querySelector("#confirm-message").textContent = message;
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
    state.providerData[scope] = null;
    if (scope === "server") {
      state.overview = await api(`/guilds/${state.guildId}/overview`);
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
    if (!(await confirmAction("Remove endpoint?", "This also removes its scoped model registration."))) return;
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
    if (!(await confirmAction("Remove model registration?", "The scoped OpenRouter registration will be removed."))) {
      return;
    }
    try {
      await api(`/guilds/${state.guildId}/providers/${scope}/openrouter`, {
        method: "DELETE",
        body: JSON.stringify({ capability, modelName }),
      });
      await refreshProviders(scope, "OpenRouter model removed");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function withBusyForm(form, action) {
    const controls = Array.from(form.querySelectorAll("button, input, select, textarea"));
    controls.forEach((control) => {
      control.disabled = true;
    });
    form.classList.add("is-saving");
    try {
      await action();
    } finally {
      controls.forEach((control) => {
        control.disabled = false;
      });
      form.classList.remove("is-saving");
    }
  }

  function openMemoryEditor(memoryId) {
    const memory = state.memoryData?.memories?.find((entry) => entry.id === memoryId);
    const dialog = document.querySelector("#memory-dialog");
    if (!memory || !dialog?.showModal) return;
    const form = dialog.querySelector("#memory-edit-form");
    form.elements.content.value = memory.content;
    form.elements.tags.value = (memory.tags || []).join(", ");
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
          memories: memoriesPayload.map((entry) =>
            typeof entry === "string"
              ? { content: entry, tags: [] }
              : { content: entry.content, tags: entry.tags || [] },
          ),
        }),
      });
      toast(`Imported ${result.inserted}; skipped ${result.skipped}`, result.inserted ? "success" : "warning");
      await loadMemories();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function refreshPersonas(personaId, message) {
    state.overview = await api(`/guilds/${state.guildId}/overview`);
    if (personaId && state.overview.personas.some((persona) => persona.personaId === personaId)) {
      state.personaId = personaId;
    }
    state.avatarRevision += 1;
    renderView();
    if (message) toast(message);
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

  function appendAttributeRow(form) {
    const list = form.querySelector("[data-attribute-list]");
    if (!list) return;
    list.querySelector("[data-attribute-empty]")?.remove();
    const row = document.createElement("div");
    row.className = "attribute-editor-row";
    row.innerHTML = `
      <textarea name="attributeText" rows="2" maxlength="2000" data-auto-grow required></textarea>
      <label class="inline-check"><input name="attributePublic" type="checkbox"><span>Public</span></label>
      <button class="button button-quiet button-small" type="button" data-attribute-remove aria-label="Remove attribute">Remove</button>`;
    list.append(row);
    const textarea = row.querySelector("textarea");
    resizeAutoGrowTextarea(textarea);
    textarea?.focus();
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
    if (
      !(await confirmAction(
        `Delete ${persona.nickname}?`,
        "This removes the alter persona from this server and cannot be undone.",
      ))
    ) {
      return;
    }
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
      await refreshPersonas(personaId, "Sample dialogue deleted");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  document.addEventListener(
    "error",
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.dataset.avatarFallback) return;
      const fallback = document.createElement("span");
      fallback.className = `${image.className} persona-avatar-fallback`;
      fallback.textContent = image.dataset.avatarFallback;
      image.replaceWith(fallback);
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !event.ctrlKey) return;
    const input = event.target instanceof Element ? event.target.closest("#persona-test-input") : null;
    if (!input || input.disabled || state.personaTestChatBusy) return;
    event.preventDefault();
    input.form?.requestSubmit();
  });

  document.addEventListener("input", (event) => {
    const textarea = event.target.closest?.("textarea[data-auto-grow]");
    if (textarea) resizeAutoGrowTextarea(textarea);
  });

  document.addEventListener("click", async (event) => {
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
    const statsTimeframe = event.target.closest("[data-stats-timeframe]");
    if (statsTimeframe) {
      if (statsTimeframe.dataset.statsTimeframe !== state.statsTimeframe) {
        state.statsTimeframe = statsTimeframe.dataset.statsTimeframe;
        state.serverStatsError = "";
        loadServerStats();
      }
      return;
    }
    if (event.target.closest("[data-stats-retry]")) {
      state.serverStatsError = "";
      loadServerStats();
      return;
    }
    const paletteChoice = event.target.closest("[data-palette-choice]");
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
    const attributeAdd = event.target.closest("[data-attribute-add]");
    if (attributeAdd) {
      const form = attributeAdd.closest("[data-persona-attributes]");
      if (form) appendAttributeRow(form);
      return;
    }
    const attributeRemove = event.target.closest("[data-attribute-remove]");
    if (attributeRemove) {
      const form = attributeRemove.closest("[data-persona-attributes]");
      attributeRemove.closest(".attribute-editor-row")?.remove();
      const list = form?.querySelector("[data-attribute-list]");
      if (list && !list.querySelector(".attribute-editor-row")) {
        list.innerHTML = `<p class="editor-empty" data-attribute-empty>No attributes yet.</p>`;
      }
      return;
    }
    const dialogueDelete = event.target.closest("[data-dialogue-delete]");
    if (dialogueDelete) {
      await removeDialogue(Number(dialogueDelete.dataset.personaId), Number(dialogueDelete.dataset.dialogueDelete));
      return;
    }
    const personaDelete = event.target.closest("[data-persona-delete]");
    if (personaDelete) {
      await removePersona(Number(personaDelete.dataset.personaDelete));
      return;
    }
    const chatReset = event.target.closest("[data-test-chat-reset]");
    if (chatReset) {
      const personaId = Number(chatReset.dataset.testChatReset);
      if (state.personaTestChats[personaId]?.length) {
        if (!(await confirmAction("Reset test chat?", "This clears the local preview conversation."))) return;
        state.personaTestChats[personaId] = [];
        renderView();
      }
      return;
    }
    const personaSelect = event.target.closest("[data-persona-select]");
    if (personaSelect) {
      state.personaId = Number(personaSelect.dataset.personaSelect);
      state.memoryData = null;
      renderView();
      return;
    }
    const personaPanel = event.target.closest("[data-persona-panel]");
    if (personaPanel) {
      state.personaPanel = personaPanel.dataset.personaPanel;
      state.memoryData = null;
      renderView();
      return;
    }
    const settingsGroup = event.target.closest("[data-settings-group]");
    if (settingsGroup) {
      state.settingsGroup = settingsGroup.dataset.settingsGroup;
      renderView();
      return;
    }
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      state.view = nav.dataset.nav;
      state.memoryData = null;
      renderShell();
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
      try {
        await refreshOverview("Server settings refreshed");
      } catch (error) {
        toast(error.message, "error");
      }
    }
  });

  document.addEventListener("change", async (event) => {
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
    const capabilityToggle = event.target.closest("[data-provider-capability]");
    if (capabilityToggle) {
      capabilityToggle.disabled = true;
      try {
        await api(
          `/guilds/${state.guildId}/providers/personal/${encodeURIComponent(capabilityToggle.dataset.provider)}/capability`,
          {
            method: "PATCH",
            body: JSON.stringify({
              capability: capabilityToggle.dataset.providerCapability,
              enabled: capabilityToggle.checked,
            }),
          },
        );
        await refreshProviders("personal", "Provider capability updated");
      } catch (error) {
        capabilityToggle.checked = !capabilityToggle.checked;
        capabilityToggle.disabled = false;
        toast(error.message, "error");
      }
    }
  });

  document.addEventListener("submit", async (event) => {
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

    const attributesForm = event.target.closest("[data-persona-attributes]");
    if (attributesForm) {
      event.preventDefault();
      const personaId = Number(attributesForm.dataset.personaId);
      const attributes = Array.from(attributesForm.querySelectorAll(".attribute-editor-row")).map((row) => ({
        text: row.querySelector('[name="attributeText"]').value,
        isPublic: row.querySelector('[name="attributePublic"]').checked,
      }));
      try {
        await withBusyForm(attributesForm, async () => {
          await api(`/guilds/${state.guildId}/personas/${personaId}/attributes`, {
            method: "PUT",
            body: JSON.stringify({ attributes }),
          });
        });
        await refreshPersonas(personaId, "Attributes saved");
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }

    const dialogueForm = event.target.closest("[data-persona-dialogue], [data-persona-dialogue-new]");
    if (dialogueForm) {
      event.preventDefault();
      const personaId = Number(dialogueForm.dataset.personaId);
      const isNew = dialogueForm.hasAttribute("data-persona-dialogue-new");
      const index = Number(dialogueForm.dataset.personaDialogue);
      try {
        await withBusyForm(dialogueForm, async () => {
          await api(
            isNew
              ? `/guilds/${state.guildId}/personas/${personaId}/dialogues`
              : `/guilds/${state.guildId}/personas/${personaId}/dialogues/${index}`,
            {
              method: isNew ? "POST" : "PATCH",
              body: JSON.stringify({
                input: dialogueForm.elements.input.value,
                output: dialogueForm.elements.output.value,
              }),
            },
          );
        });
        await refreshPersonas(personaId, isNew ? "Sample dialogue added" : "Sample dialogue saved");
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
      renderView();
      scrollTestChat();
      try {
        const result = await api(`/guilds/${state.guildId}/personas/test-chat`, {
          method: "POST",
          body: JSON.stringify({ personaId, messages: history }),
        });
        state.personaTestChats[personaId] = [...history, { role: "assistant", content: result.content }].slice(-24);
      } catch (error) {
        toast(error.message, "error");
      } finally {
        state.personaTestChatBusy = false;
        renderView();
        scrollTestChat();
      }
      return;
    }

    if (event.target.id === "provider-credential-form") {
      event.preventDefault();
      const form = event.target;
      const scope = form.dataset.providerScope;
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
        await refreshProviders(scope, "Provider key stored");
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
              displayName: form.elements.displayName.value,
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
        await refreshProviders(scope, "Endpoint tested and registered");
      } catch (error) {
        toast(error.message, "error");
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
        await refreshProviders(scope, message);
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
        await refreshProviders("server", "Primary models saved");
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }

    if (event.target.id === "fallback-form") {
      event.preventDefault();
      const form = event.target;
      const refs = [0, 1, 2, 3, 4].flatMap((index) => {
        const value = form.elements[`fallback-${index}`].value;
        if (!value) return [];
        const [type, id] = value.split(":");
        return [{ type, id: Number(id) }];
      });
      try {
        await withBusyForm(form, async () => {
          await api(`/guilds/${state.guildId}/providers/server/fallbacks`, {
            method: "PATCH",
            body: JSON.stringify({ refs }),
          });
        });
        await refreshProviders("server", "Fallback chain saved");
      } catch (error) {
        toast(error.message, "error");
      }
      return;
    }

    if (event.target.id === "profile-form") {
      event.preventDefault();
      const form = event.target;
      try {
        const result = await api("/profile", {
          method: "PATCH",
          body: JSON.stringify({
            user_nickname: form.elements.user_nickname.value,
            privacy_level: Number(form.elements.privacy_level.value),
            personal_dtm: form.elements.personal_dtm.value,
            personal_deliberate_tool_mode: form.elements.personal_deliberate_tool_mode.value,
            timezone_offset:
              form.elements.timezone_offset.value === "" ? null : Number(form.elements.timezone_offset.value),
            shortterm_cache_crossserver_opt_in: form.elements.shortterm_cache_crossserver_opt_in.checked,
            impersonation_prompt: form.elements.impersonation_prompt.value || null,
            physical_appearance_tags: parseTags(form.elements.physical_appearance_tags.value),
          }),
        });
        state.overview.profile = result.profile;
        toast("Profile saved");
      } catch (error) {
        toast(error.message, "error");
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
            tags: parseTags(form.elements.tags.value).slice(0, 5),
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
            tags: parseTags(form.elements.tags.value).slice(0, 5),
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

    const settingsForm = event.target.closest("[data-settings-sections]");
    if (settingsForm) {
      event.preventDefault();
      const sections = settingsForm.dataset.settingsSections
        .split(",")
        .map((sectionId) => state.overview.settings.catalog.find((entry) => entry.id === sectionId))
        .filter(Boolean);
      try {
        await withBusyForm(settingsForm, async () => {
          const updates = await Promise.all(
            sections.map(async (section) => ({
              section,
              result: await api(`/guilds/${state.guildId}/settings/${section.id}`, {
                method: "PATCH",
                body: JSON.stringify(collectSettingsPatch(settingsForm, section)),
              }),
            })),
          );
          for (const { section, result } of updates) {
            state.overview.settings.values[section.id] = result.values;
          }
        });
        toast(`${settingsForm.dataset.settingsPanelTitle || "Settings"} saved`);
      } catch (error) {
        toast(error.message, "error");
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
      await selectGuild(session.guilds[0].id);
    } catch {
      renderLoggedOut();
    }
  }

  boot();
})();
