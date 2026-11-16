(() => {
  let editorLibrary;
  let activeTab = "pages";
  let activePage = "imprint";
  let renderVersion = 0;

  function loadEditor() {
    if (!editorLibrary) {
      editorLibrary = new Promise((resolve, reject) => {
        const style = document.createElement("link");
        style.rel = "stylesheet";
        style.href = "/settings/assets/quill.core.css";
        document.head.append(style);
        const script = document.createElement("script");
        script.src = "/settings/assets/quill.js";
        script.onload = resolve;
        script.onerror = () => {
          editorLibrary = null;
          script.remove();
          reject(new Error("Editor unavailable"));
        };
        document.head.append(script);
      });
    }
    return editorLibrary;
  }

  async function renderAdmin(root, context) {
    const version = ++renderVersion;
    const isCurrent = () => root.isConnected && context.isCurrent() && version === renderVersion;
    const {
      api,
      escapeHtml: e,
      fieldLabel,
      personaCardHead,
      cardSaveActions,
      navigationIcon,
      copy: c,
      toast,
    } = context;
    root.innerHTML = `<span class="loading" role="status" aria-label="${e(c.title)}"></span>`;
    let entries;
    try {
      const response = await api("/site-admin/entries");
      entries = response.entries;
      await loadEditor();
    } catch {
      if (isCurrent()) root.innerHTML = `<div class="notice error" role="alert">${e(c.load_failed)}</div>`;
      return;
    }
    if (!isCurrent()) return;

    const pages = entries.filter((entry) => entry.kind === "page");
    if (!pages.some((entry) => entry.id === activePage)) activePage = pages[0].id;

    root.innerHTML = `<section class="banner compact" aria-labelledby="site-admin-title">
      <div class="banner-info"><div class="stack">
        <p class="crumb">${e(c.admin)}</p>
        <h1 id="site-admin-title" data-fx="split">${e(c.title)}</h1>
        <p class="banner-text">${e(c.hint)}</p>
      </div></div>
      <div class="banner-art" aria-hidden="true"><span class="sticker emblem">${navigationIcon("book-open")}</span></div>
    </section>
    <nav class="dock" data-fx="indicator" data-overflow role="tablist" aria-label="${e(c.title)}">
      ${[
        ["pages", "book-open"],
        ["links", "pin"],
      ]
        .map(
          ([tab, icon]) =>
            `<button id="site-tab-${tab}" type="button" role="tab" aria-controls="site-admin-stage" data-site-tab="${tab}">${navigationIcon(icon)}${e(c[tab])}</button>`,
        )
        .join("")}
    </nav>
    <section class="stage" id="site-admin-stage" role="tabpanel"></section>`;
    const dock = root.querySelector(".dock");
    const stage = root.querySelector("#site-admin-stage");

    function formHtml(entry) {
      const page = entry.kind === "page";
      const action = page
        ? `<button class="button small" type="button" data-site-preview aria-haspopup="dialog">${navigationIcon("eye")}${e(c.preview)}</button>`
        : `<button class="button small danger" type="button" data-site-remove aria-haspopup="dialog">${e(c.remove)}</button>`;
      return `<form class="card" data-fx="track" data-site-entry="${e(entry.id)}">
        ${personaCardHead(entry.title || c.add_link, "", `<div class="actions">${action}</div>`)}
        <div class="stack">
          <div class="grid">
            <label class="field">${fieldLabel(page ? c.page_title : c.link_title)}<input name="title" value="${e(entry.title)}" maxlength="100" required></label>
            <label class="field">${fieldLabel(c.position, c.position_hint)}<input name="position" type="number" min="0" max="999" value="${entry.position}" required></label>
          </div>
          ${
            page
              ? `<label class="toggle">${fieldLabel(c.visible, c.visible_hint)}<input name="enabled" type="checkbox"${entry.enabled ? " checked" : ""}></label>
            <div class="field"><span class="field-label"><strong id="site-editor-label">${e(c.content)}</strong></span>
            <div class="site-editor-toolbar row" role="toolbar" aria-label="${e(c.editor)}">
              <button class="button small icon ql-header" value="2" type="button" aria-label="${e(c.heading)}"></button>
              <button class="button small icon ql-header" value="3" type="button" aria-label="${e(c.subheading)}"></button>
              <button class="button small icon ql-bold" type="button" aria-label="${e(c.bold)}"></button>
              <button class="button small icon ql-italic" type="button" aria-label="${e(c.italic)}"></button>
              <button class="button small icon ql-underline" type="button" aria-label="${e(c.underline)}"></button>
              <button class="button small icon ql-list" value="ordered" type="button" aria-label="${e(c.ordered)}"></button>
              <button class="button small icon ql-list" value="bullet" type="button" aria-label="${e(c.bullet)}"></button>
              <button class="button small icon ql-link" type="button" aria-label="${e(c.add_editor_link)}" aria-haspopup="dialog"></button>
              <button class="button small icon ql-clean" type="button" aria-label="${e(c.remove_format)}"></button>
            </div><div class="site-editor"></div><input type="hidden" name="content" value="${e(entry.content)}"></div>`
              : `<label class="field">${fieldLabel(c.url)}<input name="url" type="url" value="${e(entry.url)}" placeholder="https://" maxlength="2048" required></label>
            <div><label class="toggle">${fieldLabel(c.show_on_login, c.show_on_login_hint)}<input name="showOnLogin" type="checkbox"${entry.showOnLogin ? " checked" : ""}></label>
                 <label class="toggle">${fieldLabel(c.show_in_sidebar)}<input name="showInSidebar" type="checkbox"${entry.showInSidebar ? " checked" : ""}></label></div>`
          }
        </div>
        ${cardSaveActions(c.save)}
      </form>`;
    }

    function renderPagePicker() {
      const toolbar = stage.querySelector("[data-site-page-toolbar]");
      const editor = stage.querySelector("#site-page-editor");
      if (pages.some(({ title }) => title.length > 24)) {
        toolbar.innerHTML = `<label class="field"><span class="field-label sr-only">${e(c.pages)}</span><select data-site-page-select>
          ${pages.map(({ id, title }) => `<option value="${e(id)}"${id === activePage ? " selected" : ""}>${e(title)}</option>`).join("")}
        </select></label>`;
        editor.removeAttribute("role");
        editor.removeAttribute("aria-labelledby");
      } else {
        toolbar.innerHTML = `<nav class="segmented" data-fx="indicator" data-overflow role="tablist" aria-label="${e(c.pages)}">
          ${pages.map(({ id, title }) => `<button id="site-page-${e(id)}" type="button" role="tab" aria-controls="site-page-editor" aria-selected="${id === activePage}" tabindex="${id === activePage ? 0 : -1}" data-site-page="${e(id)}">${e(title)}</button>`).join("")}
        </nav>`;
        editor.setAttribute("role", "tabpanel");
        editor.setAttribute("aria-labelledby", `site-page-${activePage}`);
      }
      context.enhanceDashboard(toolbar);
    }

    function mountForms(host, forms = host.querySelectorAll("[data-site-entry]")) {
      context.initDraftForms(host);
      forms.forEach(bindForm);
      context.enhanceDashboard(host);
    }

    const emptyLinks = `<section class="card"><div class="empty-note"><strong>${e(c.no_links)}</strong></div></section>`;

    function renderSection(animate = false) {
      dock.querySelectorAll("[data-site-tab]").forEach((button) => {
        const selected = button.dataset.siteTab === activeTab;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      stage.setAttribute("aria-labelledby", `site-tab-${activeTab}`);
      const links = entries.filter((entry) => entry.kind === "link");
      const html =
        activeTab === "pages"
          ? `<div class="toolbar" data-site-page-toolbar></div><div id="site-page-editor">${formHtml(entries.find(({ id }) => id === activePage))}</div>`
          : `<div class="toolbar"><p class="hint">${e(c.link_hint)}</p><div class="actions"><button class="button small primary" type="button" data-site-add>${navigationIcon("plus")}${e(c.add_link)}</button></div></div>
           <div${links.length ? ' class="card-columns"' : ""} data-site-links>${links.length ? links.map(formHtml).join("") : emptyLinks}</div>`;
      if (animate) window.TomoriFX.swap(stage, html);
      else stage.innerHTML = html;
      if (activeTab === "pages") renderPagePicker();
      mountForms(stage);
    }

    function selectPage(id) {
      const entry = pages.find((page) => page.id === id);
      if (!entry || id === activePage || stage.querySelector(".is-saving")) return;
      activePage = id;
      const editor = stage.querySelector("#site-page-editor");
      stage.querySelectorAll("[data-site-page]").forEach((tab) => {
        const selected = tab.dataset.sitePage === id;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected) {
          editor.setAttribute("aria-labelledby", tab.id);
          tab.focus({ preventScroll: true });
        }
      });
      window.TomoriFX.swap(editor, formHtml(entry));
      mountForms(editor);
    }

    dock.addEventListener("click", (event) => {
      const button = event.target.closest("[data-site-tab]");
      if (!button || button.dataset.siteTab === activeTab || stage.querySelector(".is-saving")) return;
      activeTab = button.dataset.siteTab;
      renderSection(true);
      button.focus({ preventScroll: true });
    });

    stage.addEventListener("change", (event) => {
      if (!event.target.matches("[data-site-page-select]")) return;
      selectPage(event.target.value);
      if (event.target.value !== activePage) {
        event.target.value = activePage;
        event.target.dispatchEvent(new Event("input"));
      }
    });

    stage.addEventListener("click", (event) => {
      const pageTab = event.target.closest("[data-site-page]");
      if (pageTab) selectPage(pageTab.dataset.sitePage);
      if (!event.target.closest("[data-site-add]") || stage.querySelector(".is-saving")) return;
      const list = stage.querySelector("[data-site-links]");
      if (!entries.some(({ kind }) => kind === "link")) {
        list.replaceChildren();
        list.classList.add("card-columns");
      }
      const entry = {
        id: crypto.randomUUID(),
        kind: "link",
        title: "",
        content: "",
        url: "",
        showOnLogin: false,
        showInSidebar: false,
        position: entries.length,
      };
      entries.push(entry);
      list.insertAdjacentHTML("beforeend", formHtml(entry));
      const form = list.lastElementChild;
      mountForms(list, [form]);
      form.elements.title.focus();
    });

    function bindForm(form) {
      const entry = entries.find((item) => item.id === form.dataset.siteEntry);
      let editor;
      if (entry.kind === "page") {
        const icons = window.Quill.import("ui/icons");
        for (const name of ["bold", "italic", "underline", "link", "clean"]) {
          form.querySelector(`.ql-${name}`).innerHTML = icons[name];
        }
        form.querySelectorAll(".ql-list").forEach((button) => {
          button.innerHTML = icons.list[button.value];
        });
        form.querySelectorAll(".ql-header").forEach((button) => {
          button.innerHTML = icons.header[button.value];
        });
        editor = new window.Quill(form.querySelector(".site-editor"), {
          formats: ["header", "bold", "italic", "underline", "list", "link"],
          modules: {
            toolbar: {
              container: form.querySelector(".site-editor-toolbar"),
              handlers: {
                link(value) {
                  if (!value) {
                    editor.format("link", false);
                    return;
                  }
                  const range = editor.getSelection(true);
                  const dialog = document.createElement("dialog");
                  dialog.setAttribute("aria-labelledby", "site-editor-link-title");
                  dialog.innerHTML = `<form class="stack"><header class="panel-header"><div class="heading"><h2 id="site-editor-link-title">${e(c.add_editor_link)}</h2></div></header><label class="field">${fieldLabel(c.url)}<input name="url" type="url" placeholder="https://" required></label><footer class="actions"><button class="button" type="button">${e(c.cancel)}</button><button class="button primary" type="submit">${e(c.add_editor_link)}</button></footer></form>`;
                  document.body.append(dialog);
                  dialog.querySelector("input").oninput = (event) => event.target.setCustomValidity("");
                  dialog.querySelector('button[type="button"]').onclick = () => dialog.close();
                  dialog.querySelector("form").onsubmit = (event) => {
                    event.preventDefault();
                    const url = dialog.querySelector("input").value;
                    const input = dialog.querySelector("input");
                    input.setCustomValidity(/^(https?:\/\/|mailto:)/i.test(url) ? "" : c.invalid);
                    if (!input.reportValidity()) return;
                    if (range.length) editor.formatText(range.index, range.length, "link", url, "user");
                    else editor.insertText(range.index, url, { link: url }, "user");
                    dialog.close();
                  };
                  dialog.addEventListener(
                    "close",
                    () => {
                      dialog.remove();
                      editor.focus();
                    },
                    { once: true },
                  );
                  dialog.showModal();
                },
              },
            },
          },
        });
        editor.root.setAttribute("aria-labelledby", "site-editor-label");
        editor.root.setAttribute("role", "textbox");
        editor.root.setAttribute("aria-multiline", "true");
        const restore = () =>
          editor.setContents(editor.clipboard.convert({ html: form.elements.content.value }), "silent");
        restore();
        form.addEventListener("dashboard:restore", restore);
        editor.on("text-change", () => {
          form.elements.content.value = editor.getText().trim() ? editor.getSemanticHTML() : "";
          form.elements.content.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const preview = form.querySelector("[data-site-preview]");
        preview.onclick = async () => {
          preview.disabled = true;
          try {
            const result = await api("/site-admin/preview", {
              method: "POST",
              body: JSON.stringify({ content: form.elements.content.value }),
            });
            if (!form.isConnected) return;
            const dialog = document.createElement("dialog");
            dialog.className = "wide";
            dialog.setAttribute("aria-labelledby", "site-preview-title");
            dialog.innerHTML = `<div class="stack"><header class="panel-header"><div class="heading"><h2 id="site-preview-title">${e(form.elements.title.value || c.preview)}</h2></div><button type="button" class="button small">${e(c.cancel)}</button></header><div class="site-prose">${result.content}</div></div>`;
            document.body.append(dialog);
            dialog.querySelector("button").onclick = () => dialog.close();
            dialog.addEventListener("close", () => dialog.remove(), { once: true });
            dialog.showModal();
          } catch (error) {
            toast(error.message, "error");
          } finally {
            preview.disabled = false;
          }
        };
      }
      form.querySelector("[data-site-remove]")?.addEventListener("click", async () => {
        if (!(await context.confirmAction(c.remove_title, c.remove_hint, c.remove)) || !form.isConnected) return;
        try {
          await context.withBusyForm(form, () => api(`/site-admin/entries/${entry.id}`, { method: "DELETE" }));
          context.completeFormSave(form);
          entries = entries.filter((item) => item.id !== entry.id);
          const list = form.parentElement;
          if (list) {
            form.remove();
            if (!list.children.length) {
              list.classList.remove("card-columns");
              list.innerHTML = emptyLinks;
            }
            stage.querySelector("[data-site-add]")?.focus({ preventScroll: true });
          }
          await context.afterSave();
          toast(c.saved);
        } catch (error) {
          toast(error.message, "error");
        }
      });
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (form.classList.contains("is-saving")) return;
        editor?.disable();
        const previousTitle = entry.title;
        try {
          await context.withBusyForm(form, async () => {
            const result = await api(`/site-admin/entries/${entry.id}`, {
              method: "PUT",
              body: JSON.stringify({
                kind: entry.kind,
                title: form.elements.title.value,
                content: form.elements.content?.value || "",
                url: form.elements.url?.value || "",
                ...(entry.kind === "page"
                  ? { enabled: form.elements.enabled.checked }
                  : {
                      showOnLogin: form.elements.showOnLogin.checked,
                      showInSidebar: form.elements.showInSidebar.checked,
                    }),
                position: Number(form.elements.position.value),
              }),
            });
            Object.assign(entry, result.entry);
            form.elements.title.value = entry.title;
            if (editor) {
              form.elements.content.value = entry.content;
              editor.setContents(editor.clipboard.convert({ html: entry.content }), "silent");
            } else form.elements.url.value = entry.url;
            context.completeFormSave(form);
            form.querySelector(".card-head h3").textContent = entry.title;
            if (editor && previousTitle !== entry.title && form.isConnected) renderPagePicker();
          });
          await context.afterSave();
          toast(c.saved);
        } catch (error) {
          if (form.isConnected) context.showFormError(form, error);
          else toast(error.message, "error");
        } finally {
          editor?.enable();
        }
      };
    }
    renderSection();
    context.enhanceDashboard(root);
  }
  window.TomoriSite = { renderAdmin };
})();
