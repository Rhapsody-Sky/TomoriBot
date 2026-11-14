// Tomori UI: TomoriFX, the behaviour of the Collection layer (tomori-ui.collection.css).
// Framework-free micro-interactions driven by data attributes. Each behaviour is opt-in per
// element, idempotent, and does nothing (or jumps to the end state) when motion is off.
//
//   data-fx="indicator"  Group of options; a pill slides to the selected child
//                        ([aria-selected="true"], [aria-pressed="true"], [aria-checked="true"]
//                        or [aria-current]).
//   data-fx="tilt"       Element leans toward the pointer; sets --rx and --ry (and --gx, --gy for a glare).
//   data-fx="split"      Text rises in letter by letter. Re-run with TomoriFX.split(el, "New text").
//   data-fx="spark"      Click sends a small burst of ✦ from the pointer.
//   data-fx="count"      Number counts up from 0 when it first scrolls into view.
//   data-fx="stagger"    Children fade up one after another. Re-run with TomoriFX.stagger(el).
//   data-fx="track"      A form shows its [data-edit-action] buttons (Save, Discard) only while a
//                        named field differs from the saved state. Call TomoriFX.saved(form)
//                        after saving.
//   data-overflow        A row of [role="tab"] buttons keeps what fits, always including the
//                        selected one, and moves the rest into a "More" menu.
//
// Cards (.card) resize smoothly when their content changes; nothing to switch on.
// Call TomoriFX.enhance(root) after rendering, next to TomoriControls.enhance(root).
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const still = () => reduced.matches || document.body.dataset.motion === "off";
  const lively = () => !still() && document.body.dataset.motion !== "subtle";
  const ready = new WeakSet();
  let copy = {
    more: "More",
    moreLabel: "More sections",
  };

  // ---- indicator ---------------------------------------------------------------------------
  const selected = ['[aria-selected="true"]', '[aria-pressed="true"]', '[aria-checked="true"]', '[aria-current]:not([aria-current="false"])'];
  const selectedChild = selected.map((s) => `:scope > ${s}:not([hidden])`).join(", ");

  function placeIndicator(group, instant = false) {
    let pill = group.querySelector(":scope > .fx-indicator");
    if (!pill) {
      // The group was re-rendered; bring the pill back without animating from the corner.
      pill = document.createElement("span");
      pill.className = "fx-indicator";
      pill.setAttribute("aria-hidden", "true");
      group.prepend(pill);
      instant = true;
    }
    const target = group.querySelector(selectedChild);
    if (!target) {
      pill.style.opacity = "0";
      return;
    }
    if (instant || still()) pill.style.transition = "none";
    pill.style.opacity = "1";
    pill.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`;
    pill.style.width = `${target.offsetWidth}px`;
    pill.style.height = `${target.offsetHeight}px`;
    if (instant || still()) requestAnimationFrame(() => (pill.style.transition = ""));
  }

  function indicator(group) {
    placeIndicator(group, true);
    new MutationObserver(() => placeIndicator(group)).observe(group, {
      subtree: true,
      childList: true,
      // "hidden" too: an overflow menu may move options after the selection changed.
      attributeFilter: ["aria-selected", "aria-pressed", "aria-current", "aria-checked", "hidden"],
    });
    // A resize snaps the pill into place, unless it is sliding: then it re-aims without stopping.
    new ResizeObserver(() => {
      const pill = group.querySelector(":scope > .fx-indicator");
      placeIndicator(group, !pill?.getAnimations().length);
    }).observe(group);
  }

  // ---- tilt --------------------------------------------------------------------------------
  function tilt(el) {
    const max = Number(el.dataset.fxTilt || 6);
    let frame = 0;
    el.addEventListener("pointermove", (event) => {
      if (!lively() || event.pointerType === "touch") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (event.clientX - r.left) / r.width;
        const y = (event.clientY - r.top) / r.height;
        el.style.setProperty("--ry", `${(x - 0.5) * max}deg`);
        el.style.setProperty("--rx", `${(0.5 - y) * max}deg`);
        el.style.setProperty("--gx", `${x * 100}%`);
        el.style.setProperty("--gy", `${y * 100}%`);
        el.dataset.fxActive = "";
      });
    });
    el.addEventListener("pointerleave", () => {
      cancelAnimationFrame(frame);
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
      delete el.dataset.fxActive;
    });
  }

  // ---- split text --------------------------------------------------------------------------
  function split(el, text = el.textContent) {
    const value = text.trim();
    el.setAttribute("aria-label", value);
    let index = 0;
    // Letters are grouped per word so a name never breaks in the middle.
    const words = value.split(/(\s+)/).map((part) => {
      if (/^\s+$/.test(part)) return document.createTextNode(" ");
      const word = document.createElement("span");
      word.className = "fx-word";
      word.setAttribute("aria-hidden", "true");
      for (const char of part) {
        const span = document.createElement("span");
        span.className = "fx-char";
        span.style.setProperty("--i", String(index++));
        span.textContent = char;
        word.append(span);
      }
      return word;
    });
    el.replaceChildren(...words);
    if (still()) return;
    el.classList.remove("fx-split-run");
    void el.offsetWidth;
    el.classList.add("fx-split-run");
  }

  // ---- spark -------------------------------------------------------------------------------
  function spark(el) {
    el.addEventListener("click", (event) => {
      if (!lively()) return;
      const r = el.getBoundingClientRect();
      const x = event.clientX ? event.clientX - r.left : r.width / 2;
      const y = event.clientY ? event.clientY - r.top : r.height / 2;
      const burst = document.createElement("span");
      burst.className = "fx-burst";
      burst.setAttribute("aria-hidden", "true");
      burst.style.left = `${x}px`;
      burst.style.top = `${y}px`;
      for (let index = 0; index < 8; index++) {
        const star = document.createElement("i");
        star.textContent = index % 2 ? "✧" : "✦";
        star.style.setProperty("--a", `${index * 45 + Math.random() * 20}deg`);
        star.style.setProperty("--d", `${26 + Math.random() * 18}px`);
        burst.append(star);
      }
      el.append(burst);
      setTimeout(() => burst.remove(), 700);
    });
  }

  // ---- count -------------------------------------------------------------------------------
  const counter = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      counter.unobserve(entry.target);
      count(entry.target);
    }
  });

  function count(el) {
    const target = Number(el.dataset.value ?? el.textContent);
    if (still() || !Number.isFinite(target)) {
      el.textContent = String(target);
      return;
    }
    const start = performance.now();
    const duration = 700;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = String(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---- stagger -----------------------------------------------------------------------------
  function stagger(el) {
    [...el.children].forEach((child, index) => child.style.setProperty("--i", String(index)));
    if (still()) return;
    el.classList.remove("fx-stagger-run");
    void el.offsetWidth;
    el.classList.add("fx-stagger-run");
  }

  // ---- overflow ("More") -------------------------------------------------------------------
  let moreCount = 0;
  const ellipsis =
    '<svg class="glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>';

  function overflow(nav) {
    const id = `fx-more-${++moreCount}`;
    const more = document.createElement("button");
    more.type = "button";
    more.className = "more-pill";
    more.setAttribute("popovertarget", id);
    more.innerHTML = `${ellipsis}<span></span>`;
    more.lastChild.textContent = copy.more;
    const menu = document.createElement("div");
    menu.id = id;
    menu.className = "action-menu";
    menu.popover = "";
    menu.setAttribute("aria-label", copy.moreLabel);
    nav.append(more);
    document.body.append(menu);
    const tabs = () => [...nav.querySelectorAll(':scope > [role="tab"]')];

    function measure() {
      const items = tabs();
      items.forEach((b) => (b.hidden = false));
      more.hidden = true;
      if (nav.scrollWidth <= nav.clientWidth + 1) {
        menu.replaceChildren();
        return;
      }
      more.hidden = false;
      const limit = nav.clientWidth - more.offsetWidth - 8;
      const current = items.find((b) => b.getAttribute("aria-selected") === "true");
      let used = current ? current.offsetWidth + 4 : 0;
      for (const b of items) {
        if (b === current) continue;
        if (used + b.offsetWidth + 4 <= limit) used += b.offsetWidth + 4;
        else b.hidden = true;
      }
      menu.replaceChildren(
        ...items
          .filter((b) => b.hidden)
          .map((b) => {
            const proxy = document.createElement("button");
            proxy.type = "button";
            proxy.className = "button";
            proxy.dataset.proxy = String(items.indexOf(b));
            proxy.innerHTML = b.innerHTML;
            return proxy;
          }),
      );
    }

    menu.addEventListener("click", (event) => {
      const proxy = event.target.closest("[data-proxy]");
      if (!proxy) return;
      menu.hidePopover();
      tabs()[Number(proxy.dataset.proxy)].click();
      requestAnimationFrame(measure);
    });
    new ResizeObserver(() => measure()).observe(nav);
    new MutationObserver(() => requestAnimationFrame(measure)).observe(nav, { subtree: true, attributeFilter: ["aria-selected"] });
    document.fonts?.ready.then(measure);
    measure();
  }

  // ---- track: save actions that appear on change -------------------------------------------
  // A tracked form remembers its named fields. While one differs, the form has data-changed, the
  // field's .field or .toggle has .is-changed, and the form's [data-edit-action] buttons are shown.
  // The application saves on "submit" and then calls TomoriFX.saved(form).
  const baselines = new WeakMap();
  const fieldsOf = (form) => [...form.querySelectorAll("input[name], select[name], textarea[name]")];
  const stateOf = (el) => `${el.name}=${el.type === "checkbox" || el.type === "radio" ? el.checked : el.value}`;

  function updateTrack(form) {
    const base = baselines.get(form);
    if (!base) return;
    const fields = fieldsOf(form);
    const now = fields.map(stateOf);
    const changed = now.length !== base.length || now.some((entry, index) => entry !== base[index]);
    fields.forEach((el, index) => el.closest(".field, .toggle")?.classList.toggle("is-changed", now[index] !== base[index]));
    const was = form.hasAttribute("data-changed");
    form.toggleAttribute("data-changed", changed);
    form.querySelectorAll("[data-edit-action]").forEach((button) => {
      if (button.hidden === changed) button.hidden = !changed;
    });
    if (was !== changed) form.dispatchEvent(new CustomEvent("fx:change", { bubbles: true, detail: { changed } }));
  }

  /** The current values are the saved ones: hides the edit actions. */
  function saved(form) {
    baselines.set(form, fieldsOf(form).map(stateOf));
    updateTrack(form);
  }

  function track(form) {
    saved(form);
    form.addEventListener("input", () => updateTrack(form));
    form.addEventListener("change", () => updateTrack(form));
    // Enter in a field must not save a form that has nothing to save.
    form.addEventListener(
      "submit",
      (event) => {
        if (form.hasAttribute("data-changed")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
    form.addEventListener("click", (event) => {
      if (!event.target.closest("[data-discard]")) return;
      const base = baselines.get(form);
      fieldsOf(form).forEach((el, index) => {
        const entry = base[index];
        if (entry === undefined || !entry.startsWith(`${el.name}=`)) return;
        const value = entry.slice(el.name.length + 1);
        if (el.type === "checkbox" || el.type === "radio") el.checked = value === "true";
        else el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
      window.TomoriControls?.enhance(form);
      updateTrack(form);
      form.dispatchEvent(new CustomEvent("fx:discard", { bubbles: true }));
    });
  }

  // ---- card resize -------------------------------------------------------------------------
  // When the content of a card changes (a row turns into a form, save actions appear, a list is
  // filtered), the card grows or shrinks to its new height instead of jumping.
  const cards = new Map(); // card -> { height, animation }

  function resizeCard(card, entry, from, to) {
    if (Math.abs(from - to) < 1 || still()) return;
    card.dataset.resizing = "";
    const animation = card.animate([{ blockSize: `${from}px` }, { blockSize: `${to}px` }], {
      duration: 320,
      easing: "cubic-bezier(.22, .61, .36, 1)",
    });
    entry.animation = animation;
    const finish = () => {
      if (entry.animation !== animation) return;
      entry.animation = null;
      delete card.dataset.resizing;
      entry.height = card.offsetHeight;
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  }

  new MutationObserver((records) => {
    const changed = new Set();
    for (const { target } of records) {
      const element = target instanceof Element ? target : target.parentElement;
      const card = element?.closest(".card");
      if (cards.has(card)) changed.add(card);
    }
    for (const card of changed) {
      const entry = cards.get(card);
      if (!card.isConnected) continue;
      const from = entry.animation ? card.offsetHeight : entry.height;
      entry.animation?.cancel();
      entry.animation = null;
      delete card.dataset.resizing;
      entry.height = card.offsetHeight;
      if (from && entry.height) resizeCard(card, entry, from, entry.height);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "open", "rows"] });

  // A card that changes size for another reason (the window, a column) just remembers its height.
  const cardSizes = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const entry = cards.get(target);
      if (entry && !entry.animation) entry.height = target.offsetHeight;
    }
  });

  function watchCards(root) {
    for (const [card, entry] of cards) {
      if (card.isConnected) continue;
      entry.animation?.cancel();
      cardSizes.unobserve(card);
      cards.delete(card);
    }
    const found = [...root.querySelectorAll(".card")];
    if (root instanceof Element && root.matches(".card")) found.push(root);
    for (const card of found) {
      if (cards.has(card) || card.hasAttribute("data-fx-static") || card.parentElement?.closest(".card")) continue;
      cards.set(card, { height: card.offsetHeight, animation: null });
      cardSizes.observe(card);
    }
  }

  // ---- swap --------------------------------------------------------------------------------
  /** Replaces the content of an element; the new content fades in and its card resizes. */
  function swap(el, html) {
    el.innerHTML = html;
    window.TomoriControls?.enhance(el);
    enhance(el);
    if (still()) return;
    el.classList.remove("fx-swap-run");
    void el.offsetWidth;
    el.classList.add("fx-swap-run");
  }

  // ---- navigation keeps its place ----------------------------------------------------------
  // The frame's sidebar remembers how far it was scrolled, so choosing a link far down does not
  // send the navigation back to the top on the next page.
  function keepNavigation() {
    const nav = document.querySelector(".app-frame > .shell > .sidebar-rail .sidebar-sections");
    if (!nav) return;
    const key = "tomori-nav-scroll";
    try {
      nav.scrollTop = Number(sessionStorage.getItem(key)) || 0;
      nav.addEventListener("scroll", () => sessionStorage.setItem(key, String(nav.scrollTop)), { passive: true });
    } catch {}
    // A current link that is still out of sight (first visit, deep link) is brought into view.
    const current = nav.querySelector('[aria-current]:not([aria-current="false"])');
    if (!current) return;
    const box = nav.getBoundingClientRect();
    const link = current.getBoundingClientRect();
    if (link.top < box.top || link.bottom > box.bottom) nav.scrollTop += link.top - box.top - box.height / 2 + link.height / 2;
  }
  keepNavigation();

  // ---- wiring ------------------------------------------------------------------------------
  const behaviours = { indicator, tilt, split, spark, stagger, track, count: (el) => counter.observe(el) };

  function enhance(root = document) {
    const scope = root instanceof Element && root.matches("[data-fx], [data-overflow]") ? [root] : [];
    scope.push(...root.querySelectorAll("[data-fx], [data-overflow]"));
    for (const el of scope) {
      if (ready.has(el)) continue;
      ready.add(el);
      // overflow first, so the indicator measures the row after "More" is in place
      if (el.hasAttribute("data-overflow")) overflow(el);
      for (const name of (el.dataset.fx || "").split(/\s+/)) behaviours[name]?.(el);
    }
    watchCards(root);
  }

  window.TomoriFX = {
    /** Replace the texts TomoriFX writes: more, moreLabel. */
    configure(next) {
      copy = { ...copy, ...next };
    },
    enhance,
    split,
    stagger,
    count,
    saved,
    swap,
    place: placeIndicator,
  };
})();
