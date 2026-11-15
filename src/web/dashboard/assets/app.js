(() => {
  const BASE = "/settings/api";
  const app = document.querySelector("#app");
  const toastRegion = document.querySelector("#toast-region");
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

  const { palettes, designStorageKey, appearance, applyAppearance, remembered } = window.TomoriDesign;
  let rememberDesign = remembered;

  function setRememberDesign(remember) {
    try {
      if (remember) localStorage.setItem(designStorageKey, JSON.stringify(appearance));
      else localStorage.removeItem(designStorageKey);
      rememberDesign = remember;
    } catch {
      toast(ui(remember ? "appearance_session_only" : "appearance_forget_failed"), "warning");
    }
  }

  const saveAppearance = () => {
    applyAppearance();
    const persona = state.overview?.personas.find((entry) => entry.personaId === state.personaId);
    if (persona)
      document.querySelectorAll("[data-persona-banner], .chat-fab, .chat-dock").forEach((region) => {
        region.classList.toggle("tinted", appearance.personaColors);
        if (appearance.personaColors) region.dataset.tint = personaTint(persona);
        else delete region.dataset.tint;
      });
    stopReducedPanelMotion();
    if (rememberDesign) setRememberDesign(true);
  };

  const syncAppearanceControls = () => {
    document.querySelectorAll("[data-palette-choice]").forEach((button) => {
      const isActive = button.dataset.paletteChoice === appearance.palette;
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
    const personaColors = document.querySelector("[data-design-persona-colors]");
    if (personaColors) personaColors.checked = appearance.personaColors;
    document.querySelectorAll("[data-design-choice]").forEach((button) => {
      const selected = appearance[button.dataset.designChoice] === button.value;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    const motion = document.querySelector('[data-design-setting="motion"]');
    if (motion) motion.value = appearance.motion;
    const light = appearance.lighting[appearance.theme];
    for (const key of ["angle", "spread", "intensity"]) {
      const input = document.querySelector(`[data-light-setting="${key}"]`);
      if (input) input.value = light[key];
    }
    updateDesignLightLabels(light);
  };

  function updateDesignLightLabels(light) {
    const spread = document.querySelector("[data-design-light-spread]");
    const intensity = document.querySelector("[data-design-light-intensity]");
    if (spread) spread.value = `${(light.spread / 100).toLocaleString()}×`;
    if (intensity) intensity.value = `${light.intensity}%`;
  }

  window.addEventListener("storage", (event) => {
    if (!rememberDesign || event.newValue !== null || event.storageArea !== localStorage) return;
    if (event.key !== designStorageKey && event.key !== null) return;
    rememberDesign = false;
    const toggle = document.querySelector("[data-design-remember]");
    if (toggle) toggle.checked = false;
  });

  const ui = (key) => state.overview?.interfaceCopy[key] ?? state.publicSite?.interfaceCopy[key];

  const settingsGroups = [
    {
      id: "conversation",
      labelKey: "conversation",
      icon: "message-circle",
      panels: [
        {
          titleKey: "settings_context",
          descriptionKey: "settings_context_hint",
          sources: [
            {
              section: "chat",
              fields: ["system_prompt", "context_note", "context_note_depth", "message_fetch_limit", "timezone_offset"],
            },
            { section: "capabilities", fields: ["time_awareness_enabled"] },
          ],
        },
        {
          titleKey: "settings_triggers",
          descriptionKey: "settings_triggers_hint",
          sources: [
            {
              section: "triggers",
              fields: ["always_reply_enabled", "deliberate_trigger_mode", "cooldown_type", "cooldown_length"],
            },
            {
              section: "chat",
              fields: ["match_limit", "cascade_limit"],
            },
          ],
        },
        {
          titleKey: "settings_tool_intent",
          descriptionKey: "settings_tool_intent_hint",
          sources: [{ section: "triggers", fields: ["deliberate_tool_mode", "deliberate_tool_context_turns"] }],
        },
        {
          titleKey: "settings_output",
          descriptionKey: "output_hint",
          sources: [
            {
              section: "chat",
              fields: [
                "humanizer_streaming_enabled",
                "humanizer_pacing_enabled",
                "humanizer_sentence_split_enabled",
                "humanizer_lowercase_enabled",
                "humanizer_punctuation_split_enabled",
                "send_message_limit",
                "response_prefill",
              ],
            },
            {
              section: "capabilities",
              fields: ["emoji_usage_enabled", "sticker_usage_enabled"],
            },
          ],
        },
        {
          titleKey: "settings_draft_review",
          descriptionKey: "settings_draft_review_hint",
          sources: [
            { section: "capabilities", fields: ["response_drafting_enabled"] },
            { section: "chat", fields: ["response_reviewer_prompt", "response_review_items"] },
          ],
        },
        { section: "nsfw" },
      ],
    },
    {
      id: "models",
      labelKey: "settings_models_group",
      icon: "sliders-horizontal",
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
      icon: "radio",
      panels: [{ section: "autochat", fields: ["autoch_threshold", "autoch_threshold_max"] }, { section: "welcome" }],
    },
    {
      id: "memory",
      labelKey: "memory",
      icon: "brain",
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
              fields: ["stm_privacy_bypass"],
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
      icon: "plug",
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
      icon: "settings-2",
      panels: [
        { section: "notices" },
        {
          titleKey: "diagnostics",
          descriptionKey: "diagnostics_hint",
          sources: [
            { section: "memberPermissions", fields: ["prompt_snapshot_enabled"] },
            { section: "chat", fields: ["self_debug_enabled"] },
            { section: "channelScope", fields: ["thought_log_channel_disc_id"] },
          ],
        },
      ],
    },
  ];

  const state = {
    publicSite: null,
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
    personaKnowledgePanel: "personal",
    lorebookBookId: null,
    lorebookData: null,
    lorebookImportReceipt: null,
    personaTestChats: {},
    personaChatOpen: false,
    personaTestChatBusy: false,
    avatarRevision: 0,
    providerData: { personal: null, server: null },
    providerConnection: { personal: null, server: null },
    providerPanel: { personal: "connections", server: "connections" },
    serverStats: null,
    serverStatsLoading: false,
    serverStatsError: "",
    statsTimeframe: "month",
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

  const personaAvatarUrl = (persona) =>
    persona?.avatarUrl
      ? `${persona.avatarUrl}${persona.avatarUrl.includes("?") ? "&" : "?"}v=${state.avatarRevision}`
      : "";

  const personaAvatar = (persona, extraClass = "") => {
    const initial =
      String(persona?.nickname || "?")
        .trim()
        .slice(0, 1) || "?";
    const classes = `persona-avatar${extraClass ? ` ${extraClass}` : ""}`;
    const avatarUrl = personaAvatarUrl(persona);
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
    "[data-site-entry], [data-profile-section], [data-settings-sections], [data-drafting-selections], [data-channel-settings], [data-channel-allowlist], [data-persona-naming], [data-persona-habit-form], [data-persona-attg], [data-persona-voice], [data-lorebook-form], [data-moderation-quota], #stm-categories-form, form[data-provider-scope=server][data-fx=track]";
  const localEditForms =
    "[data-persona-section], [data-persona-text-model], [data-persona-entry-form], [data-spotlight-form], #persona-channel-workspace form, #server-models-form, [data-advanced-models], [data-personal-model], [data-personal-parameters], #fallback-form, #memory-compose-form, #memory-edit-form";
  const editForms = `${draftForms}, ${localEditForms}`;
  const editSubmit = 'button[type="submit"]:not([value="reset"]), button[value="save"]:not([type])';
  const drafts = new Map();
  const formBaselines = new WeakMap();
  const panelSizes = new Map();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotion.addEventListener("change", stopReducedPanelMotion);
  const panelObserver = new MutationObserver((records) => {
    const changed = new Set();
    for (const { target } of records) {
      const element = target instanceof Element ? target : target.parentElement;
      const panel = element?.closest(".panel");
      if (panelSizes.has(panel)) changed.add(panel);
    }
    for (const target of changed) {
      const panel = panelSizes.get(target);
      if (!target.isConnected) continue;
      const height = panel.animation ? target.offsetHeight : panel.height;
      panel.animation?.cancel();
      panel.animation = null;
      delete target.dataset.resizing;
      panel.height = target.offsetHeight;
      if (height && panel.height) animatePanelSize(target, panel, height, panel.height);
    }
  });
  panelObserver.observe(app, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden", "open", "rows"],
  });
  window.addEventListener("resize", () => {
    for (const [target, panel] of panelSizes) {
      panel.height = target.offsetHeight;
    }
  });
  let savingForms = 0;

  function canAnimatePanels() {
    return !reducedMotion.matches && document.body.dataset.motion === "full";
  }

  function stopReducedPanelMotion() {
    if (canAnimatePanels()) return;
    for (const panel of panelSizes.values()) panel.animation?.cancel();
  }

  function animatePanelSize(target, panel, from, to) {
    if (Math.abs(from - to) < 1 || !canAnimatePanels()) return;
    target.dataset.resizing = "";
    const animation = target.animate([{ blockSize: `${from}px` }, { blockSize: `${to}px` }], {
      duration: 320,
      easing: "cubic-bezier(.22, .61, .36, 1)",
    });
    panel.animation = animation;
    const finish = () => {
      if (panel.animation !== animation) return;
      panel.animation = null;
      delete target.dataset.resizing;
      panel.height = target.offsetHeight;
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  }

  function observePanelSizes(root) {
    for (const [panel, entry] of panelSizes) {
      if (panel.isConnected) continue;
      entry.animation?.cancel();
      panelSizes.delete(panel);
    }
    const selector = ".panel:not(.persona-test-panel)";
    const panels = [...root.querySelectorAll(selector)];
    if (root.matches(selector)) panels.push(root);
    for (const panel of panels) {
      if (panelSizes.has(panel) || panel.parentElement.closest(".panel")) continue;
      panelSizes.set(panel, { height: panel.offsetHeight });
    }
  }

  function formSnapshot(form) {
    return Array.from(form.querySelectorAll("input[name], select[name], textarea[name]"), (input) => ({
      name: input.name,
      value: input.value,
      checked: input.type === "checkbox" || input.type === "radio" ? input.checked : undefined,
    }));
  }

  function restoreSnapshot(form, values) {
    form.querySelectorAll("input[name], select[name], textarea[name]").forEach((input) => {
      const value = values.find(
        (entry) => entry.name === input.name && (entry.checked === undefined || entry.value === input.value),
      );
      if (!value) return;
      if (
        ["channel_model", "channel_persona_id", "channel_autochat_id", "reviewer", "checker"].includes(input.name) &&
        value.value &&
        ![...input.options].some((option) => option.value === value.value)
      ) {
        input.add(
          new Option(
            ui(form.matches("[data-drafting-selections]") ? "drafting_unavailable" : "channel_loading"),
            value.value,
          ),
        );
      }
      if (value.checked !== undefined) input.checked = value.checked;
      else input.value = value.value;
    });
    form.querySelectorAll("[data-naming-mode]").forEach((mode) => {
      const input = form.elements[mode.dataset.namingMode];
      input.disabled = mode.value !== "custom";
      input.closest(".field").hidden = input.disabled;
    });
    form.querySelectorAll("[data-persona-chip-values]").forEach((input) => {
      const editor = input.closest("[data-persona-chip-editor]");
      editor.querySelector("[data-persona-chip-add]").value = "";
      editor.querySelector(".chips").innerHTML = renderPersonaChips(JSON.parse(input.value), input.name);
    });
    const humanizerFields = form.querySelector("[data-persona-humanizer-fields]");
    if (humanizerFields) humanizerFields.hidden = form.elements.humanizerMode.value === "inherit";
    if (form.id === "fallback-form") updateFallbackSlots(form);
    if (form.id === "openrouter-form") updateOpenRouterHint(form);
    resizeAutoGrowTextareas(form);
    form.dispatchEvent(new Event("dashboard:restore"));
    if (form.dataset.fx === "track") form.dispatchEvent(new Event("input"));
    updateChannelCounts(form.querySelector("[data-channel-selector]"));
  }

  function initDraftForms(root) {
    root.querySelectorAll(draftForms).forEach((form) => {
      if (formBaselines.has(form)) return;
      const key = form.dataset.siteEntry
        ? `site/${form.dataset.siteEntry}`
        : form.dataset.profileSection
          ? `profile/${form.dataset.profileSection}`
          : `${state.guildId}/${form.dataset.settingsKey || (form.dataset.personaNaming ? `naming/${form.dataset.personaNaming}` : "stm-categories")}`;
      form.dataset.draftKey = key;
      formBaselines.set(form, formSnapshot(form));
      if (form.dataset.fx === "track") {
        window.TomoriFX.enhance(form);
        window.TomoriFX.saved(form);
        if (drafts.has(key)) {
          restoreSnapshot(form, drafts.get(key));
          captureDraft(form);
        }
        return;
      }
      form.querySelectorAll(editSubmit).forEach((save) => {
        if (save.previousElementSibling?.hasAttribute("data-discard-draft")) return;
        const discard = document.createElement("button");
        discard.type = "button";
        discard.className = "button";
        discard.dataset.discardDraft = "";
        discard.dataset.editAction = "";
        discard.hidden = true;
        discard.textContent = ui("discard");
        save.before(discard);
      });
      if (!form.querySelector("input[name], select[name], textarea[name]")) {
        form.querySelector('button[type="submit"]').disabled = true;
      }
      if (drafts.has(key)) restoreSnapshot(form, drafts.get(key));
      if (!form.matches("[data-channel-settings]") || !drafts.has(key)) captureDraft(form);
    });
  }

  function setEditActions(form, changed) {
    form.querySelectorAll(editSubmit).forEach((button) => {
      button.dataset.editAction = "";
      const visible =
        changed &&
        (!form.matches("[data-channel-settings]") || channelHasChanges(form, button.closest("[data-channel-panel]")));
      const discard = button.previousElementSibling;
      const hasDiscard = discard?.hasAttribute("data-discard-draft");
      if (button.hidden !== visible && (!hasDiscard || discard.hidden !== visible)) return;
      window.TomoriFX.reflowActions(button.parentElement, () => {
        button.hidden = !visible;
        if (hasDiscard) discard.hidden = !visible;
      });
    });
  }

  function initLocalEditForm(form) {
    if (formBaselines.has(form)) return;
    const snapshot = formSnapshot(form);
    const original = form.dataset.editBaseline ? JSON.parse(form.dataset.editBaseline) : null;
    formBaselines.set(
      form,
      original
        ? snapshot.map(({ name, value, checked }) =>
            checked === undefined
              ? { name, value: String(original[name] ?? ""), checked }
              : { name, value, checked: Boolean(original[name]) },
          )
        : snapshot,
    );
    captureDraft(form);
  }

  function captureDraft(form) {
    if (!form || !formBaselines.has(form)) return;
    const values = formSnapshot(form);
    const changed = form.matches("[data-channel-settings]")
      ? channelHasChanges(form)
      : form.dataset.editFile !== undefined || JSON.stringify(values) !== JSON.stringify(formBaselines.get(form));
    if (form.dataset.draftKey) {
      if (changed) drafts.set(form.dataset.draftKey, values);
      else drafts.delete(form.dataset.draftKey);
    }
    if (form.dataset.fx === "track") return;
    setEditActions(form, changed);
  }

  function completeFormSave(form, source = form) {
    drafts.delete(form.dataset.draftKey);
    formBaselines.set(form, formSnapshot(form));
    if (form.dataset.fx === "track") window.TomoriFX.saved(form);
    else setEditActions(form, false);
    source.querySelector(".form-error")?.remove();
  }

  function syncTrackedDraft(form) {
    if (form.dataset.fx !== "track") return;
    const pending = formSnapshot(form);
    restoreSnapshot(form, formBaselines.get(form));
    window.TomoriFX.saved(form);
    restoreSnapshot(form, pending);
    enhanceDashboard(form);
  }

  function showFormError(form, error, partial = false) {
    form.querySelector(".form-error")?.remove();
    const message = document.createElement("div");
    message.className = "form-error";
    message.setAttribute("role", "alert");
    message.textContent = `${error.message} ${ui(partial ? "partial" : "retry")}`;
    form.querySelector(".form-actions, .actions:has([data-edit-action]), [data-form-actions]")?.before(message);
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

  async function downloadAttachment(path, fallbackName) {
    const response = await fetch(`${BASE}${path}`);
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error?.message || `Request failed (${response.status})`);
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || fallbackName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return response;
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
          ${renderPublicLinks()}
        </div>
      </main>`;
  }

  function loadingBar(label) {
    return `<span class="loading" role="status" aria-label="${escapeHtml(label)}"></span>`;
  }

  function formatStoredParameterValue(value) {
    return typeof value === "number" && !Number.isInteger(value) ? String(Number(value.toPrecision(7))) : (value ?? "");
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

  function renderPublicLinks(sidebar = false) {
    const site = state.publicSite;
    const entries = site?.entries.filter(
      (entry) => entry.kind === "page" || (sidebar ? entry.showInSidebar : entry.showOnLogin),
    );
    if (!entries?.length) return "";
    const links = entries
      .map(
        (entry) =>
          `<a href="${escapeHtml(entry.kind === "page" ? `/settings/pages/${entry.id}` : entry.url)}">${sidebar ? navigationIcon("book-open") : ""}<span>${escapeHtml(entry.title)}</span></a>`,
      )
      .join("");
    return sidebar
      ? `<section class="sidebar-group site-public-nav"><h2 class="group-label">${escapeHtml(site.copy.public_links)}</h2><div class="sidebar-group-links">${links}</div></section>`
      : `<nav class="site-public-links" aria-label="${escapeHtml(site.copy.public_links)}">${links}</nav>`;
  }

  async function refreshPublicSite() {
    state.publicSite = await api("/site");
  }

  let fxLocale;

  function renderShell() {
    clearSearchSpotlight();
    const guilds = state.session?.guilds || [];
    const selected = guilds.find((guild) => guild.id === state.guildId) || guilds[0];
    const user = state.session?.user;
    const fxCopy = { more: ui("control_more"), moreLabel: ui("control_more_sections") };
    const locale = JSON.stringify(fxCopy);
    if (locale !== fxLocale) {
      window.TomoriFX?.configure(fxCopy);
      fxLocale = locale;
    }
    const collection = usesCollectionFrame();
    const serverIdentity = selected?.iconUrl
      ? `<img class="${collection ? "avatar" : "server-icon"}" src="${escapeHtml(selected.iconUrl)}" alt="">`
      : `<span class="${collection ? "avatar" : "server-icon server-icon-fallback"}">${escapeHtml((selected?.name || "?").slice(0, 1))}</span>`;
    const serverLabel = `<span${collection ? "" : ' class="server-label"'}><small>${escapeHtml(ui("server"))}</small><strong>${escapeHtml(selected?.name || ui("switch_server"))}</strong></span>${navigationIcon("arrow-up-down")}`;
    const serverButton = `<button class="button ${collection ? "server-switch" : "topbar-server-button"}" type="button" data-server-picker-open aria-haspopup="dialog" aria-label="${escapeHtml(ui("switch_server"))}">${serverIdentity}${serverLabel}</button>`;
    const navigationButton = `<button class="button icon ${collection ? "menu-toggle" : "mobile-nav-trigger"}" type="button" data-navigation-menu="dashboard-navigation" aria-label="${escapeHtml(ui("navigation_menu"))}">${navigationIcon("menu")}</button>`;
    const brand = collection
      ? `<a class="frame-brand" href="#overview" data-nav="overview" aria-label="${escapeHtml(ui("overview_title"))}"><img src="/settings/assets/tomori_companion_logo.svg" alt=""><span><strong>TomoriBot</strong><small>companion control</small></span></a>`
      : '<button class="brand brand-button" type="button" data-nav="overview" aria-label="Open overview"><img src="/settings/assets/tomori_companion_logo.svg" alt="" class="topbar-logo"><span class="brand-copy"><strong>TomoriBot</strong><small>companion control</small></span></button>';
    const designButton = `<button class="button" id="design-trigger" type="button" popovertarget="design-settings" aria-label="${escapeHtml(ui("design_title"))}" data-tooltip="${escapeHtml(ui("design_title"))}"><span class="palette-orb" aria-hidden="true"></span><span class="${collection ? "design-label" : "design-trigger-label"}">${escapeHtml(ui("design_title"))}</span></button>`;
    app.innerHTML = `
      <div class="${collection ? "app-frame" : "dashboard-shell"}">
        <header class="topbar">
          ${
            collection
              ? `<div class="row">${navigationButton}${brand}</div>${serverButton}<div class="row topbar-end">${designButton}</div>`
              : `${navigationButton}${brand}<div class="topbar-server-access">${serverButton}</div>${designButton}`
          }
        </header>
        <div class="shell"><div class="sidebar-rail"><aside class="sidebar" data-variant="detailed">
          <nav class="nav-stack sidebar-sections" id="dashboard-navigation" aria-label="Dashboard">
            ${
              state.overview
                ? `
            <button class="button${collection ? " sidebar-search" : ""}" type="button" data-settings-search-open aria-haspopup="dialog">${collection ? navigationIcon("search") : ""}${escapeHtml(ui("settings_search"))}</button>
            <section class="sidebar-group"><h2 class="group-label">${escapeHtml(ui("nav_global"))}</h2><div class="sidebar-group-links">
            ${navButton("profile", ui("my_settings"))}
            ${navButton("personal-memory", "Global memory")}
            ${navButton("personal-providers", "My providers")}
            </div></section>
            <section class="sidebar-group"><h2 class="group-label">${escapeHtml(ui("nav_server_settings"))}</h2><div class="sidebar-group-links">
            ${navButton("overview", "Overview")}
            ${navButton("personas", "Personas")}
            ${state.overview.guild.isDirectMessage ? "" : navButton("personal-spotlights", ui("spotlights"))}
            ${navButton("lorebooks", ui("lorebooks"))}
            </div></section>
            ${
              state.overview?.canManage
                ? `<section class="sidebar-group"><h2 class="group-label">${escapeHtml(ui("nav_server_administration"))}</h2><div class="sidebar-group-links">
                   ${navButton("server-providers", ui("nav_server_providers"), true)}
                   ${state.overview.guild.isDirectMessage ? "" : navButton("channel-settings", ui("channel_settings"), true)}
                   ${state.overview.guild.isDirectMessage ? "" : navButton("moderation", ui("moderation"), true)}
                   ${navButton("settings", "Server settings", true)}</div></section>`
                : ""
            }
            `
                : ""
            }
            ${state.session?.user.isGlobalAdmin && state.publicSite ? `<section class="sidebar-group"><h2 class="group-label">${escapeHtml(state.publicSite.copy.admin)}</h2><div class="sidebar-group-links">${navButton("site-admin", state.publicSite.copy.title)}</div></section>` : ""}
            ${renderPublicLinks(true)}
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
        <main class="${collection ? "app-main" : "dashboard-page"}" id="${collection ? "main" : "workspace"}" data-dashboard-view="${state.view}"></main>
        </div>
      </div>
      <dialog id="navigation-sheet" class="sidebar-drawer" aria-labelledby="navigation-sheet-title"><header class="sidebar-drawer-heading"><h2 id="navigation-sheet-title">${escapeHtml(ui("navigation_menu"))}</h2><button class="button icon" type="button" data-navigation-close aria-label="${escapeHtml(ui("navigation_close"))}">${navigationIcon("x")}</button></header><div class="sidebar-drawer-body"></div></dialog>
      ${renderDesignSettings()}
      <dialog id="server-picker-dialog" class="wide" aria-labelledby="server-picker-title">
        <div class="stack">
          <header class="panel-header">
            <div class="heading"><p class="eyebrow">Your Tomori spaces</p><h2 id="server-picker-title" tabindex="-1" autofocus>Switch server</h2>
              <p>Select the server you want to view or manage.</p>
            </div>
            <button class="button icon" type="button" data-server-picker-close aria-label="Close server selection">${navigationIcon("x")}</button>
          </header>
          <div class="${collection ? "deck" : "persona-picker-grid"}">
            ${[...guilds]
              .sort((left, right) => Number(Boolean(right.isDirectMessage)) - Number(Boolean(left.isDirectMessage)))
              .map(
                (guild) =>
                  `<button class="${collection ? "deck-card" : "persona-choice"}" ${collection ? "aria-current" : "aria-pressed"}="${guild.id === state.guildId}" type="button" data-guild-select="${escapeHtml(guild.id)}">
                  ${
                    collection
                      ? personaSticker({ nickname: guild.name, avatarUrl: guild.iconUrl })
                      : guild.iconUrl
                        ? `<img src="${escapeHtml(guild.iconUrl)}" alt="" class="avatar">`
                        : `<span class="avatar avatar-fallback">${escapeHtml((guild.name || "?").slice(0, 1))}</span>`
                  }
                  <span class="server-choice-copy"><strong>${escapeHtml(guild.name)}</strong><small>${guild.isDirectMessage ? escapeHtml(ui("direct_messages_owner")) : `${guild.memberCount ?? "?"} members`}</small></span>
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
        <form method="dialog" id="memory-edit-form">
          <header class="panel-header"><div class="heading"><p class="eyebrow">Memory</p><h2 id="memory-dialog-title">Update this memory</h2></div></header>
          <div class="stack">
            <label class="field"><span class="field-label">Memory</span><textarea name="content" rows="4" required></textarea></label>
            <label class="field" data-memory-tags><span class="field-label">Tags</span><input name="tags" type="text" placeholder="character, preference"></label>
            <div class="subsection" data-memory-channel-scope hidden></div>
          </div>
          <input name="memoryId" type="hidden">
          <div class="actions">
            <button type="button" class="button " data-dialog-close="memory-dialog">Cancel</button>
            <button value="save" class="button primary" data-edit-action hidden>${escapeHtml(ui("save"))}</button>
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
    const choices = (
      field,
      label,
      options,
    ) => `<div class="field"><span class="field-label">${escapeHtml(ui(label))}</span>
      <div class="segmented fill" data-fx="indicator" role="radiogroup" aria-label="${escapeHtml(ui(label))}">${options
        .map(
          ([value, key]) =>
            `<button type="button" role="radio" aria-checked="${appearance[field] === value}" tabindex="${appearance[field] === value ? 0 : -1}" data-design-choice="${field}" value="${value}">${escapeHtml(ui(key))}</button>`,
        )
        .join("")}</div></div>`;
    return `<div id="design-settings" class="design-settings" popover role="dialog" aria-labelledby="design-title">
      <header class="panel-header"><div class="heading"><h2 id="design-title">${escapeHtml(ui("design_title"))}</h2><p>${escapeHtml(ui("design_hint"))}</p></div><button class="button  icon" type="button" popovertarget="design-settings" popovertargetaction="hide" aria-label="${escapeHtml(ui("navigation_close"))}">${navigationIcon("x")}</button></header>
      <div class="stack"><div class="row"><button class="button small" id="design-theme" type="button" data-theme-toggle>${escapeHtml(ui("design_light"))}</button><button class="button small" type="button" data-surface-toggle aria-pressed="${appearance.surface === "glass"}">${escapeHtml(ui("design_glass"))}</button></div>
      <div class="field"><span class="field-label">${escapeHtml(ui("design_palette"))}</span><div class="palette-list">${palettes.map((palette) => `<button class="palette-choice" type="button" data-palette-choice="${palette.id}" aria-pressed="${appearance.palette === palette.id}"><span class="palette-orb" aria-hidden="true"></span><span>${palette.label}</span></button>`).join("")}</div></div>
      <label class="toggle">${fieldLabel(ui("design_persona_colors"))}<input type="checkbox" role="switch" data-design-persona-colors></label>
      ${choices("colorMode", "design_color_mode", [
        ["colorful", "design_colorful"],
        ["reduced", "design_reduced"],
      ])}
      <fieldset class="stack design-light"><legend>${escapeHtml(ui("design_lighting"))}</legend>
        <label class="field">${fieldLabel(ui("design_angle"), ui("design_angle_hint"))}<input type="number" min="0" max="359" step="1" data-unit="°" data-light-setting="angle" data-scrub></label>
        <label class="field"><span class="field-label range-label">${escapeHtml(ui("design_spread"))}<output data-design-light-spread></output></span><input type="range" min="50" max="500" step="10" data-light-setting="spread"></label>
        <label class="field"><span class="field-label range-label">${escapeHtml(ui("design_intensity"))}<output data-design-light-intensity></output></span><input type="range" min="0" max="200" step="5" data-light-setting="intensity"></label>
      </fieldset>
      ${choices("layout", "design_layout", [
        ["boxed", "design_layout_boxed"],
        ["full", "design_layout_full"],
      ])}
      <label class="field">${fieldLabel(ui("design_motion"))}<select data-design-setting="motion">${["full", "subtle", "off"].map((value) => `<option value="${value}">${escapeHtml(ui(`design_motion_${value}`))}</option>`).join("")}</select></label>
      <label class="toggle">${fieldLabel(ui("design_remember"), ui("design_remember_hint"))}<input type="checkbox" role="switch" data-design-remember${rememberDesign ? " checked" : ""}></label></div>
      <div class="actions form-actions"><button class="button " type="button" data-design-reset>${escapeHtml(ui("design_reset"))}</button></div>
    </div>`;
  }

  function enhanceDashboard(container) {
    requestAnimationFrame(focusSearchDestination);
    container.querySelectorAll(localEditForms).forEach(initLocalEditForm);
    observePanelSizes(container);
    container
      .querySelectorAll(
        ".server-model-panel select, [data-persona-text-model] select, #fallback-form select, [data-history-model]",
      )
      .forEach((select) => {
        select.setAttribute("data-searchable", "");
      });
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
          "control_more",
          "control_hold_delete",
          "control_search_options",
          "control_no_matches",
          "control_keep_holding",
          "control_hold_confirmed",
        ].map((key) => [key, ui(key)]),
      ),
      (button) =>
        button.matches("[data-sprite-remove]")
          ? confirmSpriteAction(
              button.form,
              button.dataset.confirmTitle,
              button.dataset.confirmDescription,
              ui("sprite_delete_action"),
              true,
            )
          : confirmAction(button.dataset.confirmTitle, button.dataset.confirmDescription),
    );
    window.TomoriControls?.enhance(container);
    window.TomoriFX?.enhance(container);
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
    container.querySelectorAll("[data-progress-value]").forEach((bar) => {
      bar.style.setProperty("--progress", `${bar.dataset.progressValue}%`);
    });
  }

  function pageHeader(eyebrow, title, copy, actions = "") {
    return `<header class="page-header">
      <div class="heading">${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ""}<h1>${escapeHtml(title)}</h1>${copy ? `<p>${escapeHtml(copy)}</p>` : ""}</div>
      ${actions ? `<div class="actions">${actions}</div>` : ""}
    </header>`;
  }

  const navigationIcons = {
    "site-admin": "settings-2",
    overview: "house",
    personas: "users-round",
    profile: "user-round",
    "personal-memory": "brain",
    "personal-spotlights": "radio",
    lorebooks: "book-open",
    lorebook: "book-open",
    "personal-providers": "plug",
    "server-providers": "plug",
    settings: "settings-2",
    "channel-settings": "radio",
    moderation: "users-round",
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
    const rail = document.querySelector(".sidebar-rail");
    if (sidebar.parentElement !== rail) rail.append(sidebar);
    window.TomoriControls?.enhanceTabs(document.querySelector("[data-dashboard-view]"));
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

  function usesCollectionFrame() {
    return [
      "personas",
      "overview",
      "lorebooks",
      "settings",
      "channel-settings",
      "server-providers",
      "moderation",
    ].includes(state.view);
  }

  function renderView() {
    const workspace = document.querySelector("[data-dashboard-view]");
    if (!workspace) return;
    if (state.view !== "personas") delete document.body.dataset.chat;
    if (workspace.dataset.dashboardView !== state.view) {
      if (usesCollectionFrame() !== workspace.classList.contains("app-main")) return renderShell();
      clearSearchSpotlight();
      workspace.dataset.dashboardView = state.view;
      workspace.scrollTop = 0;
    }
    if (state.view === "site-admin" && state.session?.user.isGlobalAdmin) {
      initNavigationMenus();
      window.TomoriSite.renderAdmin(workspace, {
        api,
        escapeHtml,
        fieldLabel,
        pageHeader,
        navigationIcon,
        toast,
        confirmAction,
        withBusyForm,
        initDraftForms,
        enhanceDashboard,
        completeFormSave,
        isCurrent: () => state.view === "site-admin",
        copy: state.publicSite.copy,
        afterSave: async () => {
          await refreshPublicSite();
          const navigation = document.querySelector("#dashboard-navigation");
          navigation.querySelector(".site-public-nav")?.remove();
          navigation.insertAdjacentHTML("beforeend", renderPublicLinks(true));
        },
      });
      return;
    }
    if (!state.overview) return;
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
        workspace.innerHTML = `<section class="banner compact" aria-labelledby="server-lorebooks-title">
          <div class="banner-info"><div class="stack" data-lorebook-summary>
            <p class="crumb">${escapeHtml(ui("lorebook_eyebrow"))}</p>
            <h1 id="server-lorebooks-title" data-fx="split">${escapeHtml(ui("lorebooks"))}</h1>
            <p class="banner-text">${escapeHtml(ui("lorebook_page_hint"))}</p>
            <div class="chips" data-lorebook-totals hidden></div>
          </div></div>
          <div class="banner-art" aria-hidden="true"><span class="sticker emblem">${navigationIcon("book-open")}</span></div>
        </section><div id="lorebook-workspace"></div>`;
        loadLorebooks(0);
        break;
      case "personal-providers":
        renderPersonalProviders(workspace);
        break;
      case "personas":
        renderPersonaWorkspace(workspace);
        break;
      case "personal-spotlights":
        renderPersonalSpotlights(workspace);
        break;
      case "server-providers":
        renderServerProviders(workspace);
        break;
      case "settings":
        renderSettings(workspace);
        break;
      case "channel-settings":
        renderChannelSettings(workspace);
        break;
      case "moderation":
        renderModeration(workspace);
        break;
      default:
        renderOverview(workspace);
    }
    initDraftForms(workspace);
    enhanceDashboard(workspace);
    initNavigationMenus();
    focusSearchDestination();
    workspace.querySelectorAll(".tabs, .tabs").forEach((nav) => {
      const active = nav.querySelector('[aria-current="page"]');
      if (!active) return;
      const bounds = nav.getBoundingClientRect();
      const button = active.getBoundingClientRect();
      if (button.right > bounds.right) nav.scrollLeft += button.right - bounds.right;
      else if (button.left < bounds.left) nav.scrollLeft += button.left - bounds.left;
    });
  }

  let settingsSearchEntries = [];
  let pendingSearchDestination = null;
  let clearSearchSpotlight = () => {};

  function settingSearchText(element) {
    const label = (element.querySelector(".field-label, .sr-only") || element).cloneNode(true);
    label.querySelectorAll("small, input, select, textarea, button").forEach((child) => {
      child.remove();
    });
    return label.textContent.replace(/\s+/g, " ").trim();
  }

  function buildSettingsSearchIndex() {
    const entries = [];
    const addMarkup = (html, route, path) => {
      const template = document.createElement("template");
      template.innerHTML = html;
      for (const element of template.content.querySelectorAll("label.field, label.toggle, h2, h3, legend")) {
        if (element.closest(".entry-list, [data-persona-entries], .chat, .chat-dock")) continue;
        const title = settingSearchText(element);
        if (!title) continue;
        const hint = element.querySelector("small")?.textContent || "";
        const name = element.querySelector("[name]")?.getAttribute("name");
        const dialog = element.closest("dialog")?.id;
        const providerRegistration = element.closest("[data-provider-endpoint-fields]")
          ? "endpoint"
          : element.closest("[data-provider-key-fields]")
            ? "key"
            : undefined;
        const entry = {
          ...route,
          dialog,
          title,
          hint,
          name,
          tag: element.tagName.toLowerCase(),
          path,
          providerRegistration,
        };
        if (
          !entries.some(
            (existing) =>
              existing.personaId === entry.personaId &&
              existing.path === path &&
              existing.title === title &&
              existing.dialog === dialog,
          )
        )
          entries.push(entry);
      }
    };
    const page = (view, title, extra = {}) => entries.push({ view, title, path: title, hint: "", ...extra });
    page("profile", ui("my_settings"));
    for (const section of ["profile", "privacy", "conversation"])
      addMarkup(renderProfilePanel(section), { view: "profile" }, ui("my_settings"));
    page("personal-memory", "Global memory");
    page("personal-memory", ui("personal_stm"), {
      path: "Global memory",
      hint: ui("personal_stm_hint"),
      tag: "h2",
    });
    if (!state.overview.guild?.isDirectMessage)
      page("personal-spotlights", ui("spotlights"), { hint: ui("spotlights_hint") });
    page("lorebooks", ui("lorebooks"));
    if (state.overview.canManage) {
      if (!state.overview.guild.isDirectMessage) {
        for (const [moderationTab, [key]] of Object.entries(moderationTabs)) {
          page("moderation", ui(key), { moderationTab, path: ui("moderation") });
        }
        for (const type of ["text", "image", "video"]) {
          page("moderation", ui(`moderation_${type}`), { moderationTab: "quotas", path: ui("moderation"), tag: "h3" });
        }
      }
      for (const [key, name] of [
        ["lorebook_title", "title"],
        ["lorebook_content", "content"],
        ["lorebook_enabled", "enabled"],
        ["lorebook_constant", "constant"],
        ["lorebook_keys", "keys"],
        ["lorebook_secondary", "secondaryKeys"],
        ["lorebook_logic", "selectiveLogic"],
        ["lorebook_scan", "scanDepth"],
        ["lorebook_chance", "triggerChance"],
        ["lorebook_order", "insertionOrder"],
      ]) {
        entries.push({
          view: "lorebooks",
          title: ui(key),
          hint: ui(`${key}_hint`) || "",
          path: ui("lorebooks"),
          name,
          lorebookEntryField: true,
        });
      }
    }
    if (state.overview.canManage && state.overview.settings) {
      for (const group of settingsGroups) {
        const route = { view: "settings", settingsGroup: group.id };
        const path = `${ui("nav_server_settings")} / ${ui(group.labelKey)}`;
        for (const panel of group.panels) addMarkup(renderSettingsPanel(panel), route, path);
        if (group.id === "conversation") addMarkup(renderDraftingPanel(), route, path);
        if (group.id === "models") addMarkup(renderLogitBiasPanel(), route, path);
        if (group.id === "memory") addMarkup(renderStmCategories(), route, path);
        if (group.id === "media") page("settings", ui("tool_phrases"), { ...route, path, tag: "h3" });
        if (group.id === "channels" && !state.overview.guild?.isDirectMessage)
          page("settings", ui("random_schedules"), { ...route, path, tag: "h3" });
      }
      for (const [sectionId, key] of channelSettingsFields) {
        const field = state.overview.settings.catalog
          .find((section) => section.id === sectionId)
          ?.fields.find((field) => field.key === key);
        if (field)
          entries.push({
            view: "channel-settings",
            title: field.label,
            hint: field.hint,
            path: ui("channel_settings"),
            channelTab: "settings",
          });
      }
      addMarkup(
        renderChannelOverrides(),
        { view: "channel-settings", channelTab: "settings", channelSelection: true },
        ui("channel_settings"),
      );
      page("channel-settings", ui("channel_allowlisted"), { channelTab: "allowlist" });
      page("channel-settings", ui("channel_personas"), { channelTab: "settings" });
    }
    for (const persona of state.overview.personas.filter((entry) => entry.lineageId !== 0)) {
      const route = { view: "personas", personaId: persona.personaId };
      page("personas", persona.nickname, {
        ...route,
        personaPanel: "personal",
        personaHome: true,
        path: `Personas / ${persona.nickname}`,
      });
      const knowledgePath = `Personas / ${persona.nickname} / ${ui("persona_knowledge")}`;
      for (const [panel, label] of personaKnowledgeTabs()) {
        const title = ui(label);
        page("personas", title, {
          ...route,
          personaPanel: panel,
          path: knowledgePath,
          ...(panel === "conditioning" ? { hint: ui("persona_conditioning_hint") } : {}),
        });
      }
      addMarkup(
        renderPersonaNaming(persona),
        { ...route, personaPanel: "preferences" },
        `Personas / ${persona.nickname} / ${state.overview.personaNaming.copy.tab}`,
      );
      if (state.overview.canManage) {
        entries.push({
          ...route,
          personaPanel: "settings",
          title: ui("persona_model_title"),
          hint: ui("persona_model_hint"),
          name: "modelId",
          path: `Personas / ${persona.nickname} / Persona settings`,
        });
        addMarkup(
          renderPersonaSettings(persona),
          { ...route, personaPanel: "settings" },
          `Personas / ${persona.nickname} / Persona settings`,
        );
        addMarkup(
          renderPersonaAppearance(persona),
          { ...route, personaPanel: "appearance" },
          `Personas / ${persona.nickname} / Appearance & image prompt`,
        );
        const voicePath = `Personas / ${persona.nickname} / ${ui("persona_voice_title")}`;
        page("personas", ui("persona_voice_title"), { ...route, personaPanel: "voice", path: voicePath });
        for (const [name, key] of [
          ["priority", "persona_voice_priority"],
          ["designPrompt", "persona_voice_design_prompt"],
        ]) {
          page("personas", ui(key), { ...route, personaPanel: "voice", name, path: voicePath });
        }
        page("personas", ui("sprites"), { ...route, personaPanel: "sprites", path: `Personas / ${persona.nickname}` });
        page("personas", ui("persona_channels"), {
          ...route,
          personaPanel: "channels",
          path: `Personas / ${persona.nickname}`,
        });
      }
    }
    for (const scope of state.overview.canManage ? ["personal", "server"] : ["personal"]) {
      const view = `${scope === "personal" ? "personal" : "server"}-providers`;
      const path = scope === "personal" ? "My providers" : ui("nav_server_providers");
      const data = state.providerData[scope];
      const hasModels = scope !== "personal" || !data || providerConnections(data).length > 0;
      for (const [panel, key] of [
        ["connections", "connections"],
        ["models", "primary_models"],
        ["fallbacks", "connection_fallbacks"],
      ])
        if (panel === "connections" || hasModels) page(view, ui(key), { scope, providerPanel: panel, path });
      if (!data) continue;
      for (const connection of providerConnections(data))
        addMarkup(
          renderConnectionDetail(data, scope, connection),
          { view, scope, providerPanel: "connections", connection: connection.key },
          `${path} / ${connection.name}`,
        );
      if (!hasModels) continue;
      if (scope === "personal") {
        addMarkup(
          renderQuickCapabilities(data),
          { view, scope, providerPanel: "models" },
          `${path} / ${ui("quick_capabilities")}`,
        );
      }
      addMarkup(
        scope === "personal" ? renderPersonalModels(data) : renderServerModels(data) + renderAdvancedServerModels(data),
        { view, scope, providerPanel: "models" },
        `${path} / ${ui("primary_models")}`,
      );
      addMarkup(
        renderFallbacks(data, scope),
        { view, scope, providerPanel: "fallbacks" },
        `${path} / ${ui("connection_fallbacks")}`,
      );
      if (scope === "server")
        addMarkup(
          renderSettingsPanel({ section: "byok" }),
          { view, scope, providerPanel: "models" },
          `${path} / ${ui("primary_models")}`,
        );
      const template = document.createElement("template");
      template.innerHTML = renderProviderDialogs(data, scope);
      for (const dialog of template.content.querySelectorAll("dialog"))
        addMarkup(
          dialog.outerHTML,
          { view, scope, providerPanel: "connections" },
          `${path} / ${dialog.querySelector("h2")?.textContent || ""}`,
        );
    }
    return entries;
  }

  function filterSettingsSearch(entries, query) {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return entries
      .map((entry) => {
        const title = entry.title.toLocaleLowerCase();
        const text = `${title} ${entry.path} ${entry.hint || ""}`.toLocaleLowerCase();
        return {
          entry,
          score: words.every((word) => text.includes(word))
            ? title === query.toLocaleLowerCase().trim()
              ? 3
              : words.some((word) => title.includes(word)) &&
                  words.every((word) => `${title} ${entry.path}`.toLocaleLowerCase().includes(word))
                ? 2
                : 1
            : 0,
        };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ entry }) => entry);
  }

  function updateSettingsSearch(dialog) {
    const matches = filterSettingsSearch(settingsSearchEntries, dialog.querySelector("input").value);
    const list = dialog.querySelector("[data-search-results]");
    list.innerHTML = matches
      .slice(0, 60)
      .map((entry) => {
        const persona = state.overview.personas.find((persona) => persona.personaId === entry.personaId);
        return `<button type="button" class="settings-search-result" data-settings-search-result="${settingsSearchEntries.indexOf(entry)}">${persona ? personaAvatar(persona, "avatar") : ""}<span class="settings-search-copy"><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.path)}</small>${entry.hint ? `<span>${escapeHtml(entry.hint)}</span>` : ""}</span></button>`;
      })
      .join("");
    dialog.querySelector("[role=status]").textContent = matches.length
      ? ui("settings_search_count").replace("{count}", String(matches.length))
      : ui("settings_search_empty");
  }

  async function openSettingsSearch() {
    clearSearchSpotlight();
    if (document.getElementById("navigation-sheet")?.open) initNavigationMenus();
    if (!state.overview || document.querySelector("dialog[open]")) return;
    const guildId = state.guildId;
    const dialog = document.createElement("dialog");
    dialog.className = "dialog wide settings-search";
    dialog.setAttribute("aria-labelledby", "settings-search-title");
    dialog.innerHTML = `<header class="panel-header"><div class="heading"><h2 id="settings-search-title">${escapeHtml(ui("settings_search"))}</h2></div><button class="button icon" type="button" data-search-close aria-label="${escapeHtml(ui("navigation_close"))}">${navigationIcon("x")}</button></header><label class="field"><span class="sr-only">${escapeHtml(ui("settings_search"))}</span><input type="search" placeholder="${escapeHtml(ui("settings_search_placeholder"))}" autocomplete="off"></label><p class="hint" role="status"></p><div class="settings-search-results" data-search-results></div>`;
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.querySelector("[data-search-close]").onclick = () => dialog.close();
    dialog.querySelector("input").addEventListener("input", () => updateSettingsSearch(dialog));
    dialog.addEventListener("keydown", (event) => {
      const buttons = [...dialog.querySelectorAll("[data-settings-search-result]")];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = index + (event.key === "ArrowDown" ? 1 : -1);
        if (next < 0) dialog.querySelector("input").focus();
        else buttons[Math.min(next, buttons.length - 1)]?.focus();
      } else if (event.key === "Enter" && event.target.matches("input")) {
        event.preventDefault();
        buttons[0]?.click();
      }
    });
    dialog.showModal();
    settingsSearchEntries = buildSettingsSearchIndex();
    updateSettingsSearch(dialog);
    dialog.querySelector("input").focus();
    for (const scope of state.overview.canManage ? ["personal", "server"] : ["personal"]) {
      if (state.providerData[scope]) continue;
      try {
        const data = await api(`/guilds/${guildId}/providers/${scope}`);
        if (!dialog.open || state.guildId !== guildId) return;
        state.providerData[scope] = data;
        settingsSearchEntries = buildSettingsSearchIndex();
        updateSettingsSearch(dialog);
      } catch {
        if (dialog.open) dialog.querySelector("[role=status]").textContent = ui("settings_search_partial");
      }
    }
  }

  function focusSearchDestination() {
    const entry = pendingSearchDestination;
    if (!entry) return;
    if (state.view !== entry.view) {
      pendingSearchDestination = null;
      return;
    }
    const root = entry.dialog ? document.getElementById(entry.dialog) : document.querySelector("[data-dashboard-view]");
    if (!root) return;
    if (entry.dialog === "provider-dialog" && entry.view === "server-providers") {
      const form = root.querySelector("form");
      const provider = form.elements.provider;
      if (entry.providerRegistration === "endpoint") provider.value = "other";
      if (entry.providerRegistration === "key" && provider.value === "other") provider.selectedIndex = 0;
      updateServerProviderRegistration(form);
    }
    if (entry.dialog && !root.open) root.showModal();
    let target;
    if (entry.personaHome) target = root.querySelector(".banner");
    else if (entry.view === "channel-settings" && entry.channelTab !== "allowlist")
      target = root.querySelector("[data-channel-settings] [data-channel-picker]");
    else if (entry.view === "channel-settings") target = root.querySelector("[data-channel-allowlist]");
    else if (entry.name)
      target = [...root.querySelectorAll("[name]")]
        .find((input) => input.name === entry.name && input.getClientRects().length)
        ?.closest(".field, .toggle, fieldset");
    if (!target && entry.tag)
      target = [...root.querySelectorAll(entry.tag)].find(
        (element) => settingSearchText(element) === entry.title && element.getClientRects().length,
      );
    if (!target && !entry.tag && !entry.name)
      target = root.querySelector(entry.personaPanel ? "[data-persona-content]" : "h1");
    if (!target) return;
    if (target.matches("h2, h3, legend")) target = target.closest("fieldset, .panel, .card") || target;
    pendingSearchDestination = null;
    target.scrollIntoView({ block: "center", behavior: "instant" });
    const control =
      target.querySelector(
        'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button',
      ) || target;
    if (control === target) target.tabIndex = -1;
    control.focus({ preventScroll: true });
    showSearchSpotlight(target);
  }

  function showSearchSpotlight(target) {
    clearSearchSpotlight();
    const spotlight = document.createElement("div");
    spotlight.className = "settings-search-spotlight";
    spotlight.popover = "manual";
    spotlight.setAttribute("aria-hidden", "true");
    document.body.append(spotlight);
    const position = () => {
      if (!target.isConnected) {
        clearSearchSpotlight();
        return;
      }
      const rect = target.getBoundingClientRect();
      const left = Math.max(4, rect.left - 12);
      const top = Math.max(4, rect.top - 12);
      Object.assign(spotlight.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${Math.max(0, Math.min(innerWidth - 4, rect.right + 12) - left)}px`,
        height: `${Math.max(0, Math.min(innerHeight - 4, rect.bottom + 12) - top)}px`,
      });
    };
    const resize = new ResizeObserver(position);
    const dismiss = () => clearSearchSpotlight();
    clearSearchSpotlight = () => {
      spotlight.remove();
      resize.disconnect();
      document.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismiss, true);
      clearSearchSpotlight = () => {};
    };
    position();
    spotlight.showPopover();
    resize.observe(target);
    document.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
  }

  function renderOverview(workspace) {
    const { guild, personas, canManage } = state.overview;
    workspace.innerHTML = `
      <section class="banner" aria-labelledby="overview-server-name">
        <div class="banner-info">
          <div class="stack" data-overview-summary>
            <p class="crumb">${escapeHtml(ui("overview_title"))}</p>
            <h1 id="overview-server-name" data-fx="split">${escapeHtml(guild.name)}</h1>
            <p class="banner-text">${escapeHtml(ui("overview_hint"))}</p>
            <div class="chips">
              ${!guild.isDirectMessage && guild.memberCount != null ? `<span class="chip">${navigationIcon("users-round")}${escapeHtml(ui(guild.memberCount === 1 ? "overview_member_count_one" : "overview_member_count").replace("{count}", new Intl.NumberFormat().format(guild.memberCount)))}</span>` : ""}
              <span class="chip">${navigationIcon("user-round")}${escapeHtml(ui(personas.length === 1 ? "overview_persona_count_one" : "overview_persona_count").replace("{count}", new Intl.NumberFormat().format(personas.length)))}</span>
            </div>
          </div>
          <div class="quickbar">
            <a class="button small" href="#personas" data-nav="personas">${navigationIcon("users-round")}${escapeHtml(ui("overview_personas"))}</a>
            ${canManage ? `<a class="button small" href="#settings" data-nav="settings">${navigationIcon("sliders-horizontal")}${escapeHtml(ui("nav_server_settings"))}</a>` : ""}
          </div>
        </div>
        <div class="banner-art" data-overview-art aria-hidden="true">${renderOverviewArt()}</div>
      </section>
      <svg class="sr-only" width="0" height="0" aria-hidden="true"><defs><linearGradient id="spark-reward" x1="0" x2="1"><stop offset="0" stop-color="var(--primary)"></stop><stop offset="1" stop-color="var(--accent)"></stop></linearGradient></defs></svg>
      ${renderServerStats()}`;

    if (!state.serverStats && !state.serverStatsLoading && !state.serverStatsError) {
      loadServerStats();
    } else {
      updateServerStatsSection();
    }
  }

  function renderOverviewArt() {
    const personas = state.overview.personas;
    const active = (state.serverStats?.personas || [])
      .map((entry) => personas.find((persona) => persona.lineageId === entry.lineageId))
      .filter(Boolean);
    const [front, backLeft, backRight] = [...new Set([...active, ...personas])];
    if (!front) return "";
    const card = (persona, variant) => {
      if (!persona) return "";
      const avatar = personaAvatarUrl(persona);
      const initial = persona.nickname.trim().slice(0, 1) || "?";
      return `<span class="${variant}${variant === "front" && !avatar ? " mono" : ""}" data-label="${escapeHtml(persona.nickname)}">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" data-avatar-fallback="${escapeHtml(initial)}">` : escapeHtml(initial)}</span>`;
    };
    return `<div class="card-stack">${card(backLeft, "back b1")}${card(backRight, "back b2")}${card(front, "front")}</div>
      <span class="sparkle">✦</span><span class="sparkle s2">✧</span>`;
  }

  function renderStatsRanking(title, entries, unit, personas = null) {
    const top = entries[0]?.count || 1;
    return `<section class="card">
      <div class="card-head"><div><h3>${escapeHtml(title)}</h3><p class="hint">${escapeHtml(ui("stats_top_five"))}</p></div>
        ${personas ? `<a class="button small" href="#personas" data-nav="personas">${escapeHtml(ui("overview_personas"))}</a>` : ""}
      </div>
      <div class="rows" data-fx="stagger">
        ${
          entries.length
            ? entries
                .map((entry) => {
                  const name = escapeHtml(entry.name);
                  const value = `${formatStatNumber(entry.count)} ${escapeHtml(unit)}`;
                  if (!personas)
                    return `<div class="item"><div><p><strong>${name}</strong></p></div><b>${value}</b></div>`;
                  const persona = personas.find((candidate) => candidate.lineageId === entry.lineageId);
                  return `<article class="item lead">
                    ${personaSticker(persona ?? { nickname: entry.name }, "flat")}
                    <div><p><strong>${name}</strong></p><div class="progress-track" aria-hidden="true"><div class="progress-fill" data-progress-value="${(entry.count / top) * 100}"></div></div></div>
                    <b>${value}</b>
                  </article>`;
                })
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
        <td class="num model-share-cell" data-label="${escapeHtml(ui("stats_model_share"))}">${total ? "" : `<span>${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(share)}%</span><div class="share-track" aria-hidden="true"><span data-share-value="${share}"></span></div>`}</td>
        <td class="num" data-label="${escapeHtml(ui("stats_input"))}">${exactNumber(model.inputTokens)}</td>
        <td class="num" data-label="${escapeHtml(ui("stats_output"))}">${exactNumber(model.outputTokens)}</td>
        <td class="num" data-label="${escapeHtml(ui("stats_total_tokens"))}">${exactNumber(tokens)}</td>
        <td class="num" data-label="${escapeHtml(ui("stats_cost"))}">${model.cost === null ? `<span title="${escapeHtml(ui("stats_cost_unavailable"))}">-</span>` : formatUsd(model.cost)}</td>
      </tr>`;
    };
    return `<section class="card">
      <div class="card-head"><div><h3>${escapeHtml(ui("stats_models"))}</h3><p class="hint">${escapeHtml(ui("stats_models_hint"))}</p></div></div>
      <div class="stack">
      ${
        models.length
          ? `<div class="table-wrap"><table><caption>${escapeHtml(ui("stats_models"))}</caption>
        <thead><tr><th scope="col">${escapeHtml(ui("stats_model"))}</th>${["stats_model_share", "stats_input", "stats_output", "stats_total_tokens", "stats_cost"].map((key) => `<th class="num" scope="col">${escapeHtml(ui(key))}</th>`).join("")}</tr></thead>
        <tbody>${models.map((model) => row(model)).join("")}</tbody>
        <tfoot>${row({ name: selectedModel ?? ui("stats_server_total"), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cost: usage.cost }, true)}</tfoot>
      </table></div>`
          : `<p class="hint">${escapeHtml(ui("stats_empty"))}</p>`
      }
      <p class="hint">${escapeHtml(ui("stats_tokens_hint"))} ${escapeHtml(ui("stats_cost_hint"))}</p>
      </div>
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

  function statsTrendBuckets(history, selectedModel) {
    if (!history) return [];
    const dayMs = 86400000;
    const start = Date.parse(history.from);
    const dayCount = (Date.parse(history.through) - start) / dayMs + 1;
    if (dayCount < 7) return [];
    const size = Math.min(dayCount, 30);
    const points = Array.from({ length: size }, () => ({ inputTokens: 0, outputTokens: 0, cost: 0 }));
    const bucketFor = (date) => points[Math.floor((((Date.parse(date) - start) / dayMs) * size) / dayCount)];
    const tokenRows =
      selectedModel === null ? history.days : history.models.filter((row) => row.model === selectedModel);
    for (const row of tokenRows) {
      const point = bucketFor(row.date);
      if (!point) continue;
      point.inputTokens += row.inputTokens;
      point.outputTokens += row.outputTokens;
    }
    for (const row of history.models ?? []) {
      if (selectedModel !== null && row.model !== selectedModel) continue;
      const point = bucketFor(row.date);
      if (point) point.cost += row.cost;
    }
    return points;
  }

  function renderStatsTile(label, value, scope, values = []) {
    let sparkline = "";
    if (values.length) {
      const min = Math.min(...values);
      const range = Math.max(...values) - min || 1;
      const points = values
        .map(
          (count, i) =>
            `${((i / (values.length - 1)) * 100).toFixed(1)},${(36 - ((count - min) / range) * 30).toFixed(1)}`,
        )
        .join(" ");
      sparkline = `<svg class="sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><polygon class="spark-area" points="0,40 ${points} 100,40"></polygon><polyline points="${points}"></polyline></svg>`;
    }
    return `<div class="stat-tile"><div class="stat-copy"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><small>${escapeHtml(scope)}</small></div>${sparkline}</div>`;
  }

  function renderUsageHistory(stats, usage, series) {
    if (!series)
      return `<section class="card"><div class="card-head"><div><h3>${escapeHtml(ui("stats_history"))}</h3><p class="hint">${escapeHtml(ui("stats_history_error"))}</p></div><button class="button small" type="button" data-stats-retry>${escapeHtml(ui("stats_retry"))}</button></div></section>`;
    const { points, monthly, peakDay } = series;
    const maximum = Math.max(1, ...points.map((point) => point.inputTokens + point.outputTokens));
    const peakIndex = points.findIndex((point) => point.inputTokens + point.outputTokens === maximum);
    const selectedIndex = Math.max(0, peakIndex);
    const number = (value) => new Intl.NumberFormat().format(value);
    const totalTokens = usage.inputTokens + usage.outputTokens;
    return `<div class="split">
      <section class="card" data-usage-history>
      <div class="card-head"><div><h3>${escapeHtml(ui("stats_history"))}</h3><p class="hint">${escapeHtml(ui(state.statsHistoryModel === null ? (monthly ? "stats_history_monthly" : "stats_history_daily") : monthly ? "stats_history_selected_monthly" : "stats_history_selected_daily"))} (UTC)</p></div>
      <div class="chart-legend"><span><i class="legend-dot" aria-hidden="true"></i>${escapeHtml(ui("stats_input"))}</span><span><i class="legend-dot output" aria-hidden="true"></i>${escapeHtml(ui("stats_output"))}</span></div>
      </div>
      ${
        peakIndex < 0
          ? `<p class="hint">${escapeHtml(ui("stats_empty"))}</p>`
          : `
      <div class="usage-chart">
        <div class="chart-axis" aria-hidden="true"><span>${formatStatNumber(maximum)}</span><span>${formatStatNumber(Math.round(maximum / 2))}</span><span>0</span></div>
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
      <div class="chart-readout" role="status" aria-live="polite">${historyPointValues(points[selectedIndex])}</div>`
      }
      </section><div class="col"><aside class="card">
      <div class="card-head"><div><h3>${escapeHtml(ui("stats_model_share"))}</h3><p class="hint">${escapeHtml(state.statsHistoryModel ?? ui("stats_server_total"))}</p></div></div>
      <div class="stack">
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
      </div></aside>
      ${peakDay && peakIndex >= 0 ? `<aside class="card"><div class="card-head"><div><h3>${escapeHtml(ui("stats_history_peak"))}</h3><p class="hint">${escapeHtml(historyDate(peakDay.date))}</p></div><strong>${number(peakDay.inputTokens + peakDay.outputTokens)} ${escapeHtml(ui("stats_history_tokens"))}</strong></div></aside>` : ""}
      </div></div>
      <section class="card"><details><summary>${escapeHtml(ui("stats_history_values"))}</summary>
        <div class="stack">
        <div class="table-wrap"><table><caption>${escapeHtml(ui("stats_history_values"))}</caption><thead><tr><th scope="col">${escapeHtml(ui("stats_history_period"))}</th>${["stats_input", "stats_output", "stats_total_tokens"].map((key) => `<th class="num" scope="col">${escapeHtml(ui(key))}</th>`).join("")}</tr></thead><tbody>${points.map((point) => `<tr><th scope="row">${escapeHtml(historyPointLabel(point))}</th><td class="num">${number(point.inputTokens)}</td><td class="num">${number(point.outputTokens)}</td><td class="num">${number(point.inputTokens + point.outputTokens)}</td></tr>`).join("")}</tbody></table></div>
        <p class="hint">${escapeHtml(ui("stats_history_hint"))}</p>
        </div>
      </details></section>`;
  }

  function selectHistoryPoint(target) {
    const history = state.serverStats?.history;
    if (!history) return;
    const filtered =
      state.statsHistoryModel === null
        ? history
        : { ...history, days: history.models.filter((entry) => entry.model === state.statsHistoryModel) };
    const point = buildUsageHistory(filtered).points[Number(target.dataset.historyIndex)];
    const panel = target.closest("[data-usage-history]");
    if (!point || !panel) return;
    panel.querySelector(".chart-readout").innerHTML = historyPointValues(point);
    panel.querySelectorAll("[data-history-index]").forEach((bar) => {
      bar.setAttribute("aria-pressed", String(bar === target));
    });
  }

  const statsPeriods = {
    today: "stats_today",
    week: "stats_week",
    month: "stats_month",
    quarter: "stats_quarter",
    year: "stats_year",
    all_time: "stats_all_time",
    custom: "stats_custom",
  };

  function renderStatsToolbar() {
    const today = new Date().toISOString().slice(0, 10);
    return `<div class="toolbar" data-stats-filters>
      <div class="segmented" data-fx="indicator" data-overflow role="tablist" aria-label="${escapeHtml(ui("stats_timeframe"))}">
        ${Object.entries(statsPeriods)
          .map(
            ([period, label]) =>
              `<button type="button" id="overview-period-${period}" role="tab" data-history-timeframe="${period}" aria-selected="false" aria-controls="overview-period-content" tabindex="-1">${escapeHtml(ui(label))}</button>`,
          )
          .join("")}
      </div>
      <div class="actions">
        <label class="field"><span class="field-label sr-only">${escapeHtml(ui("stats_history_model_filter"))}</span><select data-history-model disabled><option value="">${escapeHtml(ui("stats_server_total"))}</option></select></label>
        <button class="button icon" type="button" popovertarget="stats-actions" aria-label="${escapeHtml(ui("stats_actions"))}" data-tooltip="${escapeHtml(ui("stats_actions"))}">${navigationIcon("ellipsis")}</button>
        <div class="action-menu" id="stats-actions" popover aria-label="${escapeHtml(ui("stats_actions"))}">
          <button class="button" type="button" data-stats-refresh>${navigationIcon("refresh-cw")}${escapeHtml(ui("stats_refresh"))}</button>
        </div>
      </div>
    </div>
    <div class="stage" id="overview-period-content" role="tabpanel">
    <form class="toolbar" id="stats-range-form" aria-label="${escapeHtml(ui("stats_custom"))}" ${state.statsRangeEditing ? "" : "hidden"}>
      <p class="sr-only" id="stats-range-hint">${escapeHtml(ui("stats_range_hint"))}</p>
      <div class="row">
        <label class="field">${fieldLabel(ui("stats_from"))}<input type="date" name="from" required max="${today}" value="${state.statsRange?.from || ""}" aria-describedby="stats-range-hint"></label>
        <label class="field">${fieldLabel(ui("stats_through"))}<input type="date" name="through" required max="${today}" value="${state.statsRange?.through || ""}" aria-describedby="stats-range-hint"></label>
      </div>
      <div class="actions"><button class="button small" type="button" data-stats-range-cancel>${escapeHtml(ui("persona_cancel"))}</button><button class="button small primary" type="submit">${escapeHtml(ui("stats_apply_range"))}</button></div>
    </form>
    <div class="toolbar" data-stats-range-summary hidden><p class="hint"></p><button class="button small" type="button" data-stats-range-edit>${escapeHtml(ui("stats_edit_range"))}</button></div>`;
  }

  function renderStatsContent() {
    if (state.serverStatsError)
      return `<section class="card"><div class="card-head"><div><h3>${escapeHtml(ui("stats_error"))}</h3><p class="hint">${escapeHtml(state.serverStatsError)}</p></div><button class="button small" type="button" data-stats-retry>${escapeHtml(ui("stats_retry"))}</button></div></section>`;
    if (!state.serverStats) return "";
    const stats = state.serverStats;
    const { totals } = stats;
    const usage = statsModelUsage(stats, state.statsHistoryModel);
    const selectedLabel = state.statsHistoryModel ?? ui("stats_server_total");
    const history =
      stats.history && state.statsHistoryModel !== null
        ? { ...stats.history, days: stats.history.models.filter((entry) => entry.model === state.statsHistoryModel) }
        : stats.history;
    const series = history ? buildUsageHistory(history) : null;
    const points = statsTrendBuckets(stats.history, state.statsHistoryModel);
    return `
        ${stats.history?.models === null ? `<p class="notice">${escapeHtml(ui("stats_history_filter_error"))}</p>` : ""}
        <div class="stat-grid framed">
          ${renderStatsTile(
            ui("stats_input"),
            formatStatNumber(usage.inputTokens),
            selectedLabel,
            points.map((point) => point.inputTokens),
          )}
          ${renderStatsTile(
            ui("stats_output"),
            formatStatNumber(usage.outputTokens),
            selectedLabel,
            points.map((point) => point.outputTokens),
          )}
          ${renderStatsTile(
            ui("stats_total_tokens"),
            formatStatNumber(usage.inputTokens + usage.outputTokens),
            selectedLabel,
            points.map((point) => point.inputTokens + point.outputTokens),
          )}
          ${renderStatsTile(
            ui("stats_cost"),
            usage.cost === null ? "-" : formatUsd(usage.cost),
            usage.cost === null ? ui("stats_cost_unavailable") : selectedLabel,
            usage.cost !== null && stats.history?.models ? points.map((point) => point.cost) : [],
          )}
        </div>
        ${renderUsageHistory(stats, usage, series)}
        <div class="split">
          ${renderStatsRanking(ui("stats_personas"), stats.personas, ui("stats_reply_unit"), state.overview.personas)}
          <section class="card"><div class="card-head"><div><h3>${escapeHtml(ui("stats_server_activity"))}</h3><p class="hint">${escapeHtml(ui("stats_server_activity_hint"))}</p></div></div>
          <div class="rows">
          ${[
            ["stats_generations", totals.textGenerations, "stats_generations_hint"],
            ["stats_replies", totals.messages, "stats_replies_hint"],
            ["stats_commands", totals.commands],
            ["stats_images", totals.imageGenerations],
            ["stats_videos", totals.videoGenerations],
          ]
            .map(
              ([label, value, hint]) =>
                `<div class="item"><div><p><strong>${escapeHtml(ui(label))}</strong></p>${hint ? `<div class="item-meta"><span>${escapeHtml(ui(hint))}</span></div>` : ""}</div><b>${formatStatNumber(value)}</b></div>`,
            )
            .join("")}
          </div></section>
        </div>
        <div class="split">
          ${renderStatsRanking(ui("stats_tools"), stats.tools, ui("stats_use_unit"))}
          ${renderStatsRanking(ui("stats_commands"), stats.topCommands, ui("stats_use_unit"))}
        </div>
        ${renderModelUsage(stats, state.statsHistoryModel)}`;
  }

  function renderServerStats() {
    return `<section class="stage" data-server-stats aria-labelledby="overview-stats-title" aria-busy="${state.serverStatsLoading}">
      <h2 class="sr-only" id="overview-stats-title">${escapeHtml(ui("stats_title"))}</h2>
      ${renderStatsToolbar()}
      <div data-stats-loading hidden>${loadingBar(ui("stats_loading"))}</div>
      <div class="stage" data-stats-content></div></div>
    </section>`;
  }

  function updateServerStatsSection(refreshContent = true) {
    if (state.view !== "overview") return;
    const current = document.querySelector("[data-server-stats]");
    if (!current) return;
    const timeframe = state.statsTimeframe;
    const displayedTimeframe = state.statsRangeEditing ? "custom" : timeframe;
    current
      .querySelector("#overview-period-content")
      .setAttribute("aria-labelledby", `overview-period-${displayedTimeframe}`);
    for (const button of current.querySelectorAll("[data-history-timeframe]")) {
      const selected = button.dataset.historyTimeframe === displayedTimeframe;
      const value = String(selected);
      if (button.getAttribute("aria-selected") !== value) button.setAttribute("aria-selected", value);
      button.tabIndex = selected ? 0 : -1;
    }

    const form = current.querySelector("#stats-range-form");
    const wasHidden = form.hidden;
    form.hidden = !state.statsRangeEditing;
    if (wasHidden && !form.hidden) {
      form.elements.from.value = state.statsRange?.from ?? "";
      form.elements.through.value = state.statsRange?.through ?? "";
    }
    const summary = current.querySelector("[data-stats-range-summary]");
    summary.hidden = timeframe !== "custom" || !form.hidden;
    if (!summary.hidden) {
      summary.querySelector(".hint").textContent =
        `${historyPointLabel({ date: state.statsRange.from, through: state.statsRange.through })} (UTC)`;
    }

    current.setAttribute("aria-busy", String(state.serverStatsLoading));
    current.querySelector("[data-stats-loading]").hidden = !state.serverStatsLoading;
    const select = current.querySelector("[data-history-model]");
    const modelHistory = state.serverStats?.history?.models;
    select.disabled = state.serverStatsLoading || !modelHistory;
    if (!refreshContent) return;
    if (!state.serverStatsLoading) {
      const models = [...new Set((modelHistory || []).map((entry) => entry.model))].sort();
      if (!models.includes(state.statsHistoryModel)) state.statsHistoryModel = null;
      if (
        select.options.length !== models.length + 1 ||
        models.some((model, index) => select.options[index + 1].value !== `model:${model}`)
      ) {
        select.innerHTML = `<option value="">${escapeHtml(ui("stats_server_total"))}</option>${models.map((model) => `<option value="${escapeHtml(`model:${model}`)}">${escapeHtml(model || "(unknown)")}</option>`).join("")}`;
      }
      select.value = state.statsHistoryModel === null ? "" : `model:${state.statsHistoryModel}`;
    }
    const content = current.querySelector("[data-stats-content]");
    content.innerHTML = renderStatsContent();
    enhanceDashboard(content);
  }

  let statsRequest;

  async function loadServerStats() {
    const request = {};
    statsRequest = request;
    const guildId = state.guildId;
    const timeframe = state.statsTimeframe;
    const range = state.statsRange;
    state.serverStatsLoading = true;
    state.serverStatsError = "";
    updateServerStatsSection(false);
    try {
      const query = new URLSearchParams({ timeframe });
      if (timeframe === "custom" && range) {
        query.set("from", range.from);
        query.set("through", range.through);
      }
      const response = await api(`/guilds/${guildId}/stats?${query}`);
      if (statsRequest !== request || state.guildId !== guildId) return;
      state.serverStats = response.stats;
      const art = state.view === "overview" && document.querySelector("[data-overview-art]");
      if (art) art.innerHTML = renderOverviewArt();
    } catch (error) {
      if (statsRequest !== request || state.guildId !== guildId) return;
      state.serverStatsError = error.message;
    } finally {
      if (statsRequest === request && state.guildId === guildId) {
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
          <label class="field">${fieldLabel(ui("discord_language"), ui("discord_language_hint"))}<select name="language_pref">
            ${(profile.languages || [])
              .map(
                ({ value, label }) =>
                  `<option value="${escapeHtml(value)}"${value === profile.language ? " selected" : ""}>${escapeHtml(label)}</option>`,
              )
              .join("")}
          </select></label>
          <label class="field">${fieldLabel(profile.copy.prefix, profile.copy.prefixHint)}<input name="prefix_override" value="${escapeHtml(profile.prefix ?? "")}" maxlength="${profile.limits.affix}"></label>
          <label class="field">${fieldLabel(profile.copy.suffix, profile.copy.suffixHint)}<input name="suffix_override" value="${escapeHtml(profile.suffix ?? "")}" maxlength="${profile.limits.affix}"></label>
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
        <section class="subsection stack" id="character-reference-controls">${renderCharacterReference()}</section>
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

  function renderCharacterReference() {
    return `<div class="heading"><h3>${escapeHtml(ui("character_reference"))}</h3><p>${escapeHtml(ui("character_reference_hint"))}</p></div>
      ${state.overview.profile.hasCharacterReference ? `<img class="character-reference-preview" src="${BASE}/profile/character-reference?v=${Date.now()}" alt="${escapeHtml(ui("character_reference"))}">` : ""}
      <div class="actions"><button class="button" type="button" data-character-reference-upload>${escapeHtml(ui("character_reference_upload"))}</button>
      ${state.overview.profile.hasCharacterReference ? `<button class="button danger" type="button" data-character-reference-remove>${escapeHtml(ui("character_reference_remove"))}</button>` : ""}</div>
      <input type="file" id="character-reference-file" accept="image/*" hidden>`;
  }

  async function saveCharacterReference(file) {
    const controls = document.getElementById("character-reference-controls");
    try {
      await withBusyForm(controls, async () => {
        const body = new FormData();
        if (file) body.set("file", file);
        const result = await api("/profile/character-reference", {
          method: file ? "PUT" : "DELETE",
          ...(file ? { body } : {}),
        });
        state.overview.profile.hasCharacterReference = result.hasCharacterReference;
        controls.innerHTML = renderCharacterReference();
      });
      toast(ui("character_reference_saved"));
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderProfile(workspace) {
    workspace.innerHTML = `${pageHeader("Personal", ui("my_settings"), "These preferences belong to you, not to the selected server.")}
      <div class="grid"><div class="stack">${renderProfilePanel("profile")}</div><div class="stack">${["privacy", "conversation"].map(renderProfilePanel).join("")}</div></div>`;
  }

  function renderPersonalSpotlights(workspace) {
    workspace.innerHTML = `${pageHeader(state.overview.guild.name, ui("spotlights"), ui("spotlights_hint"))}<section class="panel stack" id="personal-spotlights"></section>`;
    void loadPersonalSpotlights(workspace.querySelector("#personal-spotlights"));
  }

  async function loadPersonalSpotlights(host) {
    const path = `/guilds/${state.guildId}/personal-spotlights`;
    host.innerHTML = loadingBar(ui("spotlights"));
    try {
      const data = await api(path);
      if (host.isConnected) renderPersonalSpotlightList(host, path, data);
    } catch (error) {
      if (!host.isConnected) return;
      host.innerHTML = `<div class="row"><p role="alert">${escapeHtml(error.message)}</p>${refreshButton("spotlight", ui("refresh_all"))}</div>`;
      host.querySelector("[data-spotlight-refresh]").onclick = () => loadPersonalSpotlights(host);
    }
  }

  function renderPersonalSpotlightList(host, path, data) {
    const channels = new Map(data.channels.map((channel) => [channel.id, channel]));
    const personas = new Map(state.overview.personas.map((persona) => [persona.personaId, persona.nickname]));
    const allowed = state.overview.allowedChannelIds || [];
    const restricted = state.overview.channelWhitelistActive ?? allowed.length > 0;
    const newChannels = data.channels.filter(
      (channel) =>
        (!restricted || allowed.includes(channel.id)) && !data.spotlights.some((row) => row.channelId === channel.id),
    );
    host.innerHTML = `<header class="panel-header"><div class="heading"><h2>${escapeHtml(ui("spotlight_active"))}</h2></div><div class="actions">
      ${refreshButton("spotlight", ui("spotlights"))}
      <button class="button primary" type="button" data-spotlight-add aria-haspopup="dialog"${newChannels.length ? "" : " disabled"}>${navigationIcon("plus")}${escapeHtml(ui("spotlight_add"))}</button>
    </div></header>
      ${
        data.spotlights.length
          ? data.spotlights
              .map((row) => {
                const channel = channels.get(row.channelId);
                const names = row.personaIds.map((id) => personas.get(id)).filter(Boolean);
                const auto = personas.get(row.autoTriggerPersonaId);
                return `<article class="subsection stack"><div class="row">
          <div class="heading"><h3>${escapeHtml(channel ? `#${channel.name}` : ui("spotlight_channel_unavailable"))}</h3><small>${escapeHtml(row.expiresAt ? formatDate(row.expiresAt) : ui("spotlight_permanent"))}</small></div>
          <div class="actions">${channel ? `<button class="button" type="button" data-spotlight-edit="${escapeHtml(row.channelId)}" aria-haspopup="dialog">${escapeHtml(ui("spotlight_edit"))}</button>` : ""}<button class="button danger" type="button" data-spotlight-remove="${escapeHtml(row.channelId)}">${escapeHtml(ui("spotlight_remove"))}</button></div>
        </div>${names.length ? `<p>${escapeHtml(names.join(", "))}</p>` : ""}${auto ? `<p><strong>${escapeHtml(ui("spotlight_auto"))}:</strong> ${escapeHtml(auto)}</p>` : ""}</article>`;
              })
              .join("")
          : `<p class="hint">${escapeHtml(ui("spotlights_empty"))}</p>`
      }
      ${!newChannels.length ? `<p class="hint">${escapeHtml(ui("spotlight_no_channels"))}</p>` : ""}`;
    host.querySelector("[data-spotlight-refresh]").onclick = () => loadPersonalSpotlights(host);
    const edit = (row) => {
      openPersonalSpotlightEditor(path, row, row ? [channels.get(row.channelId)] : newChannels, (saved) => {
        if (!host.isConnected) return;
        data.spotlights = [...data.spotlights.filter(({ channelId }) => channelId !== saved.channelId), saved];
        renderPersonalSpotlightList(host, path, data);
        host.querySelector(`[data-spotlight-edit="${saved.channelId}"]`)?.focus({ preventScroll: true });
      });
    };
    host.querySelector("[data-spotlight-add]").onclick = () => edit(null);
    host.querySelectorAll("[data-spotlight-edit]").forEach((button) => {
      button.onclick = () => edit(data.spotlights.find(({ channelId }) => channelId === button.dataset.spotlightEdit));
    });
    host.querySelectorAll("[data-spotlight-remove]").forEach((button) => {
      button.onclick = async () => {
        if (!(await confirmAction(ui("spotlight_remove_title"), ui("spotlight_remove_hint")))) return;
        if (!host.isConnected || host.classList.contains("is-saving")) return;
        const channelId = button.dataset.spotlightRemove;
        try {
          await withBusyForm(host, () => api(`${path}/${channelId}`, { method: "DELETE" }));
          if (!host.isConnected) return;
          data.spotlights = data.spotlights.filter((row) => row.channelId !== channelId);
          renderPersonalSpotlightList(host, path, data);
          host.querySelector("[data-spotlight-refresh]").focus({ preventScroll: true });
          toast(ui("spotlight_removed"));
        } catch (error) {
          toast(error.message, "error");
        }
      };
    });
    enhanceDashboard(host);
  }

  function openPersonalSpotlightEditor(path, row, channels, onSave) {
    const personas = state.overview.personas;
    const title = ui(row ? "spotlight_edit" : "spotlight_add");
    const dialog = document.createElement("dialog");
    dialog.className = "dialog wide";
    dialog.setAttribute("aria-labelledby", "spotlight-editor-title");
    dialog.innerHTML = `<form class="stack" data-spotlight-form>
      <header class="panel-header"><div class="heading"><h2 id="spotlight-editor-title">${escapeHtml(title)}</h2></div></header>
      ${row ? `<p><strong>${escapeHtml(ui("spotlight_channel"))}:</strong> #${escapeHtml(channels[0].name)}</p>` : renderChannelSelector("channelId", [], true, channels)}
      <fieldset class="stack"><legend>${escapeHtml(ui("spotlight_personas"))}</legend>
        <label class="field">${fieldLabel(ui("spotlight_search_personas"))}<input type="search" data-spotlight-persona-search></label>
        <div class="channel-choices">${personas
          .map(
            (persona) =>
              `<label class="channel-choice" data-spotlight-persona-name="${escapeHtml(persona.nickname.toLowerCase())}"><input type="checkbox" name="personaIds" value="${persona.personaId}"${row?.personaIds.includes(persona.personaId) ? " checked" : ""}>${personaAvatar(persona, "avatar")}<span>${escapeHtml(persona.nickname)}</span></label>`,
          )
          .join("")}</div>
      </fieldset>
      <div class="grid">
        <label class="field">${fieldLabel(ui("spotlight_auto"), ui("spotlight_auto_hint"))}<select name="autoTriggerPersonaId" data-searchable></select></label>
        <label class="field">${fieldLabel(ui("spotlight_hours"), ui(row ? "spotlight_keep_expiry" : "spotlight_hours_hint"))}<input type="number" name="durationHours" min="0" max="999999" step="1" value="${row ? "" : "0"}"${row ? "" : " required"}></label>
      </div>
      <footer class="actions form-actions"><button class="button" type="button" data-spotlight-cancel>${escapeHtml(ui("endpoint_cancel"))}</button><button class="button primary" type="submit">${escapeHtml(ui("save"))}</button></footer>
    </form>`;
    document.body.append(dialog);
    const form = dialog.querySelector("form");
    const selectedIds = () =>
      [...form.querySelectorAll('[name="personaIds"]:checked')].map((input) => Number(input.value));
    const channelId = () => row?.channelId || form.elements.channelId.value;
    const auto = form.elements.autoTriggerPersonaId;
    const update = (current = auto.value) => {
      const selected = new Set(selectedIds());
      auto.replaceChildren(new Option(ui("spotlight_auto_none"), ""));
      personas
        .filter((persona) => selected.has(persona.personaId))
        .forEach((persona) => {
          auto.add(new Option(persona.nickname, persona.personaId));
        });
      auto.value = selected.has(Number(current)) ? current : "";
      form.querySelector('[type="submit"]').disabled = !selected.size || !channelId();
    };
    form.addEventListener("change", (event) => {
      if (["personaIds", "channelId"].includes(event.target.name)) update();
    });
    form.querySelector("[data-spotlight-persona-search]").oninput = (event) => {
      const query = event.target.value.trim().toLowerCase();
      form.querySelectorAll("[data-spotlight-persona-name]").forEach((label) => {
        label.hidden = !label.dataset.spotlightPersonaName.includes(query);
      });
    };
    form.querySelector("[data-spotlight-cancel]").onclick = () => dialog.close();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.classList.contains("is-saving") || !channelId() || !selectedIds().length) return;
      const hours = form.elements.durationHours.value;
      const body = {
        channelId: channelId(),
        personaIds: selectedIds(),
        autoTriggerPersonaId: Number(auto.value) || null,
        durationHours: hours === "" ? null : Number(hours),
      };
      try {
        const { spotlight } = await withBusyForm(form, () => api(path, { method: "PUT", body: JSON.stringify(body) }));
        dialog.close();
        onSave(spotlight);
        toast(ui("spotlight_saved"));
      } catch (error) {
        showFormError(form, error);
      }
    });
    dialog.addEventListener("cancel", (event) => {
      if (form.classList.contains("is-saving")) event.preventDefault();
    });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    update(row?.autoTriggerPersonaId == null ? "" : String(row.autoTriggerPersonaId));
    dialog.showModal();
    enhanceDashboard(dialog);
  }

  const moderationTabs = {
    roles: ["moderation_roles", "users-round"],
    blacklist: ["moderation_server_blocks", "x"],
    restrictions: ["moderation_persona_blocks", "user-round"],
    quotas: ["moderation_quotas", "sliders-horizontal"],
  };
  let moderationTab = "roles";

  function dashboardPanelHeading(key, hint = "", actions = "") {
    return `<header class="panel-header"><div class="heading"><h2>${escapeHtml(ui(key))}</h2>${hint ? `<p>${escapeHtml(ui(hint))}</p>` : ""}</div>${actions ? `<div class="actions">${actions}</div>` : ""}</header>`;
  }

  function renderModeration(workspace) {
    if (!state.overview.canManage || state.overview.guild.isDirectMessage) {
      workspace.innerHTML = `<section class="card"><div class="empty-note"><strong>${escapeHtml(ui("settings_manage_required"))}</strong></div></section>`;
      return;
    }
    const path = `/guilds/${state.guildId}/moderation`;
    const title = escapeHtml(ui("moderation"));
    const listFilters = { roles: { query: "" }, blacklist: { query: "" }, restrictions: { query: "", type: "" } };
    workspace.innerHTML = `
      <section class="banner compact" aria-labelledby="moderation-title">
        <div class="banner-info"><div class="stack">
          <p class="crumb">${escapeHtml(ui("nav_server_administration"))}<span class="kind">${escapeHtml(ui("settings_managers_only"))}</span></p>
          <h1 id="moderation-title" data-fx="split">${title}</h1>
          <p class="banner-text">${escapeHtml(ui("moderation_hint"))}</p>
        </div></div>
        <div class="banner-art" aria-hidden="true"><span class="sticker emblem">${navigationIcon("users-round")}</span></div>
      </section>
      <nav class="dock" data-fx="indicator" data-overflow role="tablist" aria-label="${title}">
        ${Object.entries(moderationTabs)
          .map(
            ([id, [key, icon]]) =>
              `<button type="button" id="moderation-tab-${id}" role="tab" aria-controls="moderation-stage" data-moderation-tab="${id}">${navigationIcon(icon)}${escapeHtml(ui(key))}</button>`,
          )
          .join("")}
      </nav>
      <section id="moderation-stage" class="stage" role="tabpanel">
        <div class="toolbar"><div class="actions">
          <button class="button small icon" type="button" data-moderation-refresh aria-label="${escapeHtml(ui("moderation_refresh"))}">${navigationIcon("refresh-cw")}</button>
        </div></div>
        <div data-moderation-content></div>
      </section>`;
    const stage = workspace.querySelector("#moderation-stage");
    const host = stage.querySelector("[data-moderation-content]");
    const tabButtons = [...workspace.querySelectorAll("[data-moderation-tab]")];
    let data = null;
    let loadVersion = 0;
    const selectTab = () => {
      for (const tab of tabButtons) {
        const selected = tab.dataset.moderationTab === moderationTab;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      stage.setAttribute("aria-labelledby", `moderation-tab-${moderationTab}`);
    };
    const load = async () => {
      const version = ++loadVersion;
      const current = () => host.isConnected && version === loadVersion;
      data = null;
      stage.querySelector("[data-moderation-add]")?.remove();
      host.setAttribute("aria-busy", "true");
      host.innerHTML = loadingBar(ui("moderation"));
      try {
        const result = await api(path);
        if (current()) data = result;
      } catch (error) {
        if (current()) host.innerHTML = `<div class="notice error" role="alert">${escapeHtml(error.message)}</div>`;
      } finally {
        if (current()) host.removeAttribute("aria-busy");
      }
      if (data && current()) renderModerationPanel(stage, path, data, onSaved, listFilters);
    };
    const onSaved = () => {
      if (!host.isConnected) return;
      toast(ui("moderation_saved"));
      void load();
    };
    stage.querySelector("[data-moderation-refresh]").onclick = () => {
      if (!savingForms && !host.hasAttribute("aria-busy")) void load();
    };
    for (const button of tabButtons) {
      button.onclick = () => {
        if (moderationTab === button.dataset.moderationTab || savingForms) return;
        moderationTab = button.dataset.moderationTab;
        selectTab();
        if (data) renderModerationPanel(stage, path, data, onSaved, listFilters);
        button.focus({ preventScroll: true });
      };
    }
    selectTab();
    void load();
  }

  function renderModerationPanel(stage, path, data, onSaved, listFilters) {
    const host = stage.querySelector("[data-moderation-content]");
    const actions = stage.querySelector(".toolbar > .actions");
    actions.querySelector("[data-moderation-add]")?.remove();
    const patch = (body) => api(path, { method: "PATCH", body: JSON.stringify(body) });
    const addButton = (key, disabled = false) =>
      `<button class="button small primary" type="button" data-moderation-add aria-haspopup="dialog"${disabled ? " disabled" : ""}>${navigationIcon("plus")}${escapeHtml(ui(key))}</button>`;
    const removeButton = (action, index, description, compactAction) => {
      const label = escapeHtml(ui(action));
      return `<button class="button small danger" type="button" data-moderation-remove="${index}" aria-describedby="${description}" aria-haspopup="dialog"${compactAction ? ` aria-label="${label}"` : ""}>${compactAction ? `<span data-restriction-wide>${label}</span><span data-restriction-compact>${escapeHtml(ui(compactAction))}</span>` : label}</button>`;
    };
    const removals = [];
    let availableRoles;
    if (moderationTab !== "quotas") {
      const roles = moderationTab === "roles";
      const restrictions = moderationTab === "restrictions";
      const filters = listFilters[moderationTab];
      const [heading] = moderationTabs[moderationTab];
      const action = roles
        ? "moderation_remove_action"
        : restrictions
          ? "moderation_lift_action"
          : "moderation_unblock_action";
      const searchLabel = roles
        ? "moderation_roles_search"
        : restrictions
          ? "moderation_restriction_search"
          : "moderation_blacklist_search";
      let entries = restrictions ? data.personaBlocks : data.serverBlocks;
      if (roles) {
        const names = new Map(data.roles.map(({ id, name }) => [id, name]));
        const allowed = new Set(data.allowedRoleIds);
        availableRoles = data.roles.filter(({ id }) => !allowed.has(id));
        entries = data.allowedRoleIds.map((id) => ({ id, name: names.get(id) }));
      }
      const tableRows = entries.map((entry, index) => {
        const id = roles ? entry.id : entry.userId;
        const name = entry.name || id;
        const searchText = [name, id, entry.personaName].join(" ").toLowerCase();
        const rowId = `moderation-entry-${index}`;
        const detail = entry.name ? id : roles ? ui("moderation_role_unavailable") : "";
        let description = rowId;
        let restrictionCells = "";
        if (roles) {
          removals.push({
            title: ui("moderation_remove_role").replace("{name}", () => name),
            hint: entries.length === 1 ? ui("moderation_remove_role_hint") : "",
            body: { action: "removeRole", roleId: id },
          });
        } else if (restrictions) {
          const personaId = `moderation-persona-${index}`;
          description += ` ${personaId}`;
          removals.push({
            title: ui("moderation_remove_persona_block")
              .replace("{name}", () => name)
              .replace("{persona}", () => entry.personaName),
            hint: ui("moderation_remove_persona_block_hint"),
            body: { action: "removePersonaBlock", userId: id, personaId: entry.personaId },
          });
          const type = ui(entry.type === "mute" ? "moderation_persona_mute" : "moderation_persona_block");
          const date = formatDate(entry.expiresAt);
          const expiresAt = escapeHtml(entry.expiresAt);
          restrictionCells = `<td><span id="${personaId}" dir="auto">${escapeHtml(entry.personaName)}</span><small class="hint" data-restriction-compact>${escapeHtml(type)}<br><time datetime="${expiresAt}">${escapeHtml(ui("moderation_expires").replace("{date}", () => date))}</time></small></td>
          <td data-restriction-wide>${escapeHtml(type)}</td>
          <td data-restriction-wide><time datetime="${expiresAt}">${escapeHtml(date)}</time></td>`;
        } else {
          removals.push({
            title: ui("moderation_remove_user").replace("{name}", () => name),
            hint: ui("moderation_remove_user_hint"),
            body: { action: "unblockUser", userId: id },
          });
        }
        return `<tr data-moderation-search="${escapeHtml(searchText)}"${restrictions ? ` data-restriction-type="${escapeHtml(entry.type)}"` : ""}>
          <th scope="row" id="${rowId}"><strong dir="auto">${escapeHtml(name)}</strong>${detail ? `<small class="hint">${escapeHtml(detail)}</small>` : ""}</th>
          ${restrictionCells}<td>${removeButton(action, index, description, restrictions ? "moderation_lift_compact" : undefined)}</td>
        </tr>`;
      });
      const add = roles
        ? addButton("moderation_add_role", !availableRoles.length)
        : restrictions
          ? ""
          : addButton("moderation_add_user");
      if (add) actions.insertAdjacentHTML("beforeend", add);
      host.innerHTML = `<section class="card" data-moderation-list="${moderationTab}">${personaCardHead(ui(heading), ui(`${heading}_hint`))}
        ${
          tableRows.length
            ? `<div class="stack"><div class="grid">
          <label class="field">${fieldLabel(ui(searchLabel))}<input type="search" data-moderation-query value="${escapeHtml(filters.query)}"></label>
          ${
            restrictions
              ? `<label class="field">${fieldLabel(ui("moderation_restriction_type"))}<select data-restriction-filter>
            ${[
              ["", "moderation_restriction_all_types"],
              ["mute", "moderation_persona_mute"],
              ["block", "moderation_persona_block"],
            ]
              .map(
                ([value, key]) =>
                  `<option value="${value}"${value === filters.type ? " selected" : ""}>${escapeHtml(ui(key))}</option>`,
              )
              .join("")}
          </select></label>`
              : ""
          }
        </div>
        <div class="table-wrap"><table aria-label="${escapeHtml(ui(heading))}">
          <thead><tr>
            <th scope="col">${escapeHtml(ui(roles ? "moderation_role_column" : "moderation_member_column"))}</th>
            ${
              restrictions
                ? `<th scope="col">${escapeHtml(ui("moderation_persona_column"))}</th>
            <th scope="col" data-restriction-wide>${escapeHtml(ui("moderation_restriction_type"))}</th>
            <th scope="col" data-restriction-wide>${escapeHtml(ui("moderation_expires_column"))}</th>`
                : ""
            }
            <th scope="col"><span class="sr-only">${escapeHtml(ui(action))}</span></th>
          </tr></thead><tbody>${tableRows.join("")}</tbody>
        </table></div>
        <p class="hint" role="status" data-moderation-filter-status></p></div>`
            : `<div class="empty-note"><strong>${escapeHtml(ui(`${heading}_empty`))}</strong></div>`
        }
        </section>`;
      if (tableRows.length) {
        const query = host.querySelector("[data-moderation-query]");
        const type = host.querySelector("[data-restriction-filter]");
        const rows = [...host.querySelectorAll("[data-moderation-search]")];
        const table = host.querySelector(".table-wrap");
        const status = host.querySelector("[data-moderation-filter-status]");
        const filterRows = () => {
          filters.query = query.value;
          if (type) filters.type = type.value;
          const terms = query.value.toLowerCase().trim().split(/\s+/);
          let visible = 0;
          for (const entry of rows) {
            entry.hidden =
              (type?.value && type.value !== entry.dataset.restrictionType) ||
              !terms.every((term) => entry.dataset.moderationSearch.includes(term));
            if (!entry.hidden) visible++;
          }
          table.hidden = visible === 0;
          status.textContent = visible
            ? ui("moderation_filter_count")
                .replace("{visible}", String(visible))
                .replace("{total}", String(rows.length))
            : ui("moderation_filter_no_matches");
        };
        query.addEventListener("input", filterRows);
        type?.addEventListener("change", filterRows);
        filterRows();
      }
    } else {
      const fields = [
        ["dailyUserQuota", "daily_user_quota", "moderation_daily_quota", 0, 100],
        ["serverwideQuota", "serverwide_quota", "moderation_server_quota", 0, 99999],
        ["serverwideQuotaResetsIn", "serverwide_quota_resets_in", "moderation_reset_days", 1, 365],
      ];
      host.innerHTML = `<div class="card-columns">${["text", "image", "video"]
        .map(
          (
            type,
          ) => `<form class="card" data-fx="track" data-moderation-quota="${type}" data-settings-key="moderation/${type}">
        ${personaCardHead(ui(`moderation_${type}`))}
        <div class="stack">${fields.map(([name, column, label, min, max]) => `<label class="field">${fieldLabel(ui(label), ui(`${label}_hint`))}<input type="number" name="${name}" min="${min}" max="${max}" step="1" value="${escapeHtml(data.quotas[type][column])}" required></label>`).join("")}</div>
        ${cardSaveActions(ui("save"))}
      </form>`,
        )
        .join("")}</div>`;
      host.querySelectorAll("[data-moderation-quota]").forEach((form) => {
        form.onsubmit = async (event) => {
          event.preventDefault();
          const quotaType = form.dataset.moderationQuota;
          const changes = Object.fromEntries(
            fields.flatMap(([name, column]) => {
              const value = form.elements[name].valueAsNumber;
              return value === data.quotas[quotaType][column] ? [] : [[name, value]];
            }),
          );
          if (!Object.keys(changes).length) return;
          try {
            const saved = await withBusyForm(form, () => patch({ action: "quota", quotaType, ...changes }));
            if (!saved || !form.isConnected) return;
            data.quotas[quotaType] = saved.quota;
            for (const [name, column] of fields) form.elements[name].value = saved.quota[column];
            completeFormSave(form);
            toast(ui("moderation_saved"));
          } catch (error) {
            if (form.isConnected) showFormError(form, error);
          }
        };
      });
    }
    const add = actions.querySelector("[data-moderation-add]");
    if (add) add.onclick = () => openModerationPicker(path, patch, availableRoles, data.serverBlocks, onSaved);
    host.querySelectorAll("[data-moderation-remove]").forEach((button) => {
      button.onclick = async () => {
        const { title, hint, body } = removals[Number(button.dataset.moderationRemove)];
        if (!(await confirmAction(title, hint)) || !host.isConnected) return;
        button.disabled = true;
        try {
          await patch(body);
          onSaved();
        } catch (error) {
          button.disabled = false;
          if (host.isConnected) toast(error.message, "error");
        }
      };
    });
    initDraftForms(host);
    enhanceDashboard(host);
  }

  function openModerationPicker(path, patch, roles, serverBlocks, onSaved) {
    const isRole = !!roles;
    const key = isRole ? "moderation_add_role" : "moderation_add_user";
    const dialog = document.createElement("dialog");
    dialog.className = "stack";
    dialog.setAttribute("aria-labelledby", "moderation-picker-title");
    dialog.innerHTML = `<header class="panel-header"><div class="heading"><h2 id="moderation-picker-title">${escapeHtml(ui(key))}</h2><p>${escapeHtml(ui(isRole ? "moderation_add_role_hint" : "moderation_server_blocks_hint"))}</p></div></header>
      ${isRole ? "" : `<form class="stack" data-member-search><label class="field">${fieldLabel(ui("moderation_member_query"), ui("moderation_member_query_hint"))}<input type="search" name="query" minlength="2" maxlength="100" required autofocus></label><div class="actions"><button class="button" type="submit">${escapeHtml(ui("settings_search"))}</button></div></form>`}
      <form class="stack" data-moderation-picker>
        <label class="field"${isRole ? "" : " hidden"}>${fieldLabel(ui(isRole ? "moderation_role" : "moderation_member"))}<select name="target" required${isRole ? " data-searchable autofocus" : ""}></select></label>
        <p role="status" class="hint" hidden></p>
        <footer class="actions"><button type="button" class="button" data-picker-cancel>${escapeHtml(ui("endpoint_cancel"))}</button><button type="submit" class="button primary"${isRole ? "" : " hidden disabled"}>${escapeHtml(ui(key))}</button></footer>
      </form>`;
    const form = dialog.querySelector("[data-moderation-picker]");
    const select = form.elements.target;
    const search = dialog.querySelector("[data-member-search]");
    const status = dialog.querySelector("[role=status]");
    const submit = form.querySelector('button[type="submit"]');
    if (isRole) select.replaceChildren(...roles.map(({ id, name }) => new Option(name, id)));
    if (search) {
      const clearSelection = () => {
        select.replaceChildren();
        select.closest(".field").hidden = true;
        submit.hidden = true;
        submit.disabled = true;
        status.hidden = true;
      };
      search.elements.query.oninput = clearSelection;
      search.onsubmit = async (event) => {
        event.preventDefault();
        clearSelection();
        search.querySelector(".form-error")?.remove();
        try {
          const query = search.elements.query.value.trim();
          const result = await withBusyForm(search, () => api(`${path}/members?q=${encodeURIComponent(query)}`));
          if (!result || !dialog.open) return;
          const members = result.members.filter(({ id }) => !serverBlocks.some(({ userId }) => userId === id));
          select.replaceChildren(...members.map(({ id, name, username }) => new Option(`${name} (@${username})`, id)));
          status.textContent = ui("moderation_members_empty");
          status.hidden = !!members.length;
          select.closest(".field").hidden = !members.length;
          submit.hidden = !members.length;
          submit.disabled = !members.length;
        } catch (error) {
          if (dialog.open) showFormError(search, error);
        }
      };
    }
    form.querySelector("[data-picker-cancel]").onclick = () => dialog.close();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const body = isRole ? { action: "addRole", roleId: select.value } : { action: "blockUser", userId: select.value };
      try {
        const saved = await withBusyForm(form, () => patch(body));
        if (!saved) return;
        dialog.close();
        onSaved();
      } catch (error) {
        if (dialog.open) showFormError(form, error);
      }
    };
    dialog.addEventListener("cancel", (event) => {
      if (form.classList.contains("is-saving")) event.preventDefault();
    });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    enhanceDashboard(dialog);
  }

  function renderMemoryCollection({ personal, global = false, persona = null }) {
    const serverWritesDisabled =
      !personal && !state.overview.canManage && !state.overview.memoryPolicy.serverMemoryTeachingEnabled;
    const personalCreationDisabled = personal && state.overview.profile.privacyLevel === 2;
    const title = global
      ? "Global personal memory"
      : personal
        ? `${persona.nickname}'s memories about you`
        : ui("persona_server_memory");
    const copy = global
      ? "Private facts available to your Tomori experience across persona lineages."
      : personal
        ? "Private facts about you that are only available to this persona when you are around."
        : state.overview.canManage
          ? `Shared facts for ${persona.nickname}. As an administrator, you can manage every entry.`
          : `Shared facts you personally taught ${persona.nickname}. Other members' entries remain hidden.`;

    const collection = Boolean(persona);
    const transferAttributes = personal
      ? ""
      : ` aria-disabled="true" data-tooltip="${escapeHtml(ui("memory_server_transfer_unavailable"))}"`;

    const add =
      serverWritesDisabled || personalCreationDisabled
        ? ""
        : `<button class="button primary" type="button" data-memory-add aria-controls="memory-compose-form" aria-expanded="false"${personal ? "" : " disabled"}${collection ? ' data-fx="spark"' : ""}>${collection ? navigationIcon("plus") : ""}${escapeHtml(ui("memory_add"))}</button>`;
    const transfers = `<button class="button" data-memory-export type="button"${transferAttributes}>${escapeHtml(ui("persona_memory_export") || "Export")}</button>
      <button class="button" data-memory-import type="button"${transferAttributes}>${escapeHtml(ui("persona_memory_import") || "Import")}</button>`;
    const actions = collection
      ? `<div data-persona-memory-actions hidden>
          <button class="button icon" type="button" popovertarget="persona-memory-menu" aria-label="${escapeHtml(ui("persona_memory_actions"))}">${navigationIcon("ellipsis")}</button>
          <div class="action-menu" id="persona-memory-menu" popover aria-label="${escapeHtml(ui("persona_memory_actions"))}">
            <button class="button" type="button" data-memory-refresh>${navigationIcon("refresh-cw")}${escapeHtml(ui("refresh_memories"))}</button>
            ${transfers}
          </div>
          ${add}
        </div>`
      : `<div class="actions">${refreshButton("memory", ui("refresh_memories"))}${transfers}${add}</div>`;

    return `
      ${collection ? '<div class="split">' : ""}
      <section class="${collection ? "card" : "panel"}" data-memory-card>
        <header class="${collection ? "card-head" : "panel-header"}">
          ${
            collection
              ? `<h3>${escapeHtml(ui(personal ? "persona_personal_memory" : "persona_server_memory"))}<small data-persona-memory-list-count></small></h3>
              <label class="field"><span class="field-label sr-only">${escapeHtml(ui("persona_memories_search"))}</span><input type="search" data-persona-memory-search placeholder="${escapeHtml(ui("persona_memories_search"))}"></label>`
              : `<div class="heading"><p class="eyebrow">${personal ? "Personal" : "Shared server context"}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div>`
          }
          ${actions}
          <input id="memory-import-file" type="file" accept="application/json,.json" hidden>
        </header>
      <div class="stack">
      ${collection ? `<p class="hint">${escapeHtml(copy)}</p>` : ""}
      ${
        serverWritesDisabled || personalCreationDisabled
          ? `<div class="notice info"><strong>${personalCreationDisabled ? "New personal memories are disabled by your privacy setting." : "Member teaching is disabled for this server."}</strong><p>Existing entries remain visible according to your access.</p></div>`
          : `<form id="memory-compose-form"${collection ? ' class="compose"' : ""} hidden>
              <div class="stack">
                <label class="field">${fieldLabel("New memory", "Write one concise fact. Its visibility follows the memory scope shown above.")}<textarea name="content" rows="3" required placeholder="A concise fact Tomori should remember"></textarea></label>
                ${personal ? "" : '<div class="subsection" data-memory-channel-scope hidden></div>'}
                ${personal ? `<label class="field">${fieldLabel("Tags", ui("memory_personal_tags_hint"))}<input name="tags" placeholder="preference, character"></label>` : ""}
              </div>
              <div class="actions"><button class="button small" type="button" data-memory-cancel>${escapeHtml(ui("persona_cancel"))}</button><button class="button small primary" type="submit" data-edit-action data-fx="spark" hidden>${escapeHtml(ui("save"))}</button></div>
            </form>`
      }
      <section id="memory-list" class="${collection ? "rows" : "stack"}">${loadingBar(ui("memory_loading"))}</section></div></section>
      ${
        collection
          ? `<aside class="card" data-persona-memory-summary hidden>
        ${personaCardHead(ui("persona_memory_summary"))}
        <div class="stack">
          <div class="stats"><div><strong data-persona-memory-total></strong><small>${escapeHtml(ui(personal ? "persona_personal_memory" : "persona_server_memory"))}</small></div><div><strong>#${persona.lineageId}</strong><small>${escapeHtml(ui("persona_main_lineage"))}</small></div></div>
          <div class="field" data-persona-memory-capacity hidden>
            <span class="field-label">${escapeHtml(ui("persona_memory_capacity"))}<small data-persona-memory-usage></small></span>
            <div class="progress-track" role="progressbar" aria-label="${escapeHtml(ui("persona_memory_capacity"))}" aria-valuemin="0"><div class="progress-fill"></div></div>
          </div>
        </div>
      </aside></div>`
          : ""
      }`;
  }

  function setMemoryComposer(form, open) {
    const trigger = document.querySelector("[data-memory-add]");
    form.hidden = !open;
    trigger.hidden = open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      completeFormSave(form);
      form.elements.content.focus();
    } else {
      form.reset();
      form.querySelector("[data-memory-channel-picker]")?.setAttribute("hidden", "");
      trigger.focus({ preventScroll: true });
    }
  }

  function renderGlobalMemories(workspace) {
    state.memoryKind = "personal";
    state.lineageId = 0;
    workspace.innerHTML = `
      ${pageHeader("Personal", "Global memory", ui("global_memory_hint"))}
      <div class="stack">
        <section class="panel stack" id="personal-stm">
          ${dashboardPanelHeading("personal_stm", "personal_stm_hint", refreshButton("personal-stm", ui("refresh_memories")))}
          <div class="row">
            <div data-personal-stm-status role="status"></div>
            <button class="button danger" type="button" data-personal-stm-clear>${escapeHtml(ui("personal_stm_clear"))}</button>
          </div>
        </section>
        ${renderMemoryCollection({ personal: true, global: true })}
      </div>`;
    void loadPersonalStm(workspace.querySelector("#personal-stm"));
    loadMemories();
  }

  const personalStmPath = "/profile/short-term-memory";

  async function loadPersonalStm(panel) {
    if (panel.hasAttribute("aria-busy")) return;
    const status = panel.querySelector("[data-personal-stm-status]");
    const clear = panel.querySelector("[data-personal-stm-clear]");
    panel.setAttribute("aria-busy", "true");
    clear.disabled = true;
    status.innerHTML = loadingBar(ui("memory_loading"));
    try {
      const { count } = await api(personalStmPath);
      status.textContent = ui("personal_stm_count").replace("{count}", count.toLocaleString());
    } catch {
      status.textContent = ui("personal_stm_load_failed");
    } finally {
      clear.disabled = false;
      panel.removeAttribute("aria-busy");
    }
  }

  async function clearPersonalStm(panel) {
    if (!(await confirmAction(ui("personal_stm_confirm_title"), ui("personal_stm_confirm_detail")))) return;
    if (!panel.isConnected || panel.hasAttribute("aria-busy")) return;
    try {
      await withBusyForm(panel, () => api(personalStmPath, { method: "DELETE" }));
      panel.querySelector("[data-personal-stm-status]").textContent = ui("personal_stm_clear_requested");
    } catch (error) {
      toast(error.message, "error");
    }
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
    list.innerHTML = loadingBar(ui("memory_loading"));
    try {
      const path = `/guilds/${guildId}/memories/${memoryKind}?lineageId=${lineageId}`;
      const data = await api(path);
      if (!isCurrent()) return;
      state.memoryData = data;
      if (memoryKind === "server") {
        const panel = list.closest("[data-memory-card]");
        const form = panel.querySelector("#memory-compose-form");
        if (form?.hidden) renderMemoryChannelScope(form, data);
        const add = document.querySelector("[data-memory-add]");
        if (add) add.disabled = false;
      }
      renderMemoryList(true);
      const summary = list.closest(".split")?.querySelector("[data-persona-memory-summary]");
      if (summary) updatePersonaMemorySummary(summary, data, memoryKind);
    } catch (error) {
      if (!isCurrent()) return;
      list.innerHTML = `<div class="empty"><strong>Memories could not be loaded.</strong><span>${escapeHtml(error.message)}</span></div>`;
    }
  }

  function updatePersonaMemorySummary(summary, data, kind) {
    const count = data.memories.length;
    summary.closest(".split").querySelector("[data-persona-memory-list-count]").textContent = String(count);
    const limit =
      kind === "personal"
        ? data.limits.maxPersonalMemories
        : data.mode === "all"
          ? data.limits.maxServerMemories
          : null;
    const total = summary.querySelector("[data-persona-memory-total]");
    total.textContent = String(count);
    if (summary.hidden) window.TomoriFX.count(total);
    const capacity = summary.querySelector("[data-persona-memory-capacity]");
    capacity.hidden = !limit;
    if (limit) {
      const progress = capacity.querySelector(".progress-track");
      progress.setAttribute("aria-valuemax", String(limit));
      progress.setAttribute("aria-valuenow", String(Math.min(count, limit)));
      progress.firstElementChild.style.setProperty("--progress", `${Math.min((count / limit) * 100, 100)}%`);
      capacity.querySelector("[data-persona-memory-usage]").textContent =
        `${formatStatNumber(count)} / ${formatStatNumber(limit)}`;
    }
    summary.hidden = false;
  }

  function renderMemoryList(animate = false) {
    const list = document.querySelector("#memory-list");
    if (!list) return;
    const collection = state.view === "personas";
    const memories = state.memoryData?.memories || [];
    const query = document.querySelector("[data-persona-memory-search]")?.value.trim().toLowerCase();
    const rows = query
      ? memories.filter((memory) => [memory.content, ...(memory.tags || [])].join(" ").toLowerCase().includes(query))
      : memories;
    if (!rows.length) {
      list.innerHTML = collection
        ? `<div class="empty-note"><span class="mark" aria-hidden="true">✦</span><p>${escapeHtml(ui(query ? "persona_memories_no_matches" : "persona_memory_empty"))}</p></div>`
        : '<div class="empty"><strong>No memories in this scope.</strong><span>The first one you add will appear here.</span></div>';
      return;
    }
    const serverWritesDisabled =
      state.memoryKind === "server" &&
      !state.overview.canManage &&
      !state.overview.memoryPolicy.serverMemoryTeachingEnabled;
    list.innerHTML = rows
      .map(
        (memory) => `<article class="${collection ? "item" : "memory-row"}">
          <div${collection ? "" : ' class="stack"'}>
            ${collection ? "" : `<span class="badge">#${memory.id}</span>`}
            <p>${escapeHtml(memory.content)}</p>
            <div class="${collection ? "item-meta" : "row hint"}">
              ${state.memoryKind === "personal" ? (memory.tags || []).map((tag) => `<span${collection ? ' class="chip"' : ""}>${escapeHtml(tag)}</span>`).join("") : ""}
              ${state.memoryKind === "server" && !state.overview.guild?.isDirectMessage ? `<span>${escapeHtml(memoryChannelSummary(memory, state.memoryData))}</span>` : ""}
              ${memory.updatedAt || memory.createdAt ? `<time>${escapeHtml(formatDate(memory.updatedAt || memory.createdAt))}</time>` : ""}
              ${state.memoryKind === "server" && state.overview.canManage && memory.taughtByUserId ? `<small>Teacher #${memory.taughtByUserId}</small>` : ""}
            </div>
          </div>
          ${
            memory.editable === false || serverWritesDisabled
              ? ""
              : collection
                ? `<div class="item-actions">
                    <button class="button small icon" data-memory-edit="${memory.id}" type="button" aria-label="${escapeHtml(ui("persona_edit"))}">${navigationIcon("pencil")}</button>
                    <button class="button small icon danger" data-memory-delete="${memory.id}" type="button" aria-label="${escapeHtml(ui("persona_delete_entry"))}">${navigationIcon("trash-2")}</button>
                  </div>`
                : `<div class="actions">
                    <button class="button" data-memory-edit="${memory.id}" type="button">Edit</button>
                    <button class="button danger" data-memory-delete="${memory.id}" type="button">Delete</button>
                </div>`
          }
        </article>`,
      )
      .join("");
    if (collection && animate && !query) window.TomoriFX.stagger(list);
  }

  function memoryChannelSummary(memory, data) {
    const names = (memory.channelDiscIds || []).flatMap((id) => {
      const channel = data.channels?.find((entry) => entry.id === id);
      return channel ? [`#${channel.name}`] : [];
    });
    if (memory.unavailableChannelCount) {
      names.push(ui("memory_channels_unavailable_count").replace("{count}", memory.unavailableChannelCount));
    }
    const scope = names.length ? `${ui("memory_channels")}: ${names.join(", ")}` : ui("memory_channels_all");
    return memory.channelScopePending ? `${scope}. ${ui("memory_channels_pending")}` : scope;
  }

  function renderMemoryChannelScope(form, data, memory) {
    const host = form.querySelector("[data-memory-channel-scope]");
    if (!host) return;
    host.replaceChildren();
    host.hidden = true;
    form._memoryChannels = memory?.channelDiscIds ?? [];
    if (!data || state.overview.guild?.isDirectMessage) return;
    const saved = form._memoryChannels;
    const notices = [
      !data.channelMemoryEnabled ? ui("memory_channels_inactive") : "",
      memory?.channelScopePending ? ui("memory_channels_pending") : "",
      memory?.unavailableChannelCount
        ? ui("memory_channels_unavailable").replace("{count}", memory.unavailableChannelCount)
        : "",
    ];
    if (!memory?.unavailableChannelCount && data.channels?.length) {
      host.innerHTML = `<label class="toggle">${fieldLabel(ui("memory_channels_limit"), ui("memory_channels_hint"))}
        <input type="checkbox" name="restrictMemoryChannels" role="switch" aria-controls="${form.id}-channels" data-memory-channel-limit${saved.length ? " checked" : ""}></label>
        <div id="${form.id}-channels" data-memory-channel-picker${saved.length ? "" : " hidden"}>${renderChannelSelector("channelDiscIds", saved, false, data.channels)}</div>`;
    }
    for (const notice of notices.filter(Boolean)) {
      const message = document.createElement("p");
      message.className = "hint";
      message.textContent = notice;
      host.append(message);
    }
    host.hidden = !host.hasChildNodes();
    enhanceDashboard(host);
  }

  function collectMemoryChannelPatch(form) {
    const limit = form.querySelector("[data-memory-channel-limit]");
    if (!limit) return {};
    const saved = form._memoryChannels;
    const ids = limit.checked
      ? [...form.querySelectorAll('[name="channelDiscIds"]:checked')].map((input) => input.value)
      : [];
    if (limit.checked && !ids.length) throw new Error(ui("memory_channels_required"));
    return ids.length === saved.length && ids.every((id) => saved.includes(id)) ? {} : { channelDiscIds: ids };
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
    const browser = target.querySelector("[data-lorebook-browser]");
    const bookId = lineageId === 0 ? state.lorebookBookId : null;
    const scroller = browser ? target.closest(".app-main") : null;
    if (!scroller) target.innerHTML = loadingBar(ui("lorebook_loading"));
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
      const scrollTop = scroller?.scrollTop;
      const restoreEditor = browser?.dataset.view === "detail";
      target.innerHTML = renderLorebooks(lineageId, data);
      initDraftForms(target);
      window.TomoriControls?.enhance(target);
      window.TomoriFX?.enhance(target);
      const selected = lorebookSelections.get(lorebookSelectionKey(lineageId));
      const search = target.querySelector("[data-lorebook-search-input]");
      if (selected?.query && search) {
        search.value = selected.query;
        filterLorebookEntries(search);
      }
      const deepLink = lineageId === 0 && pendingSearchDestination?.lorebookEntryField;
      const selectedEntry = data.entries.find((entry) => entry.entry_id === selected?.entryId);
      if (deepLink && (selectedEntry || data.entries[0])) {
        openLorebookEditor((selectedEntry || data.entries[0]).entry_id, false);
      } else if (restoreEditor && selectedEntry) {
        openLorebookEditor(selectedEntry.entry_id, false);
      }
      if (scroller) scroller.scrollTop = scrollTop;
      if (lineageId === 0) {
        const totals = document.querySelector("[data-lorebook-totals]");
        if (totals) {
          const entries = data.books.reduce((sum, book) => sum + book.entryCount, 0);
          const count = new Intl.NumberFormat();
          totals.innerHTML = `<span class="chip">${navigationIcon("book-open")}${escapeHtml(ui(data.books.length === 1 ? "lorebook_book_count_one" : "lorebook_book_count").replace("{count}", count.format(data.books.length)))}</span>
            <span class="chip">${escapeHtml(ui(entries === 1 ? "lorebook_collection_entry_count_one" : "lorebook_collection_entry_count").replace("{count}", count.format(entries)))}</span>`;
          totals.hidden = false;
        }
        if (deepLink) focusSearchDestination();
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

  function lorebookChannels(ids, editable, headingInCard = false) {
    const channels = state.overview.channels || [];
    const missing = ids.filter((id) => !channels.some((channel) => channel.id === id));
    if (!editable) {
      const names = ids.map((id) => channels.find((channel) => channel.id === id)?.name || id);
      return `<p>${escapeHtml(ui("lorebook_channels"))}: ${escapeHtml(names.join(", ") || ui("lorebook_channels_hint"))}</p>`;
    }
    const setting = `<a href="/settings?guild=${encodeURIComponent(state.guildId)}#channel-scoped-memory" data-lorebook-channel-settings>${escapeHtml(ui("lorebook_channel_settings_link"))}</a>`;
    const dependency = escapeHtml(ui("lorebook_channels_dependency")).replace("{setting}", () => setting);
    return `<fieldset class="stack"><legend${headingInCard ? ' class="sr-only"' : ""}>${escapeHtml(ui("lorebook_channels"))}</legend>${renderChannelSelector("channelDiscIds", ids)}<p class="hint">${escapeHtml(ui("lorebook_channels_hint"))} ${dependency}</p>${missing.length ? `<p class="hint">${escapeHtml(ui("lorebook_missing_channels"))}</p>` : ""}${missing.map((id) => `<input name="channelDiscIds" type="checkbox" value="${escapeHtml(id)}" data-missing-channel checked hidden>`).join("")}</fieldset>`;
  }

  function lorebookEntry(entry, book = null) {
    const title = escapeHtml(entry.title);
    const content = escapeHtml(entry.content);
    const keywords = [...entry.keys, ...entry.secondary_keys];
    const searchTerms = [entry.title, entry.content, ...keywords];
    const activation = ui(
      !entry.enabled
        ? "lorebook_disabled"
        : entry.trigger_chance === 0
          ? "lorebook_never"
          : entry.constant
            ? "lorebook_constant"
            : "lorebook_keyword_match",
    );
    const channelIds = (book ? book.channel_disc_ids : entry.channel_disc_ids) || [];
    const channelNames = (state.overview.channels || [])
      .filter((channel) => channelIds.includes(channel.id))
      .map((channel) => channel.name);
    const scope = channelIds.length
      ? ui(channelIds.length === 1 ? "lorebook_channel_one" : "lorebook_channel_count").replace(
          "{count}",
          String(channelIds.length),
        )
      : ui("memory_channels_all");
    const search = escapeHtml([...searchTerms, activation, scope, ...channelNames].join(" ").toLowerCase());
    const action = ui(state.overview.canManage ? "lorebook_edit" : "lorebook_view_entry");
    return `<article class="item" data-lorebook-search="${search}">
      <div class="stack" data-lorebook-preview>
        <strong dir="auto">${title}</strong><p class="clamp" dir="auto">${content}</p>
        <div class="item-meta"><span class="chip ${entry.enabled && entry.trigger_chance !== 0 ? "tone" : "off"}">${escapeHtml(activation)}</span><span class="chip">${escapeHtml(scope)}</span>${entry.keys.map((key) => `<span class="chip">${escapeHtml(key)}</span>`).join("")}</div>
      </div>
      <button class="button small" type="button" data-lorebook-edit-entry="${entry.entry_id}" aria-label="${escapeHtml(ui(state.overview.canManage ? "lorebook_edit_named" : "lorebook_view_named").replace("{title}", () => entry.title))}">${state.overview.canManage ? navigationIcon("pencil") : ""}${escapeHtml(action)}</button>
    </article>`;
  }

  function filterLorebookEntries(search) {
    const list = search.closest("[data-lorebook-browser]");
    const query = search.value.trim().toLowerCase();
    const entries = [...list.querySelectorAll("[data-lorebook-search]")];
    for (const entry of entries) entry.hidden = !entry.dataset.lorebookSearch.includes(query);
    const shown = entries.filter((entry) => !entry.hidden).length;
    list.querySelector("[data-lorebook-no-results]").hidden = !query || shown > 0;
    list.querySelector("[data-lorebook-empty]").hidden = Boolean(query) || entries.length > 0;
    list.querySelector("[data-lorebook-results]").textContent = ui("lorebook_entry_count").replace(
      "{count}",
      String(shown),
    );
  }

  async function confirmDraftDiscard(editor) {
    if (!editor) return true;
    const changed = [...editor.querySelectorAll("form[data-draft-key]")].filter((form) =>
      drafts.has(form.dataset.draftKey),
    );
    if (!changed.length) return true;
    if (!(await confirmAction(ui("discard_title"), ui("discard_detail"), ui("discard"))) || !editor.isConnected)
      return false;
    for (const form of changed) drafts.delete(form.dataset.draftKey);
    return true;
  }

  async function confirmDashboardSectionChange() {
    if (state.view === "personas") return confirmPersonaSectionChange(document.querySelector("[data-persona-content]"));
    if (state.view === "lorebooks") return confirmDraftDiscard(document.querySelector("#lorebook-workspace"));
    if (state.view === "server-providers")
      return confirmDraftDiscard(document.querySelector("#server-providers-stage"));
    return true;
  }

  async function confirmPersonaSectionChange(content) {
    if (!content) return true;
    if (state.personaPanel === "lorebook") return confirmDraftDiscard(content);
    const entryForms = [...content.querySelectorAll("[data-persona-entry-form]")];
    const composer = content.querySelector("#memory-compose-form:not([hidden])");
    if (
      !content.querySelector("form[data-changed]") &&
      ![...content.querySelectorAll("[data-persona-chip-add]")].some((input) => input.value.trim()) &&
      !entryForms.length &&
      !composer?.elements.content.value.trim() &&
      !composer?.elements.tags?.value.trim()
    )
      return true;
    if (!(await confirmAction(ui("discard_title"), ui("discard_detail"), ui("discard"))) || !content.isConnected)
      return false;
    for (const form of content.querySelectorAll("form[data-draft-key]")) drafts.delete(form.dataset.draftKey);
    for (const form of entryForms) {
      const { personaId, entryKind, entryIndex } = form.closest("[data-entry-kind]").dataset;
      personaEntryDrafts.delete(personaEntryKey(personaId, entryKind, entryIndex));
    }
    return true;
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

  function openLorebookEditor(entryId, navigate = true) {
    const entry = state.lorebookData?.entries.find((item) => item.entry_id === entryId);
    if (!entry) return;
    const lineageId = activeLorebookLineage();
    const prefix = `lorebook/${lineageId}/${lineageId === 0 ? state.lorebookBookId : 0}/${entry.entry_id}`;
    const canManage = state.overview.canManage;
    const book =
      lineageId === 0 ? state.lorebookData.books.find((item) => item.lorebook_id === state.lorebookBookId) : null;
    const name =
      book?.name ?? state.overview.personas?.find((persona) => persona.personaId === state.personaId)?.nickname;
    const actions = cardSaveActions(ui("lorebook_save"));
    const deleteButton = `<button class="button small danger hold-button" type="button" data-hold data-lorebook-delete-entry="${entryId}" data-confirm-title="${escapeHtml(ui("lorebook_delete_title").replace("{name}", () => entry.title))}" data-confirm-description="${escapeHtml(ui("lorebook_delete_entry_confirm"))}"><span>${escapeHtml(ui("control_hold_delete"))}</span></button>`;
    const selectionKey = lorebookSelectionKey(lineageId);
    const selection = lorebookSelections.get(selectionKey);
    const host = document.querySelector("#lorebook-editor-host");
    if (!host) return;
    const browser = host.closest("#lorebook-workspace").querySelector("[data-lorebook-browser]");
    const scroller = navigate ? host.closest(".app-main") : null;
    lorebookSelections.set(selectionKey, {
      ...selection,
      entryId,
      ...(scroller ? { listScroll: scroller.scrollTop } : {}),
    });
    const cardHead = (key) => `<header class="card-head"><h3>${escapeHtml(ui(key))}</h3></header>`;
    const contentFields = `<label class="field">${fieldLabel(ui("lorebook_title"), ui("lorebook_title_hint"))}<input name="title" maxlength="128" value="${escapeHtml(entry.title)}" required></label><label class="field">${fieldLabel(ui("lorebook_content"))}<textarea name="content" maxlength="4000" rows="9" required>${escapeHtml(entry.content)}</textarea></label>`;
    const enabled = `<label class="toggle"><span class="field-label">${escapeHtml(ui("lorebook_enabled"))}</span><input name="enabled" type="checkbox" role="switch"${entry.enabled ? " checked" : ""}></label>`;
    let body;
    if (!canManage) {
      body = `<label class="field">${fieldLabel(ui("lorebook_content"))}<textarea rows="9" readonly>${escapeHtml(entry.content)}</textarea></label><p class="hint">${escapeHtml(lorebookUsage(entry))}</p>${lineageId === 0 ? "" : lorebookChannels(entry.channel_disc_ids, false)}`;
    } else {
      const form = (kind, key, contents, attributes = "") =>
        `<form class="card" data-fx="track" data-lorebook-form="${kind}" data-entry-id="${entryId}" data-settings-key="${prefix}/${key}"${attributes}>${contents}${actions}</form>`;
      const entryHead = `<header class="card-head"><div><h3 id="lorebook-editor-title" tabindex="-1" dir="auto">${escapeHtml(entry.title)}</h3><p class="hint" dir="auto">${escapeHtml(name)}</p></div><div class="actions">${deleteButton}</div></header>`;
      const content = form(
        "content",
        "content",
        `${entryHead}<div class="stack">${contentFields}${enabled}</div>`,
        ' aria-labelledby="lorebook-editor-title"',
      );
      const matching = `<p class="hint">${escapeHtml(ui("lorebook_matching_hint"))}</p>`;
      const constant = `<label class="toggle"><span class="field-label">${escapeHtml(ui("lorebook_constant"))}<small>${escapeHtml(ui(entry.keys.length ? "lorebook_constant_hint" : "lorebook_constant_no_keys"))}</small></span><input name="constant" type="checkbox" role="switch"${entry.constant ? " checked" : ""}${entry.keys.length ? "" : " disabled"}></label>`;
      const keys = `<label class="field">${fieldLabel(ui("lorebook_keys"), ui("lorebook_triggers_keys_hint"))}<textarea name="keys" rows="4">${escapeHtml(entry.keys.join("\n"))}</textarea></label><p class="hint">${escapeHtml(ui("lorebook_regex_hint"))}</p>`;
      const rules = `<p class="hint">${escapeHtml(ui("lorebook_rules_hint"))}</p>${entry.constant ? `<p class="notice info">${escapeHtml(ui("lorebook_rules_always"))}</p>` : ""}`;
      const activation = `
          <label class="field">${fieldLabel(ui("lorebook_secondary"), ui("lorebook_secondary_hint"))}<textarea name="secondaryKeys" rows="3">${escapeHtml(entry.secondary_keys.join("\n"))}</textarea></label>
          <label class="field">${fieldLabel(ui("lorebook_logic"), ui("lorebook_logic_hint"))}<select name="selectiveLogic">${["lorebook_logic_any", "lorebook_logic_not_all", "lorebook_logic_not_any", "lorebook_logic_all"].map((key, index) => `<option value="${index}"${entry.selective_logic === index ? " selected" : ""}>${escapeHtml(ui(key))}</option>`).join("")}</select></label>
          <div class="grid"><label class="field">${fieldLabel(ui("lorebook_scan"), ui("lorebook_scan_hint"))}<input type="number" name="scanDepth" min="1" max="100" value="${entry.scan_depth}" data-scrub required></label><label class="field">${fieldLabel(ui("lorebook_chance"), ui("lorebook_chance_hint"))}<input type="number" name="triggerChance" min="0" max="100" value="${entry.trigger_chance}" data-scrub required></label></div>
          <label class="field">${fieldLabel(ui("lorebook_order"), ui("lorebook_order_hint"))}<input type="number" name="insertionOrder" min="-2147483648" max="2147483647" value="${entry.insertion_order}" data-scrub required></label>
          <p class="hint">${escapeHtml(ui("lorebook_placement"))}: ${escapeHtml(ui(entry.placement === 0 ? "lorebook_before" : "lorebook_after"))}. ${escapeHtml(ui("lorebook_placement_hint"))}</p>`;
      const originalKeys = ` data-original-keys="${escapeHtml(JSON.stringify(entry.keys))}"`;
      const triggers = form(
        "triggers",
        "triggers",
        `${cardHead("lorebook_triggers")}<div class="stack">${matching}${keys}${constant}</div>`,
        originalKeys,
      );
      const rulesForm = form(
        "activation",
        "activation",
        `${cardHead("lorebook_advanced")}<div class="stack">${rules}${activation}</div>`,
        ` data-original-keys="${escapeHtml(JSON.stringify(entry.secondary_keys))}"`,
      );
      const channelForm = book
        ? ""
        : form(
            "entry-channels",
            "channels",
            `<div class="stack">${lorebookChannels(entry.channel_disc_ids, true, true)}${entry.legacy_channel_tags?.length ? `<p class="hint">${escapeHtml(ui("lorebook_pending_channels"))}: ${escapeHtml(entry.legacy_channel_tags.join(", "))}</p>` : ""}</div>`,
            ` data-original-channels="${escapeHtml(JSON.stringify(entry.channel_disc_ids))}"`,
          );
      body = `<div class="col">${content}${triggers}${rulesForm}</div>${channelForm}`;
    }
    const channelNames = book?.channel_disc_ids?.map(
      (id) => state.overview.channels?.find((channel) => channel.id === id)?.name || id,
    );
    const bookChannels = book
      ? `<aside class="card">${cardHead("lorebook_channels")}<div class="stack">
      <p class="hint">${escapeHtml(ui("lorebook_book_channel_scope"))}</p>
      ${channelNames?.length ? `<div class="chips">${channelNames.map((channel) => `<span class="chip" dir="auto">${escapeHtml(channel)}</span>`).join("")}</div>` : `<p>${escapeHtml(ui("memory_channels_all"))}</p>`}
      ${canManage ? `<div class="actions"><button class="button small" type="button" data-lorebook-open="lorebook-settings-dialog" aria-haspopup="dialog">${escapeHtml(ui("lorebook_settings"))}</button></div>` : ""}
    </div></aside>`
      : "";
    const details = canManage
      ? body
      : `<section class="card"><header class="card-head"><h3 id="lorebook-editor-title" tabindex="-1" dir="auto">${escapeHtml(entry.title)}</h3></header><div class="stack">${body}</div></section>`;
    browser.dataset.view = "detail";
    browser.hidden = true;
    host.hidden = false;
    window.TomoriFX.swap(
      host,
      `<div class="toolbar"><button class="button small" type="button" data-lorebook-back>${navigationIcon("arrow-left")}${escapeHtml(ui("lorebook_back_entries"))}</button></div>
      ${canManage || book ? `<div class="split">${details}${bookChannels}</div>` : details}`,
    );
    initDraftForms(host);
    window.TomoriControls?.enhance(host);
    window.TomoriFX?.enhance(host);
    if (navigate) host.querySelector("#lorebook-editor-title").focus();
  }

  function lorebookDialog(id, title, form) {
    return `<dialog id="${id}"${id === "lorebook-entry-dialog" ? ' class="wide"' : ""} aria-labelledby="${id}-title"><header class="panel-header"><div class="heading"><h2 id="${id}-title">${escapeHtml(title)}</h2></div><button class="button icon" type="button" data-dialog-close="${id}" aria-label="${escapeHtml(ui("lorebook_close"))}" data-tooltip="${escapeHtml(ui("lorebook_close"))}">${navigationIcon("x")}</button></header><div class="stack">${form}</div></dialog>`;
  }

  function lorebookDialogActions(id, label) {
    return `<div class="actions" data-form-actions><button class="button" type="button" data-dialog-close="${id}">${escapeHtml(ui("lorebook_cancel"))}</button><button class="button primary" type="submit">${escapeHtml(label)}</button></div>`;
  }

  function lorebookDialogFocusTarget(id) {
    if (id === "lorebook-create-dialog" || id === "lorebook-import-new-dialog")
      return '[popovertarget="lorebook-collection-actions"]';
    if (id === "lorebook-import-dialog" || id === "lorebook-settings-dialog")
      return `[data-lorebook-open="${id}"]:not([popover] *):not([hidden] *), [popovertarget="lorebook-book-actions"]:not([hidden] *)`;
    return `[data-lorebook-open="${id}"]`;
  }

  function restoreLorebookDialogFocus(dialog) {
    document.querySelector(lorebookDialogFocusTarget(dialog.id))?.focus({ preventScroll: true });
  }

  function lorebookChoices(books) {
    return books.length
      ? books
          .map(
            (item) =>
              `<button type="button" class="browser-link" data-lorebook-select="${item.lorebook_id}" aria-pressed="${item.lorebook_id === state.lorebookBookId}">${navigationIcon("book-open")}<span dir="auto">${escapeHtml(item.name)}${item.enabled ? "" : ` (${escapeHtml(ui("lorebook_disabled"))})`}</span><small>${escapeHtml(String(item.entryCount))}</small></button>`,
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
      : state.overview.personas.find((item) => item.personaId === state.personaId)?.nickname ||
        state.overview.personas.find((item) => item.lineageId === lineageId)?.nickname;
    const scopeKey = `lorebook/${lineageId}/${book?.lorebook_id || 0}`;
    const available = !serverwide || Boolean(book);
    const add = canManage
      ? `<button class="button small primary" type="button" data-lorebook-open="lorebook-entry-dialog" aria-haspopup="dialog"${serverwide ? ' data-fx="spark"' : ""}>${navigationIcon("plus")}${escapeHtml(ui("lorebook_new_entry"))}</button>`
      : "";
    const count = escapeHtml(ui("lorebook_entry_count").replace("{count}", String(data.entries.length)));
    const searchLabel = escapeHtml(ui("lorebook_search"));
    const collectionActions =
      serverwide && canManage
        ? `<button class="button small icon" type="button" popovertarget="lorebook-collection-actions" aria-label="${escapeHtml(ui("lorebook_collection_actions"))}" aria-expanded="false">${navigationIcon("ellipsis")}</button><div id="lorebook-collection-actions" class="action-menu" popover aria-label="${escapeHtml(ui("lorebook_collection_actions"))}"><button class="button" type="button" data-lorebook-open="lorebook-create-dialog" aria-haspopup="dialog">${escapeHtml(ui("lorebook_new_book"))}</button><button class="button" type="button" data-lorebook-open="lorebook-import-new-dialog" aria-haspopup="dialog">${escapeHtml(ui("lorebook_import_new"))}</button></div>`
        : "";
    const bookActions =
      serverwide && book && canManage
        ? `<button class="button small icon" type="button" popovertarget="lorebook-book-actions" aria-label="${escapeHtml(ui("lorebook_book_actions"))}" aria-expanded="false">${navigationIcon("ellipsis")}</button><div id="lorebook-book-actions" class="action-menu" popover aria-label="${escapeHtml(ui("lorebook_book_actions"))}"><button class="button" type="button" data-lorebook-open="lorebook-import-dialog" aria-haspopup="dialog">${escapeHtml(ui("lorebook_transfer"))}</button><button class="button" type="button" data-lorebook-rename data-action-menu-preserve-focus>${escapeHtml(ui("lorebook_edit_book"))}</button><button class="button" type="button" data-lorebook-open="lorebook-settings-dialog" aria-haspopup="dialog">${escapeHtml(ui("lorebook_settings"))}</button><hr><button class="button danger" type="button" data-lorebook-delete-book>${escapeHtml(ui("lorebook_delete_book"))}</button></div>`
        : `<button class="button small" type="button" data-lorebook-open="lorebook-import-dialog" aria-haspopup="dialog">${escapeHtml(ui("lorebook_transfer"))}</button>`;
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
    return `<div class="stack" data-lorebook-library><div class="browser" data-layout="list" data-view="list" data-lorebook-browser>
      <section class="card browser-nav" aria-label="${escapeHtml(ui("lorebooks"))}"><header class="card-head"><h3>${escapeHtml(ui("lorebooks"))}</h3>${serverwide && collectionActions ? `<div class="actions">${collectionActions}</div>` : ""}</header>
        <div class="rows">${serverwide ? lorebookChoices(data.books) : `<div class="browser-link">${navigationIcon("book-open")}<strong dir="auto">${escapeHtml(name)}</strong><small>${data.entries.length}</small></div>`}</div>
      </section>
      <section class="card" aria-label="${escapeHtml(name || ui("lorebooks"))}">
        ${
          available
            ? `<header class="card-head"${book ? " data-lorebook-book-summary" : ""}><h3><span dir="auto">${escapeHtml(book ? name : ui("lorebook_persona"))}</span><small role="status" data-lorebook-results>${count}</small></h3><label class="field"><span class="field-label sr-only">${searchLabel}</span><input type="search" placeholder="${searchLabel}" data-lorebook-search-input></label><div class="actions">${bookActions}${add}</div></header>
          <div class="stack">
          ${book && canManage ? `<form class="compose" data-lorebook-form="book-rename" data-settings-key="${scopeKey}/rename" novalidate hidden><label class="field">${fieldLabel(ui("lorebook_book_name"))}<input name="name" maxlength="128" value="${escapeHtml(book.name)}" required aria-describedby="lorebook-name-error"><span class="error" id="lorebook-name-error" hidden></span></label><div class="actions" data-form-actions><button class="button small" type="button" data-lorebook-rename-cancel>${escapeHtml(ui("lorebook_cancel"))}</button><button class="button small primary" type="submit">${escapeHtml(ui("lorebook_save_name"))}</button></div></form>` : ""}
          ${book && !book.enabled ? `<p class="notice warning">${escapeHtml(ui("lorebook_collection_paused"))}</p>` : ""}
          ${state.lorebookImportReceipt?.key === scopeKey ? `<div class="notice success stack" role="status"><strong>${escapeHtml(ui("lorebook_import_receipt"))}</strong><span>${escapeHtml(state.lorebookImportReceipt.text)}</span></div>` : ""}
          <div class="rows" data-fx="stagger">${data.entries.map((entry) => lorebookEntry(entry, book)).join("")}</div>
          <div class="empty-note" data-lorebook-empty${data.entries.length ? " hidden" : ""}><strong>${escapeHtml(ui("lorebook_empty"))}</strong>${serverwide || canManage ? `<p class="hint">${escapeHtml(ui("lorebook_empty_hint"))}</p>` : ""}</div>
          <div class="empty-note" data-lorebook-no-results hidden><strong>${escapeHtml(ui("lorebook_no_results"))}</strong><p class="hint">${escapeHtml(ui("lorebook_search_hint"))}</p></div></div>`
            : `<div class="empty-note"><span class="mark" aria-hidden="true">✦</span><strong>${escapeHtml(ui("lorebook_no_books"))}</strong><p class="hint">${escapeHtml(ui("lorebook_no_books_hint"))}</p>${canManage ? `<button class="button small primary" type="button" data-lorebook-open="lorebook-create-dialog" aria-haspopup="dialog">${escapeHtml(ui("lorebook_new_book"))}</button>` : ""}</div>`
        }
      </section>
    </div>
    <section class="stage" id="lorebook-editor-host" aria-labelledby="lorebook-editor-title" hidden></section>
    ${canManage && serverwide ? lorebookDialog("lorebook-create-dialog", ui("lorebook_new_book"), `<p class="hint">${escapeHtml(ui("lorebook_create_hint"))}</p><form class="stack" data-lorebook-form="book-create" data-settings-key="lorebook/books/new"><label class="field">${fieldLabel(ui("lorebook_book_name"))}<input name="name" maxlength="128" required autofocus></label>${lorebookDialogActions("lorebook-create-dialog", ui("lorebook_new_book"))}</form>`) + lorebookDialog("lorebook-import-new-dialog", ui("lorebook_import_new"), `<form class="stack" data-lorebook-import-form data-lorebook-import-new><label class="field">${fieldLabel(ui("lorebook_book_name"))}<input name="name" maxlength="128" required autofocus></label><label class="field">${fieldLabel(ui("lorebook_import"))}<input name="file" type="file" accept=".json,application/json" required></label>${lorebookDialogActions("lorebook-import-new-dialog", ui("lorebook_import"))}</form>`) : ""}
    ${
      book && canManage
        ? lorebookDialog(
            "lorebook-settings-dialog",
            ui("lorebook_settings_title").replace("{name}", () => book.name),
            `<p class="hint">${escapeHtml(ui("lorebook_settings_hint"))}</p>
      <label class="toggle"><span class="field-label">${escapeHtml(ui("lorebook_enabled"))}<small>${escapeHtml(ui("lorebook_collection_enabled_hint"))}</small></span><input type="checkbox" role="switch" data-lorebook-book-enabled${book.enabled ? " checked" : ""}></label>
      <form class="stack" data-lorebook-form="book-channels" data-settings-key="${scopeKey}/channels" data-original-channels="${escapeHtml(JSON.stringify(book.channel_disc_ids || []))}">${lorebookChannels(book.channel_disc_ids || [], true)}<div class="actions" data-form-actions><button class="button primary" type="submit">${escapeHtml(ui("lorebook_save_channels"))}</button></div></form>
      `,
          )
        : ""
    }
    ${canManage && available ? lorebookDialog("lorebook-entry-dialog", ui("lorebook_new_entry"), `<div class="row">${navigationIcon("book-open")}<dl class="meta-stack"><dt>${escapeHtml(ui(serverwide ? "lorebook_selected" : "lorebook_persona"))}</dt><dd dir="auto">${escapeHtml(name)}</dd></dl></div><p class="hint">${escapeHtml(ui("lorebook_new_entry_hint"))}</p><form class="stack" data-lorebook-form="create" data-settings-key="${scopeKey}/new" data-original-channels="[]"><label class="field">${fieldLabel(ui("lorebook_title"), ui("lorebook_title_hint"))}<input name="title" maxlength="128" required autofocus></label><label class="field">${fieldLabel(ui("lorebook_content"), ui("lorebook_content_hint"))}<textarea name="content" maxlength="4000" rows="${serverwide ? 6 : 4}" required></textarea></label><label class="field">${fieldLabel(ui("lorebook_keys"), ui("lorebook_new_keys_hint"))}<textarea name="keys" rows="${serverwide ? 3 : 2}"></textarea></label>${serverwide ? "" : `<details><summary>${escapeHtml(ui("lorebook_channels"))}</summary>${lorebookChannels([], true)}</details>`}${lorebookDialogActions("lorebook-entry-dialog", ui("lorebook_new_entry"))}</form>`) : ""}
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
    let triggerFlags = null;
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
    } else if (kind === "triggers") {
      path = `/entries/${form.dataset.entryId}/keys`;
      const keys = lorebookKeys(form, "keys");
      payload = { ...scope, keys };
      const original = JSON.parse(form.dataset.originalKeys);
      if (keys.length === original.length && keys.every((key, index) => key === original[index])) {
        path = `/entries/${form.dataset.entryId}/flags`;
        payload = { ...scope, flags: { constant: form.elements.constant.checked } };
      } else if (keys.length && !form.elements.constant.disabled && form.elements.constant.checked)
        triggerFlags = { constant: true };
    } else if (kind === "entry-channels") {
      const channelDiscIds = await lorebookSelectedChannels(form);
      if (!channelDiscIds) return;
      path = `/entries/${form.dataset.entryId}/channels`;
      payload = { ...scope, channelDiscIds };
    } else if (kind === "create") {
      const channelDiscIds = lineageId === 0 ? [] : await lorebookSelectedChannels(form);
      if (!channelDiscIds) return;
      path = "/entries";
      method = "POST";
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
      if (kind === "content" || triggerFlags) {
        try {
          await api(`/guilds/${guildId}/lorebooks/entries/${form.dataset.entryId}/flags`, {
            method: "PATCH",
            body: JSON.stringify({ ...scope, flags: triggerFlags ?? { enabled } }),
          });
        } catch {
          throw new Error(ui(triggerFlags ? "lorebook_triggers_partial_save" : "lorebook_partial_save"));
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
    if (kind === "create" && result?.entryId) {
      const key = lorebookSelectionKey(lineageId);
      lorebookSelections.set(key, { ...lorebookSelections.get(key), entryId: result.entryId });
    }
    const dialog = form.closest("dialog");
    dialog?.close();
    completeFormSave(form);
    toast(ui("lorebook_saved"));
    await loadLorebooks(lineageId);
    if (dialog) {
      restoreLorebookDialogFocus(dialog);
    } else if (form.dataset.entryId) {
      document
        .querySelector(
          `[data-lorebook-form="${kind}"][data-entry-id="${form.dataset.entryId}"] .field input:not([type="hidden"]):not(:disabled), [data-lorebook-form="${kind}"][data-entry-id="${form.dataset.entryId}"] textarea`,
        )
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

  function cardSaveActions(label, leading = "", validate = true) {
    return `<div class="actions">${leading}<button class="button small" type="button" data-edit-action data-discard-draft hidden>${escapeHtml(ui("discard"))}</button><button class="button small primary" type="submit"${validate ? "" : " formnovalidate"} data-edit-action data-fx="spark" hidden>${escapeHtml(label)}</button></div>`;
  }

  function personaCardHead(title, hint = "", actions = "") {
    return `<header class="card-head"><div><h3>${escapeHtml(title)}</h3>${hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ""}</div>${actions}</header>`;
  }

  function renderPersonaHumanizer(persona) {
    const settings = state.overview.settings;
    const fields = settings?.catalog
      .find((section) => section.id === "chat")
      ?.fields.filter((field) => field.key.startsWith("humanizer_"));
    if (!fields?.length) return "";
    const override = persona.humanizerOverride;
    const values = override ?? settings.values.chat;
    return `<form class="card" data-fx="track" data-persona-id="${persona.personaId}" data-persona-section="humanizer">
      <header class="card-head"><div><h3>${escapeHtml(ui("persona_humanizer_title"))}</h3><p>${escapeHtml(ui("persona_humanizer_hint"))}</p></div></header>
      <div class="stack"><label class="field">${fieldLabel(ui("persona_humanizer_source"))}<select name="humanizerMode" data-persona-humanizer-mode>
        <option value="inherit"${override ? "" : " selected"}>${escapeHtml(ui("persona_humanizer_inherit"))}</option>
        <option value="custom"${override ? " selected" : ""}>${escapeHtml(ui("persona_humanizer_custom"))}</option>
      </select></label>
      <fieldset class="stack" data-persona-humanizer-fields${override ? "" : " hidden"}>${fields.map((field) => renderSettingField(field, values[field.key])).join("")}</fieldset></div>
      ${cardSaveActions(ui("persona_save"))}
    </form>`;
  }

  const namingHabitFields = [
    ["prefix", "prefixes", "persona_habits_prefix"],
    ["suffix", "suffixes", "persona_habits_suffix"],
    ["addressTerm", "addressTerms", "persona_habits_term", "persona_habits_term_hint"],
  ];

  function renderPersonaNamingHabits(persona) {
    const habits = state.overview.personaNamingHabits;
    if (!habits) return "";
    const values = habits.values[persona.personaId];
    return `<div data-persona-habits="${persona.personaId}">
      ${habits.styles
        .map(
          ({
            value: style,
          }) => `<form class="card" data-fx="track" data-persona-habit-form="${escapeHtml(style)}" data-settings-key="persona-habits/${persona.personaId}/${escapeHtml(style)}"${style === "neutral" ? "" : " hidden"}>
        ${personaCardHead(ui("persona_habits_title"), ui("persona_habits_hint"))}
        <div class="stack">
          <label class="field">${fieldLabel(ui("persona_habits_style"), ui("persona_habits_neutral_hint"))}<select data-persona-habit-style>${habits.styles.map(({ value, label }) => `<option value="${escapeHtml(value)}"${value === style ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
          <div class="grid">${namingHabitFields.map(([name, group, label, hint]) => `<label class="field">${fieldLabel(ui(label), hint ? ui(hint) : undefined)}<input name="${name}" maxlength="${habits.maxLength}" value="${escapeHtml(values?.[group]?.[style] ?? "")}"></label>`).join("")}</div>
        </div>
        ${cardSaveActions(ui("save"))}
      </form>`,
        )
        .join("")}
    </div>`;
  }

  async function savePersonaNamingHabits(form) {
    if (savingForms) return;
    const personaId = Number(form.closest("[data-persona-habits]").dataset.personaHabits);
    const habits = state.overview.personaNamingHabits;
    const style = form.dataset.personaHabitForm;
    const payload = {
      style,
      ...Object.fromEntries(namingHabitFields.map(([name]) => [name, form.elements[name].value])),
    };
    const result = await withBusyForm(form, () =>
      api(`/guilds/${state.guildId}/personas/${personaId}/naming-habits`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    );
    if (!result || !form.isConnected) return;
    habits.values[personaId] ??= {};
    const naming = habits.values[personaId];
    for (const [name, group] of namingHabitFields) {
      const value = result.values[name];
      naming[group] ??= {};
      if (value) naming[group][style] = value;
      else delete naming[group][style];
      form.elements[name].value = value;
    }
    completeFormSave(form);
    toast(ui("persona_habits_saved"));
  }

  async function loadPersonaConditioning(host, personaId) {
    const path = `/guilds/${state.guildId}/personas/${personaId}/conditioning`;
    const content = host.querySelector("[data-conditioning-entries]");
    const refresh = host.querySelector("[data-conditioning-refresh]");
    refresh.disabled = true;
    content.innerHTML = loadingBar(ui("persona_conditioning_title"));
    let entries;
    try {
      ({ entries } = await api(path));
    } catch (error) {
      if (content.isConnected)
        content.innerHTML = `<p class="notice error" role="alert">${escapeHtml(error.message)}</p>`;
      return;
    } finally {
      refresh.disabled = false;
    }
    if (!content.isConnected) return;
    content.innerHTML = entries.length
      ? `<div class="rows">${entries
          .map(
            ({ id, type, action, reason, count }) => `<article class="item">
        <div id="conditioning-${escapeHtml(id)}">
          <div class="item-meta"><span>${escapeHtml(ui(type === "reward" ? "persona_conditioning_reward" : "persona_conditioning_punishment"))} &middot; ${escapeHtml(action)}</span><span>${escapeHtml(ui("persona_conditioning_count").replace("{count}", String(count)))}</span></div>
          <p dir="auto">${escapeHtml(reason)}</p>
        </div>
        <div class="item-actions"><button class="button small icon danger" type="button" data-conditioning-remove="${escapeHtml(id)}" aria-label="${escapeHtml(ui("persona_conditioning_remove"))}" aria-describedby="conditioning-${escapeHtml(id)}" aria-haspopup="dialog">${navigationIcon("trash-2")}</button></div>
      </article>`,
          )
          .join("")}</div>`
      : `<p class="hint">${escapeHtml(ui("persona_conditioning_empty"))}</p>`;
    content.querySelectorAll("[data-conditioning-remove]").forEach((button) => {
      button.onclick = async () => {
        if (
          !(await confirmAction(
            ui("persona_conditioning_remove_title"),
            ui("persona_conditioning_remove_hint"),
            ui("persona_conditioning_remove"),
          )) ||
          !button.isConnected
        )
          return;
        button.disabled = true;
        try {
          await api(`${path}/${encodeURIComponent(button.dataset.conditioningRemove)}`, { method: "DELETE" });
          toast(ui("persona_conditioning_removed"));
          if (host.isConnected) {
            await loadPersonaConditioning(host, personaId);
            if (refresh.isConnected) refresh.focus({ preventScroll: true });
          }
        } catch (error) {
          if (button.isConnected) {
            button.disabled = false;
            toast(error.message, "error");
          }
        }
      };
    });
  }

  function personaKnowledgeTabs() {
    const tabs = [
      ["personal", "persona_personal_memory"],
      ["server", "persona_server_memory"],
      ["lorebook", "lorebooks"],
    ];
    if (state.overview.canManage && state.overview.personaNamingHabits && !state.overview.guild.isDirectMessage)
      tabs.push(["conditioning", "persona_conditioning_tab"]);
    return tabs;
  }

  const personaAttgFields = [
    ["nai_attg_author", "persona_attg_author"],
    ["nai_attg_title", "persona_attg_work_title"],
    ["nai_attg_tags", "persona_attg_tags"],
    ["nai_attg_genre", "persona_attg_genre"],
  ];

  function renderPersonaAttg(personaId) {
    const settings = state.overview.personaGuildSettings;
    const attg = settings?.values[personaId]?.attg;
    if (!attg) return "";
    return `<form class="card" data-fx="track" data-persona-attg="${personaId}" data-settings-key="persona-attg/${personaId}">
      ${personaCardHead(ui("persona_attg_title"), ui("persona_attg_hint"))}
      <div class="grid">${personaAttgFields.map(([name, key]) => `<label class="field">${fieldLabel(ui(key))}<input name="${name}" maxlength="${settings.attgMaxLength}" value="${escapeHtml(attg[name] ?? "")}"></label>`).join("")}
      <label class="field">${fieldLabel(ui("persona_attg_stars"), ui("persona_attg_stars_hint"))}<select name="nai_attg_stars"><option value="">${escapeHtml(ui("persona_attg_unrated"))}</option>${[1, 2, 3, 4, 5].map((stars) => `<option value="${stars}"${stars === attg.nai_attg_stars ? " selected" : ""}>${stars}</option>`).join("")}</select></label></div>
      ${cardSaveActions(ui("persona_save"))}
    </form>`;
  }

  async function savePersonaAttg(form) {
    const personaId = Number(form.dataset.personaAttg);
    const settings = state.overview.personaGuildSettings.values[personaId];
    const data = Object.fromEntries(new FormData(form));
    data.nai_attg_stars = data.nai_attg_stars ? Number(data.nai_attg_stars) : null;
    const result = await withBusyForm(form, () =>
      api(`/guilds/${state.guildId}/personas/${personaId}/attg`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    );
    if (!result || !form.isConnected) return;
    settings.attg = result.values;
    for (const [key, value] of Object.entries(result.values)) form.elements[key].value = value ?? "";
    completeFormSave(form);
    toast(ui("persona_attg_saved"));
  }

  function personaSettingsPanel(key, hint, attributes) {
    return `<section class="card" ${attributes}>
      ${personaCardHead(ui(key), ui(hint))}
      <div data-persona-panel-body>${loadingBar(ui(key))}</div>
    </section>`;
  }

  async function loadPersonaVoice(host, personaId) {
    const body = host.querySelector("[data-persona-panel-body]");
    if (body.hasAttribute("aria-busy")) return;
    body.setAttribute("aria-busy", "true");
    body.innerHTML = `<section class="card">${personaCardHead(ui("persona_voice_title"), ui("persona_voice_hint"))}${loadingBar(ui("persona_voice_title"))}</section>`;
    try {
      const voice = await api(`/guilds/${state.guildId}/personas/${personaId}/voice`);
      if (!host.isConnected) return;
      const title = (kind) => ui(kind === "clone" ? "persona_voice_clone" : "persona_voice_design");
      const currentSource = [title(voice.effectiveSource), voice.effectiveTarget].filter(Boolean).join(" / ");
      const current = voice.effectiveSource
        ? ui(voice.effectiveSource === voice.priority ? "persona_voice_effective" : "persona_voice_fallback").replace(
            "{source}",
            () => currentSource,
          )
        : ui("persona_voice_no_source");
      const settingsKey = `persona-voice/${personaId}/${voice.mode}`;
      const draftChoice = drafts
        .get(`${state.guildId}/${settingsKey}`)
        ?.find(({ name }) => name === "assignment")?.value;
      const unavailable = [...new Set([voice.selectedId, draftChoice])].filter(
        (id) => id && !voice.options.some((option) => option.id === id),
      );
      body.innerHTML = `<div class="split"><form class="card" data-fx="track" data-persona-voice="${personaId}" data-voice-mode="${escapeHtml(voice.mode)}" data-settings-key="${escapeHtml(settingsKey)}">
        ${personaCardHead(ui("persona_voice_title"), ui("persona_voice_hint"))}
        <div class="stack"><label class="field">${fieldLabel(ui("persona_voice_priority"), ui("persona_voice_priority_hint"))}
          <select name="priority">${["design", "clone"].map((kind) => `<option value="${kind}"${kind === voice.priority ? " selected" : ""}>${escapeHtml(title(kind))}</option>`).join("")}</select></label>
        <label class="field">${fieldLabel(ui(voice.mode === "elevenlabs" ? "persona_voice_provider" : "persona_voice_sample"))}
          <select name="assignment" data-searchable><option value="">${escapeHtml(ui("persona_voice_unassigned"))}</option>
          ${unavailable.map((id) => `<option value="${escapeHtml(id)}"${id === voice.selectedId ? " selected" : ""}>${escapeHtml(ui("persona_voice_unavailable"))}</option>`).join("")}
          ${voice.options.map(({ id, label }) => `<option value="${escapeHtml(id)}"${id === voice.selectedId ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>
          ${voice.catalogUnavailable ? `<small class="hint">${escapeHtml(ui("persona_voice_catalog_unavailable"))}</small>` : ""}</label>
        <label class="field">${fieldLabel(ui("persona_voice_design_prompt"), ui("persona_voice_design_hint"))}
          <textarea name="designPrompt" maxlength="${voice.maxLength}" rows="4">${escapeHtml(voice.designPrompt)}</textarea></label></div>
        ${cardSaveActions(ui("persona_save"))}
      </form><aside class="card">${personaCardHead(ui("persona_voice_status"), "", refreshButton("voice", ui("persona_voice_refresh")))}<p class="hint">${escapeHtml(current)}</p></aside></div>`;
      host.querySelector("[data-voice-refresh]").onclick = () => loadPersonaVoice(host, personaId);
      initDraftForms(host);
      enhanceDashboard(host);
      focusSearchDestination();
    } catch (error) {
      if (host.isConnected) {
        body.innerHTML = `<section class="card">${personaCardHead(ui("persona_voice_title"), "", refreshButton("voice", ui("persona_voice_refresh")))}<p class="notice error" role="alert">${escapeHtml(error.message)}</p></section>`;
        host.querySelector("[data-voice-refresh]").onclick = () => loadPersonaVoice(host, personaId);
      }
    } finally {
      body.removeAttribute("aria-busy");
    }
  }

  async function savePersonaVoice(form) {
    const personaId = Number(form.dataset.personaVoice);
    const mode = form.dataset.voiceMode;
    const changed = Object.fromEntries(
      formSnapshot(form)
        .filter(({ name, value }) => formBaselines.get(form)?.find((entry) => entry.name === name)?.value !== value)
        .map(({ name, value }) => [name, value]),
    );
    if (!Object.keys(changed).length) return;
    if (changed.assignment !== undefined) {
      const id = changed.assignment;
      changed.assignment = { mode, id: id === "" ? null : mode === "sample" ? Number(id) : id };
    }
    const saved = await withBusyForm(form, () =>
      api(`/guilds/${state.guildId}/personas/${personaId}/voice`, {
        method: "PATCH",
        body: JSON.stringify(changed),
      }),
    );
    if (!saved || !form.isConnected) return;
    const host = form.closest("[data-persona-voice-panel]");
    completeFormSave(form);
    toast(ui("persona_voice_saved"));
    await loadPersonaVoice(host, personaId);
    if (host.isConnected) host.querySelector("[data-voice-refresh]").focus({ preventScroll: true });
  }

  async function loadPersonaPreset(host, personaId) {
    const body = host.querySelector("[data-persona-panel-body]");
    const path = `/guilds/${state.guildId}/personas/${personaId}/preset`;
    try {
      const preset = await api(path);
      if (!host.isConnected) return;
      body.innerHTML = preset.name
        ? `<div class="stack"><strong>${escapeHtml(preset.name)}</strong><p class="hint">${escapeHtml(ui(preset.linked ? "persona_preset_linked" : "persona_preset_local"))}</p>
          ${preset.revision ? `<div class="actions form-actions"><button type="button" class="button danger" data-persona-resync aria-haspopup="dialog">${escapeHtml(ui("persona_preset_resync"))}</button></div>` : ""}</div>`
        : `<p class="hint">${escapeHtml(ui(preset.hasPreset ? "persona_preset_missing" : "persona_preset_original"))}</p>`;
      const button = body.querySelector("[data-persona-resync]");
      if (button)
        button.onclick = async () => {
          if (
            savingForms ||
            !(await confirmAction(
              ui("persona_preset_confirm_title"),
              ui(preset.linked ? "persona_preset_confirm_linked" : "persona_preset_confirm_local"),
            )) ||
            !host.isConnected
          )
            return;
          try {
            const result = await withBusyForm(host, () =>
              api(`${path}/resync`, {
                method: "POST",
                body: JSON.stringify({ revision: preset.revision }),
              }),
            );
            if (!result) return;
            toast(
              ui(result.avatarSynced ? "persona_preset_saved" : "persona_preset_partial"),
              result.avatarSynced ? "success" : "warning",
            );
            if (host.isConnected) await refreshPersonas(personaId);
          } catch (error) {
            toast(error.message, "error");
            if (host.isConnected && error.code === "persona_preset_changed") await loadPersonaPreset(host, personaId);
          }
        };
    } catch (error) {
      if (host.isConnected) body.innerHTML = `<p class="notice error" role="alert">${escapeHtml(error.message)}</p>`;
    }
  }

  function renderPersonaChips(values, field) {
    return values
      .map(
        (value, index) =>
          `<span class="chip${field === "triggerWords" ? " tone" : ""}">${escapeHtml(value)}<button class="chip-x" type="button" data-persona-chip-remove="${index}" aria-label="${escapeHtml(ui("persona_chip_remove").replace("{value}", () => value))}">×</button></span>`,
      )
      .join("");
  }

  function renderPersonaChipEditor(field, values, label) {
    const text = escapeHtml(ui(label));
    return `<div class="stack" data-persona-chip-editor>
      <input type="hidden" name="${field}" value="${escapeHtml(JSON.stringify(values))}" data-persona-chip-values>
      <div class="chips">${renderPersonaChips(values, field)}</div>
      <label class="field"><span class="field-label sr-only">${text}</span><input type="text" placeholder="${text}" enterkeyhint="done" data-persona-chip-add></label>
    </div>`;
  }

  function editPersonaChips(control) {
    const editor = control.closest("[data-persona-chip-editor]");
    const values = editor.querySelector("[data-persona-chip-values]");
    const input = editor.querySelector("[data-persona-chip-add]");
    const chips = JSON.parse(values.value);
    const removed = control.dataset.personaChipRemove;
    if (removed !== undefined) chips.splice(Number(removed), 1);
    const next = removed === undefined ? [...new Set([...chips, ...parseTags(input.value)])].slice(0, 80) : chips;
    values.value = JSON.stringify(next);
    values.dispatchEvent(new Event("input", { bubbles: true }));
    const list = editor.querySelector(".chips");
    window.TomoriFX.swap(list, renderPersonaChips(next, values.name));
    if (removed === undefined) {
      input.value = "";
      input.focus({ preventScroll: true });
    } else {
      const nextButton =
        list.querySelector(`[data-persona-chip-remove="${removed}"]`) || list.lastElementChild?.querySelector("button");
      (nextButton || input).focus({ preventScroll: true });
    }
  }

  function renderPersonaSettings(persona) {
    const saveActions = cardSaveActions(ui("persona_save"));
    const attributes = persona.attributes || [];
    const dialogues = persona.sampleDialogues || [];
    return `<div class="split"><div class="col">
        <form class="card" data-fx="track" data-persona-id="${persona.personaId}" data-persona-section="identity">
          ${personaCardHead(ui("persona_identity_title"), ui("persona_identity_hint"))}
          <label class="field">${fieldLabel(ui("persona_nickname"), ui("persona_nickname_hint"))}<input name="nickname" value="${escapeHtml(persona.nickname)}" minlength="1" maxlength="100" required></label>
          ${saveActions}
        </form>

        <form class="card" data-fx="track" data-persona-id="${persona.personaId}" data-persona-section="prompt">
          ${personaCardHead(ui("persona_triggers_title"), ui("persona_triggers_hint"))}
          ${renderPersonaChipEditor("triggerWords", persona.triggerWords || [], "persona_triggers_add")}
          ${saveActions}
        </form>

        <section class="card" data-persona-id="${persona.personaId}">
          <header class="card-head"><h3>${escapeHtml(ui("persona_attributes_title"))}<small>${attributes.length}</small></h3><button class="button small" type="button" data-entry-add="attribute">${navigationIcon("plus")}${escapeHtml(ui("persona_add_attribute"))}</button></header>
          <div data-persona-entries>${personaEntryDrafts.has(personaEntryKey(persona.personaId, "attribute", "new")) ? renderPersonaEntry(persona, "attribute", "new", { text: "", isPublic: false }) : ""}${attributes.length ? `<div class="rows">${attributes.map((attribute, index) => renderPersonaEntry(persona, "attribute", index, attribute)).join("")}</div>` : `<div class="empty-note"><strong>${escapeHtml(ui("persona_attributes_empty"))}</strong></div>`}</div>
        </section>

        <form class="card" data-fx="track" data-persona-id="${persona.personaId}" data-persona-section="context">
          ${personaCardHead(ui("persona_context_title"), ui("persona_context_hint"))}
          <div class="stack">
            <label class="field">${fieldLabel(ui("persona_context_field"))}<textarea name="contextNote" rows="3">${escapeHtml(persona.contextNote || "")}</textarea></label>
            <label class="field">${fieldLabel(ui("persona_context_depth"), ui("persona_context_depth_hint"))}<input name="contextNoteDepth" type="number" min="0" max="100" value="${persona.contextNoteDepth || 0}"></label>
          </div>
          ${saveActions}
        </form>
        ${renderPersonaNamingHabits(persona)}
        ${renderPersonaHumanizer(persona)}
        ${state.overview.canManage ? `<div id="persona-text-model" data-persona-id="${persona.personaId}">${loadingBar(ui("persona_model_loading"))}</div>` : ""}
        ${renderPersonaAttg(persona.personaId)}
        ${state.overview.personaGuildSettings ? personaSettingsPanel("persona_preset_title", "persona_preset_hint", "data-persona-preset-panel") : ""}
      </div><div class="col">
        <section class="card" data-persona-id="${persona.personaId}">
          <header class="card-head"><h3>${escapeHtml(ui("persona_dialogues_title"))}<small>${dialogues.length}</small></h3><button class="button small" type="button" data-entry-add="dialogue">${navigationIcon("plus")}${escapeHtml(ui("persona_add_dialogue"))}</button></header>
          <div data-persona-entries>${personaEntryDrafts.has(personaEntryKey(persona.personaId, "dialogue", "new")) ? renderPersonaEntry(persona, "dialogue", "new", { input: "", output: "" }) : ""}${dialogues.length ? `<div class="rows">${dialogues.map((dialogue, index) => renderPersonaEntry(persona, "dialogue", index, dialogue)).join("")}</div>` : `<div class="empty-note"><strong>${escapeHtml(ui("persona_dialogues_empty"))}</strong></div>`}</div>
        </section>
        ${
          persona.isAlter
            ? `<section class="card" data-persona-id="${persona.personaId}">
                ${personaCardHead(ui("persona_delete_alter"), ui("persona_delete_alter_hint"), `<div class="actions"><button class="button danger hold-button" type="button" data-hold data-persona-delete="${persona.personaId}" data-confirm-title="${escapeHtml(ui("persona_delete_title").replace("{name}", () => persona.nickname))}" data-confirm-description="${escapeHtml(ui("persona_delete_description"))}" aria-label="${escapeHtml(ui("persona_delete_title").replace("{name}", () => persona.nickname))}"><span>${escapeHtml(ui("control_hold_delete"))}</span></button></div>`)}
              </section>`
            : ""
        }
      </div></div>`;
  }

  function renderPersonaEntry(persona, kind, index, saved) {
    return `<article class="${index === "new" ? "compose" : "item"}" data-entry-kind="${kind}" data-entry-index="${index}" data-persona-id="${persona.personaId}">${renderPersonaEntryContent(persona, kind, index, saved)}</article>`;
  }

  function renderPersonaEntryContent(persona, kind, index, saved) {
    const key = personaEntryKey(persona.personaId, kind, index);
    const draft = personaEntryDrafts.get(key);
    const value = draft || saved;
    const attributes = kind === "attribute";
    const fields = attributes
      ? `<label class="field"><span class="field-label">${escapeHtml(ui("persona_attribute"))}</span><textarea name="text" rows="2" required>${escapeHtml(value.text)}</textarea></label><label class="toggle"><span class="field-label">${escapeHtml(ui("persona_attribute_public"))}</span><input name="isPublic" type="checkbox" role="switch"${value.isPublic ? " checked" : ""}></label>`
      : `<label class="field"><span class="field-label">${escapeHtml(ui("persona_dialogue_user"))}</span><textarea name="input" rows="3" required>${escapeHtml(value.input)}</textarea></label><label class="field"><span class="field-label">${escapeHtml(persona.nickname)}</span><textarea name="output" rows="3" required>${escapeHtml(value.output)}</textarea></label>`;
    const read = attributes
      ? `<div><p>${escapeHtml(saved.text)}</p>${saved.isPublic ? `<div class="item-meta"><span class="chip">${navigationIcon("users-round")}<span>${escapeHtml(ui("persona_attribute_public"))}</span></span></div>` : ""}</div>`
      : `<div class="talk"><div class="bubble-row me"><p class="speech" dir="auto">${escapeHtml(saved.input)}</p></div><div class="bubble-row">${personaSticker(persona, "flat")}<p class="speech" dir="auto">${escapeHtml(saved.output)}</p></div></div>`;
    return `${draft ? `<form class="stack" data-persona-entry-form data-edit-baseline="${escapeHtml(JSON.stringify(saved))}"><div class="${attributes ? "stack" : "edit-pair"}">${fields}</div><div class="actions"><button class="button small" type="button" data-entry-cancel>${escapeHtml(ui("persona_cancel"))}</button><button class="button small primary" type="submit" data-fx="spark">${escapeHtml(ui("persona_save"))}</button></div></form>` : `${read}<div class="item-actions"><button class="button small icon" type="button" data-entry-edit aria-label="${escapeHtml(ui("persona_edit"))}">${navigationIcon("pencil")}</button><button class="button small icon danger" type="button" data-entry-delete aria-label="${escapeHtml(ui("persona_delete_entry"))}">${navigationIcon("trash-2")}</button></div>`}`;
  }

  function personaTint(persona) {
    const art = personaArt.get(persona.lineageId);
    if (art) return art;
    const preset = palettes.find(({ id }) => id === persona.nickname.toLowerCase());
    return preset?.id || "tomori";
  }

  function personaTintAttribute(persona) {
    return appearance.personaColors ? ` data-tint="${personaTint(persona)}"` : "";
  }

  function personaSticker(persona, variant = "") {
    const avatar = personaAvatarUrl(persona);
    const initial = persona.nickname.trim().slice(0, 1) || "?";
    return `<span class="sticker${variant ? ` ${variant}` : ""}" aria-hidden="true">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" data-avatar-fallback="${escapeHtml(initial)}">` : escapeHtml(initial)}</span>`;
  }

  function renderPersonaTestChat(persona) {
    const chat = state.personaTestChats[persona.personaId] || [];
    const label = escapeHtml(ui("persona_test_open").replace("{name}", () => persona.nickname));
    return `<aside class="chat-dock${appearance.personaColors ? " tinted" : ""}"${personaTintAttribute(persona)} id="persona-test-chat" data-persona-id="${persona.personaId}" aria-labelledby="persona-test-chat-title"${state.personaChatOpen ? "" : " hidden"}>
      <header class="chat-head">
        ${personaSticker(persona)}
        <div class="who"><h2 id="persona-test-chat-title">${label}</h2><small>${escapeHtml(ui("persona_test_private"))}</small></div>
        <button class="button small" type="button" data-test-chat-reset="${persona.personaId}"${chat.length ? "" : " disabled"}>${escapeHtml(ui("persona_test_reset"))}</button>
        <button class="button icon" type="button" data-test-chat-close aria-label="${escapeHtml(ui("persona_test_close"))}">${navigationIcon("x")}</button>
      </header>
      <div class="chat-log" role="log" aria-live="polite">
        ${
          chat.length
            ? chat
                .map((message) => {
                  if (message.role === "user")
                    return `<div class="bubble-row me"><p class="speech">${escapeHtml(message.content)}</p></div>`;
                  const segments = message.segments?.length
                    ? message.segments
                    : [{ content: message.content, sprite: null }];
                  return segments
                    .map(
                      ({ content, sprite }) => `<div class="bubble-row">
              ${personaSticker(sprite ? { nickname: sprite.name, avatarUrl: sprite.imageUrl } : persona, sprite ? "react" : "")}
              <p class="speech">${escapeHtml(content)}${sprite ? `<span class="meta">${escapeHtml(sprite.displayName || persona.nickname)} · ${escapeHtml(sprite.name)}</span>` : ""}</p>
            </div>`,
                    )
                    .join("");
                })
                .join("")
            : `<p class="hint">${escapeHtml(ui("persona_test_empty"))}</p>`
        }
        ${state.personaTestChatBusy ? loadingBar(ui("persona_model_loading")) : ""}
      </div>
      <div class="chat-foot">
        <form class="composer" id="persona-test-chat-form" data-persona-id="${persona.personaId}">
          <label class="sr-only" for="persona-test-input">${escapeHtml(ui("persona_test_message"))}</label>
          <textarea id="persona-test-input" name="message" rows="3" maxlength="4000" required${state.personaTestChatBusy ? " disabled" : ""}></textarea>
          <div class="composer-footer"><span class="hint">${escapeHtml(ui("persona_test_configured_model"))}</span><button class="button small primary" data-fx="spark" type="submit"${state.personaTestChatBusy ? " disabled" : ""}>${escapeHtml(ui("persona_test_send"))}</button></div>
        </form>
      </div>
    </aside>`;
  }

  function syncPersonaChat(workspace, persona) {
    const shell = workspace.closest(".shell");
    shell.querySelector("#persona-test-chat")?.remove();
    workspace.querySelector(".chat-fab")?.remove();
    const visible = persona && state.overview.canManage && !state.overview.guild.isDirectMessage;
    shell.classList.toggle("chat-open", Boolean(visible && state.personaChatOpen));
    if (visible && state.personaChatOpen) document.body.dataset.chat = "open";
    else delete document.body.dataset.chat;
    if (!visible) return;
    workspace.insertAdjacentHTML(
      "beforeend",
      `<button class="chat-fab${appearance.personaColors ? " tinted" : ""}"${personaTintAttribute(persona)} type="button" aria-expanded="${state.personaChatOpen}" aria-controls="persona-test-chat" data-test-chat-open${state.personaChatOpen ? " hidden" : ""}>${personaSticker(persona)}<span class="fab-label">${escapeHtml(ui("persona_test_open").replace("{name}", () => persona.nickname))}</span></button>`,
    );
    workspace.insertAdjacentHTML("afterend", renderPersonaTestChat(persona));
    window.TomoriFX.enhance(shell.lastElementChild);
    scrollTestChat();
  }

  function setPersonaChat(open) {
    state.personaChatOpen = open;
    document.querySelector(".app-frame > .shell")?.classList.toggle("chat-open", open);
    if (open) document.body.dataset.chat = "open";
    else delete document.body.dataset.chat;
    const button = document.querySelector("[data-test-chat-open]");
    const dock = document.querySelector("#persona-test-chat");
    dock.hidden = !open;
    button.hidden = open;
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      scrollTestChat();
      (dock.querySelector("textarea:not(:disabled)") || dock.querySelector("[data-test-chat-close]")).focus({
        preventScroll: true,
      });
    } else button.focus({ preventScroll: true });
  }

  function renderPersonaAppearance(persona) {
    const saveActions = cardSaveActions(ui("persona_save"));
    const tags = persona.physicalAppearanceTags || [];
    return `<div class="split">
      <section class="card" data-persona-id="${persona.personaId}" data-persona-reference="${persona.personaId}">${renderPersonaReference(persona)}</section>
      <div class="col">
        <form class="card" data-fx="track" data-persona-id="${persona.personaId}" data-persona-section="appearance">
          ${personaCardHead(ui("persona_appearance_tags"), ui("persona_appearance_tags_hint"))}
          ${renderPersonaChipEditor("physicalAppearanceTags", tags, "persona_appearance_add")}
          ${saveActions}
        </form>
        <form class="card" data-fx="track" data-persona-id="${persona.personaId}" data-persona-section="prompt">
          ${personaCardHead(ui("persona_visual_prompt"), ui("persona_visual_prompt_hint"))}
          <label class="field"><span class="field-label sr-only">${escapeHtml(ui("persona_visual_description"))}</span><textarea name="personaPrompt" rows="5">${escapeHtml(persona.personaPrompt || "")}</textarea></label>
          ${saveActions}
        </form>
      </div>
    </div>`;
  }

  function renderPersonaReference(persona) {
    const { personaId } = persona;
    const canChangeAvatar = !state.overview.guild.isDirectMessage;
    const reference = state.overview.personaGuildSettings?.values[personaId];
    const saved = reference?.hasCharacterReference;
    const url = `${BASE}/guilds/${state.guildId}/personas/${personaId}/character-reference?v=${state.avatarRevision}`;
    const removals = `${canChangeAvatar && personaAvatarUrl(persona) ? `<button class="button danger" type="button" data-persona-avatar-remove="${personaId}" aria-haspopup="dialog">${escapeHtml(ui("persona_avatar_remove"))}</button>` : ""}${saved ? `<button class="button danger" type="button" data-persona-reference-remove aria-haspopup="dialog">${escapeHtml(ui("character_reference_remove"))}</button>` : ""}`;
    const actionsLabel = escapeHtml(ui("persona_actions"));
    const actions = `<div class="actions">
      ${removals ? `<button class="button icon" type="button" popovertarget="persona-art-actions" aria-label="${actionsLabel}">${navigationIcon("ellipsis")}</button><div class="action-menu" id="persona-art-actions" popover aria-label="${actionsLabel}">${removals}</div>` : ""}
      ${canChangeAvatar ? `<button class="button small" type="button" data-persona-avatar-choose="${personaId}">${navigationIcon("image")}${escapeHtml(ui("persona_avatar_change"))}</button>` : ""}
      ${reference ? `<button class="button small" type="button" data-persona-reference-upload>${navigationIcon("image")}${escapeHtml(ui("character_reference_upload"))}</button>` : ""}
    </div>`;
    return `${personaCardHead(ui(reference ? "persona_avatar_and_reference" : "persona_avatar_title"), "", actions)}
      <div class="stack">${reference ? `<p class="hint">${escapeHtml(ui("persona_reference_hint"))}</p>` : ""}
      <div class="art-preview">${saved ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(ui("persona_reference_title"))}">` : `<div role="img" aria-label="${escapeHtml(persona.nickname)}">${personaSticker(persona)}</div>`}</div></div>
      <input id="persona-avatar-file-${personaId}" data-persona-avatar-file="${personaId}" type="file" accept=".png,.jpg,.jpeg,.gif,image/png,image/jpeg,image/gif" hidden>
      ${reference ? '<input type="file" data-persona-reference-file accept="image/*" hidden>' : ""}`;
  }

  async function savePersonaReference(host, file) {
    const personaId = Number(host.dataset.personaReference);
    const settings = state.overview.personaGuildSettings.values[personaId];
    try {
      const body = new FormData();
      if (file) body.set("file", file);
      const result = await withBusyForm(host, () =>
        api(`/guilds/${state.guildId}/personas/${personaId}/character-reference`, {
          method: file ? "PUT" : "DELETE",
          ...(file ? { body } : {}),
        }),
      );
      if (!result) return;
      settings.hasCharacterReference = result.hasCharacterReference;
      if (host.isConnected) {
        state.avatarRevision += 1;
        const persona = state.overview.personas.find((item) => item.personaId === personaId);
        window.TomoriFX.swap(host, renderPersonaReference(persona));
        host.querySelector("[data-persona-reference-upload]").focus({ preventScroll: true });
      }
      toast(ui(file ? "persona_reference_saved" : "persona_reference_removed"));
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderPersonaNaming(persona) {
    const { values, copy, maxLength } = state.overview.personaNaming;
    const preference = values[persona.personaId] || {};
    return `<div class="split"><form class="card" data-fx="track" data-persona-naming="${persona.personaId}">
      ${personaCardHead(copy.title)}
      <div class="stack">${["nickname", "prefix", "suffix"]
        .map((key) => {
          const value = preference[key];
          const mode = value == null ? "inherit" : value === "" && key !== "nickname" ? "none" : "custom";
          const labelId = `persona-naming-${key}`;
          return `<div class="grid" role="group" aria-labelledby="${labelId}">
          <label class="field"><span class="field-label" id="${labelId}">${escapeHtml(copy[key])}</span><select name="${key}Mode" data-naming-mode="${key}">
            ${["inherit", "custom", ...(key === "nickname" ? [] : ["none"])].map((option) => `<option value="${option}"${mode === option ? " selected" : ""}>${escapeHtml(copy[option])}</option>`).join("")}
          </select></label>
          <label class="field"${mode === "custom" ? "" : " hidden"}><span class="field-label">${escapeHtml(copy.value)}</span><input name="${key}" maxlength="${maxLength}" value="${escapeHtml(value ?? "")}" required${mode === "custom" ? "" : " disabled"}></label>
        </div>`;
        })
        .join("")}</div>
      ${cardSaveActions(copy.save, `<button class="button small" type="button" data-action-leading data-persona-naming-reset>${escapeHtml(copy.reset)}</button>`)}
    </form><aside class="card">${personaCardHead(ui("persona_naming_defaults"))}<div class="stack"><p class="hint">${escapeHtml(copy.description)}</p><p class="hint">${escapeHtml(copy.hint)}</p></div></aside></div>`;
  }

  async function saveNamingOrCategories(namingForm, categoriesForm, reset) {
    const form = namingForm || categoriesForm;
    const overview = state.overview;
    const guildId = state.guildId;
    const data = namingForm ? overview.personaNaming : overview.settings.stmCategories;
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
          const workspace = form.closest("[data-dashboard-view]");
          const scrollTop = workspace.scrollTop;
          if (namingForm) {
            form.closest(".split").outerHTML = renderPersonaNaming(
              overview.personas.find((persona) => persona.personaId === personaId),
            );
          } else form.outerHTML = renderStmCategories();
          initDraftForms(workspace);
          enhanceDashboard(workspace);
          resizeAutoGrowTextareas(document);
          workspace.scrollTop = scrollTop;
          workspace
            .querySelector(
              namingForm ? "[data-persona-naming] [data-persona-naming-reset]" : "[data-stm-categories-reset]",
            )
            ?.focus({ preventScroll: true });
        }
        toast(data.copy.saved);
      });
    } catch (error) {
      showFormError(form, error);
    }
  }

  function renderStmCategories() {
    const { values, copy } = state.overview.settings.stmCategories;
    return `<form class="card" data-fx="track" id="stm-categories-form">
      ${personaCardHead(copy.title, copy.description)}
      <div class="stack"><p class="hint">${escapeHtml(copy.hint)}</p>${Array.from({ length: 5 }, (_, index) => {
        const category = values[index];
        return `<fieldset class="stack" data-stm-slot><legend class="sr-only">${escapeHtml(copy.label)} ${index + 1}</legend>
          <label class="field">${fieldLabel(`${copy.label} ${index + 1}`)}<input name="label${index}" maxlength="997" value="${escapeHtml(category?.label ?? "")}"></label>
          <label class="field">${fieldLabel(copy.categoryDescription)}<textarea name="description${index}" rows="2" maxlength="997" data-auto-grow>${escapeHtml(category?.description ?? "")}</textarea></label>
        </fieldset>`;
      }).join("")}<p class="hint">${escapeHtml(copy.warning)}</p></div>
      ${cardSaveActions(copy.save, `<button class="button small" type="button" data-action-leading data-stm-categories-reset>${escapeHtml(copy.reset)}</button>`)}
    </form>`;
  }

  function renderPersonaPicker(personas, selectedId, actions) {
    if (!personas.length) return "";
    return `<dialog id="persona-picker-dialog" class="collection" aria-labelledby="persona-picker-title">
      <header class="collection-head">
        <div class="collection-title"><h2 id="persona-picker-title">${escapeHtml(ui("persona_choose"))} <small>${personas.length}</small></h2>
          <div class="row">${actions}<button class="button icon" type="button" data-persona-picker-close aria-label="${escapeHtml(ui("persona_cancel"))}">${navigationIcon("x")}</button></div></div>
        <div class="collection-tools"><label class="field"><span class="field-label sr-only">${escapeHtml(ui("persona_search"))}</span><input type="search" data-persona-picker-search placeholder="${escapeHtml(ui("persona_search"))}"></label>
          <label class="field"><span class="field-label sr-only">${escapeHtml(ui("persona_picker_sort"))}</span><select data-persona-picker-sort><option value="default">${escapeHtml(ui("persona_picker_sort_default"))}</option><option value="name">${escapeHtml(ui("persona_picker_sort_name"))}</option></select></label></div>
      </header>
      <div class="collection-body"><div class="deck">${renderPersonaPickerTiles(personas, selectedId)}</div><div class="empty-note" data-persona-picker-empty hidden><strong>${escapeHtml(ui("persona_picker_no_results"))}</strong></div></div>
    </dialog>`;
  }

  function renderPersonaPickerTiles(personas, selectedId) {
    return personas
      .map(
        (entry) =>
          `<button class="deck-card" type="button" data-persona-search="${personaPickerSearchText(entry)}" data-persona-select="${entry.personaId}" aria-current="${entry.personaId === selectedId}">${personaPickerTileContent(entry)}</button>`,
      )
      .join("");
  }

  function personaPickerSearchText(persona) {
    return escapeHtml([persona.nickname, ...(persona.triggerWords || [])].join(" ").toLowerCase());
  }

  function personaPickerTileContent(persona) {
    return `${personaSticker(persona)}<strong>${escapeHtml(persona.nickname)}</strong><small>${escapeHtml(ui(persona.isAlter ? "persona_alter_label" : "persona_main_label"))} / #${persona.lineageId}</small>`;
  }

  function filterPersonaPicker(dialog) {
    const query = dialog.querySelector("[data-persona-picker-search]").value.trim().toLowerCase();
    const cards = [...dialog.querySelectorAll("[data-persona-search]")];
    for (const card of cards) card.hidden = !card.dataset.personaSearch.includes(query);
    dialog.querySelector("[data-persona-picker-empty]").hidden = cards.some((card) => !card.hidden);
  }

  function sortPersonaPicker(dialog) {
    const personas = state.overview.personas.filter((persona) => persona.lineageId !== 0);
    if (dialog.querySelector("[data-persona-picker-sort]").value === "name") {
      personas.sort(
        (left, right) => Number(left.isAlter) - Number(right.isAlter) || left.nickname.localeCompare(right.nickname),
      );
    }
    const deck = dialog.querySelector(".deck");
    deck.innerHTML = renderPersonaPickerTiles(personas, state.personaId);
    filterPersonaPicker(dialog);
    if (dialog.open) window.TomoriFX.stagger(deck);
  }

  const personaArt = new Map([
    [4, "tomori"],
    [50, "nerine"],
    [1770, "aphel"],
    [3585, "lilya"],
  ]);

  function renderPersonaArt(persona) {
    const art = personaArt.get(persona.lineageId);
    if (art) {
      return `<div class="art-stage" data-persona-portrait><img class="art-full" src="/settings/assets/persona-art-${art}.png" alt="${escapeHtml(persona.nickname)}" data-fx="tilt" data-fx-tilt="10"></div>`;
    }
    const avatar = personaAvatarUrl(persona);
    const initial = escapeHtml(persona.nickname.trim().slice(0, 1) || "?");
    return `<div class="card-stack" data-persona-portrait aria-hidden="true">
      <span class="back b1">✦</span><span class="back b2">✧</span>
      ${avatar ? `<span class="front"><img src="${escapeHtml(avatar)}" alt="" data-avatar-fallback="${initial}"></span>` : `<span class="front mono" data-label="${escapeHtml(persona.nickname)}">${initial}</span>`}
    </div>`;
  }

  function mountPersonaPage(workspace, personas, persona, primaryTabs, knowledgeTabs, canAdd) {
    const addActions = `<button class="button" type="button" data-persona-create-open data-fx="spark">${navigationIcon("plus")}${escapeHtml(ui("persona_create"))}</button>
      <button class="button" type="button" data-persona-import-open>${navigationIcon("download")}${escapeHtml(ui("persona_import_action"))}</button>`;
    const pickerActions = canAdd
      ? `<button class="button small" type="button" data-persona-import-open>${navigationIcon("download")}${escapeHtml(ui("persona_import_action"))}</button><button class="button small primary" type="button" data-persona-create-open data-fx="spark">${navigationIcon("plus")}${escapeHtml(ui("persona_create"))}</button>`
      : "";
    if (!persona) {
      workspace.innerHTML = `<section class="banner compact"><div class="banner-info"><h1>${escapeHtml(ui("personas_title"))}</h1><p class="banner-text">${escapeHtml(ui("persona_none"))}</p>${canAdd ? `<div class="actions">${pickerActions}</div>` : ""}</div></section>`;
      syncPersonaChat(workspace, null);
      return;
    }
    const tab = ([key, label, icon]) =>
      `<button type="button" id="persona-tab-${key}" role="tab" aria-selected="false" tabindex="-1" data-persona-panel="${key}">${icon ? navigationIcon(icon) : ""}${escapeHtml(label)}</button>`;
    workspace.innerHTML = `
      <section class="banner" data-persona-banner aria-labelledby="persona-name">
        <div class="banner-info">
          <div class="stack" data-persona-summary>
            <p class="crumb">${escapeHtml(ui("personas_title"))} <span class="kind" data-persona-kind></span></p>
            <h1 id="persona-name"></h1>
            <p class="banner-text" data-persona-description hidden></p>
            <div class="chips" data-persona-chips hidden></div>
          </div>
          <div class="quickbar">
            <div class="quick" data-fx="indicator" role="radiogroup" aria-label="${escapeHtml(ui("persona_choose"))}"></div>
            ${
              canAdd
                ? `<button class="quick-add" type="button" popovertarget="persona-add-menu" aria-label="${escapeHtml(ui("persona_create"))}"><span class="sticker dashed">${navigationIcon("plus")}</span></button>
              <div class="action-menu" popover id="persona-add-menu" aria-label="${escapeHtml(ui("persona_create"))}">${addActions}</div>`
                : ""
            }
            <button class="button small" type="button" data-persona-picker-open aria-haspopup="dialog">${navigationIcon("layout-grid")}<span></span></button>
          </div>
        </div>
        <div class="banner-art" data-persona-art>
          <div data-persona-portrait></div>
          <span class="sparkle" aria-hidden="true">✦</span>
          <span class="sparkle s2" aria-hidden="true">✧</span>
          <span class="sparkle s3" aria-hidden="true">✦</span>
        </div>
        ${
          state.overview.canManage
            ? `<div class="banner-menu">
          <button class="button icon" type="button" popovertarget="persona-actions-menu" aria-label="${escapeHtml(ui("persona_actions"))}">${navigationIcon("ellipsis")}</button>
          <div id="persona-actions-menu" class="action-menu" popover aria-label="${escapeHtml(ui("persona_actions"))}">
            <button class="button" type="button" data-persona-export-format="png">${navigationIcon("download")}${escapeHtml(ui("persona_export_png"))}</button>
            <button class="button" type="button" data-persona-export-format="json">${navigationIcon("download")}${escapeHtml(ui("persona_export_json"))}</button>
            <hr data-persona-main-only><button class="button" type="button" data-persona-main-change data-persona-main-only aria-haspopup="dialog">${escapeHtml(ui("persona_main_change"))}</button>
          </div>
        </div>`
            : ""
        }
      </section>
      ${state.overview.guild.isDirectMessage ? `<p class="notice">${escapeHtml(ui("direct_messages_guild_only"))}</p>` : ""}
      <nav class="dock" data-fx="indicator" data-overflow role="tablist" aria-label="${escapeHtml(ui("personas_title"))}">${primaryTabs.map(tab).join("")}</nav>
      <section class="stage" data-persona-stage role="tabpanel">
        <div class="toolbar" data-persona-knowledge-toolbar>
          <nav class="segmented" data-fx="indicator" role="tablist" aria-label="${escapeHtml(ui("persona_knowledge"))}">${knowledgeTabs.map(([key, label]) => tab([key, ui(label)])).join("")}</nav>
          <div class="actions" data-persona-stage-actions hidden></div>
        </div>
        <div data-persona-content></div>
      </section>
      ${renderPersonaPicker(personas, persona.personaId, pickerActions)}`;
  }

  function updatePersonaBanner(workspace, persona, personas) {
    const banner = workspace.querySelector("[data-persona-banner]");
    const personaChanged = banner.dataset.personaId !== String(persona.personaId);
    const revision = String(state.avatarRevision);
    const refreshed = banner.dataset.avatarRevision !== revision;
    const visualChanged = personaChanged || refreshed;
    if (visualChanged) {
      const swap = banner.dataset.personaId !== undefined && personaChanged;
      banner.dataset.personaId = persona.personaId;
      banner.dataset.avatarRevision = revision;
      banner.classList.toggle("tinted", appearance.personaColors);
      if (appearance.personaColors) banner.dataset.tint = personaTint(persona);
      else delete banner.dataset.tint;
      banner.querySelector("[data-persona-kind]").textContent = ui(
        persona.isAlter ? "persona_alter_label" : "persona_main_label",
      );
      banner.querySelectorAll("[data-persona-main-only]").forEach((action) => {
        action.hidden = persona.isAlter;
      });
      const description = banner.querySelector("[data-persona-description]");
      description.textContent = persona.attributes?.find((attribute) => attribute.isPublic)?.text || "";
      description.hidden = !description.textContent;
      const chips = banner.querySelector("[data-persona-chips]");
      const trigger = persona.triggerWords?.at(-1);
      chips.innerHTML = trigger
        ? `<span class="chip tone">${escapeHtml(ui("persona_trigger_chip").replace("{trigger}", () => trigger))}</span>`
        : "";
      chips.hidden = !trigger;
      const art = banner.querySelector("[data-persona-art]");
      const portrait = art.querySelector("[data-persona-portrait]");
      portrait.outerHTML = renderPersonaArt(persona);
      const heading = banner.querySelector("#persona-name");
      if (heading.textContent !== persona.nickname) window.TomoriFX.split(heading, persona.nickname);
      if (swap) {
        banner.classList.remove("is-swapping");
        void banner.offsetWidth;
        banner.classList.add("is-swapping");
      }
      syncPersonaChat(workspace, persona);
    }
    const quick = banner.querySelector(".quick");
    const currentButtons = [...quick.querySelectorAll("button[data-persona-select]")];
    const main = personas.find((entry) => !entry.isAlter);
    const preserve = currentButtons.some((button) => Number(button.dataset.personaSelect) === persona.personaId);
    const current = new Map(personas.map((entry) => [entry.personaId, entry]));
    const picks = preserve
      ? currentButtons.map((button) => current.get(Number(button.dataset.personaSelect))).filter(Boolean)
      : [...new Set([main, persona, ...personas].filter(Boolean))].slice(0, 4);
    const keys = picks.map((entry) => String(entry.personaId)).join(",");
    if (keys !== currentButtons.map((button) => button.dataset.personaSelect).join(",")) {
      for (const button of currentButtons) button.remove();
      quick.insertAdjacentHTML(
        "beforeend",
        picks
          .map(
            (entry) =>
              `<button type="button" role="radio" aria-label="${escapeHtml(entry.nickname)}" data-persona-select="${entry.personaId}">${personaSticker(entry)}</button>`,
          )
          .join(""),
      );
    } else if (refreshed) {
      currentButtons.forEach((button, index) => {
        button.setAttribute("aria-label", picks[index].nickname);
        button.innerHTML = personaSticker(picks[index]);
      });
    }
    quick.querySelectorAll("button").forEach((button) => {
      const active = Number(button.dataset.personaSelect) === persona.personaId;
      button.setAttribute("aria-checked", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    banner.querySelector("[data-persona-picker-open] span").textContent = ui("persona_all").replace(
      "{count}",
      String(personas.length),
    );
    const picker = workspace.querySelector("#persona-picker-dialog");
    if (picker.dataset.revision !== revision && !picker.open) {
      sortPersonaPicker(picker);
      picker.querySelector(".collection-title small").textContent = String(personas.length);
      picker.dataset.revision = revision;
    }
    picker.querySelectorAll("[data-persona-select]").forEach((button) => {
      button.setAttribute("aria-current", String(Number(button.dataset.personaSelect) === persona.personaId));
    });
  }

  function renderPersonaWorkspace(workspace) {
    const personas = (state.overview.personas || []).filter((persona) => persona.lineageId !== 0);
    const canAdd = state.overview.canManage && !state.overview.guild.isDirectMessage;
    const persona = personas.find((entry) => entry.personaId === state.personaId) || personas[0];
    const knowledgeTabs = personaKnowledgeTabs();
    const isKnowledge = (panel) => knowledgeTabs.some(([key]) => key === panel);
    const primaryTabs = [["knowledge", ui("persona_knowledge"), "brain"]];
    if (state.overview.canManage) {
      primaryTabs.push(
        ["settings", ui("persona_settings_tab"), "user-round"],
        ["sprites", ui("sprites"), "palette"],
        ["appearance", ui("persona_appearance_tab"), "image"],
        ["voice", ui("persona_voice_title"), "mic"],
      );
      if (!state.overview.guild.isDirectMessage) primaryTabs.push(["channels", ui("persona_channels"), "radio"]);
    }
    primaryTabs.push(["preferences", state.overview.personaNaming.copy.tab, "sliders-horizontal"]);
    const mountKey = JSON.stringify([canAdd, primaryTabs, knowledgeTabs]);
    const banner = workspace.querySelector("[data-persona-banner]");
    if (!persona || !banner || workspace.dataset.personaMount !== mountKey) {
      mountPersonaPage(workspace, personas, persona, primaryTabs, knowledgeTabs, canAdd);
      workspace.dataset.personaMount = mountKey;
    }
    if (!persona) return;
    state.personaId = persona.personaId;
    if (!isKnowledge(state.personaKnowledgePanel)) state.personaKnowledgePanel = "personal";
    if (!isKnowledge(state.personaPanel) && !primaryTabs.some(([key]) => key === state.personaPanel)) {
      state.personaPanel = "personal";
    }
    const panel = state.personaPanel;
    const knowledgeActive = isKnowledge(panel);
    if (knowledgeActive) state.personaKnowledgePanel = panel;
    const primaryPanel = knowledgeActive ? "knowledge" : panel;
    const stage = workspace.querySelector("[data-persona-stage]");
    const toolbar = stage.querySelector("[data-persona-knowledge-toolbar]");
    const content = stage.querySelector("[data-persona-content]");
    workspace.querySelectorAll("[data-persona-panel]").forEach((button) => {
      const section = button.closest(".dock");
      const selected = button.dataset.personaPanel === (section ? primaryPanel : state.personaKnowledgePanel);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected) button.setAttribute("aria-controls", section ? "persona-stage" : `persona-content-${panel}`);
      else button.removeAttribute("aria-controls");
    });
    toolbar.hidden = !knowledgeActive;
    toolbar.querySelector(".segmented").hidden = !knowledgeActive;
    const stageActions = stage.querySelector("[data-persona-stage-actions]");
    stageActions.hidden = true;
    stageActions.replaceChildren();
    stage.id = "persona-stage";
    stage.setAttribute("aria-labelledby", `persona-tab-${primaryPanel}`);
    content.id = `persona-content-${panel}`;
    if (knowledgeActive) {
      content.setAttribute("role", "tabpanel");
      content.setAttribute("aria-labelledby", `persona-tab-${panel}`);
    } else {
      content.removeAttribute("role");
      content.removeAttribute("aria-labelledby");
    }
    if (knowledgeActive) {
      const segments = toolbar.querySelector(".segmented");
      const active = segments.querySelector('[aria-selected="true"]');
      const left = active.offsetLeft;
      const right = left + active.offsetWidth;
      if (left < segments.scrollLeft) segments.scrollLeft = left;
      else if (right > segments.scrollLeft + segments.clientWidth) segments.scrollLeft = right - segments.clientWidth;
    }
    updatePersonaBanner(workspace, persona, personas);
    const memoryPanel = panel === "personal" || panel === "server";
    if (memoryPanel) {
      state.memoryKind = panel === "server" ? "server" : "personal";
      state.lineageId = persona.lineageId;
    }
    let body;
    switch (panel) {
      case "channels":
        body = '<section id="persona-channel-workspace"></section>';
        break;
      case "lorebook":
        body = '<div id="lorebook-workspace"></div>';
        break;
      case "conditioning":
        body = `<section class="card" data-persona-conditioning>
          ${personaCardHead(ui("persona_conditioning_title"), ui("persona_conditioning_hint"), refreshButton("conditioning", ui("persona_conditioning_refresh")))}
          <div data-conditioning-entries></div>
        </section>`;
        break;
      case "preferences":
        body = renderPersonaNaming(persona);
        break;
      case "settings":
        body = renderPersonaSettings(persona);
        break;
      case "appearance":
        body = renderPersonaAppearance(persona);
        break;
      case "voice":
        body = `<div data-persona-voice-panel><div data-persona-panel-body><section class="card">${personaCardHead(ui("persona_voice_title"), ui("persona_voice_hint"), refreshButton("voice", ui("persona_voice_title")))}${loadingBar(ui("persona_voice_title"))}</section></div></div>`;
        break;
      case "sprites":
        body = `<section id="sprite-workspace">${loadingBar(ui("sprite_loading"))}</section>`;
        break;
      default:
        body = renderMemoryCollection({ personal: panel === "personal", persona });
    }
    content.innerHTML = body;
    const memoryActions = content.querySelector("[data-persona-memory-actions]");
    if (memoryActions) {
      stageActions.append(...memoryActions.children);
      stageActions.hidden = false;
    }
    const previous = stage.dataset.panel;
    stage.dataset.panel = panel;
    if (previous !== panel || stage.dataset.personaId !== String(persona.personaId))
      window.TomoriFX.stagger(
        content.firstElementChild?.matches(".stack, .split") ? content.firstElementChild : content,
      );

    stage.dataset.personaId = persona.personaId;
    if (panel === "channels") {
      renderPersonaChannels(workspace.querySelector("#persona-channel-workspace"), persona);
    } else if (panel === "lorebook") {
      loadLorebooks(persona.lineageId);
    } else if (panel === "conditioning") {
      const host = workspace.querySelector("[data-persona-conditioning]");
      const refresh = () => loadPersonaConditioning(host, persona.personaId);
      host.querySelector("[data-conditioning-refresh]").onclick = refresh;
      void refresh();
    } else if (memoryPanel) {
      loadMemories();
    } else if (panel === "sprites") {
      loadSprites(persona.personaId);
    } else if (panel === "voice") {
      const host = workspace.querySelector("[data-persona-voice-panel]");
      const refresh = () => loadPersonaVoice(host, persona.personaId);
      host.querySelector("[data-voice-refresh]").onclick = refresh;
      void refresh();
    } else {
      resizeAutoGrowTextareas(workspace);
      if (panel === "settings") {
        loadPersonaTextModel(persona.personaId);
        const preset = workspace.querySelector("[data-persona-preset-panel]");
        if (preset) void loadPersonaPreset(preset, persona.personaId);
      }
    }
  }

  function personaChannelSelection(data, personaId) {
    const stored = data.personaChannels.find((entry) => entry.personaId === personaId)?.channelIds || [];
    const available = data.availableChannelIds ?? state.overview.channels.map((channel) => channel.id);
    return new Set(stored.length ? stored.filter((id) => available.includes(id)) : available);
  }

  async function savePersonaChannels(assignments) {
    if (assignments.some((entry) => !entry.channelIds.length)) throw new Error(ui("persona_channel_required"));
    return api(`/guilds/${state.guildId}/channel-settings`, {
      method: "PATCH",
      body: JSON.stringify({ channelIds: [], patch: { personaChannels: assignments } }),
    });
  }

  async function renderPersonaChannels(host, persona) {
    host.innerHTML = loadingBar(ui("channel_loading"));
    try {
      const data = await api(`/guilds/${state.guildId}/channel-settings`);
      if (!host.isConnected) return;
      host.innerHTML = `<div class="split"><form class="card" data-fx="track"><div class="stack">${renderChannelSelector("personaChannels", [...personaChannelSelection(data, persona.personaId)], false, state.overview.channels, { preserveMissing: true })}<p class="notice error" role="alert" hidden></p></div>${cardSaveActions(ui("channel_apply"))}</form><aside class="card">${personaCardHead(ui("persona_channel_behavior"))}<p class="hint">${escapeHtml(ui("persona_channels_hint"))}</p></aside></div>`;
      const form = host.querySelector("form");
      const selected = () => [...form.querySelectorAll('[name="personaChannels"]:checked')].map((input) => input.value);
      const validate = () => {
        const empty = !selected().length;
        form.querySelector('[type="submit"]').disabled = empty;
        form.querySelector('[role="alert"]').hidden = !empty;
        form.querySelector('[role="alert"]').textContent = ui("persona_channel_required");
      };
      form.addEventListener("change", validate);
      form.addEventListener("dashboard:restore", validate);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!selected().length || form.querySelector(editSubmit).hidden) return;
        try {
          await withBusyForm(form, () =>
            savePersonaChannels([{ personaId: persona.personaId, channelIds: selected() }]),
          );
          completeFormSave(form);
          toast(ui("channel_saved"));
        } catch (error) {
          showFormError(form, error);
        }
        validate();
      });
      validate();
      updateChannelCounts(form.querySelector("[data-channel-selector]"));
      enhanceDashboard(host);
    } catch (error) {
      host.innerHTML = `<p class="notice error" role="alert">${escapeHtml(error.message)}</p>`;
    }
  }

  function renderChannelPersonas(host, data, ids) {
    const personas = state.overview.personas;
    const original = new Map(
      personas.map((persona) => {
        const channels = personaChannelSelection(data, persona.personaId);
        return [persona.personaId, ids.filter((id) => channels.has(id)).length];
      }),
    );
    const allowed = personas.filter((persona) => original.get(persona.personaId) === ids.length);
    const allAllowed = allowed.length === personas.length;
    const count =
      allAllowed && allowed.length
        ? ui("persona_all").replace("{count}", String(allowed.length))
        : channelSelectionCount(allowed.length, personas.length);
    const editLabel = escapeHtml(ui("persona_permissions_edit"));
    host.innerHTML = `${personaCardHead(ui("channel_personas"), ui("channel_personas_hint"))}<div class="stack">
      <label class="toggle"><span class="field-label">${escapeHtml(ui("all_personas_allowed"))}</span><input type="checkbox" role="switch"${allAllowed ? " checked" : ""}></label>
      <div class="quickbar">
        ${
          allowed.length
            ? `<div class="quick">${allowed
                .slice(0, 4)
                .map((persona) => {
                  const name = escapeHtml(persona.nickname);
                  return `<span role="img" aria-label="${name}" data-tooltip="${name}">${personaSticker(persona)}</span>`;
                })
                .join("")}</div>`
            : ""
        }
        <button class="button small" type="button" data-channel-personas-edit aria-haspopup="dialog" data-tooltip="${editLabel}">${navigationIcon("layout-grid")}<span>${escapeHtml(count)}</span><span class="sr-only"> ${editLabel}</span></button>
      </div>
    </div>`;
    const open = (all = false) => {
      const dialog = document.createElement("dialog");
      dialog.id = "channel-personas-dialog";
      dialog.className = "collection";
      dialog.setAttribute("aria-labelledby", "channel-personas-title");
      const search = escapeHtml(ui("persona_permissions_search"));
      const cancel = escapeHtml(ui("persona_permissions_cancel"));
      dialog.innerHTML = `<form>
        <header class="collection-head">
          <div class="collection-title">
            <h2 id="channel-personas-title">${editLabel} <small>${personas.length}</small></h2>
            <button class="button icon" type="button" data-channel-personas-close aria-label="${escapeHtml(ui("control_close_dialog"))}">${navigationIcon("x")}</button>
          </div>
          <div class="collection-tools">
            <label class="field"><span class="field-label sr-only">${search}</span><input type="search" data-persona-picker-search placeholder="${search}" autofocus></label>
            <div class="row"><button type="button" class="button small" data-personas-select="all">${escapeHtml(ui("channel_select_all"))}</button><button type="button" class="button small" data-personas-select="none">${escapeHtml(ui("channel_deselect_all"))}</button></div>
          </div>
        </header>
        <div class="collection-body">
          <div class="deck" role="group" aria-label="${escapeHtml(ui("channel_personas"))}">${personas
            .map((persona) => {
              const count = original.get(persona.personaId);
              const pressed = all || count === ids.length ? "true" : count ? "mixed" : "false";
              return `<button class="deck-card" type="button" value="${persona.personaId}" aria-pressed="${pressed}" data-persona-search="${personaPickerSearchText(persona)}">${personaPickerTileContent(persona)}<small data-channel-personas-mixed${pressed === "mixed" ? "" : " hidden"}>${escapeHtml(ui("persona_permissions_mixed"))}</small></button>`;
            })
            .join("")}</div>
          <div class="empty-note" data-persona-picker-empty${personas.length ? " hidden" : ""}><strong>${escapeHtml(ui("persona_picker_no_results"))}</strong></div>
        </div>
        <footer>
          <p class="notice error" role="alert" hidden>${escapeHtml(ui("persona_channel_required"))}</p>
          <div class="actions"><button class="button small" type="button" data-channel-personas-close>${cancel}</button><button class="button small primary" type="submit" data-edit-action data-fx="spark" hidden>${escapeHtml(ui("save"))}</button></div>
        </footer>
      </form>`;
      document.body.append(dialog);
      const form = dialog.querySelector("form");
      const cards = [...form.querySelectorAll(".deck-card")];
      const setPermission = (card, allowed) => {
        card.setAttribute("aria-pressed", String(allowed));
        card.querySelector("[data-channel-personas-mixed]").hidden = true;
      };
      const assignments = () =>
        cards.flatMap((card) => {
          const pressed = card.getAttribute("aria-pressed");
          const personaId = Number(card.value);
          const allowed = pressed === "true";
          if (pressed === "mixed" || original.get(personaId) === (allowed ? ids.length : 0)) return [];
          const channels = personaChannelSelection(data, personaId);
          for (const id of ids) {
            if (allowed) channels.add(id);
            else channels.delete(id);
          }
          return [{ personaId, channelIds: [...channels] }];
        });
      const validate = () => {
        const changes = assignments();
        const invalid = changes.some((entry) => !entry.channelIds.length);
        form.querySelector('[type="submit"]').disabled = invalid || !changes.length;
        setEditActions(form, changes.length > 0);
        form.querySelector('[role="alert"]').hidden = !invalid;
      };
      form.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button || button.disabled) return;
        if (button.hasAttribute("data-channel-personas-close")) return dialog.close();
        if (button.matches(".deck-card")) setPermission(button, button.getAttribute("aria-pressed") !== "true");
        else if (button.dataset.personasSelect) {
          for (const card of cards) {
            if (!card.hidden) setPermission(card, button.dataset.personasSelect === "all");
          }
        } else return;
        validate();
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const changes = assignments();
        if (!changes.length || changes.some((entry) => !entry.channelIds.length)) return;
        try {
          await withBusyForm(form, () => savePersonaChannels(changes));
          const refreshed = await api(`/guilds/${state.guildId}/channel-settings`);
          if (host.isConnected) renderChannelPersonas(host, refreshed, ids);
          dialog.close();
          toast(ui("channel_saved"));
        } catch (error) {
          showFormError(form, error);
        }
      });
      dialog.addEventListener("close", () => dialog.remove());
      validate();
      enhanceDashboard(dialog);
      dialog.showModal();
    };
    host.querySelector("[data-channel-personas-edit]").onclick = () => open();
    host.querySelector("input").onchange = (event) => {
      const all = event.target.checked;
      event.target.checked = allAllowed;
      open(all);
    };
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
      target.innerHTML = `<form class="card" data-fx="track" data-persona-text-model="${personaId}">
        <header class="card-head"><div><h3>${escapeHtml(ui("persona_model_title"))}</h3><p>${escapeHtml(ui("persona_model_hint"))}</p></div></header>
        <label class="field"><span class="field-label">${escapeHtml(ui("persona_model_label"))}</span><select name="modelId"><option value=""${data.selected === null ? " selected" : ""}>${escapeHtml(ui("persona_model_inherit"))}</option>${unavailable}${options}</select></label>
        ${cardSaveActions(ui("persona_model_save"))}
      </form>`;
      enhanceDashboard(target);
      focusSearchDestination();
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

  function renderSpriteTile(sprite) {
    return `<button class="sticker-tile" type="button" data-sprite-edit="${escapeHtml(sprite.key)}" aria-haspopup="dialog">
      ${personaSticker({ nickname: sprite.name, avatarUrl: sprite.imageUrl })}
      <strong>${escapeHtml(sprite.name)}</strong>
      ${sprite.instructions ? `<small>${escapeHtml(sprite.instructions)}</small>` : ""}
    </button>`;
  }

  function renderSpritePreview(url) {
    return url
      ? `<span class="sticker"><img src="${escapeHtml(url)}" alt="" data-sprite-image><span hidden>${escapeHtml(ui("sprite_image_missing"))}</span></span>`
      : `<span class="sticker dashed" aria-hidden="true">${navigationIcon("image")}</span>`;
  }

  function renderSpriteDialog(personaId, sprite, limits) {
    const upload = escapeHtml(ui("sprite_upload_image"));
    return `<dialog class="wide" id="sprite-editor" aria-labelledby="sprite-editor-title">
      <form class="stack" data-sprite-form novalidate data-persona-id="${personaId}"${sprite ? ` data-sprite-key="${escapeHtml(sprite.key)}"` : ""}>
      <header class="panel-header">
        <div class="heading"><h2 id="sprite-editor-title">${escapeHtml(ui(sprite ? "sprite_editor_title" : "sprite_add"))}</h2></div>
        <button class="button icon" type="button" data-sprite-cancel aria-label="${escapeHtml(ui("persona_cancel"))}">${navigationIcon("x")}</button>
      </header>
        <div class="stack">
          <div class="split">
            <div class="stack">
              <label class="field">${fieldLabel(ui("sprite_name"), ui("sprite_name_hint"))}<input name="name" maxlength="${limits.name}" value="${escapeHtml(sprite?.name || "")}" required autofocus></label>
              <label class="field">${fieldLabel(ui("sprite_instructions"), ui("sprite_instructions_hint"))}<textarea name="instructions" maxlength="${limits.instructions}" rows="4">${escapeHtml(sprite?.instructions || "")}</textarea></label>
              <label class="toggle"><span class="field-label"><strong>${escapeHtml(ui("sprite_identity"))}</strong><small>${escapeHtml(ui("sprite_identity_hint"))}</small></span><input type="checkbox" name="identity"${sprite?.identity ? " checked" : ""}></label>
            </div>
            <label class="art-preview media-upload" data-upload-zone>
              <span data-sprite-preview>${renderSpritePreview(sprite?.imageUrl)}</span>
              <span class="media-overlay">${upload}</span>
              <input type="file" name="file" accept="image/png,image/jpeg,image/gif,.png,.jpg,.jpeg,.gif" aria-label="${upload}">
            </label>
          </div>
          <p class="notice error" role="alert" data-sprite-error hidden></p>
        </div>
        <section class="notice warning stack" data-sprite-confirm hidden>
          <strong data-sprite-confirm-title></strong><p data-sprite-confirm-detail></p>
          <div class="actions"><button class="button" type="button" data-sprite-confirm-cancel>${escapeHtml(ui("persona_cancel"))}</button><button class="button" type="button" data-sprite-confirm-accept></button></div>
        </section>
        <footer class="actions" data-sprite-actions>
          ${sprite ? `<button class="button danger hold-button" type="button" data-hold data-sprite-remove data-confirm-title="${escapeHtml(ui("sprite_remove_title"))}" data-confirm-description="${escapeHtml(ui("sprite_remove_detail"))}"><span>${escapeHtml(ui("control_hold_delete"))}</span></button>` : ""}
          <button class="button" type="button" data-sprite-cancel>${escapeHtml(ui("persona_cancel"))}</button>
          <button class="button primary" data-fx="spark" type="submit">${escapeHtml(ui(sprite ? "sprite_edit" : "sprite_add"))}</button>
        </footer>
      </form>
    </dialog>`;
  }

  function openSpriteDialog(trigger) {
    const root = document.querySelector("#sprite-workspace");
    const sprite = root._sprites.find((entry) => entry.key === trigger.dataset.spriteEdit);
    if (trigger.hasAttribute("data-sprite-edit") && !sprite) return;
    root.insertAdjacentHTML("beforeend", renderSpriteDialog(state.personaId, sprite, root._spriteLimits));
    const dialog = root.querySelector("#sprite-editor");
    const form = dialog.querySelector("form");
    form._spriteImageLimit = root._spriteLimits.imageBytes;
    form._spriteImageUrl = sprite?.imageUrl;
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        if (trigger.isConnected) trigger.focus({ preventScroll: true });
      },
      { once: true },
    );
    dialog.addEventListener("cancel", (event) => {
      if (dialog.querySelector("[aria-busy=true]")) event.preventDefault();
      else if (!dialog.querySelector("[data-sprite-confirm]").hidden) {
        event.preventDefault();
        dialog.querySelector("[data-sprite-confirm-cancel]").click();
      }
    });
    enhanceDashboard(dialog);
    dialog.showModal();
  }

  function confirmSpriteAction(form, title, detail, label, danger = false) {
    const panel = form.querySelector("[data-sprite-confirm]");
    const actions = form.querySelector("[data-sprite-actions]");
    const cancel = panel.querySelector("[data-sprite-confirm-cancel]");
    const accept = panel.querySelector("[data-sprite-confirm-accept]");
    form.querySelector("[data-sprite-error]").hidden = true;
    const dialog = form.closest("dialog");
    const trigger = document.activeElement;
    const close = dialog.querySelector("header [data-sprite-cancel]");
    panel.querySelector("[data-sprite-confirm-title]").textContent = title;
    panel.querySelector("[data-sprite-confirm-detail]").textContent = detail;
    accept.textContent = label;
    accept.classList.toggle("danger", danger);
    accept.classList.toggle("primary", !danger);
    const fields = form.querySelector(".split");
    fields.inert = true;
    close.disabled = true;
    actions.hidden = true;
    panel.hidden = false;
    cancel.focus();
    return new Promise((resolve) => {
      const finish = (event) => {
        for (const control of [cancel, accept]) control.removeEventListener("click", finish);
        dialog.removeEventListener("close", finish);
        panel.hidden = true;
        fields.inert = false;
        close.disabled = false;
        actions.hidden = false;
        if (dialog.open) trigger?.focus({ preventScroll: true });
        resolve(event.currentTarget === accept);
      };
      cancel.addEventListener("click", finish);
      accept.addEventListener("click", finish);
      dialog.addEventListener("close", finish, { once: true });
    });
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
      let panel = root.querySelector(":scope > .card");
      if (!panel) {
        panel = document.createElement("section");
        panel.className = "card";
        root.replaceChildren(panel);
      }
      const actions = root.closest(".stage").querySelector("[data-persona-stage-actions]");
      actions.innerHTML = `<button class="button small" type="button" data-sprite-import>${escapeHtml(ui("sprite_import"))}</button><button class="button small" type="button" data-sprite-export${data.sprites.length ? "" : " disabled"}>${escapeHtml(ui("sprite_export"))}</button><button class="button primary" type="button" data-fx="spark" data-sprite-new aria-haspopup="dialog">${navigationIcon("plus")}${escapeHtml(ui("sprite_add"))}</button>`;
      actions.hidden = false;
      actions.parentElement.hidden = false;
      panel.innerHTML = `<header class="card-head"><h3>${escapeHtml(ui("sprites"))}<small>${data.sprites.length} / ${data.limits.count}</small></h3></header>
        <input type="file" accept=".zip,application/zip" data-sprite-archive hidden>
        <div class="stack">
          ${data.inherited ? `<p class="notice info">${escapeHtml(ui("sprite_inherited"))}</p>` : ""}
          ${data.sprites.length ? "" : `<p class="empty-note">${escapeHtml(ui("sprite_empty"))}</p>`}
          <div class="sticker-grid">${data.sprites.map(renderSpriteTile).join("")}
            <button class="sticker-tile" type="button" data-fx="spark" data-sprite-new aria-haspopup="dialog"><span class="sticker dashed" aria-hidden="true">${navigationIcon("plus")}</span><strong>${escapeHtml(ui("sprite_add"))}</strong></button>
          </div>
        </div>`;
      root._sprites = data.sprites;
      root._spriteLimits = data.limits;
      enhanceDashboard(root);
      enhanceDashboard(actions);
      window.TomoriFX.stagger(root.querySelector(".sticker-grid"));
    } catch (error) {
      if (!current()) return;
      document.querySelector("#sprite-workspace").innerHTML =
        `<div class="empty"><strong>${escapeHtml(ui("sprite_load_failed"))}</strong><span>${escapeHtml(error.message)}</span><button class="button secondary" type="button" data-sprite-retry>${escapeHtml(ui("sprite_retry"))}</button></div>`;
    }
  }

  function renderChannelSelector(
    name,
    values = [],
    single = false,
    channels = state.overview.channels,
    { preserveMissing = false, required = false, title = "", hint = "" } = {},
  ) {
    const selected = new Set(values.filter((value) => value != null && value !== "").map(String));
    const allowed = state.overview.allowedChannelIds || [];
    const restricted = state.overview.channelWhitelistActive ?? allowed.length > 0;
    const missing = preserveMissing
      ? [...selected].filter((id) => !channels?.some((channel) => channel.id === id))
      : [];
    const excluded =
      name === "allowedChannels"
        ? []
        : (channels || []).filter((channel) => restricted && !allowed.includes(channel.id));
    channels = (channels || []).filter((channel) => !excluded.includes(channel));
    const groups = new Map();
    for (const channel of channels || []) {
      const key = channel.parentId ?? channel.parentName ?? "";
      if (!groups.has(key)) groups.set(key, { name: channel.parentName || ui("channel_uncategorized"), channels: [] });
      groups.get(key).channels.push(channel);
    }
    const preserved = excluded
      .filter((channel) => selected.has(channel.id))
      .map((channel) => channel.id)
      .concat(missing)
      .map((id) =>
        single && missing.includes(id)
          ? `<label class="channel-choice"><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(id)}" checked data-unavailable-channel><span>${escapeHtml(ui("spotlight_channel_unavailable"))}</span></label>`
          : `<label hidden><input type="${single ? "radio" : "checkbox"}" name="${escapeHtml(name)}" value="${escapeHtml(id)}" checked></label>`,
      )
      .join("");
    const collection = ["settings", "channel-settings"].includes(state.view) || (state.view === "personas" && !single);
    if (collection) {
      const rows = [...groups.values()]
        .map(
          (group) =>
            `<button class="channel-group" type="button" data-channel-group aria-expanded="true">${navigationIcon("chevron-down")}${escapeHtml(group.name)}<span class="n">${escapeHtml(channelSelectionCount(group.channels.filter((channel) => selected.has(String(channel.id))).length, group.channels.length))}</span></button>
        ${group.channels.map((channel) => `<label class="channel" data-channel-search="${escapeHtml([channel.name, channel.topic, group.name].filter(Boolean).join(" ").toLowerCase())}"><span class="hash" aria-hidden="true">#</span><span class="name"><strong>${escapeHtml(channel.name)}</strong>${channel.topic ? `<small>${escapeHtml(channel.topic)}</small>` : ""}</span><input type="${single ? "radio" : "checkbox"}" name="${escapeHtml(name)}" value="${escapeHtml(channel.id)}"${selected.has(String(channel.id)) ? " checked" : ""}${single && required ? " required" : ""}></label>`).join("")}`,
        )
        .join("");
      const search = escapeHtml(ui("channel_search"));
      const controls = single
        ? required
          ? ""
          : `<label class="channel"><span class="hash" aria-hidden="true">#</span><span class="name"><strong>${escapeHtml(ui("channel_none"))}</strong></span><input type="radio" name="${escapeHtml(name)}" value=""${!values[0] ? " checked" : ""}></label>`
        : `<div class="row"><button class="button small" type="button" data-channel-select="all">${escapeHtml(ui("channel_select_all"))}</button><button class="button small" type="button" data-channel-select="none">${escapeHtml(ui("channel_deselect_all"))}</button></div>`;
      const count = channelSelectionCount(
        channels.filter((channel) => selected.has(String(channel.id))).length,
        channels.length,
      );
      const heading =
        title ||
        (state.view === "personas" ? ui(name === "personaChannels" ? "persona_channels" : "memory_channels") : "");
      const total = `<small data-persona-channel-total>${escapeHtml(count)}</small>`;
      const filter = `<label class="field"><span class="field-label sr-only">${search}</span><input type="search" placeholder="${search}" data-channel-filter></label>`;
      const bulkUnderSearch = state.view === "channel-settings" && !single;
      return `<div data-channel-selector>
        <header class="card-head">${heading ? `<div><h3>${escapeHtml(heading)}${total}</h3>${hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ""}</div>` : total}${bulkUnderSearch ? `<div class="stack">${filter}${controls}</div>` : filter}</header>
        <div class="stack">${bulkUnderSearch ? "" : controls}${preserved}<div class="channels">${rows}</div><div data-channel-empty class="empty-note"${rows ? " hidden" : ""}><strong>${escapeHtml(ui("channel_empty"))}</strong></div></div>
      </div>`;
    }
    const rows =
      preserved +
      [...groups.values()]
        .map(
          (group) =>
            `<h3 class="channel-category">${escapeHtml(group.name)}</h3>${group.channels.map((channel) => `<label class="channel-choice" data-channel-search="${escapeHtml(`${channel.name} ${group.name}`.toLowerCase())}"><input type="${single ? "radio" : "checkbox"}" name="${escapeHtml(name)}" value="${escapeHtml(channel.id)}"${selected.has(String(channel.id)) ? " checked" : ""}${single && required ? " required" : ""}><span aria-hidden="true">#</span><span>${escapeHtml(channel.name)}</span></label>`).join("")}`,
        )
        .join("");
    const actions = single
      ? required
        ? ""
        : `<label class="channel-choice"><input type="radio" name="${escapeHtml(name)}" value=""${!values[0] ? " checked" : ""}><span>${escapeHtml(ui("channel_none"))}</span></label>`
      : `<div class="actions channel-selection-actions"><button class="button" type="button" data-channel-select="all">${escapeHtml(ui("channel_select_all"))}</button><button class="button" type="button" data-channel-select="none">${escapeHtml(ui("channel_deselect_all"))}</button></div>`;
    return `<div class="channel-selector stack" data-channel-selector><label class="field"><span class="field-label">${escapeHtml(ui("channel_search"))}</span><input type="search" data-channel-filter></label>${actions}<div class="channel-choices">${rows}<p data-channel-empty class="hint"${rows ? " hidden" : ""}>${escapeHtml(ui("channel_empty"))}</p></div></div>`;
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
    const legacyCooldownLabel = field.key === "cooldown_type" && cooldownLabels[value];
    const savedOption =
      legacyCooldownLabel && !field.options.some((option) => option.value === value)
        ? `<option value="${escapeHtml(value)}" selected disabled hidden>${escapeHtml(ui(legacyCooldownLabel))}</option>`
        : "";
    return (
      savedOption +
      (field.options || [])
        .map(
          (option) =>
            `<option value="${escapeHtml(option.value)}"${String(value) === String(option.value) ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
        )
        .join("")
    );
  }

  function renderSettingField(field, value) {
    if (field.type === "toggle") {
      return `<label class="toggle span-all"><span class="field-label"><strong>${escapeHtml(field.label)}</strong>${field.hint ? `<small>${escapeHtml(field.hint)}</small>` : ""}</span>
        <input name="${escapeHtml(field.key)}" type="checkbox" role="switch"${value ? " checked" : ""}></label>`;
    }
    if (field.type === "textarea") {
      if (field.key === "system_prompt")
        return `<div class="stack span-all"><label class="field">${fieldLabel(field.label, field.hint)}<textarea name="system_prompt" rows="5">${escapeHtml(value ?? "")}</textarea></label><div class="row"><button class="button small" type="button" data-system-prompt-presets aria-haspopup="dialog">${escapeHtml(ui("system_prompt_presets"))}</button></div></div>`;
      return `<label class="field span-all">${fieldLabel(field.label, field.hint)}<textarea name="${escapeHtml(field.key)}" rows="5">${escapeHtml(value ?? "")}</textarea></label>`;
    }
    if (field.type === "channels") {
      return `<fieldset class="stack span-all"><legend>${escapeHtml(field.label)}</legend>${field.hint ? `<p class="hint">${escapeHtml(field.hint)}</p>` : ""}${renderChannelSelector(field.key, Array.isArray(value) ? value : [])}</fieldset>`;
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
      return `<fieldset class="stack span-all" data-setting-field="${escapeHtml(field.key)}"><legend>${escapeHtml(field.label)}</legend>${field.hint ? `<p class="hint">${escapeHtml(field.hint)}</p>` : ""}<div class="${notices ? "stack" : "grid"}">${options}</div></fieldset>`;
    }
    if (field.type === "select" || field.type === "persona") {
      if (["welcome_channel_disc_id", "thought_log_channel_disc_id"].includes(field.key)) {
        return `<fieldset class="stack span-all"><legend>${escapeHtml(field.label)}</legend>${field.hint ? `<p class="hint">${escapeHtml(field.hint)}</p>` : ""}${renderChannelSelector(field.key, [value], true, state.overview.channels, { preserveMissing: true })}</fieldset>`;
      }
      return `<label class="field">${fieldLabel(field.label, field.hint)}<select name="${escapeHtml(field.key)}">${selectOptions(field, value)}</select></label>`;
    }
    if (field.type === "number") {
      const legacyZero = field.key === "cooldown_length" && value === 0;
      const hint = legacyZero ? ui("cooldown_legacy_zero") : field.hint;
      return `<label class="field">${fieldLabel(field.label, hint)}<input name="${escapeHtml(field.key)}" type="number" min="${field.min}" max="${field.max}" step="${field.step || 1}" value="${legacyZero ? "" : formatStoredParameterValue(value)}"${field.nullable || legacyZero ? "" : " required"}></label>`;
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
    const title = panel.titleKey ? ui(panel.titleKey) : primarySection.title;
    const description = panel.descriptionKey ? ui(panel.descriptionKey) : primarySection.description;
    const panelKey = sources
      .map(({ section, fields }) => `${section.id}:${fields.map((field) => field.key).join("+")}`)
      .join("/");
    const attributes = `data-settings-key="${escapeHtml(panelKey)}" data-settings-sections="${sources.map((source) => source.section.id).join(",")}" data-settings-panel-title="${escapeHtml(title)}"`;
    const fields = sources
      .flatMap(({ section, fields }) =>
        fields.map((field) => renderSettingField(field, settings.values[section.id]?.[field.key])),
      )
      .join("");
    return `<form class="card" data-fx="track" ${attributes}>
        ${personaCardHead(title, description)}
        <div class="stack">${fields}</div>
        ${cardSaveActions(ui("save"))}
      </form>`;
  }

  const channelSettingsFields = [
    ["autochat", "autoch_disc_ids"],
    ["channelScope", "private_channel_ids"],
    ["channelScope", "crosschannel_blocklist_ids"],
    ["channelScope", "rp_channel_ids"],
  ];

  const channelExtraFields = ["textModel", "prompt", "contextNote", "cooldown", "autochatPersona"];
  const cooldownLabels = [
    "channel_cooldown_off",
    "channel_cooldown_user",
    "channel_cooldown_channel",
    "channel_cooldown_server",
    "channel_cooldown_strict",
    "cooldown_legacy_category",
  ];
  const channelWorkspaces = new WeakMap();

  function channelHasChanges(form, panel = form) {
    const workspace = channelWorkspaces.get(form);
    if (!workspace?.data) return false;
    return (
      channelSettingsFields.some(([, key]) => {
        if (!panel.querySelector(`[name="${key}"]`)) return false;
        const mode = form.elements[key]?.value;
        return mode !== "keep" && (!workspace.basic || workspace.basic[key] !== (mode === "on"));
      }) || Object.keys(collectChannelOverrides(form)).some((key) => panel.querySelector(`[name="channel_${key}"]`))
    );
  }

  function singleChannelSnapshot(form) {
    return JSON.stringify(
      [
        ...form.querySelectorAll(
          "[data-channel-fields] input, [data-channel-fields] select, [data-channel-fields] textarea",
        ),
      ]
        .filter((input) => !input.disabled && !input.hidden)
        .map((input) => [input.name, input.type === "checkbox" ? input.checked : input.value]),
    );
  }

  function renderChannelOverrides(fields = channelExtraFields) {
    const field = (name, control) => `<label class="field">${fieldLabel(ui(`channel_${name}`))}${control}</label>`;
    const options = (entries) =>
      entries
        .map(([value, label]) => `<option value="${value}">${escapeHtml(ui(`channel_${label}`))}</option>`)
        .join("");
    const controls = {
      textModel: field("textModel", '<select name="channel_model" data-searchable></select>'),
      prompt:
        field(
          "prompt_mode",
          `<select name="channel_prompt_mode">${options([
            ["append", "append"],
            ["replace", "replace"],
          ])}</select>`,
        ) + field("prompt", '<textarea name="channel_prompt_text" rows="5" maxlength="4000"></textarea>'),
      contextNote:
        field("contextNote", '<textarea name="channel_note_text" rows="4" maxlength="2000"></textarea>') +
        field("depth", '<input name="channel_note_depth" type="number" min="0" max="100" value="0">'),
      allowlisted: "",
      cooldown:
        field(
          "cooldown_type",
          `<select name="channel_cooldown_type">${options([
            [0, "cooldown_off"],
            [1, "cooldown_user"],
            [2, "cooldown_channel"],
            [3, "cooldown_server"],
          ])}<option value="4" disabled hidden>${escapeHtml(ui("channel_cooldown_strict"))}</option></select>`,
        ) + field("seconds", '<input name="channel_cooldown_seconds" type="number" min="0" max="86400" value="5">'),
      persona: field("persona", '<select name="channel_persona_id"></select>'),
      autochatPersona: field("autochatPersona", '<select name="channel_autochat_id"></select>'),
    };
    return `${fields
      .map(
        (key) => `<div class="stack" data-channel-override="${key}">
      <label class="field">${fieldLabel(ui(`channel_${key}`), ui(`channel_${key}_hint`))}<select name="channel_${key}" data-channel-mode="${key}">
      <option value="keep">${escapeHtml(ui("channel_keep"))}</option><option value="set">${escapeHtml(ui(key === "allowlisted" || key === "persona" ? "channel_add_allowlist" : "channel_set"))}</option><option value="clear">${escapeHtml(ui(key === "allowlisted" || key === "persona" ? "channel_remove_allowlist" : "channel_reset"))}</option></select></label>
      ${key !== "persona" ? `<label class="toggle" data-channel-single-reset="${key}" hidden><span class="field-label">${escapeHtml(ui("channel_reset"))}</span><input name="channel_reset_${key}" type="checkbox" role="switch"></label>` : ""}
      ${key === "cooldown" ? `<div class="notice" data-channel-cooldown-note hidden><div class="stack"><p>${escapeHtml(ui("channel_cooldown_requires_allowlist"))}</p><div class="row"><button class="button small" type="button" data-channel-tab="allowlist">${escapeHtml(ui("channel_allowlisted"))}</button></div></div></div>` : ""}
      <p class="hint" data-channel-current="${key}"></p><div class="stack" data-channel-inputs="${key}" hidden>${controls[key]}</div>${key === "autochatPersona" ? '<div class="row" data-channel-persona-preview hidden></div>' : ""}</div>`,
      )
      .join("")}`;
  }

  async function loadChannelOverrides(form, ids, update) {
    const key = ids.join(",");
    if (channelWorkspaces.get(form)?.key === key) return;
    const request = { key, data: null };
    channelWorkspaces.set(form, request);
    const status = form.querySelector("[data-channel-load]");
    status.hidden = false;
    status.innerHTML = loadingBar(ui("channel_loading"));
    try {
      const query = new URLSearchParams();
      ids.forEach((id) => {
        query.append("channelId", id);
      });
      const data = await api(`/guilds/${state.guildId}/channel-settings?${query}`);
      if (!form.isConnected || channelWorkspaces.get(form) !== request) return;
      request.data = data;
      renderChannelPersonas(form.querySelector("[data-channel-personas]"), data, ids);
      for (const [name, choices] of [
        ["channel_model", data.models],
        ["channel_autochat_id", data.personas],
      ]) {
        const select = form.elements[name];
        const previous = select.value;
        select.innerHTML =
          `<option value="">${escapeHtml(ui("channel_choose"))}</option>` +
          choices.map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join("");
        select.value = previous;
      }
      const rows = Object.values(data.channels);
      for (const field of channelExtraFields) {
        const values = rows.map((row) => (field === "persona" ? row.personaIds : row[field]));
        const value = values[0];
        const mixed = values.some((entry) => JSON.stringify(entry) !== JSON.stringify(value));
        let summary = ui("channel_default");
        if (mixed) summary = ui("channel_different");
        else if (field === "allowlisted") summary = ui(value ? "channel_on_list" : "channel_not_on_list");
        else if (field === "persona")
          summary =
            (value || []).map((id) => data.personas.find((p) => p.id === id)?.label || id).join(", ") ||
            ui("channel_no_persona_rows");
        else if (value != null)
          summary =
            field === "textModel"
              ? data.models.find((m) => m.id === value)?.label || String(value)
              : field === "autochatPersona"
                ? data.personas.find((p) => p.id === value)?.label || String(value)
                : field === "cooldown"
                  ? `${ui(cooldownLabels[value.type])} · ${value.seconds} ${ui("channel_seconds")}`
                  : value.text;
        form.querySelector(`[data-channel-current="${field}"]`).textContent =
          `${ui("channel_current")}: ${summary.length > 220 ? `${summary.slice(0, 220)}…` : summary}`;
        if (mixed || form.elements[`channel_${field}`].value !== "keep") continue;
        if (field === "textModel") form.elements.channel_model.value = value ?? "";
        if (field === "autochatPersona") form.elements.channel_autochat_id.value = value ?? "";
        if (field === "prompt") {
          form.elements.channel_prompt_text.value = value?.text || "";
          form.elements.channel_prompt_mode.value = value?.mode || "append";
        }
        if (field === "contextNote") {
          form.elements.channel_note_text.value = value?.text || "";
          form.elements.channel_note_depth.value = value?.depth ?? 0;
        }
        if (field === "cooldown") {
          form.elements.channel_cooldown_type.value = value?.type ?? 0;
          form.elements.channel_cooldown_seconds.value = value?.seconds ?? 5;
        }
      }
      status.hidden = true;
      status.textContent = "";
      if (ids.length === 1) {
        request.basic = {};
        for (const [sectionId, field] of channelSettingsFields) {
          request.basic[field] = (state.overview.settings.values[sectionId][field] || []).includes(ids[0]);
          form.elements[field].value = request.basic[field] ? "on" : "off";
        }
        for (const field of channelExtraFields.filter((entry) => entry !== "persona")) {
          const reset = form.querySelector(`[data-channel-single-reset="${field}"] input`);
          reset.checked = rows[0][field] == null;
          form.elements[`channel_${field}`].value = "keep";
        }
      }
      update();
      if (ids.length === 1) {
        request.singleBaseline = singleChannelSnapshot(form);
        formBaselines.set(form, formSnapshot(form));
      } else {
        const modes = new Set([
          ...channelSettingsFields.map(([, key]) => key),
          ...channelExtraFields.map((key) => `channel_${key}`),
        ]);
        formBaselines.set(
          form,
          formSnapshot(form).map((entry) => (modes.has(entry.name) ? { ...entry, value: "keep" } : entry)),
        );
      }
      if (form._pendingPanels) {
        for (const [panel, values] of form._pendingPanels) restoreSnapshot(panel, values);
        delete form._pendingPanels;
      }
      if (!form._channelDraftRestored && drafts.has(form.dataset.draftKey)) {
        restoreSnapshot(form, drafts.get(form.dataset.draftKey));
        form._channelDraftRestored = true;
      }
      form.dispatchEvent(new Event("change", { bubbles: true }));
      enhanceDashboard(form);
    } catch (error) {
      if (channelWorkspaces.get(form) !== request || !form.isConnected) return;
      status.innerHTML = `<p class="notice error" role="alert">${escapeHtml(ui("channel_load_failed"))} ${escapeHtml(error.message)}</p>`;
      channelWorkspaces.delete(form);
    }
  }

  function collectChannelOverrides(form) {
    const patch = {};
    for (const key of channelExtraFields) {
      let mode = form.elements[`channel_${key}`].value;
      const workspace = channelWorkspaces.get(form);
      if (workspace?.singleBaseline && key !== "persona") {
        const row = Object.values(workspace.data.channels)[0];
        const reset = form.querySelector(`[data-channel-single-reset="${key}"] input`).checked;
        if (reset) mode = row[key] == null ? "keep" : "clear";
        else {
          let value;
          if (key === "textModel") value = Number(form.elements.channel_model.value);
          if (key === "autochatPersona") value = Number(form.elements.channel_autochat_id.value);
          if (key === "prompt")
            value = { text: form.elements.channel_prompt_text.value, mode: form.elements.channel_prompt_mode.value };
          if (key === "contextNote")
            value = {
              text: form.elements.channel_note_text.value,
              depth: Number(form.elements.channel_note_depth.value),
            };
          if (key === "cooldown")
            value = {
              type: Number(form.elements.channel_cooldown_type.value),
              seconds: Number(form.elements.channel_cooldown_seconds.value),
            };
          mode = JSON.stringify(value) === JSON.stringify(row[key]) ? "keep" : "set";
        }
      }
      if (mode === "keep") continue;
      if (key === "persona") {
        patch.personaId = Number(form.elements.channel_persona_id.value);
        patch.personaAllowed = mode === "set";
      } else if (key === "allowlisted") patch.allowlisted = mode === "set";
      else if (mode === "clear") patch[key] = null;
      else if (key === "textModel") patch[key] = Number(form.elements.channel_model.value);
      else if (key === "autochatPersona") patch[key] = Number(form.elements.channel_autochat_id.value);
      else if (key === "prompt")
        patch[key] = { text: form.elements.channel_prompt_text.value, mode: form.elements.channel_prompt_mode.value };
      else if (key === "contextNote")
        patch[key] = {
          text: form.elements.channel_note_text.value,
          depth: Number(form.elements.channel_note_depth.value),
        };
      else if (key === "cooldown")
        patch[key] = {
          type: Number(form.elements.channel_cooldown_type.value),
          seconds: Number(form.elements.channel_cooldown_seconds.value),
        };
    }
    return patch;
  }

  let channelTab = "settings";
  let channelRenderRequest = 0;
  async function renderChannelSettings(workspace) {
    if (!state.overview.settings) return renderSettings(workspace);
    if (!workspace.querySelector("[data-channel-stage]")) {
      const title = escapeHtml(ui("channel_settings"));
      workspace.innerHTML = `
        <section class="banner compact" aria-labelledby="channel-settings-title">
          <div class="banner-info"><div class="stack">
            <p class="crumb">${escapeHtml(ui("nav_server_administration"))}<span class="kind">${escapeHtml(ui("settings_managers_only"))}</span></p>
            <h1 id="channel-settings-title" data-fx="split">${title}</h1>
            <p class="banner-text">${escapeHtml(ui("channel_settings_hint"))}</p>
          </div></div>
          <div class="banner-art" aria-hidden="true"><span class="sticker emblem">${navigationIcon("radio")}</span></div>
        </section>
        <nav class="dock" data-fx="indicator" data-overflow role="tablist" aria-label="${title}">
          <button type="button" id="channel-tab-settings" role="tab" aria-controls="channel-settings-stage" data-channel-tab="settings">${navigationIcon("sliders-horizontal")}${title}</button>
          <button type="button" id="channel-tab-allowlist" role="tab" aria-controls="channel-settings-stage" data-channel-tab="allowlist">${navigationIcon("check")}${escapeHtml(ui("channel_allowlisted"))}</button>
        </nav>
        <section id="channel-settings-stage" class="stage" role="tabpanel" data-channel-stage></section>`;
    }
    const stage = workspace.querySelector("[data-channel-stage]");
    workspace.querySelectorAll(".dock [data-channel-tab]").forEach((button) => {
      const selected = button.dataset.channelTab === channelTab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    stage.setAttribute("aria-labelledby", `channel-tab-${channelTab}`);
    const channels = state.overview.channels;
    const guildId = state.guildId;
    const renderRequest = ++channelRenderRequest;
    const current = () =>
      stage.isConnected &&
      state.guildId === guildId &&
      state.view === "channel-settings" &&
      channelRenderRequest === renderRequest;
    stage.innerHTML = loadingBar(ui("channel_loading"));
    let data;
    try {
      data = await api(`/guilds/${guildId}/channel-settings`);
    } catch (error) {
      if (current()) stage.innerHTML = `<div class="notice error" role="alert">${escapeHtml(error.message)}</div>`;
      return;
    }
    if (!current()) return;
    const allowed = data.allowlistedChannelIds;
    if (channelTab === "allowlist") {
      const effectiveAllowed = allowed.length ? allowed : channels.map((channel) => channel.id);
      stage.innerHTML = `<form class="card" data-fx="track" data-channel-allowlist data-settings-key="channel-allowlist">
        <div class="stack">
          ${renderChannelSelector("allowedChannels", effectiveAllowed, false, channels, {
            title: ui("channel_allowlisted"),
            hint: ui("channel_allowlisted_hint"),
          })}
          <p class="notice error" data-channel-required role="alert" hidden>${escapeHtml(ui("channel_required"))}</p>
        </div>
        ${cardSaveActions(ui("save"))}
      </form>`;
      const form = stage.querySelector("[data-channel-allowlist]");
      form._allowed = allowed;
      const notice = form.querySelector("[data-channel-required]");
      const validate = () => {
        const empty = !form.querySelector('[name="allowedChannels"]:checked');
        notice.hidden = !empty;
        form.querySelector('[type="submit"]').disabled = empty;
      };
      form.addEventListener("change", validate);
      form.addEventListener("dashboard:restore", validate);
      validate();
      initDraftForms(stage);
      enhanceDashboard(stage);
      focusSearchDestination();
      return;
    }
    const visibleChannels = allowed.length ? channels.filter((channel) => allowed.includes(channel.id)) : channels;
    stage.innerHTML = `<form class="split" data-channel-settings data-settings-key="channel-settings">
        <section class="card" data-channel-picker>
          ${renderChannelSelector("selectedChannels", [], false, visibleChannels, { title: ui("channel_uncategorized") })}
        </section>
        <div class="col">
          <section class="card">
            <header class="card-head"><div><h3 data-channel-count>${escapeHtml(ui("channel_selected"))}</h3><p class="hint" data-channel-prompt>${escapeHtml(ui("channel_select_hint"))}</p></div></header>
            <div data-channel-load hidden></div>
          </section>
          <div class="stack" data-channel-fields hidden>${[
            ["channel_conversation", ["rp_channel_ids"], ["textModel", "prompt", "cooldown"]],
            ["channel_memory_context", ["private_channel_ids", "crosschannel_blocklist_ids"], ["contextNote"]],
            ["channel_autochat", ["autoch_disc_ids"], ["autochatPersona"]],
          ]
            .map(
              ([title, settings, extras]) =>
                `<section class="card" data-channel-panel>${personaCardHead(ui(title))}
                  <div class="stack">${channelSettingsFields
                    .filter(([, key]) => settings.includes(key))
                    .map(([sectionId, key]) => {
                      const field = state.overview.settings.catalog
                        .find((section) => section.id === sectionId)
                        .fields.find((field) => field.key === key);
                      return `<label class="field">${fieldLabel(field.label, field.hint)}<select name="${key}"><option value="keep">${escapeHtml(ui("channel_disabled"))}</option><option value="on">${escapeHtml(ui("channel_enable"))}</option><option value="off">${escapeHtml(ui("channel_disable"))}</option></select></label>`;
                    })
                    .join("")}${renderChannelOverrides(extras)}</div>
                  ${cardSaveActions(ui("save"), "", false)}
                </section>`,
            )
            .join("")}<section class="card" data-channel-personas></section></div>
        </div>
      </form>`;
    const form = stage.querySelector("[data-channel-settings]");
    const update = () => {
      const selected = [...form.querySelectorAll('[name="selectedChannels"]:checked')].map((input) => input.value);
      const selectionKey = selected.join(",");
      if (form._selectionKey !== undefined && form._selectionKey !== selectionKey) {
        for (const [, key] of channelSettingsFields) form.elements[key].value = "keep";
        for (const key of channelExtraFields) form.elements[`channel_${key}`].value = "keep";
        form._channelDraftRestored = true;
      }
      form._selectionKey = selectionKey;
      const label = form.querySelector("[data-channel-count]");
      label.textContent =
        selected.length === 1
          ? `# ${channels.find((channel) => channel.id === selected[0]).name}`
          : ui("channel_selected");
      if (selected.length > 1) {
        const count = document.createElement("small");
        count.textContent = String(selected.length);
        label.append(count);
      }
      const channelWorkspace = channelWorkspaces.get(form);
      const loaded = channelWorkspace?.key === selectionKey && !!channelWorkspace.data;
      form.querySelector("[data-channel-fields]").hidden = !loaded;
      if (!selected.length) {
        channelWorkspaces.delete(form);
        form.querySelector("[data-channel-load]").hidden = true;
      }
      form.querySelector("[data-channel-prompt]").textContent = ui(
        selected.length === 1
          ? "channel_single_hint"
          : selected.length > 1
            ? "channel_batch_hint"
            : "channel_select_hint",
      );
      for (const [sectionId, key] of channelSettingsFields) {
        const existing = new Set(state.overview.settings.values[sectionId][key] || []);
        const count = selected.filter((id) => existing.has(id)).length;
        form.elements[key].options[0].hidden = selected.length === 1;
        form.elements[key].options[1].textContent = ui(selected.length === 1 ? "channel_on" : "channel_enable");
        form.elements[key].options[2].textContent = ui(selected.length === 1 ? "channel_off" : "channel_disable");
        form.elements[key].options[0].textContent = ui(
          count && count !== selected.length ? "channel_mixed" : count ? "channel_enabled" : "channel_disabled",
        );
      }
      for (const key of channelExtraFields) {
        const mode = form.elements[`channel_${key}`].value;
        const inputs = form.querySelector(`[data-channel-inputs="${key}"]`);
        const single = selected.length === 1 && key !== "persona";
        const reset = form.querySelector(`[data-channel-single-reset="${key}"]`);
        if (reset) reset.hidden = !single;
        form.elements[`channel_${key}`].hidden = single;
        const trigger = form.elements[`channel_${key}`].nextElementSibling;
        if (trigger?.classList.contains("select-trigger")) trigger.hidden = single;
        form.querySelector(`[data-channel-current="${key}"]`).hidden = single;
        inputs.hidden = single
          ? reset.querySelector("input").checked
          : mode !== "set" && !(key === "persona" && mode === "clear");
        if (key === "autochatPersona") {
          const preview = form.querySelector("[data-channel-persona-preview]");
          const personas = state.overview.personas;
          const useDefault = single ? reset.querySelector("input").checked : mode === "clear";
          const persona = useDefault
            ? personas.find((entry) => !entry.isAlter)
            : personas.find((entry) => entry.personaId === Number(form.elements.channel_autochat_id.value));
          preview.hidden = !persona;
          preview.innerHTML = persona
            ? `${personaSticker(persona, "flat")}<strong>${escapeHtml(persona.nickname)}</strong>`
            : "";
        }
        inputs.querySelectorAll("input[name], select[name], textarea[name]").forEach((input) => {
          input.disabled = inputs.hidden;
          input.required = !inputs.hidden;
        });
        if (key === "cooldown") {
          const unavailable = selected.some((id) => !allowed.includes(id));
          form.querySelector("[data-channel-cooldown-note]").hidden = !unavailable;
          form.elements.channel_cooldown.disabled = unavailable;
          if (reset) reset.querySelector("input").disabled = unavailable;
          if (unavailable)
            inputs.querySelectorAll("input[name], select[name], textarea[name]").forEach((input) => {
              input.disabled = true;
            });
        }
      }
      form.querySelectorAll('[type="submit"]').forEach((button) => {
        button.disabled =
          !selected.length || !channelHasChanges(form, button.closest("[data-channel-panel]")) || !loaded;
      });
      if (selected.length) void loadChannelOverrides(form, selected, update);
    };
    form.addEventListener(
      "change",
      async (event) => {
        const next = [...form.querySelectorAll('[name="selectedChannels"]:checked')].map((input) => input.value);
        if (form._selectionKey !== undefined && next.join(",") !== form._selectionKey && channelHasChanges(form)) {
          event.stopImmediatePropagation();
          const previous = new Set(form._selectionKey ? form._selectionKey.split(",") : []);
          form.querySelectorAll('[name="selectedChannels"]').forEach((input) => {
            input.checked = previous.has(input.value);
          });
          updateChannelCounts(form.querySelector("[data-channel-selector]"));
          if (!(await confirmAction(ui("discard_title"), ui("discard_detail")))) return;
          const chosen = new Set(next);
          form.querySelectorAll('[name="selectedChannels"]').forEach((input) => {
            input.checked = chosen.has(input.value);
          });
          drafts.delete(form.dataset.draftKey);
          updateChannelCounts(form.querySelector("[data-channel-selector]"));
          update();
          captureDraft(form);
          return;
        }
        update();
      },
      true,
    );
    form.addEventListener("input", (event) => {
      if (event.target.name !== "selectedChannels") update();
    });
    initDraftForms(stage);
    update();
    enhanceDashboard(stage);
    focusSearchDestination();
  }

  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-channel-filter]")) {
      const selector = event.target.closest("[data-channel-selector]");
      const query = event.target.value.trim().toLowerCase();
      const groups = selector.querySelectorAll("[data-channel-group]");
      if (groups.length) {
        let matches = false;
        for (const heading of groups) {
          filterChannelGroup(heading, query, Boolean(query) || !heading.hasAttribute("data-channel-collapsed"));
          matches ||= !heading.hidden;
        }
        selector.querySelector("[data-channel-empty]").hidden = matches;
        return;
      }
      selector.querySelectorAll("[data-channel-search]").forEach((row) => {
        row.hidden = !row.dataset.channelSearch.includes(query);
      });
      selector.querySelectorAll(".channel-category").forEach((heading) => {
        let row = heading.nextElementSibling;
        let visible = false;
        while (row?.matches(".channel-choice")) {
          visible ||= !row.hidden;
          row = row.nextElementSibling;
        }
        heading.hidden = !visible;
      });
      selector.querySelector("[data-channel-empty]").hidden = !!selector.querySelector(
        "[data-channel-search]:not([hidden])",
      );
    }
  });

  document.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-channel-tab]");
    if (tab) {
      if (savingForms) {
        toast(ui("saving"));
        return;
      }
      if (channelTab === tab.dataset.channelTab) return;
      channelTab = tab.dataset.channelTab;
      const workspace = tab.closest("[data-dashboard-view]");
      void renderChannelSettings(workspace);
      workspace.querySelector(`#channel-tab-${channelTab}`)?.focus({ preventScroll: true });
      return;
    }
    const category = event.target.closest("[data-channel-group]");
    if (category) {
      const expanded = category.getAttribute("aria-expanded") !== "true";
      const query = category
        .closest("[data-channel-selector]")
        .querySelector("[data-channel-filter]")
        .value.trim()
        .toLowerCase();
      category.toggleAttribute("data-channel-collapsed", !expanded);
      filterChannelGroup(category, query, expanded);
    }
    const button = event.target.closest("[data-channel-select]");
    if (button) {
      const selector = button.closest("[data-channel-selector]");
      selector.querySelectorAll("[data-channel-search]:not([hidden]) input").forEach((input) => {
        if (input.closest(".channels") && input.closest("[hidden]")) return;
        input.checked = button.dataset.channelSelect === "all";
      });
      selector.dispatchEvent(new Event("change", { bubbles: true }));
      selector.closest("form[data-fx='track']")?.dispatchEvent(new Event("input"));
      updateChannelCounts(selector);
    }
  });

  function channelGroupRows(heading) {
    const rows = [];
    for (let row = heading.nextElementSibling; row?.hasAttribute("data-channel-search"); row = row.nextElementSibling) {
      rows.push(row);
    }
    return rows;
  }

  function filterChannelGroup(heading, query, expanded) {
    let hasMatch = false;
    for (const row of channelGroupRows(heading)) {
      const matches = row.dataset.channelSearch.includes(query);
      hasMatch ||= matches;
      row.hidden = !matches || !expanded;
    }
    heading.hidden = !hasMatch;
    heading.setAttribute("aria-expanded", String(expanded));
  }

  function channelSelectionCount(selected, total) {
    return ui("persona_channel_count").replace("{selected}", String(selected)).replace("{total}", String(total));
  }

  function updateChannelCounts(selector) {
    const total = selector?.querySelector("[data-persona-channel-total]");
    if (total) {
      const inputs = [...selector.querySelectorAll("[data-channel-search] input")];
      total.textContent = channelSelectionCount(inputs.filter((input) => input.checked).length, inputs.length);
    }
    selector?.querySelectorAll("[data-channel-group]").forEach((heading) => {
      const rows = channelGroupRows(heading);
      heading.querySelector(".n").textContent = channelSelectionCount(
        rows.filter((row) => row.querySelector("input").checked).length,
        rows.length,
      );
    });
  }

  function renderSettings(workspace) {
    if (!state.overview.settings) {
      workspace.innerHTML = `<section class="card"><div class="empty-note"><strong>${escapeHtml(ui("settings_manage_required"))}</strong></div></section>`;
      return;
    }
    if (!workspace.querySelector("[data-server-settings-content]")) {
      const title = escapeHtml(ui("nav_server_settings"));
      workspace.innerHTML = `
        <section class="banner compact" aria-labelledby="server-settings-title">
          <div class="banner-info"><div class="stack" data-settings-summary>
            <p class="crumb">${escapeHtml(ui("nav_server_administration"))}<span class="kind">${escapeHtml(ui("settings_managers_only"))}</span></p>
            <h1 id="server-settings-title" data-fx="split">${title}</h1>
            <p class="banner-text">${escapeHtml(ui("settings_banner_hint").replace("{server}", () => state.overview.guild.name))}</p>
          </div></div>
          <div class="banner-art" aria-hidden="true"><span class="sticker emblem">${navigationIcon("sliders-horizontal")}</span></div>
        </section>
        <nav class="dock" data-fx="indicator" data-overflow role="tablist" aria-label="${title}">
          ${settingsGroups.map((group) => `<button type="button" id="server-settings-${group.id}" role="tab" aria-controls="server-settings-stage" data-settings-group="${group.id}">${navigationIcon(group.icon)}${escapeHtml(ui(group.labelKey))}</button>`).join("")}
        </nav>
        <section id="server-settings-stage" class="stage" role="tabpanel">
          <div class="toolbar"><div class="actions">
            <button class="button icon" type="button" data-overview-refresh aria-label="${escapeHtml(ui("refresh_all"))}">${navigationIcon("refresh-cw")}</button>
          </div></div>
          <div class="card-columns" data-server-settings-content></div>
        </section>`;
    }
    const activeGroup = settingsGroups.find((group) => group.id === state.settingsGroup) || settingsGroups[0];
    workspace.querySelectorAll("[data-settings-group]").forEach((button) => {
      const selected = button.dataset.settingsGroup === activeGroup.id;
      if (button.getAttribute("aria-selected") !== String(selected))
        button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    workspace
      .querySelector("#server-settings-stage")
      .setAttribute("aria-labelledby", `server-settings-${activeGroup.id}`);
    const content = workspace.querySelector("[data-server-settings-content]");
    content.innerHTML = `
      ${activeGroup.panels.map((panel) => renderSettingsPanel(panel)).join("")}
      ${activeGroup.id === "conversation" ? '<div id="response-drafting-workspace" class="card"></div>' : ""}
      ${activeGroup.id === "models" ? renderLogitBiasPanel() : ""}
      ${activeGroup.id === "memory" ? renderStmCategories() : ""}
      ${activeGroup.id === "media" ? '<section class="card" id="tool-phrase-panel"></section>' : ""}
      ${activeGroup.id === "channels" && !state.overview.guild.isDirectMessage ? '<section class="card" id="random-schedule-panel"></section>' : ""}`;
    initDraftForms(content);
    enhanceDashboard(content);
    window.TomoriFX.stagger(content);
    resizeAutoGrowTextareas(content);
    const draftingHost = content.querySelector("#response-drafting-workspace");
    if (draftingHost) void loadDraftingPanel(draftingHost);
    const toolHost = content.querySelector("#tool-phrase-panel");
    if (toolHost) void loadToolPhrasePanel(toolHost);
    const scheduleHost = content.querySelector("#random-schedule-panel");
    if (scheduleHost) void loadRandomSchedulePanel(scheduleHost);
  }

  async function openSystemPromptPresets(button) {
    const prompt = button.closest("form").elements.system_prompt;
    const { dialog, form, fields, save } = openDashboardEditor(
      button,
      "system_prompt_presets",
      true,
      "system_prompt_label",
    );
    try {
      const { locked, presets } = await api(`/guilds/${state.guildId}/settings/system-prompt-presets`);
      if (!dialog.open) return;
      if (locked) {
        fields.textContent = ui("system_prompt_locked");
        return;
      }
      fields.innerHTML = `<label class="field">${fieldLabel(ui("system_prompt_preset"))}<select name="preset"><option value="">${escapeHtml(ui("system_prompt_default"))}</option>${presets.map(({ id, name }) => `<option value="${id}">${escapeHtml(name)}</option>`).join("")}</select></label><label class="field" data-preset-preview hidden>${fieldLabel(ui("system_prompt_preview"))}<textarea rows="10" readonly></textarea></label>`;
      const preview = fields.querySelector("[data-preset-preview]");
      const selected = () => presets.find(({ id }) => String(id) === form.elements.preset.value);
      form.elements.preset.onchange = () => {
        const entry = selected();
        preview.hidden = !entry;
        preview.querySelector("textarea").value = entry?.text ?? "";
      };
      save.textContent = ui("system_prompt_use_preset");
      save.hidden = false;
      form.onsubmit = (event) => {
        event.preventDefault();
        if (prompt.isConnected) {
          prompt.value = selected()?.text ?? "";
          prompt.dispatchEvent(new Event("input", { bubbles: true }));
          resizeAutoGrowTextareas(prompt.closest("form"));
        }
        dialog.close();
      };
      enhanceDashboard(dialog);
    } catch (error) {
      if (dialog.open) fields.textContent = error.message;
    }
  }

  async function loadToolPhrasePanel(host) {
    const path = `/guilds/${state.guildId}/settings/tool-triggers`;
    const header = personaCardHead(ui("tool_phrases"), ui("tool_phrases_hint"));
    host.innerHTML = header + loadingBar(ui("tool_phrases"));
    try {
      let { targets } = await api(path);
      if (!host.isConnected) return;
      let selected = (targets.find(({ entries }) => entries.length) ?? targets[0]).target;
      const render = () => {
        const { entries } = targets.find(({ target }) => target === selected);
        host.innerHTML = `${header}<div class="stack"><form class="stack"><label class="field">${fieldLabel(ui("tool_phrase_target"))}<select name="target">${targets.map(({ target, label }) => `<option value="${escapeHtml(target)}"${target === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
          <label class="field">${fieldLabel(ui("tool_phrase_literal"))}<input name="phrase" maxlength="40" required></label>
          <div class="actions" data-form-actions><button class="button small primary" type="submit" data-fx="spark">${escapeHtml(ui("tool_phrase_add"))}</button></div></form>
          ${entries.length ? `<div class="rows">${entries.map(({ kind, value }, index) => `<div class="item"><div><strong dir="auto">${escapeHtml(value)}</strong>${kind === "regex" ? `<div class="item-meta">${escapeHtml(ui("tool_phrase_regex"))}</div>` : ""}</div><div class="item-actions"><button class="button small icon danger" type="button" data-phrase-remove="${index}" aria-label="${escapeHtml(ui("tool_phrase_remove"))}" data-tooltip="${escapeHtml(ui("tool_phrase_remove"))}">${navigationIcon("trash-2")}</button></div></div>`).join("")}</div>` : `<p class="hint">${escapeHtml(ui("tool_phrase_empty"))}</p>`}</div>`;
        const form = host.querySelector("form");
        form.elements.target.onchange = () => {
          const phrase = form.elements.phrase.value;
          selected = form.elements.target.value;
          render();
          host.querySelector('[name="phrase"]').value = phrase;
          host.querySelector('[name="phrase"]').focus();
        };
        const update = async (patch) => {
          try {
            const result = await withBusyForm(host, () =>
              api(path, { method: "PATCH", body: JSON.stringify({ ...patch, target: selected }) }),
            );
            if (!host.isConnected || !result) return;
            targets = result.targets;
            render();
            host.querySelector('[name="phrase"]').focus({ preventScroll: true });
            toast(ui("tool_phrase_saved"));
          } catch (error) {
            if (host.isConnected) showFormError(form, error);
          }
        };
        form.onsubmit = (event) => {
          event.preventDefault();
          void update({ action: "add", value: form.elements.phrase.value });
        };
        host.querySelectorAll("[data-phrase-remove]").forEach((button) => {
          button.onclick = () => update({ action: "remove", ...entries[Number(button.dataset.phraseRemove)] });
        });
        enhanceDashboard(host);
      };
      render();
    } catch (error) {
      if (host.isConnected)
        host.innerHTML = `${header}<p class="notice error" role="alert">${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadRandomSchedulePanel(host) {
    const guildId = state.guildId;
    const path = `/guilds/${guildId}/settings/random-triggers`;
    const header = (actions = "") => personaCardHead(ui("random_schedules"), ui("random_schedules_hint"), actions);
    host.innerHTML = header() + loadingBar(ui("random_schedules"));
    try {
      const { channels, triggers } = await api(path);
      if (!host.isConnected) return;
      const allowed = state.overview.allowedChannelIds || [];
      const restricted = state.overview.channelWhitelistActive ?? allowed.length > 0;
      const candidates = channels.filter(({ id }) => !restricted || allowed.includes(id));
      const personas = state.overview.personas;
      const channelName = (id) => channels.find((channel) => channel.id === id)?.name;
      const personaName = (id) =>
        id == null ? ui("random_schedule_any_persona") : personas.find(({ personaId }) => personaId === id)?.nickname;
      host.innerHTML =
        header(
          candidates.length
            ? `<button class="button small" type="button" data-random-schedule-add aria-haspopup="dialog">${escapeHtml(ui("random_schedule_add"))}</button>`
            : "",
        ) +
        (triggers.length
          ? `<div class="rows">${triggers.map((entry, index) => `<div class="item"><div><strong>#${escapeHtml(channelName(entry.channel_disc_id))}</strong><div class="item-meta"><span>${escapeHtml(personaName(entry.persona_id))}</span><span>${escapeHtml(ui("random_schedule_next"))} <time datetime="${escapeHtml(entry.next_trigger_at)}">${escapeHtml(new Date(entry.next_trigger_at).toLocaleString())}</time></span></div></div><div class="item-actions"><button class="button small" type="button" data-schedule-edit="${index}" aria-haspopup="dialog">${escapeHtml(ui("random_schedule_edit"))}</button><button class="button small icon danger" type="button" data-schedule-remove="${index}" aria-label="${escapeHtml(ui("random_schedule_remove"))}" data-tooltip="${escapeHtml(ui("random_schedule_remove"))}">${navigationIcon("trash-2")}</button></div></div>`).join("")}</div>`
          : `<p class="hint">${escapeHtml(ui("random_schedule_empty"))}</p>`);
      const openEditor = (button, entry) =>
        openRandomScheduleEditor(button, host, path, candidates, personas, entry, channelName, personaName);
      const add = host.querySelector("[data-random-schedule-add]");
      if (add) add.onclick = () => openEditor(add);
      host.querySelectorAll("[data-schedule-edit]").forEach((button) => {
        button.onclick = () => openEditor(button, triggers[Number(button.dataset.scheduleEdit)]);
      });
      host.querySelectorAll("[data-schedule-remove]").forEach((button) => {
        button.onclick = async () => {
          const entry = triggers[Number(button.dataset.scheduleRemove)];
          if (
            !(await confirmAction(ui("random_schedule_remove"), ui("random_schedule_remove_hint"))) ||
            !host.isConnected ||
            guildId !== state.guildId
          )
            return;
          try {
            await withBusyForm(host, () => api(`${path}/${entry.trigger_id}`, { method: "DELETE" }));
            toast(ui("random_schedule_removed"));
            if (host.isConnected) await loadRandomSchedulePanel(host);
          } catch (error) {
            toast(error.message, "error");
          }
        };
      });
      enhanceDashboard(host);
    } catch (error) {
      if (host.isConnected)
        host.innerHTML = `${header()}<p class="notice error" role="alert">${escapeHtml(error.message)}</p>`;
    }
  }

  function openRandomScheduleEditor(button, host, path, channels, personas, entry, channelName, personaName) {
    const { dialog, form, fields, save } = openDashboardEditor(
      button,
      entry ? "random_schedule_edit" : "random_schedule_add",
      true,
      "random_schedules",
    );
    const maxScheduleValue = 2_147_483_647;
    const number = (name, label, value, min, max, required = false) =>
      `<label class="field">${fieldLabel(ui(label))}<input name="${name}" type="number" min="${min}" max="${max}" value="${value ?? ""}"${required ? " required" : ""}></label>`;
    fields.innerHTML = `${entry ? `<p>#${escapeHtml(channelName(entry.channel_disc_id))} / ${escapeHtml(personaName(entry.persona_id))}</p><p class="hint">${escapeHtml(ui("random_schedule_edit_hint"))}</p>` : `<fieldset class="stack"><legend>${escapeHtml(ui("random_schedule_choose_channel"))}</legend>${renderChannelSelector("channelDiscId", [], true, channels, { required: true })}</fieldset><label class="field">${fieldLabel(ui("random_schedule_persona"))}<select name="personaId" data-searchable><option value="">${escapeHtml(ui("random_schedule_any_persona"))}</option>${personas.map(({ personaId, nickname }) => `<option value="${personaId}">${escapeHtml(nickname)}</option>`).join("")}</select></label>`}
      <div class="grid">${number("timerHours", "random_schedule_interval", entry?.timer_hours ?? 24, 1, maxScheduleValue, true)}${number("chancePercent", "random_schedule_chance", entry?.chance_percent ?? 100, 1, 100, true)}${number("randomOffsetRange", "random_schedule_jitter", entry?.random_offset_range, 0, maxScheduleValue)}${number("silenceThresholdHours", "random_schedule_silence", entry?.silence_threshold_hours, 1, maxScheduleValue)}${number("failureThreshold", "random_schedule_failures", entry?.failure_threshold, 1, maxScheduleValue)}</div>
      <label class="toggle">${fieldLabel(ui("random_schedule_respond_self"))}<input type="checkbox" role="switch" name="respondToSelf"${entry?.respond_to_self ? " checked" : ""}></label>
      <label class="field">${fieldLabel(ui("random_schedule_prompt"), ui("random_schedule_prompt_hint"))}<textarea name="customPrompt" maxlength="1000" rows="4">${escapeHtml(entry?.custom_prompt ?? "")}</textarea></label>`;
    save.hidden = false;
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!host.isConnected || form.classList.contains("is-saving")) return;
      const values = new FormData(form);
      const nullableNumber = (key) => (values.get(key) ? Number(values.get(key)) : null);
      const payload = {
        channelDiscId: entry?.channel_disc_id ?? values.get("channelDiscId"),
        personaId: entry ? (entry.persona_id ?? null) : nullableNumber("personaId"),
        timerHours: Number(values.get("timerHours")),
        chancePercent: Number(values.get("chancePercent")),
        randomOffsetRange: nullableNumber("randomOffsetRange"),
        silenceThresholdHours: nullableNumber("silenceThresholdHours"),
        failureThreshold: nullableNumber("failureThreshold"),
        respondToSelf: values.has("respondToSelf"),
        customPrompt: values.get("customPrompt") || null,
      };
      try {
        await withBusyForm(form, () =>
          api(entry ? `${path}/${entry.trigger_id}` : path, {
            method: entry ? "PATCH" : "POST",
            body: JSON.stringify(payload),
          }),
        );
        dialog.close();
        toast(ui("random_schedule_saved"));
        if (host.isConnected) await loadRandomSchedulePanel(host);
      } catch (error) {
        if (dialog.open) showFormError(form, error);
      }
    };
    enhanceDashboard(dialog);
  }

  function renderLogitBiasPanel() {
    const bias = state.overview.settings.logitBias;
    if (!bias) return "";
    return `<section class="card" id="logit-bias-panel">
      ${personaCardHead(ui("logit_bias"), ui("logit_bias_hint"), `<div class="actions"><button class="button small" type="button" data-logit-open="import" aria-haspopup="dialog">${escapeHtml(ui("logit_import"))}</button><button class="button small primary" type="button" data-logit-open="add" aria-haspopup="dialog">${navigationIcon("plus")}${escapeHtml(ui("logit_add"))}</button></div>`)}
      <div data-logit-list>${renderLogitBiasList(bias.entries)}</div>
    </section>`;
  }

  function renderLogitBiasList(entries) {
    if (!entries.length) return `<p class="hint">${escapeHtml(ui("logit_empty"))}</p>`;
    return `<div class="table-wrap"><table><thead><tr><th scope="col">${escapeHtml(ui("logit_term"))}</th><th scope="col">${escapeHtml(ui("logit_value"))}</th><th scope="col"></th></tr></thead><tbody>${entries
      .map(
        (entry) =>
          `<tr><td>${escapeHtml(entry.text)}${entry.kind === "token_id" ? ` <small class="hint">${escapeHtml(ui("logit_token_id"))}</small>` : ""}</td>
        <td class="num">${entry.value > 0 ? "+" : ""}${escapeHtml(entry.value)}</td><td class="num"><button class="button small icon danger" type="button"
        data-logit-remove="${escapeHtml(entry.id)}" aria-label="${escapeHtml(`${ui("logit_remove")}: ${entry.text}`)}" data-tooltip="${escapeHtml(ui("logit_remove"))}">${navigationIcon("trash-2")}</button></td></tr>`,
      )
      .join("")}</tbody></table></div>`;
  }

  function updateLogitBiasList(panel, entries) {
    if (!panel.isConnected) return;
    state.overview.settings.logitBias.entries = entries;
    panel.querySelector("[data-logit-list]").innerHTML = renderLogitBiasList(entries);
  }

  function openLogitBiasEditor(panel, mode) {
    const importing = mode === "import";
    const title = ui(importing ? "logit_import" : "logit_add");
    const path = `/guilds/${state.guildId}/settings/logit-bias`;
    const dialog = document.createElement("dialog");
    dialog.className = "dialog";
    dialog.setAttribute("aria-labelledby", "logit-dialog-title");
    dialog.innerHTML = `<form class="stack">
      <header class="panel-header"><div class="heading"><h2 id="logit-dialog-title">${escapeHtml(title)}</h2></div></header>
      ${
        importing
          ? `<label class="field">${fieldLabel(ui("logit_import_file"), ui("logit_import_hint"))}<input type="file" name="file" accept=".json,application/json" required></label>`
          : `<label class="field">${fieldLabel(ui("logit_terms"), ui("logit_terms_hint"))}<input name="terms" type="text" maxlength="4000" required></label>
          <label class="field">${fieldLabel(ui("logit_value"), ui("logit_value_hint"))}<input name="bias" type="number" min="-100" max="100" step="any" required></label>`
      }
      <footer class="actions form-actions"><button type="button" class="button" data-logit-close>${escapeHtml(ui("endpoint_cancel"))}</button><button class="button primary" type="submit">${escapeHtml(importing ? title : ui("save"))}</button></footer>
    </form>`;
    document.body.append(dialog);
    const form = dialog.querySelector("form");
    form.querySelector("[data-logit-close]").onclick = () => dialog.close();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.classList.contains("is-saving")) return;
      try {
        const { entries } = await withBusyForm(form, async () => {
          let body;
          if (importing) {
            const file = form.elements.file.files[0];
            if (!file || file.size > state.overview.settings.logitBias.maxImportBytes)
              throw new Error(ui("logit_import_invalid"));
            try {
              body = { action: "import", payload: JSON.parse(await file.text()) };
            } catch {
              throw new Error(ui("logit_import_invalid"));
            }
          } else {
            body = { action: "add", terms: form.elements.terms.value, bias: form.elements.bias.value };
          }
          return api(path, { method: "POST", body: JSON.stringify(body) });
        });
        updateLogitBiasList(panel, entries);
        dialog.close();
        toast(ui("logit_saved"));
      } catch (error) {
        showFormError(form, error);
      }
    });
    dialog.addEventListener("cancel", (event) => {
      if (form.classList.contains("is-saving")) event.preventDefault();
    });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
    enhanceDashboard(dialog);
  }

  async function deleteLogitBias(button) {
    const panel = button.closest("#logit-bias-panel");
    if (!panel || panel.classList.contains("is-saving")) return;
    if (!(await confirmAction(ui("logit_remove_title"), ui("logit_remove_hint")))) return;
    if (!panel.isConnected || panel.classList.contains("is-saving")) return;
    try {
      const { entries } = await withBusyForm(panel, () =>
        api(`/guilds/${state.guildId}/settings/logit-bias/${encodeURIComponent(button.dataset.logitRemove)}`, {
          method: "DELETE",
        }),
      );
      updateLogitBiasList(panel, entries);
      panel.querySelector('[data-logit-open="add"]')?.focus({ preventScroll: true });
      toast(ui("logit_removed"));
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderDraftingPanel(data) {
    const reviewer = data?.reviewer ? JSON.stringify(data.reviewer) : "";
    const checker = data?.checker ? JSON.stringify(data.checker) : "";
    const reviewerGroups = (data?.reviewers || [])
      .map(({ provider, label, models }) => {
        const options = models.map(({ id, name }) => {
          const value = JSON.stringify({ id, provider });
          return `<option value="${escapeHtml(value)}"${reviewer === value ? " selected" : ""}>${escapeHtml(`${label} / ${name}`)}</option>`;
        });
        return `<optgroup label="${escapeHtml(label)}">${options.join("")}</optgroup>`;
      })
      .join("");
    const checkerOptions = (data?.checkers || [])
      .map(({ reference, label }) => {
        const value = JSON.stringify(reference);
        return `<option value="${escapeHtml(value)}"${checker === value ? " selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
    const unavailable = (value) =>
      `<option value="${escapeHtml(value)}" selected>${escapeHtml(ui("drafting_unavailable"))}</option>`;
    const defaultLabel = data ? `${ui("drafting_default")} (${data.defaultModel})` : ui("drafting_default");
    return `<form data-fx="track" data-drafting-selections data-settings-key="response-drafting">
      ${personaCardHead(ui("drafting_title"), ui("drafting_hint"))}
      <div class="stack">
      <label class="field">${fieldLabel(ui("drafting_reviewer"), data && !data.defaultModelAvailable ? ui("drafting_default_unavailable") : "")}
        <select name="reviewer" data-searchable><option value="">${escapeHtml(defaultLabel)}</option>
        ${data?.reviewer?.provider === null ? unavailable(reviewer) : ""}${reviewerGroups}</select>
      </label>
      <label class="field">${fieldLabel(ui("drafting_checker"), ui("drafting_checker_hint"))}
        <select name="checker" data-searchable><option value="">${escapeHtml(ui("drafting_checker_none"))}</option>
        ${checker && !data.checkers.some(({ reference }) => JSON.stringify(reference) === checker) ? unavailable(checker) : ""}${checkerOptions}</select>
      </label>
      </div>
      ${cardSaveActions(ui("save"))}
    </form>`;
  }

  async function loadDraftingPanel(host) {
    host.innerHTML = loadingBar(ui("drafting_title"));
    try {
      const data = await api(`/guilds/${state.guildId}/settings/response-drafting`);
      if (!host.isConnected) return;
      host.innerHTML = renderDraftingPanel(data);
      initDraftForms(host);
      enhanceDashboard(host);
      focusSearchDestination();
    } catch {
      if (!host.isConnected) return;
      host.innerHTML = `${personaCardHead(ui("drafting_title"), "", `<div class="actions">${refreshButton("drafting", ui("drafting_title"))}</div>`)}<p class="notice error" role="alert">${escapeHtml(ui("drafting_load_failed"))}</p>`;
    }
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

  function renderEndpointRows(data, scope) {
    if (!data.endpoints?.length) return '<p class="hint">No custom endpoints.</p>';
    const collection = scope === "server";
    const rows = data.endpoints
      .map((endpoint) => {
        const label = escapeHtml(endpoint.modelName || endpoint.displayName);
        const route = `${escapeHtml(endpoint.capability)} / ${escapeHtml(endpoint.apiStyle)}`;
        const url = escapeHtml(endpoint.endpointUrl);
        const editable =
          endpoint.id &&
          endpoint.capability !== "transcription" &&
          (endpoint.capability === "text" || endpoint.capability === "speech" || endpoint.modelRefId);
        const edit = editable
          ? `<button class="button${collection ? " small" : ""}" type="button" data-endpoint-model-edit="${endpoint.id}" data-endpoint-connection="${endpoint.connectionId}" data-provider-scope="${scope}" aria-haspopup="dialog">${escapeHtml(ui("endpoint_model_edit"))}</button>`
          : "";
        const features = [
          endpoint.requiresAuth && "Auth",
          endpoint.hasTools && "Tools",
          endpoint.seesImages && "Vision",
          endpoint.supportsStructOutput && "Structured output",
        ].filter(Boolean);
        if (collection)
          return `<article class="item">
        <div class="stack">
          <div><strong>${label}</strong><div class="item-meta"><span>${route}</span></div><small>${url}</small></div>
          ${features.length ? `<div class="chips">${features.map((feature) => `<span class="chip">${feature}</span>`).join("")}</div>` : ""}
        </div>
        ${edit ? `<div class="item-actions">${edit}</div>` : ""}
      </article>`;
        return `<article class="subsection">
        <div class="row"><div class="heading"><p class="eyebrow">${route}</p><h3>${label}</h3><small>${url}</small></div>${edit}</div>
        <div class="row">${features.map((feature) => `<span>${feature}</span>`).join("")}</div>
      </article>`;
      })
      .join("");
    return collection ? `<div class="rows">${rows}</div>` : rows;
  }

  function renderOpenRouterRows(data, scope) {
    if (!data.openRouterModels?.length) {
      return `<p class="hint">${escapeHtml(ui("connection_no_models"))}</p>`;
    }
    const collection = scope === "server";
    const rows = data.openRouterModels
      .map((model) => {
        const remove =
          model.capability === "transcription"
            ? ""
            : `<button class="button${collection ? " small" : ""} danger" type="button" data-openrouter-delete="${escapeHtml(model.codename)}" data-openrouter-capability="${escapeHtml(model.capability)}" data-provider-scope="${scope}" data-tooltip="${escapeHtml(ui("connection_remove_registration_hint"))}">${escapeHtml(ui("connection_remove_registration"))}</button>`;
        if (collection)
          return `<article class="item"><div><strong>${escapeHtml(model.codename)}</strong><div class="item-meta"><span>${escapeHtml(model.capability)}</span></div></div>${remove ? `<div class="item-actions">${remove}</div>` : ""}</article>`;
        return `<article class="panel-header"><div class="heading"><span class="eyebrow">${escapeHtml(model.capability)}</span><h3>${escapeHtml(model.codename)}</h3></div>${remove ? `<div class="actions">${remove}</div>` : ""}</article>`;
      })
      .join("");
    return collection ? `<div class="rows">${rows}</div>` : rows;
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
    const transcription = workspace.transcription;
    const transcriptionOptions =
      transcription?.options
        .map((option) => {
          const selected =
            option.provider === transcription.selected?.provider && option.id === transcription.selected?.modelId;
          const value = JSON.stringify({ provider: option.provider, modelId: option.id });
          return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`;
        })
        .join("") ?? "";
    const unavailable =
      transcription?.selected &&
      !transcription.options.some(
        (option) => option.provider === transcription.selected.provider && option.id === transcription.selected.modelId,
      );
    const originalTranscription = unavailable
      ? "unavailable"
      : transcription?.selected
        ? JSON.stringify(transcription.selected)
        : "";
    return `<form class="card" id="server-models-form" data-provider-scope="server" data-settings-key="server-models" data-fx="track">
      ${personaCardHead(ui("primary_models"), ui("server_primary_models_hint"))}
      <div class="stack">
        ${fields
          .map(
            ([kind, label, description, allowNone]) =>
              `<label class="field">${fieldLabel(label, description)}<select name="${kind}"${kind === "text" ? " required" : ""}>${renderOptions(kind, allowNone)}</select></label>`,
          )
          .join("")}
        ${transcription ? `<label class="field">${fieldLabel(ui("model_transcription"), ui("transcription_server_hint"))}<select name="transcription" data-original-model="${escapeHtml(originalTranscription)}"><option value="">${escapeHtml(ui("transcription_disabled"))}</option>${unavailable ? `<option value="unavailable" selected disabled>${escapeHtml(ui("personal_model_unavailable"))}</option>` : ""}${transcriptionOptions}</select></label>` : ""}
      </div>
      ${cardSaveActions(ui("save"))}
    </form>`;
  }

  function renderAdvancedServerModels(data) {
    if (!data.advancedModels) return "";
    const hints = {
      decision: "decision_model_hint",
      speech_design: "speech_design_model_hint",
      speech_clone: "speech_clone_model_hint",
    };
    return `<form class="card" data-advanced-models data-provider-scope="server" data-settings-key="server-advanced-models" data-fx="track">
      ${personaCardHead(ui("advanced_models"), ui("advanced_models_hint"))}
      <div class="stack">${data.advancedModels
        .map(
          ({ kind, options, selected }) => `<label class="field">
        ${fieldLabel(ui(`model_${kind}`), ui(hints[kind]))}
        <select name="${escapeHtml(kind)}" data-searchable>
          <option value="">${escapeHtml(ui("advanced_model_unset"))}</option>
          ${selected && selected.provider === null ? `<option value="unavailable" selected disabled>${escapeHtml(ui("advanced_model_unavailable"))}</option>` : ""}
          ${options.map(({ id, provider, label }) => `<option value="${escapeHtml(JSON.stringify({ provider, modelId: id }))}"${id === selected?.modelId && provider === selected?.provider ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}
        </select></label>`,
        )
        .join("")}</div>
      ${cardSaveActions(ui("save"))}
    </form>`;
  }

  function renderQuickCapabilities(data) {
    const switches = (data.quickCapabilities || []).flatMap((capability) => {
      const model = data.models?.[capability];
      const selected = model?.selected;
      if (!selected) return [];
      const option = model.options.find(({ id, provider }) => id === selected.id && provider === selected.provider);
      return [
        `<label class="toggle">${fieldLabel(ui(`model_${capability}`), option?.label || ui("personal_model_unavailable"))}
        <input type="checkbox" role="switch" name="routing_${escapeHtml(capability)}" data-personal-capability="${escapeHtml(capability)}"${model.enabled ? " checked" : ""}>
      </label>`,
      ];
    });
    return `<section class="panel stack provider-panel" data-quick-capabilities>
      <header class="panel-header"><div class="heading"><h2>${escapeHtml(ui("quick_capabilities"))}</h2><p>${escapeHtml(ui("quick_capabilities_hint"))}</p></div></header>
      ${switches.length ? `<div class="grid">${switches.join("")}</div>` : `<p class="hint">${escapeHtml(ui("quick_capabilities_empty"))}</p>`}
    </section>`;
  }

  async function togglePersonalCapability(input) {
    const capability = input.dataset.personalCapability;
    const model = state.providerData.personal?.models?.[capability];
    if (!model) return;
    if (savingForms) {
      input.checked = model.enabled;
      toast(ui("saving"));
      return;
    }
    try {
      const result = await withBusyForm(input.closest("[data-quick-capabilities]"), () =>
        api("/profile/capability", { method: "PATCH", body: JSON.stringify({ capability, enabled: input.checked }) }),
      );
      input.checked = model.enabled = result.enabled;
      toast(ui("quick_capability_saved"));
    } catch (error) {
      input.checked = model.enabled;
      toast(error.message, "error");
    }
  }

  function renderPersonalModels(data) {
    if (!data.models) return "";
    return `<form class="panel stack provider-panel server-model-panel" data-personal-model>
      <div class="panel-header"><div class="heading"><p class="eyebrow">${escapeHtml(ui("model_routing"))}</p><h2>${escapeHtml(ui("personal_models"))}</h2><p>${escapeHtml(ui("personal_models_hint"))}</p></div></div>
      <div class="grid">
        ${[
          "text",
          "vision",
          "embedding",
          "image",
          "image_nai",
          "video",
          "speech_design",
          "speech_clone",
          "transcription",
        ]
          .map((capability) => {
            const model = data.models[capability];
            if (!model) return "";
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
            const hint = capability === "transcription" ? "transcription_personal_hint" : null;
            return `<label class="field">${fieldLabel(ui(`model_${capability}`), hint ? ui(hint) : undefined)}<select name="${capability}" data-original-model="${escapeHtml(original)}"${model.options.length ? "" : " disabled"}><option value="" disabled${hasSelected ? "" : " selected"}>${escapeHtml(ui(placeholder))}</option>${options}</select></label>`;
          })
          .join("")}
      </div>
      <div class="actions"><button class="button primary" type="submit">${escapeHtml(ui("personal_model_save"))}</button></div>
    </form>`;
  }

  async function savePersonalModel(form) {
    if (savingForms) return;
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
    const collection = scope === "server";
    const forms = (data.parameters || [])
      .map(
        (
          provider,
        ) => `<form class="${collection ? "card" : "stack"}" data-personal-parameters="${escapeHtml(provider.provider)}" data-provider-scope="${scope}"${collection ? ` data-settings-key="server-parameters/${escapeHtml(provider.provider)}" data-fx="track"` : ""}>
        ${collection ? personaCardHead(ui("server_parameters"), ui("server_parameters_hint")) : `<h3>${escapeHtml(provider.displayName)}</h3>`}
        <div class="grid">
          ${personalParameterFields.map(([key, min, max, step]) => `<label class="field">${fieldLabel(ui(`parameter_${key}`))}<input type="number" name="${key}" min="${min}" max="${max}" step="${step}" value="${formatStoredParameterValue(provider[key])}" placeholder="${escapeHtml(ui("parameter_unset"))}"></label>`).join("")}
          <label class="field">${fieldLabel(ui("parameter_thinking_level"))}<select name="thinking_level">
            <option value="" disabled${provider.thinking_level == null ? " selected" : ""}>${escapeHtml(ui("parameter_unset"))}</option>
            ${["auto", "none", "minimal", "low", "medium", "high"].map((value) => `<option value="${value}"${provider.thinking_level === value ? " selected" : ""}>${escapeHtml(ui(`thinking_${value}`))}</option>`).join("")}
          </select></label>
        </div>
        ${collection ? cardSaveActions(ui("save")) : `<div class="actions"><button class="button primary" type="submit">${escapeHtml(ui("personal_parameters_save"))}</button></div>`}
      </form>`,
      )
      .join("");
    if (collection) return forms;
    return `<section class="panel provider-panel">
      <div class="panel-header"><div class="heading"><p class="eyebrow">${escapeHtml(ui("connection_provider"))}</p><h2>${escapeHtml(ui("personal_parameters"))}</h2><p>${escapeHtml(ui("personal_parameters_hint"))}</p></div></div>
      ${forms || `<p class="hint">${escapeHtml(ui("personal_parameters_empty"))}</p>`}
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
    if (scope === "server") completeFormSave(form);
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
    return `${personal ? '<section class="panel provider-panel">' : ""}<form ${personal ? "" : 'class="card" data-settings-key="server-fallbacks" data-fx="track" '}id="fallback-form" data-provider-scope="${scope}" data-original-fallbacks="${escapeHtml(JSON.stringify((data.fallbackRefs || []).filter(Boolean)))}">
      ${personal ? `<div class="panel-header"><div class="heading"><p class="eyebrow">Failover</p><h2>${escapeHtml(ui("personal_fallbacks"))}</h2><p>${escapeHtml(ui("personal_fallbacks_hint"))}</p></div></div>` : personaCardHead(ui("server_fallbacks"), ui("server_fallbacks_hint"))}
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
      ${
        personal
          ? `<div class="subsection">
        <label class="toggle">${fieldLabel(ui("personal_randomizer"), ui("personal_randomizer_hint"))}<input name="model_randomizer_enabled" type="checkbox" data-original-value="${Boolean(data.randomizerEnabled)}"${data.randomizerEnabled ? " checked" : ""}></label>
        <label class="toggle"><span class="field-label"><strong>${escapeHtml(profile.copy.serverFallback)}</strong><small>${escapeHtml(profile.copy.serverFallbackHint)}</small></span><input name="personal_server_fallback_enabled" type="checkbox" data-original-value="${profile.personalServerFallback}"${profile.personalServerFallback ? " checked" : ""}></label>
      </div>`
          : ""
      }
      ${personal ? `<div class="actions form-actions"><button class="button primary" type="submit">${escapeHtml(ui("save"))}</button></div>` : cardSaveActions(ui("save"))}
    </form>${personal ? "</section>" : ""}`;
  }

  function updateFallbackSlots(form) {
    const slots = [...form.querySelectorAll("[data-fallback-slot]")];
    const lastFilled = slots.reduce((last, slot, index) => (slot.querySelector("select").value ? index : last), -1);
    slots.forEach((slot, index) => {
      slot.hidden = index > lastFilled + 1;
    });
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
    const randomizer = form.elements.model_randomizer_enabled;
    const saveRandomizer = randomizer && String(randomizer.checked) !== randomizer.dataset.originalValue;
    const saveChain = serialized !== form.dataset.originalFallbacks;
    const saveServerFallback = scope === "personal" && String(enabled) !== serverFallback.dataset.originalValue;
    if (!saveChain && !saveServerFallback && !saveRandomizer) return;
    if (saveRandomizer && randomizer.checked && refs.length === 0) {
      throw new Error(ui("personal_randomizer_requires_fallbacks"));
    }
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
      if (saveRandomizer && (!randomizer.checked || form.dataset.originalFallbacks === serialized)) {
        try {
          const result = await api("/profile/model-randomizer", {
            method: "PATCH",
            body: JSON.stringify({ enabled: randomizer.checked }),
          });
          state.providerData[scope].randomizerEnabled = result.enabled;
          randomizer.dataset.originalValue = String(result.enabled);
          saved.push(ui("personal_randomizer_saved"));
        } catch (error) {
          failed.push(error.message);
        }
      }
    });
    if (failed.length) {
      const baseline = formBaselines.get(form);
      for (const field of formSnapshot(form)) {
        const original = baseline.find(({ name }) => name === field.name);
        const wasSaved = field.name.startsWith("fallback-")
          ? form.dataset.originalFallbacks === serialized
          : String(field.checked) === form.elements[field.name].dataset.originalValue;
        if (wasSaved && original) Object.assign(original, field);
      }
      captureDraft(form);
      throw Object.assign(new Error([...saved, ...failed].join(" ")), { partial: saved.length > 0 });
    }
    if (scope === "server") completeFormSave(form);
    toast(saved.length === 1 ? saved[0] : ui("fallback_saved"));
    await refreshProviders(scope);
  }

  async function saveModelSelections(form, path, savedKey, onSaved) {
    if (form.classList.contains("is-saving")) return;
    const baseline = formBaselines.get(form);
    const changed = formSnapshot(form).filter(({ name, value }) =>
      baseline.some((entry) => entry.name === name && entry.value !== value),
    );
    if (!changed.length) return;
    const failures = [];
    let saved = 0;
    await withBusyForm(form, async () => {
      for (const field of changed) {
        try {
          const value = field.value ? JSON.parse(field.value) : null;
          await api(path, {
            method: "PATCH",
            body: JSON.stringify({ [field.name]: value }),
          });
          onSaved?.(field.name, value);
          baseline.find(({ name }) => name === field.name).value = field.value;
          saved += 1;
        } catch (error) {
          failures.push(error.message);
        }
      }
      if (!failures.length) completeFormSave(form);
      else {
        syncTrackedDraft(form);
        captureDraft(form);
      }
    });
    if (failures.length) showFormError(form, new Error(failures.join(" ")), saved > 0);
    else toast(ui(savedKey));
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
      ...(data.braveSearchConfigured
        ? [
            {
              key: "provider:brave",
              name: "Brave Search",
              provider: { provider: "brave", hasApiKey: true },
              endpoint: null,
            },
          ]
        : []),
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
        ? [
            "text",
            "vision",
            "embedding",
            "image",
            "image_nai",
            "video",
            "speech_design",
            "speech_clone",
            "transcription",
          ]
        : [
            "text",
            "vision",
            "embedding",
            "image",
            "imageNai",
            "video",
            "transcription",
            "decision",
            "speech_design",
            "speech_clone",
          ];
    const groups = kinds
      .map((kind) => {
        const options =
          scope === "personal" || kind === "transcription"
            ? data.models?.[kind]?.options
            : (data.models?.options?.[kind] ?? data.advancedModels?.find((slot) => slot.kind === kind)?.options);
        const models = (options || []).filter((option) => option.provider === provider);
        if (!models.length) return "";
        const key = kind === "imageNai" ? "image_nai" : kind;
        return `<tr><th scope="row">${escapeHtml(ui(`model_${key}`))}</th><td>${models.map((model) => escapeHtml(model.label)).join(", ")}</td></tr>`;
      })
      .join("");
    const label = escapeHtml(ui("connection_available_models"));
    const models = groups
      ? `<div class="table-wrap"><table aria-label="${label}"><tbody>${groups}</tbody></table></div>`
      : `<p class="hint">${escapeHtml(ui("connection_no_available_models"))}</p>`;
    return scope === "server" ? models : `<div class="subsection stack"><h3>${label}</h3>${models}</div>`;
  }

  function renderConnectionDetail(data, scope, connection) {
    const collection = scope === "server";
    if (!connection)
      return collection
        ? ""
        : `<div class="hint"><strong>${escapeHtml(ui("connection_empty"))}</strong><p>${escapeHtml(ui("connection_select"))}</p></div>`;
    const provider = connection.provider;
    const endpoint = connection.endpoint;
    const providerName = provider?.provider || endpoint?.provider;
    const brave = providerName === "brave";
    const parameters = (data.parameters || []).filter((entry) => entry.provider === providerName);
    const canReplace = provider && !endpoint && !provider.provider.startsWith("custom:");
    const activeTextProvider =
      scope === "server" && canReplace && provider.provider.toLowerCase() === data.activeTextProvider;
    const buttonClass = collection ? "button small" : "button";
    const remove = endpoint
      ? `<button class="${buttonClass} danger" type="button" data-endpoint-delete="${endpoint.id}" data-provider-scope="${scope}">Remove connection</button>`
      : canReplace && scope === "personal"
        ? `<button class="${buttonClass} danger" type="button" data-provider-delete="${escapeHtml(provider.provider)}">Remove</button>`
        : canReplace && (brave || (data.activeTextProvider && !activeTextProvider))
          ? `<button class="${buttonClass} danger" type="button" data-server-provider-delete="${escapeHtml(provider.provider)}" data-provider-name="${escapeHtml(connection.name)}" aria-haspopup="dialog">${escapeHtml(ui("connection_remove_server_provider"))}</button>`
          : "";
    const menuId = `connection-actions-${scope}`;
    const edit = endpoint?.connectionId
      ? `<button class="${buttonClass}" type="button" data-endpoint-edit="${endpoint.connectionId}" data-provider-scope="${scope}" aria-haspopup="dialog">${escapeHtml(ui("endpoint_edit"))}</button>`
      : "";
    const rotation =
      scope === "server" && provider?.supportsRotation
        ? `<button class="${buttonClass}" type="button" data-provider-rotation="${escapeHtml(provider.provider)}" aria-haspopup="dialog">${escapeHtml(ui("rotation_title"))}</button>`
        : "";
    const replace = canReplace
      ? `<button class="${buttonClass}" type="button" data-provider-open="${escapeHtml(provider.provider)}">${escapeHtml(ui("connection_replace_key"))}</button>`
      : "";
    const actionItems = [edit, replace, rotation, remove].filter(Boolean);
    const actions = actionItems.length
      ? `<button class="button icon" type="button" popovertarget="${menuId}" aria-label="${escapeHtml(ui("connection_actions"))}">${navigationIcon("ellipsis")}</button><div id="${menuId}" class="action-menu" popover aria-label="${escapeHtml(ui("connection_actions"))}">${edit}${replace}${rotation}${collection && remove && actionItems.length > 1 ? "<hr>" : ""}${remove}</div>`
      : "";
    const openRouter = providerName?.toLowerCase() === "openrouter";
    const credentialStatus = provider ? (provider.hasApiKey ? "Encrypted key stored" : "No key stored") : "";
    const endpoints = endpoint ? renderEndpointRows({ endpoints: connection.endpoints }, scope) : "";
    const models = brave
      ? `<p class="hint">${escapeHtml(ui("brave_search_key_hint"))}</p>`
      : renderConnectionModels(data, scope, providerName);
    if (collection) {
      const controls = actionItems.length > 2 ? actions : actionItems.join("");
      const cards = `<section class="card">
        ${personaCardHead(connection.name, "", controls ? `<div class="actions">${controls}</div>` : "")}
        <div class="stack">
          ${credentialStatus || activeTextProvider ? `<div class="chips">${credentialStatus ? `<span class="chip">${escapeHtml(credentialStatus)}</span>` : ""}${activeTextProvider ? `<span class="chip tone">${escapeHtml(ui("connection_active_text"))}</span>` : ""}</div>` : ""}
          ${endpoints}${models}
        </div>
      </section>
      ${openRouter ? `<section class="card">${personaCardHead(ui("connection_registered_models"))}${renderOpenRouterRows(data, scope)}</section>${renderOpenRouterRegistration(scope)}` : ""}
      ${parameters.length ? renderPersonalParameters({ parameters }, scope) : ""}`;
      return openRouter || parameters.length ? `<div class="card-columns">${cards}</div>` : cards;
    }
    return `<div class="${parameters.length || openRouter ? "grid" : "stack"}">
      <section class="panel provider-panel"><header class="panel-header"><div class="heading"><h2>${escapeHtml(connection.name)}</h2>${credentialStatus ? `<small>${escapeHtml(credentialStatus)}</small>` : ""}${activeTextProvider ? `<small>${escapeHtml(ui("connection_active_text"))}</small>` : ""}</div><div class="actions">${actions}</div></header>${endpoints}${models}${openRouter ? `<div class="subsection stack"><h3>${escapeHtml(ui("connection_registered_models"))}</h3>${renderOpenRouterRows(data, scope)}</div>` : ""}</section>
      <div class="stack">
      ${openRouter ? renderOpenRouterRegistration(scope) : ""}
      ${parameters.length ? renderPersonalParameters({ parameters }, scope) : ""}
      </div>
    </div>`;
  }

  function renderOpenRouterRegistration(scope) {
    const collection = scope === "server";
    return `${collection ? "" : '<section class="panel provider-panel">'}
      <form id="openrouter-form" data-provider-scope="${scope}"${collection ? ' class="card" data-settings-key="server-openrouter-registration" data-fx="track"' : ""}>
        ${collection ? personaCardHead(ui("connection_register_model"), ui("connection_models_hint")) : `<div class="panel-header"><div class="heading"><p class="eyebrow">${escapeHtml(ui("connection_provider"))}</p><h2>${escapeHtml(ui("connection_models"))}</h2><p>${escapeHtml(ui("connection_models_hint"))}</p></div></div>`}
          <div class="grid"><label class="field">${fieldLabel("Capability", "Determines which Tomori model selector may use this registration.")}<select name="capability"><option value="text">Text</option><option value="embedding">Embeddings</option><option value="image">Images</option><option value="video">Video</option><option value="decision">Decision</option><option value="transcription">${escapeHtml(ui("model_transcription"))}</option></select></label>
            <label class="field">${fieldLabel("Model codename", "Exact OpenRouter identifier, usually in provider/model-name format.")}<input name="modelName" placeholder="provider/model-name" maxlength="240" required></label></div>
          <p class="hint" data-openrouter-transcription-hint hidden>${escapeHtml(ui("openrouter_transcription_hint"))}</p>
        ${collection ? cardSaveActions(ui("connection_register_model")) : `<div class="actions"><button class="button primary" type="submit">${escapeHtml(ui("connection_register_model"))}</button></div>`}
      </form>${collection ? "" : "</section>"}`;
  }

  function updateOpenRouterHint(form) {
    form.querySelector("[data-openrouter-transcription-hint]").hidden =
      form.elements.capability.value !== "transcription";
  }

  function renderPersonalProviders(workspace) {
    const scope = "personal";
    const data = state.providerData[scope];
    if (!data) {
      workspace.innerHTML = `${pageHeader("Personal", "My providers", "")}${loadingBar(ui("providers_loading"))}`;
      loadProviderWorkspace(scope);
      return;
    }
    const { connections, connection } = selectProviderConnection(data, scope);

    const hasPersonalModels = connections.length > 0;
    if (!hasPersonalModels) state.providerPanel[scope] = "connections";

    workspace.innerHTML = `
      ${pageHeader(
        "Personal",
        "My providers",
        data.byokRequired
          ? "This server requires personal provider credentials."
          : "Your encrypted credentials and active personal capabilities.",
        refreshButton("provider", ui("refresh_providers"), scope),
      )}
      <nav class="tabs provider-primary-tabs tabs-parent${state.providerPanel[scope] === "connections" ? " tabs-joined" : ""}" aria-label="My providers">${[
        ["connections", "connections"],
        ["models", "primary_models"],
        ["fallbacks", "connection_fallbacks"],
      ]
        .filter(([id]) => id === "connections" || hasPersonalModels)
        .map(
          ([id, key]) =>
            `<button type="button" aria-selected="${state.providerPanel[scope] === id}" aria-current="${state.providerPanel[scope] === id ? "page" : "false"}" data-provider-panel="${id}" data-provider-scope="${scope}">${escapeHtml(ui(key))}</button>`,
        )
        .join("")}</nav>
      <section class="stack" aria-label="${escapeHtml(ui("connections"))}"${state.providerPanel[scope] === "connections" ? "" : " hidden"}>
        <div class="row provider-toolbar">
        ${connections.length ? `<nav class="tabs tabs-child" aria-label="${escapeHtml(ui("connections"))}">${connections.map((entry) => `<button type="button" data-connection-select="${escapeHtml(entry.key)}" data-provider-scope="${scope}" aria-selected="${entry.key === connection?.key}">${escapeHtml(entry.name)}</button>`).join("")}</nav>` : ""}
        <div class="actions"><button class="button secondary" type="button" data-provider-open aria-haspopup="dialog">${escapeHtml(ui("add_provider"))}</button><button class="button secondary" type="button" data-endpoint-open aria-haspopup="dialog">${escapeHtml(ui("endpoint_register_new"))}</button></div>
        </div>${renderConnectionDetail(data, scope, connection)}
      </section>
      <section class="stack" aria-label="${escapeHtml(ui("model_routing"))}"${state.providerPanel[scope] === "models" ? "" : " hidden"}>${renderQuickCapabilities(data) + renderPersonalModels(data)}</section>
      <section class="stack" aria-label="${escapeHtml(ui("connection_fallbacks"))}"${state.providerPanel[scope] === "fallbacks" ? "" : " hidden"}>${renderFallbacks(data, scope)}</section>
      ${renderProviderDialogs(data, scope)}`;
  }

  function renderProviderEndpointFields() {
    return `<div class="grid">
            <label class="field">${fieldLabel("Internal label", "Stable letters, numbers, underscores, or dashes used to identify this endpoint.")}<input name="label" pattern="[A-Za-z0-9_\\-]+" maxlength="48" required></label>
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
          </fieldset>`;
  }

  function renderProviderDialogs(data, scope) {
    const server = scope === "server";
    const keyField = `<label class="field">${fieldLabel("API key", ui("provider_key_hint"))}<input name="apiKey" type="password" autocomplete="new-password" minlength="10" required></label>`;
    return `<dialog id="provider-dialog" aria-labelledby="provider-dialog-title">
        <form class="stack" id="provider-credential-form" data-provider-scope="${scope}">
          <div class="panel-header"><div class="heading"><p class="eyebrow">${escapeHtml(ui("connections"))}</p><h2 id="provider-dialog-title">${escapeHtml(ui("add_provider"))}</h2></div></div>
          <label class="field">${fieldLabel("Provider", "Service this credential belongs to and the capabilities it may unlock.")}<select name="provider">${providerChoiceOptions(data)}${server ? `<option value="other">${escapeHtml(ui("provider_other"))}</option>` : ""}</select></label>
          ${
            server
              ? `<fieldset data-provider-key-fields>${keyField}</fieldset>
          <fieldset class="stack" data-provider-endpoint-fields hidden disabled>
            <legend>${escapeHtml(ui("endpoint_register_new"))}</legend>
            ${renderProviderEndpointFields()}
          </fieldset>`
              : keyField
          }
          <div class="actions" data-form-actions><button class="button" type="button" data-dialog-close="provider-dialog">${escapeHtml(ui("endpoint_cancel"))}</button><button class="button primary" type="submit">${escapeHtml(ui("provider_store_key"))}</button></div>
        </form>
      </dialog>
      ${
        server
          ? ""
          : `<dialog id="endpoint-dialog" class="wide" aria-labelledby="endpoint-dialog-title">
        <form class="stack" id="endpoint-form" data-provider-scope="${scope}">
          <div class="panel-header"><div class="heading"><p class="eyebrow">Custom</p><h2 id="endpoint-dialog-title">${escapeHtml(ui("endpoint_register_new"))}</h2></div></div>
          ${renderProviderEndpointFields()}
          <div class="actions" data-form-actions><button class="button" type="button" data-dialog-close="endpoint-dialog">${escapeHtml(ui("endpoint_cancel"))}</button><button class="button primary" type="submit">${escapeHtml(ui("endpoint_test_register"))}</button></div>
        </form>
      </dialog>`
      }`;
  }

  function updateServerProviderRegistration(form) {
    const endpoint = form.elements.provider.value === "other";
    const keyFields = form.querySelector("[data-provider-key-fields]");
    const endpointFields = form.querySelector("[data-provider-endpoint-fields]");
    keyFields.hidden = keyFields.disabled = endpoint;
    endpointFields.hidden = endpointFields.disabled = !endpoint;
    form.closest("dialog").classList.toggle("wide", endpoint);
    form.querySelector('[type="submit"]').textContent = ui(endpoint ? "endpoint_test_register" : "provider_store_key");
    form.querySelector(".form-error")?.remove();
    window.TomoriControls?.enhance(form);
  }

  const serverProviderPanels = [
    ["connections", "connections", "plug"],
    ["models", "primary_models", "layout-grid"],
    ["fallbacks", "connection_fallbacks", "arrow-up-down"],
  ];

  function renderServerProviderPicker(connections, selectedKey) {
    if (connections.length < 2) return { markup: "", activeTab: "" };
    const label = escapeHtml(ui("connection_provider"));
    if (connections.length > 5 || connections.some(({ name }) => name.length > 24)) {
      return {
        markup: `<label class="field"><span class="field-label sr-only">${label}</span><select data-server-provider-select${connections.length >= 8 ? " data-searchable" : ""}>
          ${connections.map(({ key, name }) => `<option value="${escapeHtml(key)}"${key === selectedKey ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}
        </select></label>`,
        activeTab: "",
      };
    }
    const activeTab = `server-connection-${connections.findIndex(({ key }) => key === selectedKey)}`;
    return {
      markup: `<nav class="segmented" data-fx="indicator" data-overflow role="tablist" aria-label="${label}">
        ${connections
          .map(({ key, name }, index) => {
            const active = key === selectedKey;
            return `<button type="button" id="server-connection-${index}" role="tab" aria-controls="server-connection-detail" aria-selected="${active}" tabindex="${active ? 0 : -1}" data-connection-select="${escapeHtml(key)}" data-provider-scope="server">${escapeHtml(name)}</button>`;
          })
          .join("")}
      </nav>`,
      activeTab,
    };
  }

  async function switchServerProviderConnection(key, control) {
    if (savingForms) {
      toast(ui("saving"));
      return false;
    }
    if (key === state.providerConnection.server) return true;
    const detail = document.querySelector("#server-connection-detail");
    const data = state.providerData.server;
    if (!detail || !data) return false;
    const connection = providerConnections(data).find((entry) => entry.key === key);
    if (
      !connection ||
      !(await confirmDraftDiscard(detail)) ||
      !control.isConnected ||
      data !== state.providerData.server
    )
      return false;
    state.providerConnection.server = connection.key;
    if (control.matches('[role="tab"]')) {
      for (const tab of control.parentElement.querySelectorAll("[data-connection-select]")) {
        const active = tab === control;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      }
      detail.setAttribute("aria-labelledby", control.id);
      control.focus({ preventScroll: true });
    }
    window.TomoriFX.swap(detail, renderConnectionDetail(data, "server", connection));
    initDraftForms(detail);
    enhanceDashboard(detail);
    return true;
  }

  function renderServerProviders(workspace) {
    if (!state.overview.canManage) {
      workspace.innerHTML = `<section class="card"><div class="empty-note"><strong>${escapeHtml(ui("settings_manage_required"))}</strong></div></section>`;
      return;
    }
    if (!workspace.querySelector("#server-providers-stage")) {
      const title = escapeHtml(ui("nav_server_providers"));
      workspace.innerHTML = `
        <section class="banner compact" aria-labelledby="server-providers-title">
          <div class="banner-info"><div class="stack">
            <p class="crumb">${escapeHtml(ui("nav_server_administration"))}<span class="kind">${escapeHtml(ui("settings_managers_only"))}</span></p>
            <h1 id="server-providers-title" data-fx="split">${title}</h1>
            <p class="banner-text">${escapeHtml(ui("server_providers_hint"))}</p>
          </div></div>
          <div class="banner-art" aria-hidden="true"><span class="sticker emblem">${navigationIcon("plug")}</span></div>
        </section>
        <nav class="dock" data-fx="indicator" data-overflow role="tablist" aria-label="${title}">
          ${serverProviderPanels.map(([id, label, icon]) => `<button type="button" id="server-providers-${id}" role="tab" aria-controls="server-providers-stage" data-provider-panel="${id}" data-provider-scope="server">${navigationIcon(icon)}${escapeHtml(ui(label))}</button>`).join("")}
        </nav>
        <section id="server-providers-stage" class="stage" role="tabpanel">
          <div class="toolbar" data-server-provider-toolbar><div class="actions">
            <button class="button small icon" type="button" data-provider-refresh="server" aria-label="${escapeHtml(ui("refresh_providers"))}">${navigationIcon("refresh-cw")}</button>
          </div></div>
          <div class="stack" data-server-provider-content></div>
        </section>
        <div data-server-provider-dialogs></div>`;
    }
    const panel = state.providerPanel.server;
    for (const button of workspace.querySelectorAll(".dock [data-provider-panel]")) {
      const active = button.dataset.providerPanel === panel;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    const stage = workspace.querySelector("#server-providers-stage");
    stage.setAttribute("aria-labelledby", `server-providers-${panel}`);
    const content = stage.querySelector("[data-server-provider-content]");
    const actions = stage.querySelector("[data-server-provider-toolbar] > .actions");
    actions.previousElementSibling?.remove();
    actions.querySelector("[data-provider-open]")?.remove();
    const data = state.providerData.server;
    if (!data) {
      if (!content.hasAttribute("aria-busy")) {
        content.setAttribute("aria-busy", "true");
        content.innerHTML = loadingBar(ui("providers_loading"));
        void loadProviderWorkspace("server");
      }
      return;
    }
    content.removeAttribute("aria-busy");
    workspace.querySelector("[data-server-provider-dialogs]").innerHTML = renderProviderDialogs(data, "server");
    if (panel === "models") {
      content.innerHTML = `<div class="card-columns">${renderServerModels(data)}${renderAdvancedServerModels(data)}${renderSettingsPanel({ section: "byok" })}</div>`;
    } else if (panel === "fallbacks") {
      content.innerHTML = renderFallbacks(data, "server");
    } else {
      const { connections, connection } = selectProviderConnection(data, "server");
      const add = `<button class="button small primary" type="button" data-provider-open aria-haspopup="dialog">${navigationIcon("plus")}${escapeHtml(ui("add_provider"))}</button>`;
      const { markup, activeTab } = renderServerProviderPicker(connections, connection?.key);
      if (connections.length) {
        actions.insertAdjacentHTML("beforebegin", markup);
        actions.insertAdjacentHTML("beforeend", add);
      }
      content.innerHTML = connections.length
        ? `<div id="server-connection-detail"${activeTab ? ` role="tabpanel" aria-labelledby="${activeTab}"` : ""}>${renderConnectionDetail(data, "server", connection)}</div>`
        : `<section class="card"><div class="empty-note"><strong>${escapeHtml(ui("connection_empty"))}</strong><div class="row">${add}</div></div></section>`;
    }
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
      const workspace = document.querySelector("[data-dashboard-view]");
      const expectedView = scope === "personal" ? "personal-providers" : "server-providers";
      if (workspace && state.view === expectedView) {
        if (scope === "server") {
          const content = workspace.querySelector("[data-server-provider-content]");
          content.removeAttribute("aria-busy");
          content.innerHTML = `<p class="notice error" role="alert">${escapeHtml(error.message)}</p>`;
        } else workspace.innerHTML = `<div class="empty"><strong>${escapeHtml(error.message)}</strong></div>`;
      }
      return false;
    }
  }

  function collectSettingsPatch(form, section) {
    const patch = {};
    for (const field of section.fields) {
      const input = form.elements.namedItem(field.key);
      if (form.querySelector(`[name="${field.key}"][data-unavailable-channel]:checked`)) continue;
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
      if (field.key === "cooldown_type" || field.key === "cooldown_length") {
        const saved = state.overview.settings.values[section.id]?.[field.key];
        if (input.value !== "" && Number(input.value) !== saved) patch[field.key] = Number(input.value);
        continue;
      }
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
    state.personaKnowledgePanel = "personal";
    state.personaTestChats = {};
    state.personaChatOpen = false;
    state.personaTestChatBusy = false;
    renderBootScreen();
    try {
      state.overview = await api(`/guilds/${guildId}/overview`);
      if (
        (state.view === "personal-spotlights" && state.overview.guild.isDirectMessage) ||
        (state.view === "server-providers" && !state.overview.canManage) ||
        (["moderation", "channel-settings"].includes(state.view) &&
          (!state.overview.canManage || state.overview.guild.isDirectMessage))
      )
        state.view = "overview";
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

  function confirmAction(title, message, label = ui("confirm_action")) {
    const dialog = document.querySelector("#confirm-dialog");
    if (!dialog?.showModal) return Promise.resolve(window.confirm(message));
    dialog.querySelector("#confirm-title").textContent = title;
    dialog.querySelector("#confirm-message").textContent = message;
    dialog.querySelector('button[value="confirm"]').textContent = label;
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

  async function deleteServerProvider(button) {
    const guildId = state.guildId;
    const stillHere = () => guildId === state.guildId && state.view === "server-providers";
    const confirm = await confirmAction(
      ui("connection_remove_server_provider_title").replace("{name}", () => button.dataset.providerName),
      ui(
        button.dataset.serverProviderDelete === "brave"
          ? "brave_search_remove_hint"
          : "connection_remove_server_provider_hint",
      ),
    );
    if (!confirm || !stillHere() || !button.isConnected) return;
    try {
      const result = await withBusyForm(button, () =>
        api(
          `/guilds/${guildId}/providers/server/credentials/${encodeURIComponent(button.dataset.serverProviderDelete)}`,
          {
            method: "DELETE",
          },
        ),
      );
      if (!result?.deleted) return;
      toast(ui("connection_server_provider_removed"));
      if (guildId !== state.guildId) return;
      await refreshProviders("server");
      if (stillHere()) {
        const picker =
          '[data-connection-select][aria-selected="true"], [data-server-provider-select] + .select-trigger';
        focusNavigation(document.querySelector(picker) ? picker : "[data-provider-open]");
      }
    } catch (error) {
      toast(error.message, "error");
      if (error.code === "provider_active" && stillHere()) await loadProviderWorkspace("server");
    }
  }

  function openDashboardEditor(button, title, wide = false, eyebrow = "connections") {
    const dialog = document.createElement("dialog");
    if (wide) dialog.className = "wide";
    dialog.setAttribute("aria-labelledby", "dashboard-editor-title");
    dialog.innerHTML = `<form class="stack"><header class="panel-header"><div class="heading"><p class="eyebrow" data-editor-context>${escapeHtml(ui(eyebrow))}</p><h2 id="dashboard-editor-title">${escapeHtml(ui(title))}</h2></div></header>
      <div class="stack" data-editor-fields>${loadingBar(ui(title))}</div>
      <footer class="actions form-actions"><button class="button" type="button" data-editor-cancel>${escapeHtml(ui("endpoint_cancel"))}</button><button class="button primary" type="submit" hidden>${escapeHtml(ui("save"))}</button></footer></form>`;
    const form = dialog.querySelector("form");
    form.querySelector("[data-editor-cancel]").onclick = () => dialog.close();
    dialog.addEventListener("cancel", (event) => {
      if (form.classList.contains("is-saving")) event.preventDefault();
    });
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        if (button.checkVisibility()) button.focus({ preventScroll: true });
        else if (button.isConnected) {
          const menu = button.closest(".action-menu");
          if (menu) focusNavigation(`[popovertarget="${menu.id}"]`);
        }
      },
      { once: true },
    );
    document.body.append(dialog);
    dialog.showModal();
    return {
      dialog,
      form,
      fields: form.querySelector("[data-editor-fields]"),
      save: form.querySelector('[type="submit"]'),
    };
  }

  function renderMainPersonaReview(review, source) {
    const format = (key, values) =>
      escapeHtml(ui(key).replace(/\{(\w+)\}/g, (token, field) => String(values[field] ?? token)));
    const sameLineage = review.currentLineageId === review.targetLineageId;
    const memoriesKey = sameLineage
      ? "persona_main_memories_same"
      : review.targetLineageId === null
        ? "persona_main_memories_new"
        : "persona_main_memories_switch";
    const loreKey =
      review.incomingLoreCount === null
        ? "persona_main_lore_keep"
        : review.incomingLoreCount === 0
          ? "persona_main_lore_clear"
          : "persona_main_lore_replace";
    const target = review.targetLineageId === null ? ui("persona_main_lineage_new") : `#${review.targetLineageId}`;
    const affectsExistingLore = review.incomingLoreCount !== null && review.existingLoreCount > 0;
    return `
      <strong>${format("persona_main_review_summary", { current: review.currentName, source: review.sourceName, name: review.nextName })}</strong>
      <div class="heading"><h3>${escapeHtml(ui("persona_main_lineage"))}</h3>
        <p>#${escapeHtml(review.currentLineageId)} → ${escapeHtml(target)}</p></div>
      <div class="heading"><h3>${escapeHtml(ui("persona_main_memories"))}</h3>
        <p>${escapeHtml(ui(memoriesKey))}</p>
        <p>${escapeHtml(ui("persona_main_memories_global"))}</p></div>
      <div class="heading"><h3>${escapeHtml(ui("persona_main_lore"))}</h3>
        <p${affectsExistingLore ? ' class="notice warning"' : ""}>${format(loreKey, { existing: review.existingLoreCount, incoming: review.incomingLoreCount })}</p>
        <p>${escapeHtml(ui(sameLineage ? "persona_main_lore_server" : "persona_main_lore_previous"))}</p>
        ${review.sharedPersonas.length ? `<p>${format("persona_main_shared", { names: review.sharedPersonas.join(", ") })}</p>` : ""}
      </div>
      <p class="hint">${escapeHtml(ui(source === "preset" ? "persona_main_preset_media" : "persona_main_card_media"))}</p>`;
  }

  async function openMainPersonaChange(button) {
    const guildId = state.guildId;
    const path = `/guilds/${guildId}/personas/main/replacement`;
    const { dialog, form, fields, save } = openDashboardEditor(
      button,
      "persona_main_change",
      true,
      "persona_main_label",
    );
    try {
      const { presets } = await api(path);
      if (!dialog.open) return;
      fields.innerHTML = `
        <div class="stack" data-main-selection>
        <label class="field">${fieldLabel(ui("persona_main_source"))}<select name="source">
          <option value="preset"${presets.length ? "" : " disabled"}>${escapeHtml(ui("persona_main_preset"))}</option>
          <option value="card"${presets.length ? "" : " selected"}>${escapeHtml(ui("persona_main_card"))}</option>
        </select></label>
        ${presets.length ? "" : `<p class="hint">${escapeHtml(ui("persona_main_no_presets"))}</p>`}
        <label class="field" data-main-preset>${fieldLabel(ui("persona_main_preset"))}<select name="presetId" required>
          <option value="">${escapeHtml(ui("persona_main_choose_preset"))}</option>
          ${presets.map(({ id, name }) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("")}
        </select></label>
        <div class="stack" data-main-card>
          <label class="field">${fieldLabel(ui("persona_main_file"))}<input type="file" name="file" accept=".png,.json,image/png,application/json" required></label>
          <label class="field">${fieldLabel(ui("persona_main_identity"))}<select name="identityMode">
            <option value="fork">${escapeHtml(ui("persona_main_identity_fork"))}</option>
            <option value="preserve">${escapeHtml(ui("persona_main_identity_preserve"))}</option>
          </select></label>
        </div>
        </div>
        <section class="subsection" data-main-review tabindex="-1" hidden></section>`;
      const selectionPanel = fields.querySelector("[data-main-selection]");
      const reviewPanel = fields.querySelector("[data-main-review]");
      const presetField = fields.querySelector("[data-main-preset]");
      const cardFields = fields.querySelector("[data-main-card]");
      const back = document.createElement("button");
      back.type = "button";
      back.className = "button";
      back.textContent = ui("persona_main_back");
      save.before(back);
      let reviewed = null;
      const resetReview = () => {
        reviewed = null;
        selectionPanel.hidden = false;
        back.hidden = true;
        reviewPanel.hidden = true;
        reviewPanel.replaceChildren();
        save.classList.remove("danger");
        save.classList.add("primary");
        save.textContent = ui("persona_main_review");
      };
      back.onclick = () => {
        resetReview();
        dialog.scrollTop = 0;
        selectionPanel.querySelector('[role="combobox"]')?.focus({ preventScroll: true });
      };
      const sync = () => {
        const isPreset = form.elements.source.value === "preset";
        presetField.hidden = !isPreset;
        cardFields.hidden = isPreset;
        form.elements.presetId.disabled = !isPreset;
        form.elements.file.disabled = isPreset;
        form.elements.identityMode.disabled = isPreset;
        resetReview();
        form.querySelector(".form-error")?.remove();
      };
      form.addEventListener("change", sync);
      sync();
      enhanceDashboard(fields);
      save.hidden = false;
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (!dialog.open || state.guildId !== guildId || form.classList.contains("is-saving")) return;
        form.querySelector(".form-error")?.remove();
        const body = new FormData(form);
        try {
          if (!reviewed) {
            reviewed = await withBusyForm(form, () => api(path, { method: "POST", body }));
            if (!dialog.open) return;
            reviewPanel.innerHTML = renderMainPersonaReview(reviewed, body.get("source"));
            selectionPanel.hidden = true;
            reviewPanel.hidden = false;
            back.hidden = false;
            dialog.scrollTop = 0;
            reviewPanel.focus({ preventScroll: true });
            save.textContent = ui("persona_main_confirm");
            if (reviewed.incomingLoreCount !== null && reviewed.existingLoreCount > 0) {
              save.classList.remove("primary");
              save.classList.add("danger");
            }
            return;
          }
          body.set("revision", reviewed.revision);
          const result = await withBusyForm(form, () => api(path, { method: "PUT", body }));
          dialog.close();
          toast(
            ui(result.synchronized ? "persona_main_changed" : "persona_main_sync_warning"),
            result.synchronized ? "success" : "warning",
          );
          if (state.guildId === guildId) await refreshPersonas(result.personaId);
        } catch (error) {
          if (dialog.open) {
            resetReview();
            showFormError(form, error);
          } else {
            toast(error.message, "error");
          }
        }
      };
    } catch (error) {
      if (dialog.open) fields.textContent = error.message;
    }
  }

  async function openRotationKeys(button) {
    const guildId = state.guildId;
    const path = `/guilds/${guildId}/providers/server/credentials/${encodeURIComponent(button.dataset.providerRotation)}/rotation`;
    const { dialog, form, fields, save } = openDashboardEditor(button, "rotation_title");
    try {
      const { name, count } = await api(path);
      if (!dialog.open) return;
      form.querySelector("[data-editor-context]").textContent = name;
      fields.innerHTML = `<p>${escapeHtml(ui("rotation_count").replace("{count}", String(count)))}</p><label class="field">${fieldLabel(ui("rotation_key"), ui("rotation_key_hint"))}<input type="password" name="key" minlength="10" maxlength="4000" required autocomplete="new-password"></label>`;
      if (count > 0)
        save.parentElement.insertAdjacentHTML(
          "afterbegin",
          `<button type="button" class="button danger" data-rotation-clear>${escapeHtml(ui("rotation_clear"))}</button>`,
        );
      save.textContent = ui("rotation_key");
      save.hidden = false;
      async function update(payload, receipt) {
        if (!dialog.open || state.guildId !== guildId || form.classList.contains("is-saving")) return;
        try {
          const result = await withBusyForm(form, () => api(path, { method: "PATCH", body: JSON.stringify(payload) }));
          dialog.close();
          toast(ui(result.updated ? receipt : "endpoint_edit_unchanged"));
        } catch (error) {
          if (dialog.open) showFormError(form, error);
        }
      }
      form.onsubmit = (event) => {
        event.preventDefault();
        void update({ action: "add", key: form.elements.key.value }, "rotation_added");
      };
      const clear = form.querySelector("[data-rotation-clear]");
      if (clear)
        clear.onclick = async () => {
          if (await confirmAction(ui("rotation_clear"), ui("rotation_clear_hint")))
            await update({ action: "clear" }, "rotation_cleared");
        };
    } catch (error) {
      if (dialog.open) fields.textContent = error.message;
    }
  }

  const endpointModelFlagLabels = {
    hasTools: "endpoint_tools",
    seesImages: "endpoint_images",
    seesVideos: "endpoint_videos",
    supportsStructOutput: "endpoint_structured",
    strictRoleAlternation: "endpoint_roles",
    supportsPrefixCompletion: "endpoint_model_prefix_completion",
    supportsAssistantPrefill: "endpoint_model_prefill",
    verbatimToolCalling: "endpoint_model_verbatim",
  };

  async function openEndpointModelEditor(button) {
    const guildId = state.guildId;
    const { providerScope: scope, endpointConnection, endpointModelEdit } = button.dataset;
    const path = `/guilds/${guildId}/providers/${scope}/connections/${endpointConnection}/models/${endpointModelEdit}`;
    const { dialog, form, fields, save } = openDashboardEditor(button, "endpoint_model_edit", true);
    try {
      const model = await api(path);
      if (!dialog.open) return;
      form.querySelector("[data-editor-context]").textContent = model.connectionName;
      const canEnableRoute = scope === "personal" && ["text", "embedding", "image", "video"].includes(model.capability);
      const toggle = (key, label, checked, hint = "") =>
        `<label class="toggle">${fieldLabel(ui(label), hint)}<input type="checkbox" role="switch" name="${key}"${checked ? " checked" : ""}></label>`;
      const options = (name, selected, choices) =>
        `<select name="${name}">${choices.map(([value, key]) => `<option value="${value}"${value === selected ? " selected" : ""}>${escapeHtml(ui(`endpoint_model_${key}`))}</option>`).join("")}</select>`;
      fields.innerHTML = `${canEnableRoute ? `<p class="hint">${escapeHtml(ui("endpoint_model_personal_routing_hint"))}</p>` : ""}
        ${model.codeName === null ? "" : `<label class="field">${fieldLabel(ui("endpoint_model_name"))}<input name="codeName" maxlength="200" value="${escapeHtml(model.codeName)}" required></label>`}
        ${model.capability === "text" || model.capability === "decision" ? `<label class="field">${fieldLabel(ui(model.capability === "decision" ? "endpoint_model_input_limit" : "endpoint_model_context"))}<input type="number" name="numCtx" min="512" max="10000000" value="${model.numCtx ?? ""}"${model.capability === "decision" ? " required" : ""}></label>` : ""}
        ${
          model.flags
            ? `<div class="grid">${Object.entries(model.flags)
                .map(([key, enabled]) =>
                  toggle(
                    `flag_${key}`,
                    endpointModelFlagLabels[key],
                    enabled,
                    ui(`${endpointModelFlagLabels[key]}_hint`),
                  ),
                )
                .join("")}</div>`
            : ""
        }
        ${
          model.imageSupports
            ? `<fieldset class="stack"><legend>${escapeHtml(ui("endpoint_model_image_supports"))}</legend>${Object.entries(
                model.imageSupports,
              )
                .filter(([key]) => key !== "inpaint" || model.allowInpaint)
                .map(([key, enabled]) => toggle(`image_${key}`, `endpoint_model_${key}`, enabled))
                .join("")}</fieldset>`
            : ""
        }
        ${
          model.speech
            ? `${
                model.allowVoiceMode
                  ? `<label class="field">${fieldLabel(ui("endpoint_model_voice_mode"))}${options(
                      "voiceMode",
                      model.speech.voiceMode,
                      [
                        ["clone", "voice_clone"],
                        ["voice-design", "voice_design"],
                        ["auto", "voice_auto"],
                      ],
                    )}</label>${toggle("supportsInstruct", "endpoint_model_voice_instruct", model.speech.supportsInstruct)}`
                  : ""
              }<label class="field">${fieldLabel(ui("endpoint_model_script_markup"))}${options(
                "scriptMarkup",
                model.speech.scriptMarkup,
                [
                  ["plain", "markup_plain"],
                  ["bracket-tags", "markup_brackets"],
                  ["emoji", "markup_emoji"],
                ],
              )}</label>`
            : ""
        }
        ${model.workflowMaxBytes ? `<label class="field">${fieldLabel(ui("endpoint_model_workflow"), ui("endpoint_model_workflow_hint"))}<input type="file" name="workflow" accept=".json,application/json"></label>` : ""}`;
      enhanceDashboard(dialog);
      const initial = formSnapshot(form);
      const changes = () =>
        formSnapshot(form).filter(({ name, value, checked }, index) =>
          name === "workflow"
            ? Boolean(form.elements.workflow.files[0])
            : value !== initial[index].value || checked !== initial[index].checked,
        );
      const sync = () => {
        save.disabled = changes().length === 0;
      };
      form.addEventListener("input", sync);
      form.addEventListener("change", sync);
      sync();
      save.hidden = false;
      form.onsubmit = async (event) => {
        event.preventDefault();
        const dirty = changes();
        if (!dirty.length || state.guildId !== guildId || form.classList.contains("is-saving")) return;
        try {
          await withBusyForm(form, async () => {
            const patch = {};
            for (const { name, value, checked } of dirty) {
              if (name.startsWith("flag_")) {
                patch.flags ||= {};
                patch.flags[name.slice(5)] = checked;
              } else if (name.startsWith("image_"))
                patch.imageSupports ??= formSnapshot(form)
                  .filter((field) => field.name.startsWith("image_") && field.checked)
                  .map((field) => field.name.slice(6));
              else if (name === "workflow") {
                const file = form.elements.workflow.files[0];
                try {
                  if (file.size > model.workflowMaxBytes) throw new Error();
                  patch.workflow = JSON.parse(await file.text());
                  if (!patch.workflow || typeof patch.workflow !== "object" || Array.isArray(patch.workflow))
                    throw new Error();
                } catch {
                  throw new Error(ui("endpoint_model_workflow_invalid"));
                }
              } else patch[name] = name === "numCtx" ? (value ? Number(value) : null) : (checked ?? value);
            }
            await api(path, { method: "PATCH", body: JSON.stringify(patch) });
          });
          dialog.close();
          toast(ui("endpoint_model_saved"));
          if (state.guildId === guildId) await loadProviderWorkspace(scope);
        } catch (error) {
          if (dialog.open) showFormError(form, error);
        }
      };
    } catch (error) {
      if (dialog.open) fields.textContent = error.message;
    }
  }

  async function openConnectionEditor(scope, connectionId) {
    const guildId = state.guildId;
    const path = `/guilds/${guildId}/providers/${scope}/connections/${connectionId}`;
    const dialog = document.createElement("dialog");
    dialog.className = "wide";
    dialog.setAttribute("aria-labelledby", "endpoint-edit-title");
    dialog.innerHTML = `<form class="stack">
      <header class="panel-header"><div class="heading"><p class="eyebrow">${escapeHtml(ui("connections"))}</p><h2 id="endpoint-edit-title">${escapeHtml(ui("endpoint_edit"))}</h2></div></header>
      <div class="stack" data-connection-fields>${loadingBar(ui("endpoint_edit"))}</div>
      <footer class="actions form-actions"><button class="button" type="button" data-connection-cancel>${escapeHtml(ui("endpoint_cancel"))}</button><button class="button primary" type="submit" hidden>${escapeHtml(ui("save"))}</button></footer>
    </form>`;
    const form = dialog.querySelector("form");
    const fields = form.querySelector("[data-connection-fields]");
    const save = form.querySelector('[type="submit"]');
    const focusMenu = () => {
      if (guildId === state.guildId)
        focusNavigation(
          `[popovertarget="connection-actions-${scope}"], [data-endpoint-edit="${connectionId}"][data-provider-scope="${scope}"]`,
        );
    };
    form.querySelector("[data-connection-cancel]").onclick = () => dialog.close();
    dialog.addEventListener("cancel", (event) => {
      if (form.classList.contains("is-saving")) event.preventDefault();
    });
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        focusMenu();
      },
      { once: true },
    );
    document.body.append(dialog);
    dialog.showModal();

    try {
      const connection = await api(path);
      if (!dialog.open) return;
      const hint = connection.isPreset ? "endpoint_edit_preset_hint" : "endpoint_edit_hint";
      fields.innerHTML = `<p class="hint">${escapeHtml(ui(hint))}</p>
        <label class="field">${fieldLabel(ui("endpoint_edit_label"))}<input ${connection.isPreset ? "readonly" : 'name="label" required maxlength="40"'} value="${escapeHtml(connection.label)}"></label>
        <label class="field">${fieldLabel(ui("endpoint_edit_url"), connection.isPreset ? "" : ui("endpoint_edit_url_hint"))}<input type="url" ${connection.isPreset ? "readonly" : 'name="endpointUrl" required maxlength="500"'} value="${escapeHtml(connection.endpointUrl)}"></label>
        <label class="field">${fieldLabel(ui("endpoint_edit_token"), ui("endpoint_edit_token_hint"))}<input name="authToken" type="password" maxlength="500" autocomplete="new-password"></label>
        ${connection.unloadDuringComfyUi === undefined ? "" : `<label class="toggle">${fieldLabel(ui("endpoint_edit_handoff"), ui("endpoint_edit_handoff_hint"))}<input name="unloadDuringComfyUi" type="checkbox" role="switch"${connection.unloadDuringComfyUi ? " checked" : ""}></label>`}`;
      const initial = formSnapshot(form);
      const patch = () =>
        Object.fromEntries(
          formSnapshot(form).flatMap(({ name, checked, value }, index) => {
            const previous = initial[index];
            return checked === undefined
              ? value.trim() === previous.value.trim()
                ? []
                : [[name, value.trim()]]
              : checked === previous.checked
                ? []
                : [[name, checked]];
          }),
        );
      form.addEventListener("input", () => {
        save.disabled = Object.keys(patch()).length === 0;
      });
      save.disabled = true;
      save.hidden = false;
      fields.querySelector("input[name]")?.focus({ preventScroll: true });
      form.onsubmit = async (event) => {
        event.preventDefault();
        const changes = patch();
        if (form.classList.contains("is-saving") || !Object.keys(changes).length) return;
        let result;
        try {
          result = await withBusyForm(form, () => api(path, { method: "PATCH", body: JSON.stringify(changes) }));
        } catch (error) {
          if (dialog.open) showFormError(form, error);
          return;
        }
        dialog.close();
        toast(
          ui(result.updated ? "endpoint_edit_saved" : "endpoint_edit_unchanged"),
          result.updated ? "success" : "info",
        );
        if (result.updated && guildId === state.guildId) {
          await loadProviderWorkspace(scope);
          focusMenu();
        }
      };
    } catch (error) {
      if (dialog.open) fields.innerHTML = `<p class="notice error" role="alert">${escapeHtml(error.message)}</p>`;
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
    renderMemoryChannelScope(form, state.memoryKind === "server" ? state.memoryData : null, memory);
    form.elements.memoryId.value = memory.id;
    completeFormSave(form);
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
      const messages = document.querySelector("#persona-test-chat .chat-log");
      if (messages) messages.scrollTop = messages.scrollHeight;
    });
  }

  function updatePersonaTestChat(personaId) {
    const panel = document.querySelector(`#persona-test-chat[data-persona-id="${personaId}"]`);
    const persona = state.overview?.personas.find((entry) => entry.personaId === personaId);
    if (panel && persona) {
      const template = document.createElement("template");
      template.innerHTML = renderPersonaTestChat(persona);
      panel.querySelector(".chat-log").replaceChildren(...template.content.querySelector(".chat-log").childNodes);
      panel.querySelector("[data-test-chat-reset]").disabled = !state.personaTestChats[personaId]?.length;
      const form = panel.querySelector("form");
      form.elements.message.disabled = state.personaTestChatBusy;
      form.querySelector('button[type="submit"]').disabled = state.personaTestChatBusy;
      scrollTestChat();
    }
  }

  async function removePersonaAvatar(personaId) {
    if (
      !(await confirmAction(
        ui("persona_avatar_remove_title"),
        ui("persona_avatar_remove_detail"),
        ui("persona_avatar_remove"),
      ))
    )
      return;
    try {
      await api(`/guilds/${state.guildId}/personas/${personaId}/avatar`, { method: "DELETE" });
      await refreshPersonas(personaId, ui("persona_avatar_removed"));
      document.querySelector(`[data-persona-avatar-choose="${personaId}"]`)?.focus({ preventScroll: true });
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
      if (image.parentElement.matches(".sticker, .card-stack .front")) {
        image.replaceWith(document.createTextNode(image.dataset.avatarFallback));
        return;
      }
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSettingsSearch();
      return;
    }
    const picker = event.target.closest?.("#persona-picker-dialog, #channel-personas-dialog");
    if (picker && event.key === "/" && event.target.type !== "search") {
      event.preventDefault();
      picker.querySelector("[data-persona-picker-search]").focus();
      return;
    }
    const group = event.target.closest?.(".quick, .dock, .segmented, .deck");
    const current = event.target.closest?.(
      "[data-persona-select], [data-persona-panel], [data-design-choice], [data-history-timeframe], [data-settings-group], [data-channel-tab][role=tab], [data-provider-panel][role=tab], [data-connection-select][role=tab], [data-moderation-tab][role=tab], .deck-card[aria-pressed]",
    );
    if (group?.contains(current) && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const items = [...group.querySelectorAll(":scope > button:not([hidden], [disabled], .more-pill)")];
      const index = items.indexOf(current);
      const next =
        items[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length
        ];
      if (next) {
        event.preventDefault();
        if (group.matches(".quick, .dock, .segmented")) next.click();
        if (
          next.isConnected &&
          (group.matches(".deck") || next.matches("[data-design-choice], [data-history-timeframe]"))
        )
          next.focus();
      }
      return;
    }
    const historyPoint = event.target.closest?.("[data-history-index]");
    if (historyPoint && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      selectHistoryPoint(historyPoint);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const chipInput = event.target.closest?.("[data-persona-chip-add]");
    if (chipInput) {
      event.preventDefault();
      editPersonaChips(chipInput);
      return;
    }
    const input = event.target instanceof Element ? event.target.closest("#persona-test-input") : null;
    if (!input || input.disabled || state.personaTestChatBusy) return;
    event.preventDefault();
    input.form?.requestSubmit();
  });

  document.addEventListener("dragover", (event) => {
    const zone = event.target.closest?.("[data-upload-zone]");
    const input = zone?.querySelector('input[type="file"]');
    if (!input || input.disabled || !event.dataTransfer?.types.includes("Files")) return;
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
    if (input.disabled || !file) return;
    if (!["image/png", "image/jpeg", "image/gif"].includes(file.type) && !/\.(png|jpe?g|gif)$/i.test(file.name)) {
      const error = input.form.querySelector("[data-sprite-error]");
      error.textContent = ui("control_file_invalid");
      error.hidden = false;
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  document.addEventListener("input", (event) => {
    const lighting = event.target.closest("[data-light-setting]");
    if (lighting?.validity.valid) {
      const light = appearance.lighting[appearance.theme];
      light[lighting.dataset.lightSetting] = Number(lighting.value);
      saveAppearance();
      updateDesignLightLabels(light);
      return;
    }
    captureDraft(event.target.closest(editForms));
    updateChannelCounts(event.target.closest("[data-channel-selector]"));
    if (event.target.matches("[data-persona-memory-search]")) {
      if (state.memoryData) renderMemoryList();
      return;
    }
    if (event.target.matches("[data-persona-picker-search]")) filterPersonaPicker(event.target.closest("dialog"));
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
    if (event.target.matches("[data-sprite-form] input[name=name]")) setSpriteFieldError(event.target, "");
    if (event.target.matches('[data-lorebook-form="book-rename"] input[name="name"]')) {
      event.target.removeAttribute("aria-invalid");
      const error = event.target.form.querySelector(".error");
      error.hidden = true;
      error.textContent = "";
    }
    if (event.target.matches("[data-lorebook-search-input]")) {
      filterLorebookEntries(event.target);
      const key = lorebookSelectionKey(activeLorebookLineage());
      lorebookSelections.set(key, { ...lorebookSelections.get(key), query: event.target.value });
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
    const logitAction = event.target.closest("[data-logit-open], [data-logit-remove]");
    if (logitAction) {
      if (savingForms) return;
      if (logitAction.hasAttribute("data-logit-remove")) return deleteLogitBias(logitAction);
      return openLogitBiasEditor(logitAction.closest("#logit-bias-panel"), logitAction.dataset.logitOpen);
    }
    if (event.target.closest("[data-settings-search-open]")) {
      await openSettingsSearch();
      return;
    }
    const searchResult = event.target.closest("[data-settings-search-result]");
    if (searchResult) {
      if (savingForms) {
        toast(ui("saving"));
        return;
      }
      const entry = settingsSearchEntries[Number(searchResult.dataset.settingsSearchResult)];
      if (!entry) return;
      searchResult.closest("dialog").close();
      const unsaved = [...document.querySelectorAll(localEditForms)].some(
        (form) =>
          !form.closest("[data-persona-content]") &&
          formBaselines.has(form) &&
          (form.dataset.editFile !== undefined ||
            JSON.stringify(formSnapshot(form)) !== JSON.stringify(formBaselines.get(form))),
      );
      if (unsaved && !(await confirmAction(ui("discard_title"), ui("leave_detail")))) return;
      if (!(await confirmDashboardSectionChange())) return;
      pendingSearchDestination = entry;
      setTimeout(() => {
        if (pendingSearchDestination === entry) pendingSearchDestination = null;
      }, 10000);
      state.view = entry.view;
      if (entry.settingsGroup) state.settingsGroup = entry.settingsGroup;
      if (entry.personaPanel) {
        state.personaPanel = entry.personaPanel;
        state.personaId = entry.personaId;
      }
      if (entry.scope) {
        state.providerPanel[entry.scope] = entry.providerPanel;
        if (entry.connection) state.providerConnection[entry.scope] = entry.connection;
      }
      if (entry.channelTab) channelTab = entry.channelTab;
      if (entry.moderationTab) moderationTab = entry.moderationTab;
      renderShell();
      return;
    }
    if (event.target.closest("[data-character-reference-upload]")) {
      document.getElementById("character-reference-file").click();
      return;
    }
    if (event.target.closest("[data-character-reference-remove]")) {
      await saveCharacterReference(null);
      return;
    }
    const personaReferenceAction = event.target.closest(
      "[data-persona-reference-upload], [data-persona-reference-remove]",
    );
    if (personaReferenceAction) {
      const host = personaReferenceAction.closest("[data-persona-reference]");
      if (personaReferenceAction.hasAttribute("data-persona-reference-upload")) {
        host.querySelector("[data-persona-reference-file]").click();
      } else if (
        (await confirmAction(
          ui("persona_reference_remove_title"),
          ui("persona_reference_remove_hint"),
          ui("character_reference_remove"),
        )) &&
        host.isConnected
      ) {
        await savePersonaReference(host, null);
      }
      return;
    }
    const statsPeriod = event.target.closest("[data-history-timeframe]");
    if (statsPeriod) {
      const period = statsPeriod.dataset.historyTimeframe;
      state.statsRangeEditing = period === "custom";
      if (!state.statsRangeEditing && state.statsTimeframe !== period) {
        state.statsTimeframe = period;
        void loadServerStats();
      } else {
        updateServerStatsSection(false);
      }
      return;
    }
    const editStatsRange = event.target.closest("[data-stats-range-edit]");
    if (editStatsRange || event.target.closest("[data-stats-range-cancel]")) {
      state.statsRangeEditing = Boolean(editStatsRange);
      updateServerStatsSection(false);
      if (state.statsRangeEditing) {
        document.querySelector('#stats-range-form input[name="from"]')?.focus();
      } else {
        queueMicrotask(() =>
          requestAnimationFrame(() => {
            (
              document.querySelector("[data-stats-range-summary]:not([hidden]) [data-stats-range-edit]") ||
              document.querySelector('[data-history-timeframe][aria-selected="true"]')
            )?.focus({ preventScroll: true });
          }),
        );
      }
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
        "[data-lorebook-select], [data-lorebook-edit-entry], [data-lorebook-open], [data-lorebook-channel-settings], [data-lorebook-back], [data-lorebook-rename], [data-lorebook-rename-cancel], [data-lorebook-delete-entry]",
      )
    ) {
      event.preventDefault();
      if (event.type === "holdcomplete") event.target.dispatchEvent(new Event("holdreset"));
      toast(ui("saving"));
      return;
    }
    if (event.target.closest("[data-lorebook-channel-settings]")) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (!(await confirmDraftDiscard(document.querySelector("#lorebook-workspace")))) return;
      openChannelMemorySettings();
      return;
    }
    const lorebookRetry = event.target.closest("[data-lorebook-retry]");
    if (lorebookRetry) return loadLorebooks(Number(lorebookRetry.dataset.lorebookRetry));
    if (event.target.closest("[data-lorebook-back]")) {
      const target = document.querySelector("#lorebook-workspace");
      const browser = target.querySelector("[data-lorebook-browser]");
      const editor = target.querySelector("#lorebook-editor-host");
      if (!(await confirmDraftDiscard(editor)) || !editor.isConnected) return;
      const selection = lorebookSelections.get(lorebookSelectionKey(activeLorebookLineage()));
      editor.hidden = true;
      editor.replaceChildren();
      browser.hidden = false;
      const scroller = browser.closest(".app-main");
      if (scroller && selection?.listScroll !== undefined) scroller.scrollTop = selection.listScroll;
      (
        browser.querySelector(
          `[data-lorebook-search]:not([hidden]) [data-lorebook-edit-entry="${selection?.entryId}"]`,
        ) || browser.querySelector("[data-lorebook-search-input]")
      )?.focus({ preventScroll: true });
      browser.dataset.view = "list";
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
      const bookId = Number(bookChoice.dataset.lorebookSelect);
      if (bookId === state.lorebookBookId || !(await confirmDashboardSectionChange())) return;
      const library = bookChoice.closest("[data-lorebook-library]");
      library.inert = true;
      state.lorebookBookId = bookId;
      await loadLorebooks(0);
      library.inert = false;
      document.querySelector(`[data-lorebook-select="${state.lorebookBookId}"]`)?.focus({ preventScroll: true });
      return;
    }
    const entryEditor = event.target.closest("[data-lorebook-edit-entry]");
    if (entryEditor) {
      const entryId = Number(entryEditor.dataset.lorebookEditEntry);
      openLorebookEditor(entryId);
      return;
    }
    const lorebookOpen = event.target.closest("[data-lorebook-open]");
    if (lorebookOpen) {
      const dialog = document.getElementById(lorebookOpen.dataset.lorebookOpen);
      dialog.showModal();
      dialog.addEventListener(
        "close",
        () => {
          if (dialog.isConnected) restoreLorebookDialogFocus(dialog);
        },
        { once: true },
      );
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
    const spriteCancel = event.target.closest("[data-sprite-cancel]");
    if (spriteCancel) {
      const dialog = spriteCancel.closest("dialog");
      if (!dialog.querySelector("[aria-busy=true]")) dialog.close();
      return;
    }
    const spriteTile = event.target.closest("[data-sprite-edit], [data-sprite-new]");
    if (spriteTile) {
      if (!document.querySelector("#sprite-editor[open]")) openSpriteDialog(spriteTile);
      return;
    }
    if (event.target.closest("[data-sprite-import]")) {
      document.querySelector("[data-sprite-archive]").click();
      return;
    }
    const spriteRemove = event.target.closest("[data-sprite-remove]");
    if (spriteRemove) {
      if (event.type !== "holdcomplete") return;
      const form = spriteRemove.form;
      const personaId = Number(form.dataset.personaId);
      const path = `/guilds/${state.guildId}/personas/${personaId}/sprites?key=${encodeURIComponent(form.dataset.spriteKey)}`;
      const error = form.querySelector("[data-sprite-error]");
      error.hidden = true;
      try {
        await withBusyForm(form, async () => {
          const result = await api(path, { method: "DELETE" });
          form.closest("dialog").close();
          await refreshPersonas(personaId, result.message);
          document.querySelector('[data-persona-panel="sprites"]')?.focus({ preventScroll: true });
        });
      } catch (failure) {
        if (form.isConnected) {
          error.textContent = failure.message;
          error.hidden = false;
          spriteRemove.dispatchEvent(new Event("holdreset"));
        } else toast(failure.message, "error");
      }
      return;
    }
    const spriteExport = event.target.closest("[data-sprite-export]");
    if (spriteExport) {
      spriteExport.disabled = true;
      try {
        const response = await downloadAttachment(
          `/guilds/${state.guildId}/personas/${state.personaId}/sprites/export`,
          "sprites.zip",
        );
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
        "[data-nav], [data-persona-select], [data-persona-panel], [data-settings-group], [data-provider-panel], [data-guild-select], [data-overview-refresh], [data-provider-refresh]",
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
    const namingReset = event.target.closest("[data-persona-naming-reset]");
    if (namingReset) {
      await saveNamingOrCategories(namingReset.form, null, true);
      return;
    }
    const categoriesReset = event.target.closest("[data-stm-categories-reset]");
    if (categoriesReset) {
      await saveNamingOrCategories(null, categoriesReset.form, true);
      return;
    }
    const removeChip = event.target.closest("[data-persona-chip-remove]");
    if (removeChip) {
      editPersonaChips(removeChip);
      return;
    }
    const discard = event.target.closest("[data-discard-draft]");
    if (discard) {
      const form = discard.form;
      const panel = discard.closest("[data-channel-panel]") || form;
      if (await confirmAction(ui("discard_title"), ui("discard_detail"))) {
        restoreSnapshot(panel, formBaselines.get(form));
        if (form.matches("#persona-channel-workspace form")) form.dispatchEvent(new Event("change"));
        if (form.matches("[data-channel-settings]")) form.dispatchEvent(new Event("change", { bubbles: true }));
        captureDraft(form);
        enhanceDashboard(form);
        panel.querySelector(".form-error")?.remove();
        panel
          .querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
          ?.focus({ preventScroll: true });
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
        if (!(await confirmDashboardSectionChange())) return;
        await selectGuild(guildSelect.dataset.guildSelect);
      }
      return;
    }
    const historyPoint = event.target.closest("[data-history-index]");
    if (historyPoint) {
      selectHistoryPoint(historyPoint);
      return;
    }
    if (event.target.closest("[data-stats-retry], [data-stats-refresh]")) {
      if (state.serverStatsLoading) return;
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
    const designChoice = event.target.closest("[data-design-choice]");
    if (designChoice) {
      appearance[designChoice.dataset.designChoice] = designChoice.value;
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
        layout: "boxed",
        personaColors: true,
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
      const { providerScope, connectionSelect } = connectionTab.dataset;
      if (providerScope === "server") {
        if (!(await switchServerProviderConnection(connectionSelect, connectionTab))) {
          connectionTab.parentElement?.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
        }
        return;
      }
      state.providerConnection[providerScope] = connectionSelect;
      renderView();
      focusNavigation(`button[data-connection-select="${CSS.escape(connectionTab.dataset.connectionSelect)}"]`);
      return;
    }
    const providerPanel = event.target.closest("[data-provider-panel]");
    if (providerPanel) {
      const { providerScope, providerPanel: panel } = providerPanel.dataset;
      if (providerScope === "server") {
        if (panel === state.providerPanel.server || !(await confirmDashboardSectionChange())) return;
        if (!providerPanel.isConnected) return;
      }
      state.providerPanel[providerScope] = panel;
      renderView();
      focusNavigation(`[data-provider-panel="${providerPanel.dataset.providerPanel}"]`);
      return;
    }
    const providerOpen = event.target.closest("[data-provider-open]");
    if (providerOpen) {
      const form = document.querySelector("#provider-credential-form");
      form.reset();
      if (providerOpen.dataset.providerOpen) form.elements.provider.value = providerOpen.dataset.providerOpen;
      if (form.dataset.providerScope === "server") updateServerProviderRegistration(form);
      document.querySelector("#provider-dialog")?.showModal();
      return;
    }
    if (event.target.closest("[data-endpoint-open]")) {
      document.querySelector("#endpoint-dialog")?.showModal();
      return;
    }
    const endpointEdit = event.target.closest("[data-endpoint-edit]");
    if (endpointEdit) {
      void openConnectionEditor(endpointEdit.dataset.providerScope, endpointEdit.dataset.endpointEdit);
      return;
    }
    const endpointModelEdit = event.target.closest("[data-endpoint-model-edit]");
    if (endpointModelEdit) {
      void openEndpointModelEditor(endpointModelEdit);
      return;
    }
    const rotationKeys = event.target.closest("[data-provider-rotation]");
    if (rotationKeys) {
      void openRotationKeys(rotationKeys);
      return;
    }
    if (event.target.closest("[data-persona-create-open]")) {
      document.querySelector("#persona-picker-dialog[open]")?.close();
      document.querySelector("#persona-create-dialog")?.showModal();
      return;
    }
    if (event.target.closest("[data-persona-import-open]")) {
      document.querySelector("#persona-picker-dialog[open]")?.close();
      document.querySelector("#persona-import-dialog")?.showModal();
      return;
    }
    const mainPersonaChange = event.target.closest("[data-main-persona-change]");
    if (mainPersonaChange) {
      void openMainPersonaChange(mainPersonaChange);
      return;
    }
    const personaExport = event.target.closest("[data-persona-export-format]");
    if (personaExport) {
      const format = personaExport.dataset.personaExportFormat;
      personaExport.disabled = true;
      try {
        await downloadAttachment(
          `/guilds/${state.guildId}/personas/${state.personaId}/export?format=${format}`,
          `tomori-preset.${format}`,
        );
      } catch (error) {
        toast(error.message, "error");
      } finally {
        personaExport.disabled = false;
      }
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
    if (event.target.closest("[data-test-chat-open], [data-test-chat-close]")) {
      setPersonaChat(Boolean(event.target.closest("[data-test-chat-open]")));
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
      window.TomoriFX.stagger(dialog.querySelector(".deck"));
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
        else window.TomoriFX.swap(entry, renderPersonaEntryContent(persona, kind, index, collection[Number(index)]));
      } else if (!document.querySelector(`[data-entry-kind="${kind}"][data-entry-index="new"]`)) {
        entryAdd
          .closest("section")
          .querySelector("[data-persona-entries]")
          .insertAdjacentHTML("afterbegin", renderPersonaEntry(persona, kind, index, {}));
      }
      const editor = document.querySelector(
        `[data-entry-kind="${kind}"][data-entry-index="${index}"] [data-persona-entry-form]`,
      );
      if (editor) {
        initLocalEditForm(editor);
        enhanceDashboard(editor);
        editor.querySelector("textarea")?.focus();
      }
      return;
    }
    const personaSelect = event.target.closest("[data-persona-select]");
    if (personaSelect) {
      const nextPersona = Number(personaSelect.dataset.personaSelect);
      if (
        state.personaId !== nextPersona &&
        state.view === "personas" &&
        !(await confirmPersonaSectionChange(document.querySelector("[data-persona-content]")))
      )
        return;
      state.view = "personas";
      personaSelect.closest("dialog")?.close();
      if (state.personaId === nextPersona) return;
      state.personaId = nextPersona;
      state.memoryData = null;
      const fromQuickBar = Boolean(personaSelect.closest(".quick"));
      renderView();
      focusNavigation(fromQuickBar ? '.quick [aria-checked="true"]' : "[data-persona-picker-open]");
      return;
    }
    const personaPanel = event.target.closest("[data-persona-panel]");
    if (personaPanel) {
      const tab = personaPanel.dataset.personaPanel;
      const panel = tab === "knowledge" ? state.personaKnowledgePanel : tab;
      if (panel === state.personaPanel) return;
      if (!(await confirmPersonaSectionChange(document.querySelector("[data-persona-content]")))) return;
      state.personaPanel = panel;
      state.memoryData = null;
      renderView();
      focusNavigation(`[data-persona-panel="${tab}"]`);
      return;
    }
    const promptPresets = event.target.closest("[data-system-prompt-presets]");
    if (promptPresets) {
      void openSystemPromptPresets(promptPresets);
      return;
    }
    const settingsGroup = event.target.closest("[data-settings-group]");
    if (settingsGroup) {
      if (state.settingsGroup === settingsGroup.dataset.settingsGroup) return;
      state.settingsGroup = settingsGroup.dataset.settingsGroup;
      renderSettings(settingsGroup.closest("[data-dashboard-view]"));
      settingsGroup.focus({ preventScroll: true });
      return;
    }
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      if (state.view === nav.dataset.nav) {
        document.querySelector("#navigation-sheet[open]")?.close();
        return;
      }
      if (!(await confirmDashboardSectionChange())) return;
      state.view = nav.dataset.nav;
      state.memoryData = null;
      renderView();
      focusNavigation(`.nav-stack [data-nav="${state.view}"]`);
      return;
    }
    const personalStm = event.target.closest("[data-personal-stm-refresh], [data-personal-stm-clear]");
    if (personalStm) {
      const panel = personalStm.closest("#personal-stm");
      if (personalStm.hasAttribute("data-personal-stm-refresh")) await loadPersonalStm(panel);
      else await clearPersonalStm(panel);
      return;
    }
    const memoryAdd = event.target.closest("[data-memory-add]");
    if (memoryAdd) {
      setMemoryComposer(document.getElementById("memory-compose-form"), true);
      return;
    }
    const memoryCancel = event.target.closest("[data-memory-cancel]");
    if (memoryCancel) {
      setMemoryComposer(memoryCancel.form, false);
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
    if (event.target.closest('[data-memory-export]:not([aria-disabled="true"])')) await exportMemories();
    if (event.target.closest('[data-memory-import]:not([aria-disabled="true"])'))
      document.querySelector("#memory-import-file")?.click();
    const providerRefresh = event.target.closest("[data-provider-refresh]");
    if (providerRefresh) await refreshProviders(providerRefresh.dataset.providerRefresh, "Providers refreshed");
    const draftingRefresh = event.target.closest("[data-drafting-refresh]");
    if (draftingRefresh) return loadDraftingPanel(draftingRefresh.closest("#response-drafting-workspace"));
    const providerDelete = event.target.closest("[data-provider-delete]");
    if (providerDelete) await deleteProvider(providerDelete.dataset.providerDelete);
    const serverProviderDelete = event.target.closest("[data-server-provider-delete]");
    if (serverProviderDelete) return deleteServerProvider(serverProviderDelete);
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
        await refreshOverview(ui("settings_refreshed"), currentKeys);
      } catch (error) {
        toast(error.message, "error");
      }
    }
  }
  document.addEventListener("click", handleDashboardAction);
  document.addEventListener("holdcomplete", handleDashboardAction);

  document.addEventListener("change", async (event) => {
    if (event.target.matches('#provider-credential-form[data-provider-scope="server"] select[name="provider"]')) {
      updateServerProviderRegistration(event.target.form);
      return;
    }
    if (event.target.matches("[data-server-provider-select]")) {
      const select = event.target;
      if (!(await switchServerProviderConnection(select.value, select)) && select.isConnected) {
        select.value = state.providerConnection.server;
        select.dispatchEvent(new Event("input"));
      }
      return;
    }
    if (event.target.matches("[data-persona-picker-sort]")) sortPersonaPicker(event.target.closest("dialog"));
    if (event.target.matches("[data-memory-channel-limit]"))
      event.target.form.querySelector("[data-memory-channel-picker]").hidden = !event.target.checked;
    if (event.target.matches("[data-persona-habit-style]")) {
      const select = event.target;
      const style = select.value;
      select.value = select.form.dataset.personaHabitForm;
      select.dispatchEvent(new Event("input"));
      for (const form of select.closest("[data-persona-habits]").querySelectorAll("[data-persona-habit-form]")) {
        form.hidden = form.dataset.personaHabitForm !== style;
        if (!form.hidden) form.querySelector("[data-persona-habit-style]").focus({ preventScroll: true });
      }
      return;
    }
    if (event.target.matches("[data-personal-capability]")) {
      await togglePersonalCapability(event.target);
      return;
    }
    if (event.target.matches("[data-persona-humanizer-mode]")) {
      event.target.form.querySelector("[data-persona-humanizer-fields]").hidden = event.target.value === "inherit";
    }
    if (event.target.matches('#openrouter-form select[name="capability"]')) {
      updateOpenRouterHint(event.target.form);
    }
    if (event.target.id === "character-reference-file") {
      const file = event.target.files?.[0];
      if (file) await saveCharacterReference(file);
      event.target.value = "";
      return;
    }
    if (event.target.matches('#fallback-form select[name^="fallback-"]')) {
      updateFallbackSlots(event.target.form);
    }
    if (event.target.matches("[data-design-remember]")) {
      setRememberDesign(event.target.checked);
      event.target.checked = rememberDesign;
      return;
    }
    if (event.target.matches("[data-design-persona-colors]")) {
      appearance.personaColors = event.target.checked;
      saveAppearance();
      return;
    }
    if (event.target.matches("[data-design-setting]")) {
      appearance[event.target.dataset.designSetting] = event.target.value;
      saveAppearance();
      return;
    }
    if (event.target.matches("[data-lorebook-book-enabled]")) {
      const input = event.target;
      const lineageId = activeLorebookLineage();
      const guildId = state.guildId;
      const target = document.querySelector("#lorebook-workspace");
      const scope = lorebookScope(lineageId);
      const dialog = input.closest("dialog");
      input.disabled = true;
      try {
        await api(`/guilds/${guildId}/lorebooks/books/${scope.bookId}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: input.checked }),
        });
        if (lorebookCurrent(lineageId, target, guildId) && (lineageId !== 0 || scope.bookId === state.lorebookBookId)) {
          await loadLorebooks(lineageId);
          if (!lorebookCurrent(lineageId, target, guildId)) return;
          if (dialog) document.getElementById(dialog.id)?.showModal();
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
    if (event.target.matches('[data-sprite-form] input[type="file"]')) {
      const { form, files } = event.target;
      const preview = form.querySelector("[data-sprite-preview]");
      const file = files[0];
      form.querySelector("[data-sprite-error]").hidden = true;
      if (!file || file.size > form._spriteImageLimit) {
        preview.innerHTML = renderSpritePreview(form._spriteImageUrl);
        return;
      }
      const reader = new FileReader();
      reader.addEventListener(
        "load",
        () => {
          if (!preview.isConnected || reader.result === null || event.target.files[0] !== file) return;
          preview.innerHTML = renderSpritePreview(reader.result);
        },
        { once: true },
      );
      reader.readAsDataURL(file);
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
    captureDraft(event.target.closest(editForms));
    const namingMode = event.target.closest("[data-naming-mode]");
    if (namingMode) {
      const input = namingMode.form.elements[namingMode.dataset.namingMode];
      input.disabled = namingMode.value !== "custom";
      input.closest(".field").hidden = input.disabled;
    }
    if (event.target.id === "memory-import-file" && event.target.files?.[0]) {
      await importMemories(event.target.files[0]);
      event.target.value = "";
    }
    const avatarInput = event.target.closest("[data-persona-avatar-file]");
    if (event.target.matches("[data-persona-reference-file]")) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) await savePersonaReference(event.target.closest("[data-persona-reference]"), file);
      return;
    }
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
    if (event.submitter?.matches("[data-edit-action][hidden]")) {
      event.preventDefault();
      return;
    }
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
      void loadServerStats();
      document.querySelector("[data-stats-range-edit]")?.focus({ preventScroll: true });
      return;
    }
    if (event.target.classList.contains("is-saving")) {
      event.preventDefault();
      return;
    }
    if (event.target.matches("[data-persona-habit-form]")) {
      event.preventDefault();
      try {
        await savePersonaNamingHabits(event.target);
      } catch (error) {
        if (event.target.isConnected) showFormError(event.target, error);
      }
      return;
    }
    if (event.target.matches("[data-persona-attg], [data-persona-voice]")) {
      event.preventDefault();
      try {
        if (event.target.hasAttribute("data-persona-attg")) await savePersonaAttg(event.target);
        else await savePersonaVoice(event.target);
      } catch (error) {
        if (event.target.isConnected) showFormError(event.target, error);
      }
      return;
    }
    if (event.target.matches("[data-lorebook-form], [data-lorebook-import-form]")) {
      event.preventDefault();
      try {
        if (event.target.hasAttribute("data-lorebook-import-form")) await importLorebook(event.target);
        else await saveLorebookForm(event.target);
      } catch (error) {
        if (event.target.closest("dialog") || event.target.closest("#lorebook-editor-host")?.matches(".stage"))
          showFormError(event.target, error);
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
      const file = form.elements.file.files[0];
      body.set("identity", String(form.elements.identity.checked));
      if (!file) body.delete("file");
      const error = form.querySelector("[data-sprite-error]");
      error.hidden = true;
      if (!editing && !file) {
        error.textContent = ui("sprite_file_hint");
        error.hidden = false;
        form.elements.file.focus();
        return;
      }
      if (!form.querySelector("[data-sprite-confirm]").hidden || form.hasAttribute("aria-busy")) return;
      if (!editing && !(await confirmSpriteAction(form, ui("sprite_add"), ui("sprite_add_detail"), ui("sprite_add"))))
        return;
      try {
        await withBusyForm(form, async () => {
          const result = await api(path, { method: editing ? "PUT" : "POST", body });
          form.closest("dialog").close();
          await refreshPersonas(personaId, result.message);
          document.querySelector('[data-persona-panel="sprites"]')?.focus({ preventScroll: true });
        });
      } catch (failure) {
        if (form.isConnected) {
          error.textContent = failure.message;
          error.hidden = false;
        } else toast(failure.message, "error");
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
      form.reset();
      const chats = state.personaTestChats;
      const history = [...(chats[personaId] || []).slice(-23), { role: "user", content }];
      chats[personaId] = history;
      state.personaTestChatBusy = true;
      updatePersonaTestChat(personaId);
      try {
        const result = await api(`/guilds/${state.guildId}/personas/test-chat`, {
          method: "POST",
          body: JSON.stringify({ personaId, messages: history.map(({ role, content }) => ({ role, content })) }),
        });
        chats[personaId] = [
          ...history,
          { role: "assistant", content: result.content, segments: result.segments },
        ].slice(-24);
      } catch (error) {
        toast(error.message, "error");
      } finally {
        if (state.personaTestChats === chats) {
          state.personaTestChatBusy = false;
          updatePersonaTestChat(state.personaId);
        }
      }
      return;
    }

    if (event.target.matches("#provider-credential-form, #endpoint-form")) {
      event.preventDefault();
      const form = event.target;
      const scope = form.dataset.providerScope;
      const provider = form.elements.provider?.value;
      const endpoint = form.id === "endpoint-form" || (scope === "server" && provider === "other");
      const payload = endpoint
        ? {
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
          }
        : { provider, apiKey: form.elements.apiKey.value };
      try {
        await withBusyForm(form, () =>
          api(`/guilds/${state.guildId}/providers/${scope}/${endpoint ? "endpoints" : "credentials"}`, {
            method: "POST",
            body: JSON.stringify(payload),
          }),
        );
        form.reset();
        form.closest("dialog")?.close();
        if (!endpoint) state.providerConnection[scope] = `provider:${provider}`;
        toast(endpoint ? "Endpoint tested and registered" : "Provider key stored");
        await refreshProviders(scope);
      } catch (error) {
        if (endpoint) showFormError(form, error);
        else toast(error.message, "error");
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
        updateOpenRouterHint(form);
        if (scope === "server") completeFormSave(form);
        const message =
          result?.model?.capability === "transcription"
            ? ui("openrouter_transcription_saved")
            : result?.status === "already_available"
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
      const transcription = form.elements.transcription;
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
              ...(transcription && transcription.value !== transcription.dataset.originalModel
                ? { transcription: transcription.value ? JSON.parse(transcription.value) : null }
                : {}),
            }),
          });
        });
        completeFormSave(form);
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

    if (event.target.matches("[data-drafting-selections], [data-advanced-models]")) {
      event.preventDefault();
      const advanced = event.target.matches("[data-advanced-models]");
      const resource = advanced ? "providers/server/model-targets" : "settings/response-drafting";
      const update = advanced
        ? (name, value) => {
            const slot = state.providerData.server?.advancedModels.find((model) => model.kind === name);
            if (slot) slot.selected = value;
          }
        : undefined;
      await saveModelSelections(
        event.target,
        `/guilds/${state.guildId}/${resource}`,
        advanced ? "advanced_models_saved" : "drafting_saved",
        update,
      );
      return;
    }

    if (event.target.matches("[data-profile-section]")) {
      event.preventDefault();
      const form = event.target;
      const baseline = formBaselines.get(form);
      const patch = {};
      for (const input of form.querySelectorAll("input[name], select[name], textarea[name]")) {
        const original = baseline.find(({ name }) => name === input.name);
        if (original?.value === input.value && (input.type !== "checkbox" || original.checked === input.checked))
          continue;
        if (input.type === "checkbox") patch[input.name] = input.checked;
        else if (input.name === "privacy_level") patch[input.name] = Number(input.value);
        else if (input.name === "timezone_offset") patch[input.name] = input.value === "" ? null : Number(input.value);
        else if (input.name === "physical_appearance_tags") patch[input.name] = parseTags(input.value);
        else patch[input.name] = input.value || null;
      }
      if (!Object.keys(patch).length) return;
      try {
        await withBusyForm(form, async () => {
          const result = await api("/profile", { method: "PATCH", body: JSON.stringify(patch) });
          state.overview.profile = result.profile;
          for (const [name, key] of [
            ["user_nickname", "nickname"],
            ["prefix_override", "prefix"],
            ["suffix_override", "suffix"],
          ]) {
            if (name in patch) form.elements[name].value = result.profile[key] ?? "";
          }
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
      if (form.hidden) return;
      try {
        await withBusyForm(form, () =>
          api(`/guilds/${state.guildId}/memories/${state.memoryKind}`, {
            method: "POST",
            body: JSON.stringify({
              lineageId: state.lineageId,
              content: form.elements.content.value,
              tags: state.memoryKind === "personal" ? parseTags(form.elements.tags.value).slice(0, 5) : [],
              ...collectMemoryChannelPatch(form),
            }),
          }),
        );
        if (!form.isConnected) return;
        setMemoryComposer(form, false);
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
        const channelPatch = collectMemoryChannelPatch(form);
        await withBusyForm(form, () =>
          api(`/guilds/${state.guildId}/memories/${state.memoryKind}/${form.elements.memoryId.value}`, {
            method: "PATCH",
            body: JSON.stringify({
              lineageId: state.lineageId,
              content: form.elements.content.value,
              tags: state.memoryKind === "personal" ? parseTags(form.elements.tags.value).slice(0, 5) : [],
              ...channelPatch,
            }),
          }),
        );
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
      await saveNamingOrCategories(namingForm, categoriesForm, false);
      return;
    }

    const allowlistForm = event.target.closest("[data-channel-allowlist]");
    if (allowlistForm) {
      event.preventDefault();
      const previous = new Set(allowlistForm._allowed);
      const selected = new Set(
        [...allowlistForm.querySelectorAll('[name="allowedChannels"]:checked')].map((input) => input.value),
      );
      const visible = new Set(
        [...allowlistForm.querySelectorAll('[name="allowedChannels"]')].map((input) => input.value),
      );
      if (!selected.size) return;
      if (!previous.size && selected.size === visible.size) return;
      const added = [...selected].filter((id) => !previous.has(id));
      const removed = [...previous].filter((id) => visible.has(id) && !selected.has(id));
      if (!added.length && !removed.length) return;
      if (!(await confirmAction(ui("channel_restrictions"), ui("channel_restrictions_confirm")))) return;
      const guildId = state.guildId;
      let saved = false;
      try {
        await withBusyForm(allowlistForm, async () => {
          for (const [channelIds, allowlisted] of [
            [added, true],
            [removed, false],
          ]) {
            if (channelIds.length) {
              await api(`/guilds/${guildId}/channel-settings`, {
                method: "PATCH",
                body: JSON.stringify({ channelIds, patch: { allowlisted } }),
              });
              saved = true;
            }
          }
          completeFormSave(allowlistForm);
          state.overview = await api(`/guilds/${guildId}/overview`);
        });
        if (allowlistForm.isConnected) void renderChannelSettings(allowlistForm.closest("[data-dashboard-view]"));
        toast(ui("channel_saved"));
      } catch (error) {
        showFormError(allowlistForm, error, saved);
      }
      return;
    }
    const channelForm = event.target.closest("[data-channel-settings]");
    if (channelForm) {
      event.preventDefault();
      const panel = event.submitter?.closest("[data-channel-panel]");
      if (!panel) return;
      for (const input of panel.querySelectorAll("input[name], select[name], textarea[name]")) {
        if (!input.reportValidity()) return;
      }
      const selected = new Set(
        [...channelForm.querySelectorAll('[name="selectedChannels"]:checked')].map((input) => input.value),
      );
      if (!selected.size) return;
      const extraPatch = collectChannelOverrides(channelForm);
      for (const key of Object.keys(extraPatch)) {
        if (!panel.querySelector(`[name="channel_${key}"]`)) delete extraPatch[key];
      }
      const pendingPanels = [...channelForm.querySelectorAll("[data-channel-panel]")]
        .filter((entry) => entry !== panel)
        .map((entry) => [entry, formSnapshot(entry)]);
      if (
        (extraPatch.allowlisted !== undefined || extraPatch.personaAllowed !== undefined) &&
        !(await confirmAction(ui("channel_restrictions"), ui("channel_restrictions_confirm")))
      )
        return;
      let saved = false;
      try {
        await withBusyForm(channelForm, async () => {
          const overview = await api(`/guilds/${state.guildId}/overview`);
          const patches = new Map();
          for (const [sectionId, key] of channelSettingsFields) {
            if (!panel.querySelector(`[name="${key}"]`)) continue;
            const mode = channelForm.elements[key].value;
            if (mode === "keep") continue;
            const ids = new Set(overview.settings.values[sectionId][key] || []);
            if (selected.size === 1 && channelWorkspaces.get(channelForm)?.basic?.[key] === (mode === "on")) continue;
            selected.forEach((id) => {
              if (mode === "on") ids.add(id);
              else ids.delete(id);
            });
            if (!patches.has(sectionId)) patches.set(sectionId, {});
            patches.get(sectionId)[key] = [...ids];
          }
          for (const [sectionId, patch] of patches) {
            const result = await api(`/guilds/${state.guildId}/settings/${sectionId}`, {
              method: "PATCH",
              body: JSON.stringify(patch),
            });
            state.overview.settings.values[sectionId] = result.values;
            Object.keys(patch).forEach((key) => {
              channelForm.elements[key].value = "keep";
            });
            saved = true;
          }
          if (Object.keys(extraPatch).length) {
            await api(`/guilds/${state.guildId}/channel-settings`, {
              method: "PATCH",
              body: JSON.stringify({ channelIds: [...selected], patch: extraPatch }),
            });
            Object.keys(extraPatch).forEach((key) => {
              channelForm.elements[`channel_${key}`].value = "keep";
            });
            saved = true;
          }
          completeFormSave(channelForm, panel);
        });
        channelWorkspaces.delete(channelForm);
        channelForm._pendingPanels = pendingPanels;
        channelForm.dispatchEvent(new Event("change", { bubbles: true }));
        toast(ui("channel_saved"));
      } catch (error) {
        captureDraft(channelForm);
        showFormError(panel, error, saved);
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
            const savedFields = new Set(section.fields.map((field) => field.key));
            const baseline = formBaselines.get(settingsForm);
            const snapshot = formSnapshot(settingsForm);
            const changed = snapshot.some(
              (field, index) =>
                savedFields.has(field.name) &&
                (field.value !== baseline[index].value || field.checked !== baseline[index].checked),
            );
            if (settingsForm.dataset.fx === "track" && !changed) continue;
            const patch = collectSettingsPatch(settingsForm, section);
            if (!Object.keys(patch).length) continue;
            const result = await api(`/guilds/${state.guildId}/settings/${section.id}`, {
              method: "PATCH",
              body: JSON.stringify(patch),
            });
            state.overview.settings.values[section.id] = result.values;
            if (section.id === "byok") state.providerData.personal = null;
            formBaselines.set(
              settingsForm,
              baseline.map((value, index) => (savedFields.has(value.name) ? snapshot[index] : value)),
            );
            captureDraft(settingsForm);
            savedSections += 1;
          }
          completeFormSave(settingsForm);
        });
        toast(ui("settings_card_saved").replace("{name}", () => settingsForm.dataset.settingsPanelTitle));
      } catch (error) {
        if (savedSections > 0) {
          syncTrackedDraft(settingsForm);
          captureDraft(settingsForm);
        }
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
                  ? JSON.parse(values.triggerWords.value)
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
              : section === "humanizer"
                ? {
                    override:
                      values.humanizerMode.value === "inherit"
                        ? null
                        : Object.fromEntries(
                            [...personaForm.querySelectorAll("[data-persona-humanizer-fields] input")].map((input) => [
                              input.name,
                              input.checked,
                            ]),
                          ),
                  }
                : { physicalAppearanceTags: JSON.parse(values.physicalAppearanceTags.value) };
      try {
        await withBusyForm(personaForm, async () => {
          await api(`/guilds/${state.guildId}/personas/${personaId}/${section}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
          completeFormSave(personaForm);
          await refreshPersonas(null, ui("persona_saved"));
        });
      } catch (error) {
        if (personaForm.isConnected) showFormError(personaForm, error);
        toast(error.message, "error");
      }
    }
  });

  async function boot() {
    try {
      await refreshPublicSite();
    } catch {
      state.publicSite = null;
    }
    try {
      const session = await api("/session");
      state.session = session;
      state.csrfToken = session.csrfToken;
      if (!session.guilds.length) {
        if (session.user.isGlobalAdmin && state.publicSite) {
          state.view = "site-admin";
          return renderShell();
        }
        return renderNoGuilds();
      }
      const guildId = new URLSearchParams(window.location.search).get("guild");
      const guild = session.guilds.find((item) => item.id === guildId) || session.guilds[0];
      if (window.location.hash === "#lorebooks") state.view = "lorebooks";
      if (window.location.hash === "#settings") state.view = "settings";
      if (window.location.hash === "#channel-settings") state.view = "channel-settings";
      if (window.location.hash === "#server-providers") state.view = "server-providers";
      if (window.location.hash === "#moderation") state.view = "moderation";
      await selectGuild(guild.id);
      if (window.location.hash === "#channel-scoped-memory") openChannelMemorySettings();
    } catch {
      renderLoggedOut();
    }
  }

  boot();
})();
