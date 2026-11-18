(() => {
  const setHiddenValue = (input, next) => {
    input.value = JSON.stringify(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  function nudgeToolFields(e, inputField, t) {
    const chips = (ids, labels, field) =>
      ids
        .map(
          (id) =>
            `<span class="chip">${e(labels[id])}${
              field
                ? `<button class="chip-x" type="button" value="${e(id)}" data-nudge-remove-option="${field}" aria-label="${e(t("remove_item", { name: labels[id] }))}">×</button>`
                : ""
            }</span>`,
        )
        .join("");

    const field = (name, labels, initial, hint, choose) => `<div class="stack" data-nudge-tool-field="${name}">
      ${inputField(
        t(name),
        `<select data-searchable data-nudge-tool="${name}"><option value="">${e(t(choose))}</option>
        ${Object.entries(labels)
          .map(([id, label]) => `<option value="${e(id)}">${e(label)}</option>`)
          .join("")}</select>`,
        t(hint),
      )}
      <div class="chips" data-nudge-tool-chips></div><input type="hidden" name="${name}" value="${e(JSON.stringify(initial))}"></div>`;

    function update(panel, registry, limit) {
      const needed = JSON.parse(panel.elements.prerequisites.value);
      for (const wrapper of panel.querySelectorAll("[data-nudge-tool-field]")) {
        const name = wrapper.dataset.nudgeToolField;
        const chosen = JSON.parse(panel.elements.namedItem(name).value);
        const list = wrapper.querySelector("[data-nudge-tool-chips]");
        list.innerHTML = chips(chosen, name === "prerequisites" ? registry.requirements : registry.tools, name);
        list.hidden = !chosen.length;
        const select = wrapper.querySelector("select");
        for (const option of select.options)
          option.disabled =
            chosen.includes(option.value) || (name === "recommended" && needed.includes(`tool:${option.value}`));
        select.value = "";
        select.disabled = chosen.length >= limit;
      }
      window.TomoriControls.enhance(panel);
    }

    function remove(button) {
      const field = button.form.elements.namedItem(button.dataset.nudgeRemoveOption);
      const picker = button.closest("[data-nudge-tool-field]").querySelector(".field button");
      setHiddenValue(
        field,
        JSON.parse(field.value).filter((key) => key !== button.value),
      );
      picker?.focus();
    }

    function add(select, limit) {
      if (!select.matches("[data-nudge-tool]") || !select.value) return;
      const { form: panel, value } = select;
      const field = panel.elements.namedItem(select.dataset.nudgeTool);
      const chosen = JSON.parse(field.value);
      if (chosen.length >= limit || chosen.includes(value)) return;
      setHiddenValue(field, [...chosen, value]);
      if (field.name !== "prerequisites" || !value.startsWith("tool:")) return;
      const recommended = panel.elements.recommended;
      const previous = JSON.parse(recommended.value);
      if (previous.includes(value.slice(5)))
        setHiddenValue(
          recommended,
          previous.filter((id) => id !== value.slice(5)),
        );
    }

    return { chips, field, update, add, remove };
  }

  function readNudgeContent(panel) {
    return {
      title: panel.elements.title.value.trim(),
      brief: panel.elements.brief.value.trim(),
      agendaHint: panel.elements.agenda.value.trim(),
      prerequisites: JSON.parse(panel.elements.prerequisites.value),
      recommendedTools: JSON.parse(panel.elements.recommended.value),
    };
  }

  async function render(workspace, ctx) {
    const {
      api,
      ui,
      escapeHtml: e,
      navigationIcon: icon,
      fieldLabel,
      personaCardHead: head,
      cardSaveActions: actions,
      renderChannelSelector,
      personas,
      renderPersonaQuickStickers: stickers,
      personaPickerTileContent,
      personaPickerSearchText,
      initDraftForms,
      enhanceDashboard,
      withBusyForm,
      completeFormSave,
      showFormError,
      confirmDraftDiscard,
      loadingBar,
      toast,
    } = ctx;
    const root = document.createElement("div");
    root.dataset.nudgeWorkspace = "";
    const path = `/guilds/${ctx.guildId}/natural-nudges`;
    const studioPath = `${path}/studio`;
    const $ = (selector, node = root) => node.querySelector(selector);
    const title = e(ui("nudge_title"));
    const tabs = { settings: "settings-2", models: "plug", advanced: "sliders-horizontal", studio: "book-open" };
    const categories = ["ping_user", "revive_topic", "start_topic", "play_scene"];
    const personaById = new Map(personas.map((persona) => [persona.personaId, persona]));
    const personaIds = [...personaById.keys()];
    const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
    let settings;
    let category = "ping_user";
    let studio;
    let studioRequest = 0;
    let entry = null;
    let tab = ctx.initialTab in tabs ? ctx.initialTab : "settings";
    const t = (key, vars = {}) =>
      (settings?.copy[key] || ui(`nudge_${key}`) || ui(key) || "").replace(/\{(\w+)\}/g, (match, name) =>
        Object.hasOwn(vars, name) ? vars[name] : match,
      );
    const c = (key, vars) => e(t(key, vars));

    workspace.replaceChildren(root);
    root.innerHTML = `
      <section class="banner compact" aria-labelledby="natural-nudge-title">
        <div class="banner-info"><div class="stack">
          <p class="crumb">${e(ui("nav_server_administration"))}<span class="kind">${e(ui("settings_managers_only"))}</span></p>
          <h1 id="natural-nudge-title" data-fx="split">${title}</h1>
          <p class="banner-text">${e(ui("nudge_hint"))}</p>
        </div></div>
        <div class="banner-art" aria-hidden="true"><span class="sticker emblem">${icon("bell")}</span></div>
      </section>
      <div data-nudge-page>${loadingBar(ui("loading") || ui("nudge_title"))}</div>`;
    const page = $("[data-nudge-page]");
    const current = () => root.isConnected && ctx.isCurrent();
    const enhance = (node) => {
      initDraftForms(node);
      enhanceDashboard(node);
    };
    const form = (
      name,
      titleText,
      hint,
      body,
    ) => `<form class="card" data-fx="track" data-nudge-form="${name}" data-settings-key="nudge-${name}">
      ${head(titleText, hint)}<div class="stack">${body}</div>${actions(ui("save"))}</form>`;
    const toggle = (label, enabled) =>
      `<label class="toggle">${fieldLabel(label)}<input type="checkbox" name="enabled"${enabled ? " checked" : ""}></label>`;
    const inputField = (label, content, hint) => `<label class="field">${fieldLabel(label, hint)}${content}</label>`;
    const notice = (message) => `<p class="notice error" role="alert">${e(message)}</p>`;
    const tabButtons = (items, selected, prefix, attr) =>
      Object.entries(items)
        .map(
          ([id, glyph]) => `
      <button type="button" role="tab" id="${prefix}-${id}" aria-controls="${prefix}-panel-${id}"
        aria-selected="${id === selected}" tabindex="${id === selected ? 0 : -1}" ${attr}="${id}">${glyph ? icon(glyph) : ""}${c(id)}</button>`,
        )
        .join("");
    const displayStep = (step, label) =>
      `<button class="button small" type="button" data-nudge-heat-step="${step}" aria-label="${c(label)}">${step > 0 ? "+5" : "−5"}</button>`;
    const modelValue = (model) =>
      model ? JSON.stringify({ kind: model.kind, provider: model.provider, id: model.id }) : "";

    function modelsMarkup(slot) {
      const { selected, options } = settings[slot];
      const groups = new Map();
      const value = modelValue(selected);
      for (const choice of options) {
        const label =
          slot === "checker"
            ? `${choice.providerLabel} · ${t(choice.kind === "decision" ? "decision_models" : "text_models")}`
            : choice.providerLabel;
        if (!groups.has(label)) groups.set(label, []);
        groups
          .get(label)
          .push(
            `<option value="${e(modelValue(choice))}"${modelValue(choice) === value ? " selected" : ""}>${e(choice.name)}</option>`,
          );
      }
      const choices = [...groups]
        .map(([provider, models]) => `<optgroup label="${e(provider)}">${models.join("")}</optgroup>`)
        .join("");
      const missing =
        selected && !options.some((choice) => modelValue(choice) === value)
          ? `<option value="${e(value)}" selected disabled>${c("model_unavailable")}</option>`
          : "";
      return form(
        slot,
        t(slot),
        t(`${slot}_hint`),
        `
        ${inputField(t("model"), `<select name="model" data-searchable><option value="">${c(`${slot}_auto`)}</option>${missing}${choices}</select>`)}
        <p class="hint" data-nudge-description></p>`,
      );
    }

    function modeMarkup(mode) {
      const values = settings[mode];
      return form(
        mode,
        t(mode),
        t(`${mode}_hint`),
        `
        ${toggle(t(`enable_${mode}`), values.enabled)}
        ${inputField(
          t("frequency"),
          `<select name="frequency">${settings.frequencies
            .map(
              (name, level) =>
                `<option value="${level}"${level === values.frequency ? " selected" : ""}>${e(name)}</option>`,
            )
            .join("")}</select>`,
        )}
        <p class="hint" role="status" data-nudge-description></p>`,
      );
    }

    function renderPanels() {
      page.innerHTML = `
        <nav class="dock" data-fx="indicator" data-overflow role="tablist" aria-label="${title}">${tabButtons(tabs, tab, "nudge", "data-nudge-tab")}</nav>
        <section class="stage" id="nudge-panel-settings" role="tabpanel" aria-labelledby="nudge-settings">
          <div class="split"><form class="card" data-fx="track" data-nudge-form="channels" data-settings-key="nudge-channels">
            <div class="stack">
              ${renderChannelSelector("nudgeChannels", settings.channels.selected, false, settings.channelChoices, {
                title: t("channels"),
                includeExcluded: true,
                hideBulk: true,
                intro: '<p class="hint" data-nudge-description></p><p class="hint" data-nudge-unavailable hidden></p>',
              })}
              <p class="notice warning" data-nudge-channel-limit hidden>${c("channel_limit")}</p>
            </div>${actions(ui("save"))}
          </form><div class="col">${modeMarkup("idle")}${modeMarkup("active")}</div></div>
        </section>
        <section class="stage" id="nudge-panel-models" role="tabpanel" aria-labelledby="nudge-models">
          <div class="card-columns">${modelsMarkup("planner")}${modelsMarkup("checker")}</div>
        </section>
        <section class="stage" id="nudge-panel-advanced" role="tabpanel" aria-labelledby="nudge-advanced">
          <div class="card-columns">
            ${form(
              "heat",
              t("heat"),
              t("heat_hint"),
              `
              <div class="stats"><div><strong data-nudge-measured>${number.format(settings.heat.measured)}</strong><small>${c("measured")}</small></div>
              <div><strong data-nudge-effective>${number.format(settings.heat.effective)}</strong><small>${c("effective", { max: settings.heat.max })}</small></div></div>
              <div class="row"><p>${c("adjust")} <strong data-nudge-offset></strong></p>
                ${displayStep(-5, "heat_down")}${displayStep(5, "heat_up")}
              </div><input type="hidden" name="offset" value="${settings.heat.offset}">`,
            )}
            ${form(
              "weights",
              t("weights"),
              t("weights_hint"),
              `<div class="grid">${categories
                .map((id) =>
                  inputField(
                    t(`${id}_weight`),
                    `<input type="number" name="${id}" min="1" max="100" step="1" required value="${settings.weights[id]}" data-unit="%">`,
                  ),
                )
                .join("")}</div>
              <p class="hint" role="status">${c("total")} <strong data-nudge-total></strong></p>
              <p class="notice warning" role="status" data-nudge-weight-error hidden>${c("invalid_weights")}</p>`,
            )}
          </div>
        </section>
        <section class="stage" id="nudge-panel-studio" role="tabpanel" aria-labelledby="nudge-studio">
          <div class="toolbar" data-nudge-library-tools>
            <div class="segmented" data-fx="indicator" data-overflow role="tablist" aria-label="${c("weights")}">
              ${tabButtons(Object.fromEntries(categories.map((id) => [id, null])), category, "nudge-category", "data-nudge-category")}
            </div>
            <div class="actions">
              ${inputField(t("search"), `<input type="search" placeholder="${c("search")}" data-nudge-search>`).replace('class="field-label"', 'class="field-label sr-only"')}
              <button class="button small primary" type="button" data-nudge-add data-fx="spark" disabled>${icon("plus")}${c("add")}</button>
            </div>
          </div>
          <div id="nudge-library" role="tabpanel" aria-labelledby="nudge-category-${category}" data-nudge-catalog></div>
          <div class="stage" data-nudge-editor hidden>
            <div class="toolbar"><button class="button small" type="button" data-nudge-back>${icon("arrow-left")}${c("back")}</button></div>
            <div class="split" data-nudge-editor-cards></div>
          </div>
        </section>`;
      for (const button of page.querySelectorAll("[data-nudge-category]"))
        button.setAttribute("aria-controls", "nudge-library");
      selectTab(tab);
      enhance(page);
      updateAllSettings();
      ctx.afterRender();
    }

    const checkedValues = (panel) =>
      [...panel.querySelectorAll('input[type="checkbox"]:checked')].map(({ value }) => value);
    function updateAllSettings() {
      for (const panel of page.querySelectorAll("form[data-nudge-form]")) {
        if (panel.closest("[data-nudge-editor]")) continue;
        updateSettingsCard(panel);
      }
    }

    function updateSettingsCard(panel) {
      const kind = panel.dataset.nudgeForm;
      const description = $("[data-nudge-description]", panel);
      const save = $('button[type="submit"]', panel);
      if (kind === "channels") {
        const { unavailable } = settings.channels;
        const selected = checkedValues(panel).length + unavailable;
        description.textContent = t(selected ? "manual" : "automatic");
        const outside = $("[data-nudge-unavailable]", panel);
        outside.hidden = !unavailable;
        outside.textContent = t("hidden_channels", { count: unavailable });
        $("[data-nudge-channel-limit]", panel).hidden = selected <= 25;
        save.disabled = selected > 25;
      } else if (kind === "idle" || kind === "active") {
        const enabled = panel.elements.enabled.checked;
        panel.elements.frequency.disabled = !enabled;
        description.textContent = enabled
          ? settings[kind].pace[Number(panel.elements.frequency.value)]
          : settings[kind].off;
        window.TomoriControls.enhance(panel);
      } else if (kind === "planner" || kind === "checker") {
        const resolved = settings[kind].resolved;
        description.hidden = Boolean(panel.elements.model.value);
        description.textContent = resolved ? t("resolved", { model: resolved }) : t("no_model");
      } else if (kind === "heat") {
        const { measured, limit, max } = settings.heat;
        const offset = Number(panel.elements.offset.value);
        const effective = Math.min(max, Math.max(0, measured + offset));
        $("[data-nudge-measured]", panel).textContent = number.format(measured);
        $("[data-nudge-effective]", panel).textContent = number.format(effective);
        $("[data-nudge-offset]", panel).textContent =
          offset === 0 ? "0" : (offset > 0 ? "+" : "−") + number.format(Math.abs(offset));
        $('[data-nudge-heat-step="-5"]', panel).disabled = effective === 0 || offset <= -limit;
        $('[data-nudge-heat-step="5"]', panel).disabled = effective === max || offset >= limit;
      } else if (kind === "weights") {
        const total = categories.reduce((sum, key) => sum + (panel.elements.namedItem(key).valueAsNumber || 0), 0);
        $("[data-nudge-total]", panel).textContent = `${number.format(total)}%`;
        $("[data-nudge-weight-error]", panel).hidden = total === 100;
        save.disabled = total !== 100;
      }
    }

    async function saveSettings(panel) {
      const action = panel.dataset.nudgeForm;
      let values;
      if (action === "idle" || action === "active") {
        values = { enabled: panel.elements.enabled.checked, frequency: Number(panel.elements.frequency.value) };
      } else if (action === "channels") {
        values = { ids: checkedValues(panel) };
      } else if (action === "heat") {
        values = { offset: Number(panel.elements.offset.value) };
      } else if (action === "weights") {
        values = {
          weights: Object.fromEntries(categories.map((key) => [key, panel.elements.namedItem(key).valueAsNumber])),
        };
      } else {
        const picked = JSON.parse(panel.elements.model.value || "null");
        values = { model: action === "planner" && picked ? { provider: picked.provider, id: picked.id } : picked };
      }
      settings = {
        ...settings,
        ...(await api(path, { method: "PATCH", body: JSON.stringify({ action, ...values }) })),
      };
      completeFormSave(panel);
      updateAllSettings();
      toast(
        ui("settings_card_saved").replace("{name}", () => panel.querySelector("h3").childNodes[0].textContent.trim()),
      );
    }

    const studioCatalog = () => $("[data-nudge-catalog]");
    const studioEditor = () => $("[data-nudge-editor]");
    const owner = (record) => personaById.get(record.owner);
    const source = (record) =>
      record.source === "persona"
        ? t("for_persona", { name: owner(record)?.nickname || "" })
        : t(record.source === "builtin" ? "builtin" : "server_custom");
    const count = (scope) =>
      scope === null
        ? t("selection_all", { count: personaIds.length })
        : t("selection_count", { count: scope.length, total: personaIds.length });
    const scopePreview = (scope) =>
      (scope ?? personaIds)
        .slice(0, 3)
        .map((id) => personaById.get(id))
        .filter(Boolean);
    const badges = (
      record,
    ) => `<span class="badge ${record.enabled ? (record.blocker ? "warning " : "success ") : ""}dot">
      ${c(record.enabled ? (record.blocker ? "blocked" : "enabled") : "off")}</span>${record.enabled && record.blocker ? `<span class="hint">${e(record.blocker)}</span>` : ""}`;
    const summaryScope = (record) =>
      record.owner !== null
        ? ""
        : record.scope?.length
          ? `<div class="quickbar"><div class="quick">${stickers(scopePreview(record.scope), "flat")}</div><span class="hint">${e(count(record.scope))}</span></div>`
          : `<span class="chip">${c(record.scope === null ? "all_personas" : "no_personas")}</span>`;

    function filterCatalog() {
      const query = $("[data-nudge-search]").value.trim().toLowerCase();
      const articles = [...studioCatalog().querySelectorAll("[data-nudge-entry]")];
      articles.forEach((row) => {
        row.hidden = !row.dataset.nudgeSearch.includes(query);
      });
      const empty = $("[data-nudge-empty]");
      if (empty) empty.hidden = articles.some((row) => !row.hidden);
    }

    function renderCatalog() {
      const cards = studio.entries.map((record, index) => {
        const builtin = record.source === "builtin";
        const action = builtin ? t("edit_availability") : ui("edit") || ui("persona_edit");
        const label = t(builtin ? "edit_availability_name" : "edit_name", { name: record.title });
        const summary = [
          record.title,
          record.brief,
          record.agenda,
          source(record),
          record.blocker,
          ...record.prerequisites.map((id) => studio.requirements[id]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return `<article class="card" data-nudge-entry data-nudge-search="${e(summary)}">
          ${head(record.title, "", `<button class="button small" type="button" data-nudge-open="${index}" aria-label="${e(label)}">${e(action)}</button>`)}
          <div class="stack"><p>${e(record.brief)}</p>
            <div class="chips"><span class="chip">${e(source(record))}</span>${badges(record)}${summaryScope(record)}</div>
          </div></article>`;
      });
      studioCatalog().innerHTML = `<div class="card-columns">${cards.join("")}</div>
        <div class="card" data-nudge-empty hidden><div class="empty-note"><span class="mark" aria-hidden="true">✦</span>
          <strong>${c("empty")}</strong><button class="button small" type="button" data-nudge-clear>${c("clear")}</button></div></div>`;
      const add = $("[data-nudge-add]");
      add.disabled = studio.customCount >= studio.limit;
      if (add.disabled) add.dataset.tooltip = t("limit", { count: studio.limit });
      else delete add.dataset.tooltip;
      filterCatalog();
      enhance(studioCatalog());
    }

    async function loadStudio() {
      const request = ++studioRequest;
      const list = studioCatalog();
      list.innerHTML = loadingBar(t("studio"));
      $("[data-nudge-add]").disabled = true;
      try {
        const response = await api(`${studioPath}?category=${encodeURIComponent(category)}`);
        if (!current() || request !== studioRequest) return false;
        studio = response;
        renderCatalog();
        return true;
      } catch (error) {
        if (current() && request === studioRequest) {
          list.innerHTML = `<div class="card">${notice(error.message)}<div class="actions"><button class="button small" type="button" data-nudge-retry>${e(ui("retry"))}</button></div></div>`;
        }
        return false;
      }
    }

    const nudgeTools = nudgeToolFields(e, inputField, t);

    function editMarkup(record) {
      const title = record.key ? record.title : t("new");
      const hint = `${t(category)} · ${source(record)}`;
      const required = studio.implied ? studio.requirements[studio.implied] : "";
      if (record.source === "builtin") {
        const read = (label, text) =>
          text ? `<div class="stack"><strong>${c(label)}</strong><p>${e(text)}</p></div>` : "";
        const identify = (label, ids, labels) =>
          ids.length
            ? `<div class="stack"><strong>${c(label)}</strong><div class="chips">${nudgeTools.chips(ids, labels)}</div></div>`
            : "";
        return `<section class="card" data-nudge-entry-title>${head(title, hint)}<div class="stack">
          ${read("brief", record.brief)}${read("agenda", record.agenda)}
          ${identify("prerequisites", studio.implied ? [studio.implied, ...record.prerequisites] : record.prerequisites, studio.requirements)}
          ${identify("recommended", record.recommended, studio.tools)}
        </div></section>`;
      }
      const requirements = Object.fromEntries(
        Object.entries(studio.requirements).filter(([id]) => id !== studio.implied),
      );
      const remove =
        record.key && record.source === "server"
          ? `<button class="button small danger hold-button" type="button" data-action-leading data-hold data-nudge-delete
        data-confirm-title="${c("delete_name", { name: title })}" data-confirm-description="${c("delete_hint")}"><span>${e(ui("control_hold_delete"))}</span></button>`
          : "";
      return `<form class="card" data-fx="track" data-nudge-form="content" data-settings-key="nudge-content-${e(record.key || category)}" data-nudge-entry-title>
        ${head(title, hint)}<div class="stack">
          ${inputField(t("name"), `<input name="title" maxlength="80" value="${e(record.title)}" required>`)}
          ${inputField(t("brief"), `<textarea name="brief" rows="4" maxlength="1000" required>${e(record.brief)}</textarea>`, t(`${category}_brief`))}
          ${inputField(t("agenda"), `<textarea name="agenda" rows="2" maxlength="500">${e(record.agenda)}</textarea>`, t("agenda_hint"))}
          ${required ? `<p class="hint">${c("required_category", { name: required })}</p>` : ""}
          ${nudgeTools.field("prerequisites", requirements, record.prerequisites, "prerequisites_hint", "add_prerequisite")}
          ${nudgeTools.field("recommended", studio.tools, record.recommended, "recommended_hint", "add_tool")}
        </div>${actions(ui("save"), remove)}</form>`;
    }

    const draftScope = (panel) => (panel.elements.scope ? JSON.parse(panel.elements.scope.value) : null);

    function renderAvailability(record) {
      const chooser =
        record.owner !== null
          ? `<span>${e(owner(record)?.nickname || "")}</span>`
          : `<button class="button small" type="button" data-nudge-pick aria-haspopup="dialog" data-tooltip="${c("choose_personas")}">
          ${icon("layout-grid")}<span data-nudge-count></span></button>
          <input type="hidden" name="scope" value="${e(JSON.stringify(record.scope))}">`;
      return form(
        "availability",
        t("availability"),
        "",
        `
        ${toggle(t("enable"), record.enabled)}
        <div class="chips" data-nudge-blocker hidden></div>
        <div class="stack"><strong>${c("allowed_personas")}</strong>
          <div class="quickbar"><div class="quick" data-nudge-scope-preview></div>${chooser}</div>
          <p class="hint" data-nudge-scope-hint hidden></p>
          <p class="notice warning" role="status" data-nudge-scope-error hidden>${c("required_personas")}</p>
        </div>`,
      ).replace('data-settings-key="nudge-availability"', `data-settings-key="nudge-availability-${e(record.key)}"`);
    }

    function updateAvailability(panel) {
      const scope = draftScope(panel);
      const enabled = panel.elements.enabled.checked;
      const preview = $("[data-nudge-scope-preview]", panel);
      const ids = entry.owner === null ? scope : [entry.owner];
      preview.innerHTML = stickers(scopePreview(ids));
      preview.hidden = ids?.length === 0;
      const button = $("[data-nudge-pick]", panel);
      if (button) {
        $("[data-nudge-count]", button).textContent = count(scope);
        button.setAttribute("aria-label", `${t("choose_personas")}, ${count(scope)}`);
      }
      const blocker = $("[data-nudge-blocker]", panel);
      blocker.hidden = !enabled || !entry.blocker;
      blocker.innerHTML = blocker.hidden ? "" : badges(entry.enabled ? entry : { ...entry, enabled: true });
      const hint = $("[data-nudge-scope-hint]", panel);
      hint.textContent = !enabled ? t("off_personas") : scope === null && button ? t("future_personas") : "";
      hint.hidden = !hint.textContent;
      const invalid = scope?.length === 0;
      $("[data-nudge-scope-error]", panel).hidden = !invalid;
      $('button[type="submit"]', panel).disabled = invalid;
    }

    const updateTools = (panel) => nudgeTools.update(panel, studio, 8);

    function openEditor(record) {
      entry = record;
      $("[data-nudge-library-tools]").hidden = true;
      studioCatalog().hidden = true;
      const editor = studioEditor();
      editor.hidden = false;
      window.TomoriFX.swap(
        $("[data-nudge-editor-cards]"),
        editMarkup(record) + (record.key ? renderAvailability(record) : ""),
      );
      enhance(editor);
      const content = $('[data-nudge-form="content"]', editor);
      const availability = $('[data-nudge-form="availability"]', editor);
      if (content) updateTools(content);
      if (availability) updateAvailability(availability);
      const heading = $("[data-nudge-entry-title] h3");
      heading.tabIndex = -1;
      (record.source === "builtin"
        ? availability.elements.enabled
        : record.key
          ? heading
          : content.elements.title
      ).focus();
    }

    function closeEditor(key) {
      studioEditor().hidden = true;
      $("[data-nudge-editor-cards]").replaceChildren();
      $("[data-nudge-library-tools]").hidden = false;
      studioCatalog().hidden = false;
      entry = null;
      const index = studio.entries.findIndex((record) => record.key === key);
      ($(`[data-nudge-open="${index}"]:not([hidden])`, studioCatalog()) || $("[data-nudge-add]")).focus();
    }

    function openPicker(panel) {
      const dialog = document.createElement("dialog");
      dialog.className = "collection";
      dialog.id = "nudge-personas-dialog";
      dialog.setAttribute("aria-labelledby", "nudge-personas-title");
      dialog.innerHTML = `<header class="collection-head">
        <div class="collection-title"><h2 id="nudge-personas-title">${c("choose_personas")} <small data-nudge-picker-count></small></h2>
          <button class="button icon" type="button" data-nudge-picker-close aria-label="${e(ui("control_close_dialog"))}">${icon("x")}</button></div>
        <div class="collection-tools">
          <label class="field"><span class="field-label sr-only">${e(ui("persona_permissions_search"))}</span>
            <input type="search" placeholder="${e(ui("persona_permissions_search"))}" data-persona-picker-search autofocus></label>
          <div class="actions"><button class="button small" type="button" data-nudge-pick-all>${c("select_all")}</button>
            <button class="button small" type="button" data-nudge-pick-none>${c("clear_selection")}</button></div>
        </div>
      </header><div class="collection-body"><div class="deck">${personas
        .map(
          (persona) =>
            `<button class="deck-card" type="button" value="${persona.personaId}" aria-pressed="false" data-nudge-persona
          data-persona-search="${personaPickerSearchText(persona)}">${personaPickerTileContent(persona)}</button>`,
        )
        .join("")}</div>
        <p class="empty-note" data-persona-picker-empty hidden>${c("no_matching_personas")}</p></div>`;
      const update = () => {
        const selected = draftScope(panel);
        $("[data-nudge-picker-count]", dialog).textContent = count(selected);
        const keys = new Set(selected ?? personaIds);
        for (const button of dialog.querySelectorAll("[data-nudge-persona]")) {
          button.setAttribute("aria-pressed", String(keys.has(Number(button.value))));
        }
      };
      dialog.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        if (button.hasAttribute("data-nudge-picker-close")) return dialog.close();
        let scope = draftScope(panel);
        if (button.hasAttribute("data-nudge-pick-all")) scope = null;
        else if (button.hasAttribute("data-nudge-pick-none")) scope = [];
        else if (button.hasAttribute("data-nudge-persona")) {
          const keys = new Set(scope ?? personaIds);
          const id = Number(button.value);
          if (!keys.delete(id)) keys.add(id);
          scope = keys.size === personaIds.length ? null : personaIds.filter((key) => keys.has(key));
        } else return;
        setHiddenValue(panel.elements.scope, scope);
        update();
      });
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      root.append(dialog);
      update();
      dialog.showModal();
      enhanceDashboard(dialog);
    }

    async function saveEntry(panel) {
      const kind = panel.dataset.nudgeForm;
      const target = { category, key: entry.key };
      const request =
        kind === "availability"
          ? { ...target, action: "availability", enabled: panel.elements.enabled.checked, scope: draftScope(panel) }
          : {
              category,
              action: entry.key ? "edit" : "add",
              ...(entry.key ? { key: entry.key, revision: entry.revision } : {}),
              form: readNudgeContent(panel),
            };
      const { key } = await api(studioPath, { method: "PATCH", body: JSON.stringify(request) });
      completeFormSave(panel);
      toast(t(kind === "availability" ? "availability_saved" : "saved"));
      if (!(await loadStudio())) {
        if (current() && !entry.key) closeEditor(key);
        return;
      }
      const updated = studio.entries.find((record) => record.key === key);
      if (!updated) return closeEditor(key);
      if (!entry.key) return openEditor(updated);
      entry = updated;
      if (kind === "content") {
        panel.elements.title.value = updated.title;
        panel.elements.brief.value = updated.brief;
        panel.elements.agenda.value = updated.agenda;
        panel.elements.prerequisites.value = JSON.stringify(updated.prerequisites);
        panel.elements.recommended.value = JSON.stringify(updated.recommended);
        $("h3", panel).textContent = updated.title;
        const remove = $("[data-nudge-delete]", panel);
        if (remove) remove.dataset.confirmTitle = t("delete_name", { name: updated.title });
        updateTools(panel);
        panel.elements.title.focus();
      } else {
        if (panel.elements.scope) panel.elements.scope.value = JSON.stringify(updated.scope);
        panel.elements.enabled.focus();
      }
      const availability = $('[data-nudge-form="availability"]');
      if (availability) updateAvailability(availability);
      completeFormSave(panel);
    }

    function selectTab(next) {
      tab = next;
      page.querySelectorAll("[data-nudge-tab]").forEach((button) => {
        const selected = button.dataset.nudgeTab === next;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
        document.getElementById(button.getAttribute("aria-controls")).hidden = !selected;
      });
      if (next === "studio" && !studio && !studioRequest) void loadStudio();
      enhanceDashboard($(`#nudge-panel-${next}`));
    }

    page.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const next = button.dataset.nudgeTab;
      if (next && next !== tab) {
        selectTab(next);
        button.focus();
      }
      const group = button.dataset.nudgeCategory;
      if (group && group !== category) {
        category = group;
        page.querySelectorAll("[data-nudge-category]").forEach((item) => {
          item.setAttribute("aria-selected", String(item === button));
          item.tabIndex = item === button ? 0 : -1;
        });
        studioCatalog().setAttribute("aria-labelledby", button.id);
        $("[data-nudge-search]").value = "";
        void loadStudio();
        button.focus();
      }
      if (button.hasAttribute("data-nudge-clear")) {
        const input = $("[data-nudge-search]");
        input.value = "";
        filterCatalog();
        input.focus();
      }
      if (button.hasAttribute("data-nudge-retry")) void loadStudio();
      if (button.hasAttribute("data-nudge-add"))
        openEditor({
          key: null,
          title: "",
          brief: "",
          agenda: "",
          prerequisites: [],
          recommended: [],
          owner: null,
          source: "server",
          enabled: true,
          scope: null,
        });
      if (button.hasAttribute("data-nudge-open")) openEditor(studio.entries[Number(button.dataset.nudgeOpen)]);
      if (button.hasAttribute("data-nudge-back") && (await confirmDraftDiscard(studioEditor()))) closeEditor(entry.key);
      if (button.hasAttribute("data-nudge-heat-step")) {
        const input = button.form.elements.offset;
        const next = Number(input.value) + Number(button.dataset.nudgeHeatStep);
        input.value = String(Math.min(settings.heat.limit, Math.max(-settings.heat.limit, next)));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (button.hasAttribute("data-nudge-pick")) openPicker(button.form);
      if (button.hasAttribute("data-nudge-remove-option")) nudgeTools.remove(button);
    });

    page.addEventListener("input", (event) => {
      const input = event.target;
      if (input.hasAttribute("data-nudge-search")) return filterCatalog();
      const kind = input.form?.dataset.nudgeForm;
      if (kind === "availability") updateAvailability(input.form);
      else if (kind === "content" && input.type === "hidden") updateTools(input.form);
      else if (kind && kind !== "content") updateSettingsCard(input.form);
    });

    page.addEventListener("change", (event) => nudgeTools.add(event.target, 8));

    page.addEventListener(
      "dashboard:restore",
      (event) => {
        const panel = event.target;
        const kind = panel.dataset.nudgeForm;
        if (kind === "availability") updateAvailability(panel);
        else if (kind === "content") updateTools(panel);
        else if (kind) updateSettingsCard(panel);
      },
      true,
    );

    page.addEventListener("submit", async (event) => {
      const panel = event.target;
      const kind = panel.dataset.nudgeForm;
      if (!kind) return;
      event.preventDefault();
      if (!panel.hasAttribute("data-changed") || $('button[type="submit"]', panel).disabled) return;
      try {
        await withBusyForm(panel, () =>
          kind === "content" || kind === "availability" ? saveEntry(panel) : saveSettings(panel),
        );
      } catch (error) {
        if (panel.isConnected) showFormError(panel, error);
      }
    });

    page.addEventListener("holdcomplete", async (event) => {
      const button = event.target.closest("[data-nudge-delete]");
      if (!button) return;
      try {
        await withBusyForm(button.form, async () => {
          if (!(await confirmDraftDiscard(studioEditor()))) return button.dispatchEvent(new Event("holdreset"));
          const { key } = await api(studioPath, {
            method: "PATCH",
            body: JSON.stringify({ action: "remove", category, key: entry.key }),
          });
          toast(t("deleted"));
          await loadStudio();
          closeEditor(key);
        });
      } catch (error) {
        button.dispatchEvent(new Event("holdreset"));
        showFormError(button.form, error);
      }
    });

    try {
      settings = await api(path);
      if (current()) renderPanels();
    } catch (error) {
      if (current()) page.innerHTML = notice(error.message);
    }
  }

  async function renderPersona(root, ctx) {
    const {
      api,
      ui,
      escapeHtml: e,
      navigationIcon: icon,
      fieldLabel,
      personaCardHead: head,
      cardSaveActions: actions,
      personaSticker,
      initDraftForms,
      enhanceDashboard,
      withBusyForm,
      completeFormSave,
      showFormError,
      confirmDraftDiscard,
      confirmAction,
      loadingBar,
      toast,
      guildId,
      persona,
    } = ctx;
    const path = `/guilds/${guildId}/personas/${persona.personaId}/nudges`;
    const $ = (selector, node = root) => node.querySelector(selector);
    const name = persona.nickname;
    let data;
    let editing = null;
    let working = false;
    let retry;
    const t = (key, vars = {}) =>
      (data.copy[key] ?? "").replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(vars, key) ? vars[key] : match));
    const c = (key, vars) => e(t(key, vars));
    const field = (label, body, hint) => `<label class="field">${fieldLabel(label, hint)}${body}</label>`;
    const button = (text, attrs, glyph = "", variant = "") =>
      `<button class="button small${variant ? ` ${variant}` : ""}" type="button" ${attrs}>${glyph ? icon(glyph) : ""}${e(text)}</button>`;
    const empty = (key) =>
      `<div class="empty-note"><span class="mark" aria-hidden="true">✦</span><strong>${c(key)}</strong></div>`;
    const count = (count, limit) => t("persona_count", { count, limit });
    const enhance = (node) => {
      initDraftForms(node);
      enhanceDashboard(node);
    };
    const nudgeTools = nudgeToolFields(e, field, t);
    const draftKey = (suffix) => `persona-nudges/${persona.personaId}/${suffix}`;
    const contentForm = () => $('[data-nudge-form="persona-content"]');
    const summary = () => $("[data-persona-nudge-summary]");
    const editor = () => $("[data-persona-nudge-editor]");

    root.innerHTML = `<div data-persona-nudge-status>${loadingBar(ui("persona_nudge_tab"))}</div><div data-persona-nudge-body></div>`;
    const status = $("[data-persona-nudge-status]");
    const body = $("[data-persona-nudge-body]");

    function showRetry(error, action) {
      retry = action;
      status.innerHTML = `<section class="card"><p class="notice error" role="alert">${e(error.message)}</p>
        <div class="actions">${button(ui("persona_nudge_reload"), "data-persona-nudge-retry")}</div></section>`;
    }

    async function reload(afterLoad) {
      try {
        data = await api(path);
      } catch (error) {
        if (root.isConnected) showRetry(error, afterLoad);
        return;
      }
      if (!root.isConnected) return;
      retry = undefined;
      status.replaceChildren();
      afterLoad();
    }

    async function mutate(patch, message, afterLoad, panel, trigger) {
      if (working || retry) return false;
      working = true;
      if (trigger) trigger.disabled = true;
      const run = async () => {
        const result = await api(path, { method: "PATCH", body: JSON.stringify(patch) });
        if (!root.isConnected) return;
        if (panel?.dataset.nudgeForm) completeFormSave(panel);
        panel?.closest("dialog")?.close();
        toast(t(message));
        await reload(() => afterLoad(result));
      };
      try {
        if (panel) await withBusyForm(panel, run);
        else await run();
        return true;
      } catch (error) {
        if (panel?.isConnected) showFormError(panel, error);
        else if (root.isConnected) toast(error.message, "error");
        return false;
      } finally {
        working = false;
        if (trigger?.isConnected) trigger.disabled = data.interests.length >= data.limits.interests;
      }
    }

    function row(record, kind, index) {
      const idle = kind === "idle";
      const label = idle ? record.title : record.label;
      return `<article class="item"><div><p><strong>${e(label)}</strong></p>
        <p class="hint">${e(idle ? record.brief : record.description)}</p>
        ${
          idle
            ? `<div class="item-meta"><span class="chip">${e(data.categories[record.category])}</span>
          <span class="badge ${record.enabled ? (record.blocker ? "warning " : "success ") : ""}dot">${c(record.enabled ? (record.blocker ? "blocked" : "enabled") : "off")}</span>
          ${record.blocker ? `<span class="hint">${e(record.blocker)}</span>` : ""}</div>`
            : ""
        }</div>
        <div class="item-actions">${button(ui("persona_edit"), `data-persona-nudge-edit="${kind}" value="${e(idle ? record.id : index)}" aria-label="${c("edit_name", { name: label })}"`)}</div></article>`;
    }

    function updateRows(kind) {
      const interests = kind === "interest";
      const items = interests ? data.interests : data.idle;
      const limit = interests ? data.limits.interests : data.limits.idle;
      const rows = $(`[data-persona-nudge-rows="${kind}"]`);
      rows.innerHTML = items.length
        ? items.map((item, index) => row(item, kind, index)).join("")
        : empty(interests ? "persona_interest_empty" : "persona_idle_empty");
      $(`[data-persona-nudge-count="${kind}"]`).textContent = count(items.length, limit);
      $(`[data-persona-nudge-add="${kind}"]`).disabled = items.length >= limit;
      if (interests) $("[data-persona-nudge-generate]").disabled = items.length >= limit;
      else $("[data-persona-nudge-restore]").hidden = !data.restoreRevision;
      enhanceDashboard(rows);
    }

    function levelEffect(panel) {
      $("[data-persona-nudge-effect]").textContent = data.levels.find(
        ({ id }) => id === Number(panel.elements.level.value),
      ).effect;
    }

    function showSummary() {
      body.innerHTML = `<div class="stage" data-persona-nudge-summary>
        <form class="card" data-fx="track" data-nudge-form="persona-level" data-settings-key="${draftKey("level")}">
          ${head(ui("persona_nudge_talkativeness"), t("persona_talk_hint", { name }))}
          <div class="grid"><div class="stack">${field(
            t("persona_level"),
            `<select name="level">${data.levels
              .map(
                ({ id, label }) => `<option value="${id}"${data.level === id ? " selected" : ""}>${e(label)}</option>`,
              )
              .join("")}</select>`,
          )}
            <p class="hint" data-persona-nudge-effect role="status"></p></div></div>${actions(ui("save"))}
        </form>
        <section class="card" data-persona-nudge-interests>
          <div class="card-head"><div><h3>${e(ui("persona_nudge_interests"))}<small data-persona-nudge-count="interest"></small></h3>
            <p class="hint">${c("persona_interests_hint", { name })}</p></div>
            <div class="actions">${button(t("persona_generate"), "data-persona-nudge-generate")}
              ${button(t("persona_interest_add"), 'data-persona-nudge-add="interest" data-fx="spark" aria-haspopup="dialog"', "plus", "primary")}</div></div>
          <div class="rows" data-persona-nudge-rows="interest"></div>
        </section>
        <section class="card" data-persona-nudge-idle>
          <div class="card-head"><div><h3>${c("idle")}<small data-persona-nudge-count="idle"></small></h3>
            <p class="hint">${c("persona_idle_hint", { name })}</p></div>
            ${button(t("add"), 'data-persona-nudge-add="idle" data-fx="spark"', "plus", "primary")}</div>
          <div class="rows" data-persona-nudge-rows="idle"></div>
          <div class="actions">${button(t("persona_restore"), "data-persona-nudge-restore hidden")}</div>
        </section>
      </div>
      <div class="stage" data-persona-nudge-editor hidden>
        <div class="toolbar">${button(t("back"), "data-persona-nudge-back", "arrow-left")}</div>
        <div class="split" data-persona-nudge-cards></div>
      </div>
      <dialog aria-labelledby="persona-nudge-interest-title" data-persona-nudge-interest-dialog></dialog>`;
      updateRows("interest");
      updateRows("idle");
      enhance(body);
      levelEffect($('[data-nudge-form="persona-level"]'));
      window.TomoriFX.stagger(summary());
    }

    function interestDialog(index) {
      const record = data.interests[index];
      const dialog = $("[data-persona-nudge-interest-dialog]");
      const listRevision = data.interestRevision;
      dialog.innerHTML = `<form class="stack">
        <header class="panel-header"><div class="heading"><h2 id="persona-nudge-interest-title">${c(record ? "persona_interest_edit" : "persona_interest_add")}</h2></div></header>
        ${field(t("name"), `<input name="label" maxlength="${data.limits.interestLabel}" required value="${e(record?.label ?? "")}" autofocus>`)}
        ${field(t("persona_interest_description"), `<textarea rows="3" name="description" maxlength="${data.limits.interestDescription}" required>${e(record?.description ?? "")}</textarea>`, t("persona_interest_hint"))}
        <div class="actions" data-form-actions>${record ? button(t("persona_interest_remove_action"), "data-persona-nudge-remove-interest", "", "danger") : ""}
          ${button(ui("lorebook_cancel"), "data-persona-nudge-dialog-close")}
          <button class="button small primary" type="submit" data-fx="spark">${e(ui("save"))}</button></div></form>`;
      const panel = $("form", dialog);
      const finish = () => {
        updateRows("interest");
        (
          $(`[data-persona-nudge-edit="interest"][value="${index}"]`) || $('[data-persona-nudge-add="interest"]')
        ).focus();
      };
      panel.onsubmit = async (event) => {
        event.preventDefault();
        const interest = { label: panel.elements.label.value, description: panel.elements.description.value };
        const patch = record
          ? { action: "interest-edit", index, revision: record.revision, interest }
          : { action: "interest-add", interest };
        await mutate(patch, "persona_interest_saved", finish, panel);
      };
      $("[data-persona-nudge-dialog-close]", panel).onclick = () => dialog.close();
      const remove = $("[data-persona-nudge-remove-interest]", panel);
      if (remove)
        remove.onclick = async () => {
          if (
            !(await confirmAction(t("persona_interest_remove"), record.label, t("persona_interest_remove_action"))) ||
            !panel.isConnected ||
            !dialog.open
          )
            return;
          await mutate(
            { action: "interest-remove", index, revision: listRevision },
            "persona_interest_removed",
            finish,
            panel,
          );
        };
      dialog.oncancel = (event) => {
        if (working) event.preventDefault();
      };
      enhance(dialog);
      dialog.showModal();
    }

    function updateCategory(panel) {
      const category = editing?.category ?? panel.elements.category.value;
      $("[data-persona-nudge-brief-hint]", panel).textContent = t(`${category}_brief`);
      const implied = $("[data-persona-nudge-implied]", panel);
      const impliedId = data.implied[category];
      implied.hidden = !impliedId;
      implied.textContent = impliedId ? t("required_category", { name: data.requirements[impliedId] }) : "";
      const options = $('[data-nudge-tool="prerequisites"]', panel);
      for (const option of options.options) option.hidden = Boolean(option.value && impliedId === option.value);
      const prerequisites = panel.elements.prerequisites;
      const selected = JSON.parse(prerequisites.value);
      if (selected.includes(impliedId))
        setHiddenValue(
          prerequisites,
          selected.filter((id) => id !== impliedId),
        );
      nudgeTools.update(panel, data, data.limits.options);
    }

    function openEditor(record) {
      editing = record ?? null;
      summary().hidden = true;
      editor().hidden = false;
      const title = record?.title ?? t("new");
      const required = data.implied[record?.category ?? "start_topic"];
      const requirements = record
        ? Object.fromEntries(Object.entries(data.requirements).filter(([id]) => id !== required))
        : data.requirements;
      const remove = record
        ? `<button class="button small danger hold-button" type="button" data-action-leading data-hold data-persona-nudge-delete
        data-confirm-title="${c("delete_name", { name: title })}" data-confirm-description="${c("persona_delete_hint", { name })}"><span>${e(ui("control_hold_delete"))}</span></button>`
        : "";
      window.TomoriFX.swap(
        $("[data-persona-nudge-cards]"),
        `<form class="card" data-fx="track" data-nudge-form="persona-content" data-settings-key="${draftKey(record?.id ?? "new")}">
        ${head(title, t("for_persona", { name }))}
        <div class="stack">
          ${field(t("name"), `<input name="title" maxlength="${data.limits.title}" value="${e(record?.title ?? "")}" required>`)}
          ${
            record
              ? ""
              : field(
                  t("persona_category"),
                  `<select name="category">${Object.entries(data.categories)
                    .map(
                      ([id, label]) =>
                        `<option value="${id}"${id === "start_topic" ? " selected" : ""}>${e(label)}</option>`,
                    )
                    .join("")}</select>`,
                )
          }
          ${field(t("brief"), `<textarea name="brief" rows="4" maxlength="${data.limits.brief}" required>${e(record?.brief ?? "")}</textarea>`)}
          <p class="hint" data-persona-nudge-brief-hint></p>
          ${field(t("agenda"), `<textarea name="agenda" rows="2" maxlength="${data.limits.agenda}">${e(record?.agenda ?? "")}</textarea>`, t("agenda_hint"))}
          <p class="hint" data-persona-nudge-implied hidden></p>
          ${nudgeTools.field("prerequisites", requirements, record?.prerequisites ?? [], "prerequisites_hint", "add_prerequisite")}
          ${nudgeTools.field("recommended", data.tools, record?.recommended ?? [], "recommended_hint", "add_tool")}
        </div>${actions(ui("save"), remove)}</form>
        ${
          record
            ? `<form class="card" data-fx="track" data-nudge-form="persona-availability" data-settings-key="${draftKey(record.id + "/availability")}">
          ${head(t("availability"))}<div class="stack">
          <label class="toggle">${fieldLabel(t("enable"))}<input name="enabled" type="checkbox"${record.enabled ? " checked" : ""}></label>
          <div class="stack"><strong>${c("persona_owner")}</strong><div class="item lead">${personaSticker(persona, "flat")}<span>${e(name)}</span></div></div>
          </div>${actions(ui("save"))}</form>`
            : ""
        }`,
      );
      enhance(editor());
      const panel = contentForm();
      updateCategory(panel);
      panel.elements.title.focus();
    }

    function closeEditor(id = editing?.id) {
      editor().hidden = true;
      $("[data-persona-nudge-cards]").replaceChildren();
      editing = null;
      summary().hidden = false;
      ($(`[data-persona-nudge-edit="idle"][value="${id ?? ""}"]`) || $('[data-persona-nudge-add="idle"]')).focus();
    }

    root.addEventListener("click", async (event) => {
      const target = event.target.closest("button");
      if (!target || working) return;
      if (target.hasAttribute("data-persona-nudge-retry")) {
        working = true;
        target.disabled = true;
        try {
          await reload(retry);
        } finally {
          working = false;
        }
        return;
      }
      if (retry) return;
      const add = target.dataset.personaNudgeAdd;
      const edit = target.dataset.personaNudgeEdit;
      if (add === "interest" || edit === "interest") interestDialog(edit ? Number(target.value) : -1);
      if (add === "idle" || edit === "idle") openEditor(data.idle.find(({ id }) => id === target.value));
      if (target.hasAttribute("data-persona-nudge-back") && (await confirmDraftDiscard(editor()))) closeEditor();
      if (target.hasAttribute("data-persona-nudge-generate"))
        await mutate({ action: "interest-generate" }, "persona_generated", () => updateRows("interest"), null, target);
      if (
        target.hasAttribute("data-persona-nudge-restore") &&
        (await confirmAction(t("persona_restore_title"), t("persona_restore_hint"), t("persona_restore_action"))) &&
        root.isConnected
      )
        await mutate({ action: "idle-restore", revision: data.restoreRevision }, "persona_restored", () =>
          updateRows("idle"),
        );
      if (target.hasAttribute("data-nudge-remove-option")) nudgeTools.remove(target);
    });

    function updateForm(panel) {
      if (panel?.dataset.nudgeForm === "persona-level") levelEffect(panel);
      else if (panel?.dataset.nudgeForm === "persona-content") updateCategory(panel);
    }

    root.addEventListener("input", (event) => {
      if (event.target.matches('[name="level"], [name="category"], input[type="hidden"]'))
        updateForm(event.target.form);
    });
    root.addEventListener("change", (event) => nudgeTools.add(event.target, data.limits.options));
    root.addEventListener("dashboard:restore", (event) => updateForm(event.target), true);

    root.addEventListener("submit", async (event) => {
      const panel = event.target;
      const kind = panel.dataset.nudgeForm;
      if (!kind) return;
      event.preventDefault();
      if (!panel.hasAttribute("data-changed")) return;
      if (kind === "persona-level") {
        await mutate(
          { action: "talkativeness", level: Number(panel.elements.level.value) },
          "persona_talk_saved",
          () => {
            panel.elements.level.value = String(data.level);
            levelEffect(panel);
            completeFormSave(panel);
          },
          panel,
        );
      } else if (kind === "persona-availability") {
        const id = editing.id;
        await mutate(
          { action: "idle-toggle", id, enabled: panel.elements.enabled.checked },
          "availability_saved",
          () => {
            updateRows("idle");
            const updated = data.idle.find((record) => record.id === id);
            if (!updated) return closeEditor(id);
            panel.elements.enabled.checked = updated.enabled;
            completeFormSave(panel);
          },
          panel,
        );
      } else {
        const form = readNudgeContent(panel);
        const patch = editing
          ? { action: "idle-edit", id: editing.id, revision: editing.revision, form }
          : { action: "idle-add", category: panel.elements.category.value, form };
        await mutate(
          patch,
          "saved",
          (result) => {
            updateRows("idle");
            const id = result.id ?? patch.id;
            const updated = data.idle.find((record) => record.id === id);
            if (!updated) return closeEditor(id);
            if (result.id) return openEditor(updated);
            editing = updated;
            panel.elements.title.value = updated.title;
            panel.elements.brief.value = updated.brief;
            panel.elements.agenda.value = updated.agenda;
            panel.elements.prerequisites.value = JSON.stringify(updated.prerequisites);
            panel.elements.recommended.value = JSON.stringify(updated.recommended);
            $("h3", panel).textContent = updated.title;
            $("[data-persona-nudge-delete]", panel).dataset.confirmTitle = t("delete_name", { name: updated.title });
            updateCategory(panel);
            completeFormSave(panel);
          },
          panel,
        );
      }
    });

    root.addEventListener("holdcomplete", async (event) => {
      const target = event.target.closest("[data-persona-nudge-delete]");
      if (!target) return;
      if (working || !(await confirmDraftDiscard(editor())) || !target.isConnected) {
        target.dispatchEvent(new Event("holdreset"));
        return;
      }
      const { id, revision } = editing;
      const deleted = await mutate(
        { action: "idle-remove", id, revision },
        "deleted",
        () => {
          updateRows("idle");
          closeEditor(id);
        },
        target.form,
      );
      if (!deleted) target.dispatchEvent(new Event("holdreset"));
    });

    await reload(showSummary);
  }

  window.TomoriNaturalNudges = { render, renderPersona };
})();
