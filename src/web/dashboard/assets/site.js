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
    const { api, escapeHtml: e, fieldLabel, pageHeader, navigationIcon, copy: c, toast } = context;
    root.innerHTML = `<span class="loading" role="status" aria-label="${e(c.title)}"></span>`;
    let entries;
    try {
      const response = await api("/site-admin/entries");
      entries = response.entries;
      await loadEditor();
    } catch {
      if (isCurrent()) root.innerHTML = `<div class="notice danger" role="alert">${e(c.load_failed)}</div>`;
      return;
    }
    if (!isCurrent()) return;

    function formHtml(entry) {
      const page = entry.kind === "page";
      return `<form class="panel stack" data-site-entry="${e(entry.id)}">
        <header class="panel-header"><div class="heading"><p class="eyebrow">${e(page ? c.pages : c.links)}</p><h2>${e(entry.title || c.add_link)}</h2>${page ? "" : `<p>${e(c.link_hint)}</p>`}</div>
          ${page ? `<button class="button" type="button" data-site-preview>${e(c.preview)}</button>` : `<button class="button danger" type="button" data-site-remove>${e(c.remove)}</button>`}</header>
        <div class="grid">
          <label class="field">${fieldLabel(page ? c.page_title : c.link_title)}<input name="title" value="${e(entry.title)}" maxlength="100" required></label>
          <label class="field">${fieldLabel(c.position, c.position_hint)}<input name="position" type="number" min="0" max="999" value="${entry.position}" required></label>
        </div>
        ${
          page
            ? `<div class="field"><span class="field-label"><strong id="site-editor-label">${e(c.content)}</strong></span>
          <div class="site-editor-toolbar actions" role="toolbar" aria-label="${e(c.editor)}">
            <button class="button icon ql-header" value="2" type="button" aria-label="${e(c.heading)}" data-tooltip="${e(c.heading)}"></button>
            <button class="button icon ql-header" value="3" type="button" aria-label="${e(c.subheading)}" data-tooltip="${e(c.subheading)}"></button>
            <button class="button icon ql-bold" type="button" aria-label="${e(c.bold)}" data-tooltip="${e(c.bold)}"></button>
            <button class="button icon ql-italic" type="button" aria-label="${e(c.italic)}" data-tooltip="${e(c.italic)}"></button>
            <button class="button icon ql-underline" type="button" aria-label="${e(c.underline)}" data-tooltip="${e(c.underline)}"></button>
            <button class="button icon ql-list" value="ordered" type="button" aria-label="${e(c.ordered)}" data-tooltip="${e(c.ordered)}"></button>
            <button class="button icon ql-list" value="bullet" type="button" aria-label="${e(c.bullet)}" data-tooltip="${e(c.bullet)}"></button>
            <button class="button icon ql-link" type="button" aria-label="${e(c.add_editor_link)}" data-tooltip="${e(c.add_editor_link)}"></button>
            <button class="button icon ql-clean" type="button" aria-label="${e(c.remove_format)}" data-tooltip="${e(c.remove_format)}"></button>
          </div><div class="site-editor"></div><input type="hidden" name="content" value="${e(entry.content)}"></div>`
            : `<label class="field">${fieldLabel(c.url)}<input name="url" type="url" value="${e(entry.url)}" placeholder="https://" maxlength="2048" required></label>`
        }
        <label class="toggle">${fieldLabel(c.visible, c.visible_hint)}<input name="enabled" type="checkbox"${entry.enabled ? " checked" : ""}></label>
        <footer class="actions form-actions"><button class="button primary" type="submit">${e(c.save)}</button></footer>
      </form>`;
    }

    function render() {
      root.innerHTML = `${pageHeader(c.admin, c.title, c.hint)}
        <nav class="tabs tabs-parent${activeTab === "pages" ? " tabs-joined" : ""}" aria-label="${e(c.title)}">${["pages", "links"].map((tab) => `<button type="button" data-site-tab="${tab}" aria-current="${activeTab === tab ? "page" : "false"}">${e(c[tab])}</button>`).join("")}</nav>
        <div class="stack" data-site-content>${
          activeTab === "pages"
            ? `<nav class="tabs tabs-child" aria-label="${e(c.pages)}">${entries
                .filter((entry) => entry.kind === "page")
                .map(
                  (entry) =>
                    `<button type="button" data-site-page="${e(entry.id)}" aria-current="${activePage === entry.id ? "page" : "false"}">${e(entry.title)}</button>`,
                )
                .join("")}</nav>${formHtml(entries.find((entry) => entry.id === activePage))}`
            : `<div class="actions"><button class="button" type="button" data-site-add>${navigationIcon("plus")}${e(c.add_link)}</button></div>${entries
                .filter((entry) => entry.kind === "link")
                .map(formHtml)
                .join("")}`
        }</div>`;
      context.initDraftForms(root);
      root.querySelectorAll("[data-site-entry]").forEach(bindForm);
      context.enhanceDashboard(root);
      root.querySelectorAll("[data-site-tab], [data-site-page]").forEach((button) => {
        button.onclick = () => {
          if (button.dataset.siteTab) activeTab = button.dataset.siteTab;
          if (button.dataset.sitePage) activePage = button.dataset.sitePage;
          render();
        };
      });
      root.querySelector("[data-site-add]")?.addEventListener("click", () => {
        const entry = {
          id: crypto.randomUUID(),
          kind: "link",
          title: "",
          content: "",
          url: "",
          enabled: false,
          position: entries.length,
        };
        entries.push(entry);
        render();
        root.querySelector(`[data-site-entry="${entry.id}"] input[name="title"]`).focus();
      });
    }

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
                  dialog.className = "dialog";
                  dialog.innerHTML = `<form class="stack"><header class="panel-header"><div class="heading"><h2>${e(c.add_editor_link)}</h2></div></header><label class="field">${fieldLabel(c.url)}<input name="url" type="url" placeholder="https://" required></label><footer class="actions"><button class="button" type="button">${e(c.cancel)}</button><button class="button primary" type="submit">${e(c.add_editor_link)}</button></footer></form>`;
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
                  dialog.addEventListener("close", () => {
                    dialog.remove();
                    editor.focus();
                  });
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
        form.querySelector("[data-site-preview]").onclick = async () => {
          try {
            const result = await api("/site-admin/preview", {
              method: "POST",
              body: JSON.stringify({ content: form.elements.content.value }),
            });
            if (!form.isConnected) return;
            const dialog = document.createElement("dialog");
            dialog.className = "dialog wide";
            dialog.innerHTML = `<header class="panel-header"><div class="heading"><h2>${e(form.elements.title.value)}</h2></div><button type="button" class="button">${e(c.cancel)}</button></header><div class="site-prose">${result.content}</div>`;
            document.body.append(dialog);
            dialog.querySelector("button").onclick = () => dialog.close();
            dialog.addEventListener("close", () => dialog.remove());
            dialog.showModal();
          } catch (error) {
            toast(error.message, "error");
          }
        };
      }
      form.querySelector("[data-site-remove]")?.addEventListener("click", async () => {
        if (!(await context.confirmAction(c.remove_title, c.remove_hint))) return;
        try {
          await context.withBusyForm(form, () => api(`/site-admin/entries/${entry.id}`, { method: "DELETE" }));
          context.completeFormSave(form);
          entries = entries.filter((item) => item.id !== entry.id);
          await context.afterSave();
          render();
          toast(c.saved);
        } catch (error) {
          toast(error.message, "error");
        }
      });
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (form.classList.contains("is-saving")) return;
        editor?.disable();
        try {
          await context.withBusyForm(form, async () => {
            const result = await api(`/site-admin/entries/${entry.id}`, {
              method: "PUT",
              body: JSON.stringify({
                kind: entry.kind,
                title: form.elements.title.value,
                content: form.elements.content?.value || "",
                url: form.elements.url?.value || "",
                enabled: form.elements.enabled.checked,
                position: Number(form.elements.position.value),
              }),
            });
            Object.assign(entry, result.entry);
            if (editor) {
              form.elements.content.value = entry.content;
              editor.setContents(editor.clipboard.convert({ html: entry.content }), "silent");
            }
            context.completeFormSave(form);
            form.querySelector("h2").textContent = entry.title;
            const pageTab = root.querySelector(`[data-site-page="${entry.id}"]`);
            if (pageTab) pageTab.textContent = entry.title;
          });
          await context.afterSave();
          toast(c.saved);
        } catch (error) {
          toast(error.message, "error");
        } finally {
          editor?.enable();
        }
      };
    }
    render();
  }
  window.TomoriSite = { renderAdmin };
})();
