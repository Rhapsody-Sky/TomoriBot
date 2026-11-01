(() => {
  const states = new WeakMap();
  const actionMenuStates = new WeakMap();
  const actionMenuRecords = new Set();
  let controlId = 0;
  let copy = {};
  const supportsPopover = "showPopover" in HTMLElement.prototype;
  const sprite = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  sprite.setAttribute("width", "0");
  sprite.setAttribute("height", "0");
  sprite.setAttribute("aria-hidden", "true");
  sprite.style.position = "absolute";
  const paths = {
    chevron: "m6 9 6 6 6-6",
    check: "m5 12 4 4L19 6",
    close: "m18 6-12 12M6 6l12 12",
    upload: "M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5",
  };
  for (const [name, path] of Object.entries(paths)) {
    const symbol = document.createElementNS("http://www.w3.org/2000/svg", "symbol");
    symbol.id = `ui-control-${name}`;
    symbol.setAttribute("viewBox", "0 0 24 24");
    symbol.setAttribute("fill", "none");
    symbol.setAttribute("stroke", "currentColor");
    symbol.setAttribute("stroke-width", "2");
    symbol.setAttribute("stroke-linecap", "round");
    symbol.setAttribute("stroke-linejoin", "round");
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.setAttribute("d", path);
    symbol.append(shape);
    sprite.append(symbol);
  }
  document.body.append(sprite);

  function glyph(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("glyph");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#ui-control-${name}`);
    svg.append(use);
    return svg;
  }

  function fieldLabel(input) {
    const field = input.closest(".field");
    if (!field) return null;
    const label = field.querySelector(".field-label, :scope > span");
    if (!label) return null;
    label.id ||= `control-label-${++controlId}`;
    input.setAttribute("aria-labelledby", label.id);
    if (field.tagName === "LABEL") {
      const container = document.createElement("div");
      for (const attribute of field.attributes) {
        if (attribute.name !== "for") container.setAttribute(attribute.name, attribute.value);
      }
      container.append(...field.childNodes);
      field.replaceWith(container);
    }
    return label;
  }

  function placePopover(menu, trigger) {
    const rect = trigger.getBoundingClientRect();
    const below = innerHeight - rect.bottom - 18;
    const above = rect.top - 18;
    menu.style.maxHeight = `${Math.max(80, Math.min(260, Math.max(below, above)))}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - menu.offsetWidth - 12))}px`;
    menu.style.top = `${below >= menu.offsetHeight || below >= above ? rect.bottom + 6 : Math.max(12, rect.top - menu.offsetHeight - 6)}px`;
  }

  function enhanceSelect(select) {
    if (!supportsPopover || select.multiple || select.size > 1 || select.hidden) return;
    const label = fieldLabel(select);
    if (!label) return;
    const id = `control-choice-${++controlId}`;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", id);
    trigger.setAttribute("aria-labelledby", label.id);
    if (select.getAttribute("aria-describedby"))
      trigger.setAttribute("aria-describedby", select.getAttribute("aria-describedby"));
    if (select.dataset.tooltip) trigger.dataset.tooltip = select.dataset.tooltip;
    const value = document.createElement("span");
    value.className = "select-value";
    trigger.append(value, glyph("chevron"));
    const list = document.createElement("div");
    list.id = id;
    list.className = "select-options";
    list.setAttribute("popover", "auto");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-labelledby", label.id);
    const error = document.createElement("span");
    error.className = "control-validation error";
    error.id = `${id}-error`;
    error.hidden = true;
    select.after(trigger, list, error);
    select.classList.add("control-native-select");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    let options = [];
    let active = select.selectedIndex;
    let query = "";
    let lastKey = 0;
    let validating = false;

    function optionDisabled(index) {
      const option = select.options[index];
      return !option || option.disabled || option.hidden || option.parentElement?.disabled;
    }

    function sync() {
      value.textContent = select.selectedOptions[0]?.textContent || "";
      trigger.disabled = select.matches(":disabled");
      trigger.setAttribute("aria-required", String(select.required));
      options.forEach((row, index) => {
        row.setAttribute("aria-selected", String(index === select.selectedIndex));
        row.setAttribute("aria-disabled", String(Boolean(optionDisabled(index))));
      });
      if (validating) {
        error.textContent = select.validationMessage;
        error.hidden = select.validity.valid;
        trigger.setAttribute("aria-invalid", String(!select.validity.valid));
      }
      if (trigger.disabled) close();
    }

    function buildOptions() {
      list.replaceChildren();
      options = [...select.options].map((option, index) => {
        const row = document.createElement("div");
        row.className = "select-option";
        row.id = `${id}-${index}`;
        row.hidden = option.hidden;
        row.setAttribute("role", "option");
        const text = document.createElement("span");
        text.textContent = option.textContent;
        row.append(text, glyph("check"));
        list.append(row);
        row.addEventListener("pointerdown", (event) => event.preventDefault());
        row.addEventListener("pointermove", () => highlight(index));
        row.addEventListener("click", () => commit(index));
        return row;
      });
      sync();
    }

    function highlight(index) {
      if (optionDisabled(index)) return;
      active = index;
      options.forEach((row, rowIndex) => {
        row.dataset.active = String(rowIndex === active);
      });
      trigger.setAttribute("aria-activedescendant", options[active].id);
      options[active].scrollIntoView({ block: "nearest" });
    }

    function open() {
      if (select.matches(":disabled") || list.matches(":popover-open")) return;
      buildOptions();
      list.style.width = `${Math.min(trigger.getBoundingClientRect().width, innerWidth - 24)}px`;
      list.showPopover();
      placePopover(list, trigger);
      trigger.setAttribute("aria-expanded", "true");
      active = select.selectedIndex;
      highlight(optionDisabled(active) ? [...select.options].findIndex((_, index) => !optionDisabled(index)) : active);
    }

    function close() {
      if (list.matches(":popover-open")) list.hidePopover();
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
    }

    function commit(index) {
      if (select.matches(":disabled") || optionDisabled(index)) return;
      const changed = select.selectedIndex !== index;
      select.selectedIndex = index;
      sync();
      close();
      if (changed) {
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (trigger.isConnected) trigger.focus();
    }

    trigger.addEventListener("click", () => (list.matches(":popover-open") ? close() : open()));
    trigger.addEventListener("keydown", (event) => {
      if (select.matches(":disabled")) return;
      const opened = list.matches(":popover-open");
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        open();
        const enabled = [...select.options].map((_, index) => index).filter((index) => !optionDisabled(index));
        const position = enabled.indexOf(active);
        const index =
          event.key === "Home"
            ? enabled[0]
            : event.key === "End"
              ? enabled.at(-1)
              : enabled[Math.max(0, Math.min(enabled.length - 1, position + (event.key === "ArrowDown" ? 1 : -1)))];
        highlight(index);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (opened) commit(active);
        else open();
      } else if (event.key === "Escape") {
        if (opened) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      } else if (event.key === "Tab") close();
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        query = Date.now() - lastKey > 700 ? event.key : query + event.key;
        lastKey = Date.now();
        const index = [...select.options].findIndex(
          (option, index) => !optionDisabled(index) && option.textContent.toLowerCase().startsWith(query.toLowerCase()),
        );
        if (index >= 0) {
          open();
          highlight(index);
        }
      }
    });
    list.addEventListener("toggle", (event) => {
      trigger.setAttribute("aria-expanded", String(event.newState === "open"));
      if (event.newState === "closed") trigger.removeAttribute("aria-activedescendant");
    });
    select.addEventListener("input", sync);
    select.addEventListener("change", sync);
    select.addEventListener("focus", () => trigger.focus());
    select.addEventListener("invalid", (event) => {
      event.preventDefault();
      validating = true;
      const describedBy = new Set((trigger.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      describedBy.add(error.id);
      trigger.setAttribute("aria-describedby", [...describedBy].join(" "));
      sync();
      if (!select.form || select.form.querySelector(":invalid") === select) trigger.focus();
    });
    select.form?.addEventListener("reset", () =>
      setTimeout(() => {
        validating = false;
        error.hidden = true;
        trigger.removeAttribute("aria-invalid");
        sync();
      }, 0),
    );
    const observer = new MutationObserver(buildOptions);
    observer.observe(select, {
      attributes: true,
      attributeFilter: ["disabled", "required", "selected", "label", "hidden"],
      childList: true,
      subtree: true,
      characterData: true,
    });
    states.set(select, sync);
    buildOptions();
  }

  function enhanceScrub(input) {
    const label = fieldLabel(input);
    if (!label) return;
    const wrap = document.createElement("span");
    wrap.className = "scrub";
    const grip = document.createElement("button");
    grip.type = "button";
    grip.className = "scrub-handle";
    grip.textContent = "\u2194";
    const unit = document.createElement("span");
    unit.className = "scrub-unit";
    unit.textContent = input.dataset.unit || "";
    input.before(wrap);
    wrap.append(grip, input, unit);
    let drag = null;
    function limits() {
      const min = input.min === "" ? -Infinity : Number(input.min);
      const max = input.max === "" ? Infinity : Number(input.max);
      return {
        min: Number.isFinite(min) ? min : -Infinity,
        max: Number.isFinite(max) ? max : Infinity,
        step: Number(input.step) > 0 ? Number(input.step) : 1,
      };
    }
    function sync() {
      const { min, max } = limits();
      const value = input.valueAsNumber;
      const fill =
        Number.isFinite(value) && Number.isFinite(min) && Number.isFinite(max) && max > min
          ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
          : 0;
      wrap.style.setProperty("--scrub-fill", `${fill}%`);
      const labelText = label.firstChild?.textContent.trim() || label.textContent.trim();
      grip.setAttribute("aria-label", (copy.control_adjust || "{label}").replace("{label}", labelText));
      grip.dataset.tooltip = grip.getAttribute("aria-label");
      if (document.getElementById("scrub-instructions")) grip.setAttribute("aria-describedby", "scrub-instructions");
      grip.disabled = input.matches(":disabled") || input.readOnly;
    }
    function set(value) {
      const { min, max, step } = limits();
      const base = Number.isFinite(min) ? min : Number(input.defaultValue) || 0;
      input.value = String(
        Number(Math.max(min, Math.min(max, base + Math.round((value - base) / step) * step)).toFixed(8)),
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      sync();
    }
    function finish(cancel) {
      if (!drag) return;
      const previous = drag;
      drag = null;
      if (cancel) {
        input.value = previous.original;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        sync();
      }
      wrap.classList.remove("is-scrubbing");
      if (grip.hasPointerCapture(previous.id)) grip.releasePointerCapture(previous.id);
      if (!cancel && previous.original !== input.value) input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    grip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || input.matches(":disabled") || input.readOnly) return;
      event.preventDefault();
      grip.focus();
      const { min } = limits();
      drag = {
        id: event.pointerId,
        x: event.clientX,
        original: input.value,
        value: Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : Number.isFinite(min) ? min : 0,
      };
      grip.setPointerCapture(event.pointerId);
      wrap.classList.add("is-scrubbing");
    });
    grip.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      if (input.matches(":disabled") || input.readOnly) {
        finish(true);
        return;
      }
      set(drag.value + Math.round((event.clientX - drag.x) / (event.shiftKey ? 24 : 8)) * limits().step);
    });
    grip.addEventListener("pointerup", () => finish(false));
    grip.addEventListener("pointercancel", () => finish(true));
    grip.addEventListener("lostpointercapture", () => finish(true));
    grip.addEventListener("blur", () => finish(true));
    grip.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(true);
        return;
      }
      if (
        input.matches(":disabled") ||
        input.readOnly ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
      )
        return;
      const { min, max, step } = limits();
      if ((event.key === "Home" && !Number.isFinite(min)) || (event.key === "End" && !Number.isFinite(max))) return;
      event.preventDefault();
      const value = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : Number.isFinite(min) ? min : 0;
      set(
        event.key === "Home"
          ? min
          : event.key === "End"
            ? max
            : value + (["ArrowUp", "ArrowRight"].includes(event.key) ? step : -step),
      );
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
    input.form?.addEventListener("reset", () => setTimeout(sync, 0));
    const observer = new MutationObserver(sync);
    observer.observe(input, {
      attributes: true,
      attributeFilter: ["disabled", "readonly", "min", "max", "step", "value"],
    });
    states.set(input, sync);
    sync();
  }

  function accepts(input, file) {
    const rules = input.accept
      .toLowerCase()
      .split(",")
      .map((rule) => rule.trim())
      .filter(Boolean);
    return (
      !rules.length ||
      rules.some((rule) =>
        rule.startsWith(".")
          ? file.name.toLowerCase().endsWith(rule)
          : rule.endsWith("/*")
            ? file.type.toLowerCase().startsWith(rule.slice(0, -1))
            : file.type.toLowerCase() === rule,
      )
    );
  }

  function enhanceFile(input) {
    if (input.hidden || input.classList.contains("sr-only") || !input.closest(".field")) return;
    const zone = document.createElement("span");
    zone.className = "dropzone";
    const title = document.createElement("strong");
    title.className = "file-name";
    const hint = document.createElement("small");
    const status = document.createElement("small");
    status.setAttribute("role", "status");
    input.before(zone);
    zone.append(glyph("upload"), title, hint, input, status);
    function update() {
      zone.classList.remove("is-dragging", "is-invalid");
      zone.classList.toggle("is-disabled", input.matches(":disabled"));
      hint.textContent = input.dataset.fileHint || copy.control_choose_file || "";
      const files = [...input.files];
      title.textContent = files.length ? files.map((file) => file.name).join(", ") : copy.control_drop_file || "";
      zone.classList.toggle("has-file", files.length > 0);
      status.textContent = files.length
        ? `${Math.max(1, Math.round(files.reduce((total, file) => total + file.size, 0) / 1024))} KB${copy.control_file_ready ? ` \u00b7 ${copy.control_file_ready}` : ""}`
        : "";
    }
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (input.matches(":disabled")) return;
      zone.classList.add("is-dragging");
    });
    zone.addEventListener("dragleave", (event) => {
      if (!(event.relatedTarget instanceof Node) || !zone.contains(event.relatedTarget))
        zone.classList.remove("is-dragging");
    });
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragging");
      if (input.matches(":disabled")) return;
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
      const selected = input.multiple ? files : files.slice(0, 1);
      if (selected.some((file) => !accepts(input, file))) {
        zone.classList.add("is-invalid");
        status.textContent = copy.control_file_invalid || "";
        return;
      }
      const transfer = new DataTransfer();
      selected.forEach((file) => {
        transfer.items.add(file);
      });
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    input.addEventListener("change", update);
    input.form?.addEventListener("reset", () => setTimeout(update, 0));
    const observer = new MutationObserver(update);
    observer.observe(input, { attributes: true, attributeFilter: ["disabled", "accept"] });
    states.set(input, update);
    update();
  }

  function closePopovers() {
    if (!supportsPopover) return;
    document.querySelectorAll(".select-options:popover-open").forEach((list) => {
      list.hidePopover();
    });
  }

  function findActionMenuTrigger(menu, root) {
    const find = (container) =>
      [...container.querySelectorAll("[popovertarget]")].find(
        (trigger) => trigger.getAttribute("popovertarget") === menu.id,
      );
    return find(root) || (root === document ? null : find(document));
  }

  function enhanceActionMenus(root) {
    for (const record of actionMenuRecords) {
      if (record.menu.isConnected && record.trigger.isConnected) continue;
      record.cleanup();
      actionMenuRecords.delete(record);
    }
    if (!supportsPopover) return;
    root.querySelectorAll(".action-menu[popover]").forEach((menu) => {
      if (actionMenuStates.has(menu)) return;
      const trigger = findActionMenuTrigger(menu, root);
      if (!trigger) return;
      trigger.setAttribute("aria-expanded", "false");

      const position = () => placePopover(menu, trigger);
      const onToggle = (event) => {
        const open = event.newState === "open";
        trigger.setAttribute("aria-expanded", String(open));
        if (open) {
          position();
          menu.querySelector("button:not(:disabled):not([hidden])")?.focus({ preventScroll: true });
        }
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") trigger.focus({ preventScroll: true });
      };
      const onClick = (event) => {
        const action = event.target.closest("button");
        if (!action || !menu.contains(action)) return;
        setTimeout(() => {
          if (menu.matches(":popover-open")) menu.hidePopover();
          if (action.hasAttribute("data-action-menu-preserve-focus")) return;
          const dialog = document.querySelector("dialog[open]");
          if (dialog) {
            dialog.addEventListener(
              "close",
              () => {
                if (trigger.isConnected) trigger.focus({ preventScroll: true });
              },
              { once: true },
            );
          } else if (trigger.isConnected) trigger.focus({ preventScroll: true });
        }, 0);
      };
      const onResize = () => {
        if (menu.matches(":popover-open")) position();
      };
      const onScroll = () => {
        if (menu.matches(":popover-open")) menu.hidePopover();
      };

      menu.addEventListener("toggle", onToggle);
      menu.addEventListener("keydown", onKeyDown);
      menu.addEventListener("click", onClick);
      window.addEventListener("resize", onResize);
      window.addEventListener("scroll", onScroll, { passive: true });
      const cleanup = () => {
        menu.removeEventListener("toggle", onToggle);
        menu.removeEventListener("keydown", onKeyDown);
        menu.removeEventListener("click", onClick);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("scroll", onScroll);
        actionMenuStates.delete(menu);
      };
      const record = { menu, trigger, cleanup };
      actionMenuStates.set(menu, record);
      actionMenuRecords.add(record);
    });
  }

  let confirmHold = async () => false;
  function enhanceHolds(root) {
    root.querySelectorAll("[data-hold]:not([data-hold-ready])").forEach((button) => {
      button.dataset.holdReady = "true";
      const label = button.querySelector("span");
      const idle = label.textContent;
      let frame = 0,
        start = 0,
        holding = false,
        source = null,
        complete = false,
        confirming = false;
      function cancel() {
        cancelAnimationFrame(frame);
        holding = false;
        source = null;
        button.classList.remove("is-holding");
        if (!complete) {
          button.style.setProperty("--hold", 0);
          label.textContent = idle;
        }
      }
      function tick(now) {
        if (!holding) return;
        if (!button.isConnected) return cancel();
        const fraction = Math.min(1, (now - start) / 1200);
        button.style.setProperty("--hold", fraction);
        if (fraction === 1) {
          complete = true;
          holding = false;
          button.classList.remove("is-holding");
          label.textContent = copy.control_hold_confirmed;
          button.classList.add("is-complete");
          button.dispatchEvent(new Event("holdcomplete", { bubbles: true }));
        } else frame = requestAnimationFrame(tick);
      }
      function begin(kind) {
        if (holding || button.disabled || complete) return;
        source = kind;
        holding = true;
        start = performance.now();
        label.textContent = copy.control_keep_holding;
        button.classList.add("is-holding");
        frame = requestAnimationFrame(tick);
      }
      button.onpointerdown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        button.focus();
        button.setPointerCapture(event.pointerId);
        begin("pointer");
      };
      button.onpointermove = (event) => {
        if (!holding || source !== "pointer") return;
        const rect = button.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          cancel();
      };
      button.onpointerup = cancel;
      button.onpointercancel = cancel;
      button.onlostpointercapture = cancel;
      button.onkeydown = (event) => {
        if (event.key === "Escape") return cancel();
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          if (!event.repeat) begin("keyboard");
        }
      };
      button.onkeyup = (event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          cancel();
        }
      };
      button.onblur = cancel;
      button.onclick = async (event) => {
        event.preventDefault();
        if (event.detail !== 0 || holding || complete || confirming || button.disabled) return;
        confirming = true;
        try {
          if ((await confirmHold(button)) && button.isConnected && !button.disabled)
            button.dispatchEvent(new Event("holdcomplete", { bubbles: true }));
        } finally {
          confirming = false;
        }
      };
      button.addEventListener("holdreset", () => {
        cancel();
        complete = false;
        button.classList.remove("is-complete");
        button.style.setProperty("--hold", 0);
        label.textContent = idle;
      });
      button.addEventListener("holdcancel", cancel);
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden)
      document.querySelectorAll("[data-hold]").forEach((button) => {
        button.dispatchEvent(new Event("holdcancel"));
      });
  });
  window.addEventListener("blur", () =>
    document.querySelectorAll("[data-hold]").forEach((button) => {
      button.dispatchEvent(new Event("holdcancel"));
    }),
  );

  const tip = document.createElement("span");
  tip.id = "control-tooltip";
  tip.className = "tooltip";
  tip.setAttribute("role", "tooltip");
  tip.setAttribute("popover", "manual");
  const dismissed = new WeakSet();
  let target = null;
  let showTimer = 0;
  let hideTimer = 0;
  let pointerFocus = false;

  function tooltipControl(node) {
    return node instanceof Element
      ? node.closest(
          "[data-tooltip],button[title],button.icon[aria-label],button.button-icon[aria-label],.scrub-handle",
        )
      : null;
  }

  function hideTooltip() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (supportsPopover && tip.matches(":popover-open")) tip.hidePopover();
    if (target) {
      const ids = (target.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== tip.id);
      if (ids.length) target.setAttribute("aria-describedby", ids.join(" "));
      else target.removeAttribute("aria-describedby");
    }
    target = null;
  }

  function showTooltip(button) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (
      !supportsPopover ||
      !button.isConnected ||
      button.matches(":disabled") ||
      button.getAttribute("aria-expanded") === "true" ||
      dismissed.has(button)
    )
      return;
    const text = button.dataset.tooltip || button.title || button.getAttribute("aria-label");
    if (!text) return;
    if (target === button && tip.matches(":popover-open")) return;
    hideTooltip();
    target = button;
    if (button.title) {
      button.dataset.tooltip = button.title;
      button.removeAttribute("title");
    }
    tip.textContent = text;
    (button.closest("dialog[open]") || document.body).append(tip);
    const ids = new Set((button.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
    ids.add(tip.id);
    button.setAttribute("aria-describedby", [...ids].join(" "));
    tip.showPopover();
    const box = button.getBoundingClientRect();
    const bounds = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(12, Math.min(box.left + (box.width - bounds.width) / 2, innerWidth - bounds.width - 12))}px`;
    const top = box.top - bounds.height - 8;
    tip.style.top = `${Math.max(8, Math.min(top >= 8 ? top : box.bottom + 8, innerHeight - bounds.height - 8))}px`;
  }

  function leaveTooltip(button) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (tip.matches(":hover") || button.matches(":hover,:focus-within")) return;
      dismissed.delete(button);
      if (target === button) hideTooltip();
    }, 150);
  }

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    if (tip.contains(event.target)) {
      clearTimeout(hideTimer);
      return;
    }
    const button = tooltipControl(event.target);
    if (!button || (event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => showTooltip(button), 350);
  });
  document.addEventListener("pointerout", (event) => {
    const button = tooltipControl(event.target);
    if (button && (!(event.relatedTarget instanceof Node) || !button.contains(event.relatedTarget)))
      leaveTooltip(button);
    else if (tip.contains(event.target) && target) leaveTooltip(target);
  });
  document.addEventListener("focusin", (event) => {
    const button = tooltipControl(event.target);
    if (button && !pointerFocus) showTooltip(button);
  });
  document.addEventListener("focusout", (event) => {
    const button = tooltipControl(event.target);
    if (button && (!(event.relatedTarget instanceof Node) || !button.contains(event.relatedTarget)))
      leaveTooltip(button);
  });
  document.addEventListener(
    "pointerdown",
    () => {
      pointerFocus = true;
      hideTooltip();
      setTimeout(() => {
        pointerFocus = false;
      }, 0);
    },
    true,
  );
  document.addEventListener("click", hideTooltip);
  document.addEventListener("input", (event) => {
    if (event.target === target) hideTooltip();
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && target) {
        dismissed.add(target);
        hideTooltip();
        event.preventDefault();
        event.stopImmediatePropagation();
      } else if (event.key !== "Tab") hideTooltip();
    },
    true,
  );
  document.addEventListener(
    "scroll",
    (event) => {
      hideTooltip();
      if (!(event.target instanceof Element) || !event.target.closest(".select-options")) closePopovers();
    },
    true,
  );
  document.addEventListener("close", hideTooltip, true);
  window.addEventListener("resize", () => {
    hideTooltip();
    closePopovers();
  });
  window.addEventListener("blur", hideTooltip);

  const tabStates = new WeakMap();
  const tabRecords = new Set();

  function enhanceTabs(root = document) {
    for (const record of tabRecords) {
      if (record.navigation.isConnected) continue;
      record.resize.disconnect();
      record.mutations.disconnect();
      tabRecords.delete(record);
    }
    root.querySelectorAll(".tabs, .settings-tabs, .persona-tabs").forEach((row) => {
      if (tabStates.has(row)) {
        tabStates.get(row).measure();
        return;
      }
      const buttons = [...row.children].filter((child) => child.tagName === "BUTTON");
      if (!buttons.length) return;
      const navigation = document.createElement("div");
      navigation.className = "tab-navigation";
      const viewport = document.createElement("div");
      viewport.className = "tabs-viewport";
      const picker = document.createElement("button");
      picker.type = "button";
      picker.className = "button tab-selection";
      picker.setAttribute("aria-haspopup", "dialog");
      picker.setAttribute("aria-expanded", "false");
      const selectedLabel = document.createElement("span");
      picker.append(document.createTextNode(copy.control_sections || ""), selectedLabel);
      const dialog = document.createElement("dialog");
      dialog.id = `control-tabs-${++controlId}`;
      const header = document.createElement("header");
      header.className = "panel-header";
      const heading = document.createElement("div");
      heading.className = "heading";
      const context = document.createElement("p");
      context.className = "eyebrow";
      const navigationLabel = row.getAttribute("aria-label") || "";
      context.textContent = navigationLabel;
      const title = document.createElement("h2");
      title.id = `${dialog.id}-title`;
      title.textContent = copy.control_choose_section || "";
      dialog.setAttribute("aria-labelledby", title.id);
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "button icon";
      closeButton.setAttribute("aria-label", copy.control_close_dialog || "");
      closeButton.dataset.tooltip = copy.control_close_dialog || "";
      closeButton.append(glyph("close"));
      heading.append(context, title);
      header.append(heading, closeButton);
      const options = document.createElement("div");
      options.className = "sheet-options";
      dialog.append(header, options);
      picker.setAttribute("aria-controls", dialog.id);
      row.before(navigation);
      navigation.append(viewport, picker, dialog);
      viewport.append(row);
      row.classList.add("tabs");
      row.setAttribute("role", "tablist");

      function selectedTab() {
        return (
          buttons.find((button) => button.getAttribute("aria-current") === "page") ||
          buttons.find((button) => button.getAttribute("aria-pressed") === "true") ||
          buttons.find((button) => button.classList.contains("is-active")) ||
          buttons.find((button) => button.getAttribute("aria-selected") === "true") ||
          buttons[0]
        );
      }

      function sync() {
        const selected = selectedTab();
        for (const button of buttons) {
          button.setAttribute("role", "tab");
          button.setAttribute("aria-selected", String(button === selected));
          button.tabIndex = button === selected ? 0 : -1;
        }
        selectedLabel.textContent = selected.textContent.trim();
        picker.setAttribute(
          "aria-label",
          navigationLabel ? `${navigationLabel}: ${selectedLabel.textContent}` : selectedLabel.textContent,
        );
      }

      function close() {
        if (dialog.open) dialog.close();
      }

      function measure() {
        if (!navigation.isConnected) return;
        const available = navigation.getBoundingClientRect().width;
        if (!available) return;
        const compact = row.getBoundingClientRect().width > available;
        navigation.dataset.tabsCompact = String(compact);
        viewport.inert = compact;
        viewport.setAttribute("aria-hidden", String(compact));
        if (compact && row.contains(document.activeElement)) picker.focus();
        else if (!compact && document.activeElement === picker) selectedTab().focus();
        sync();
      }

      function open() {
        if (dialog.open) return;
        options.replaceChildren();
        const selected = selectedTab();
        for (const button of buttons) {
          if (button.hidden) continue;
          const option = document.createElement("button");
          option.type = "button";
          option.className = "button tab-sheet-option";
          option.textContent = button.textContent.trim();
          option.disabled = button.matches(":disabled");
          option.setAttribute("aria-pressed", String(button === selected));
          option.addEventListener("click", () => {
            button.click();
            sync();
            close();
          });
          options.append(option);
        }
        dialog.showModal();
        picker.setAttribute("aria-expanded", "true");
      }

      picker.addEventListener("click", open);
      closeButton.addEventListener("click", close);
      dialog.addEventListener("close", () => {
        picker.setAttribute("aria-expanded", "false");
        if (navigation.isConnected) (navigation.dataset.tabsCompact === "true" ? picker : selectedTab()).focus();
      });
      dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close();
      });
      row.addEventListener("click", (event) => {
        if (event.target.closest("button")) close();
      });
      row.addEventListener("keydown", (event) => {
        const enabled = buttons.filter((button) => !button.matches(":disabled") && !button.hidden);
        let index = enabled.indexOf(document.activeElement);
        if (index < 0) return;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") index = (index + 1) % enabled.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
          index = (index + enabled.length - 1) % enabled.length;
        else if (event.key === "Home") index = 0;
        else if (event.key === "End") index = enabled.length - 1;
        else return;
        event.preventDefault();
        enabled[index].focus();
        enabled[index].click();
      });
      const resize = new ResizeObserver(measure);
      resize.observe(navigation);
      resize.observe(row);
      const mutations = new MutationObserver(measure);
      mutations.observe(row, { childList: true, characterData: true, subtree: true });
      const record = { navigation, picker, row, measure, close, resize, mutations };
      tabStates.set(row, record);
      tabRecords.add(record);
      document.fonts.ready.then(measure);
      measure();
    });
  }

  window.addEventListener("resize", () => {
    for (const record of tabRecords) {
      record.measure();
    }
  });

  window.TomoriControls = {
    configure(nextCopy, nextConfirmHold) {
      copy = nextCopy || {};
      confirmHold = nextConfirmHold || confirmHold;
    },
    enhance(root = document) {
      hideTooltip();
      enhanceHolds(root);
      enhanceActionMenus(root);
      root.querySelectorAll("select, input[type=number], input[type=file]").forEach((input) => {
        const sync = states.get(input);
        if (sync) {
          sync();
          return;
        }
        if (input.tagName === "SELECT") enhanceSelect(input);
        else if (input.type === "number" && input.step !== "any") enhanceScrub(input);
        else if (input.type === "file") enhanceFile(input);
      });
      if (supportsPopover)
        root.querySelectorAll("button[title]").forEach((button) => {
          button.dataset.tooltip ||= button.title;
          button.removeAttribute("title");
        });
    },
    dismiss() {
      hideTooltip();
      if (supportsPopover) closePopovers();
      for (const record of tabRecords) record.close();
    },
    enhanceTabs,
    focusTab(target) {
      const record = target?.closest(".tabs") && tabStates.get(target.closest(".tabs"));
      if (!record) return false;
      (record.navigation.dataset.tabsCompact === "true" ? record.picker : target).focus({ preventScroll: true });
      return true;
    },
  };
})();
