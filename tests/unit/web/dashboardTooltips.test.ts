import { expect, it } from "bun:test";
import { runInNewContext } from "node:vm";

it("keeps tooltips closed during automatic focus and layout changes", async () => {
  class ControlElement {
    id = "";
    style = {};
    dataset: { tooltip?: string } = {};
    isConnected = true;
    attributes = new Map<string, string>();
    popoverOpen = false;

    append() {}
    contains(node: unknown) {
      return node === this;
    }
    closest(selector: string) {
      return selector.startsWith("[data-tooltip]") && this.dataset.tooltip ? this : null;
    }
    matches(selector: string) {
      return selector === ":popover-open" && this.popoverOpen;
    }
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    }
    removeAttribute(name: string) {
      this.attributes.delete(name);
    }
    showPopover() {
      this.popoverOpen = true;
    }
    hidePopover() {
      this.popoverOpen = false;
    }
    getBoundingClientRect() {
      return { left: 24, top: 60, bottom: 104, width: 44, height: 44 };
    }
  }

  const document = new EventTarget();
  const tooltip = new ControlElement();
  const control = new ControlElement();
  control.dataset.tooltip = "Example";
  const timers = new Map<number, () => void>();
  let timerId = 0;
  runInNewContext(await Bun.file("src/web/dashboard/assets/controls.js").text(), {
    document: Object.assign(document, {
      body: new ControlElement(),
      createElement: () => tooltip,
      createElementNS: () => new ControlElement(),
    }),
    window: new EventTarget(),
    HTMLElement: ControlElement,
    Element: ControlElement,
    Node: ControlElement,
    ResizeObserver: class {},
    innerWidth: 375,
    innerHeight: 800,
    setTimeout(callback: () => void) {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
  });

  function dispatch(type: string, properties = {}) {
    const event = Object.assign(new Event(type), properties);
    Object.defineProperty(event, "target", { value: control });
    document.dispatchEvent(event);
  }
  function runTimers() {
    for (const [id, callback] of timers) {
      timers.delete(id);
      callback();
    }
  }

  dispatch("keydown", { key: "Enter" });
  dispatch("focusin");
  expect(tooltip.popoverOpen).toBe(false);

  dispatch("pointerover", { pointerType: "mouse" });
  runTimers();
  expect(tooltip.popoverOpen).toBe(false);

  dispatch("pointermove", { pointerType: "touch" });
  runTimers();
  expect(tooltip.popoverOpen).toBe(false);

  dispatch("keydown", { key: "Tab" });
  dispatch("focusin");
  expect(tooltip.popoverOpen).toBe(true);
  expect(control.getAttribute("aria-describedby")).toBe(tooltip.id);

  dispatch("close");
  runTimers();
  dispatch("pointermove", { pointerType: "mouse" });
  runTimers();
  expect(tooltip.popoverOpen).toBe(true);
});
