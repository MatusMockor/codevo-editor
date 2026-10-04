// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KeymapPlatform } from "../../domain/keymap";
import {
  agentThreadUndoInteractionOwned,
  agentThreadUndoShortcutApplies,
} from "./useAgentThreadUndoShortcut";

describe("agentThreadUndoShortcutApplies", () => {
  let surface: HTMLElement;
  let row: HTMLButtonElement;

  function applies(
    target: EventTarget,
    init: KeyboardEventInit,
    platform: KeymapPlatform = "linux",
    ownsLastInteraction = true,
  ): boolean {
    let result = false;
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    const listener = (dispatched: Event): void => {
      result = agentThreadUndoShortcutApplies(dispatched as KeyboardEvent, {
        surface,
        platform,
        ownsLastInteraction,
      });
    };
    window.addEventListener("keydown", listener);
    if (target instanceof HTMLElement) target.focus();
    target.dispatchEvent(event);
    window.removeEventListener("keydown", listener);
    return result;
  }

  beforeEach(() => {
    surface = document.createElement("section");
    row = document.createElement("button");
    surface.append(row);
    document.body.append(surface);
  });

  afterEach(() => {
    surface.remove();
  });

  it("uses Cmd+Z on macOS and Ctrl+Z elsewhere", () => {
    expect(applies(row, { key: "z", metaKey: true }, "mac")).toBe(true);
    expect(applies(row, { key: "z", ctrlKey: true }, "mac")).toBe(false);
    expect(applies(row, { key: "z", metaKey: true, ctrlKey: true }, "mac")).toBe(false);
    expect(applies(row, { key: "z", ctrlKey: true }, "linux")).toBe(true);
    expect(applies(row, { key: "z", ctrlKey: true }, "windows")).toBe(true);
    expect(applies(row, { key: "z", metaKey: true }, "linux")).toBe(false);
    expect(applies(row, { key: "z" }, "linux")).toBe(false);
  });

  it("leaves redo, composition, and already handled keys alone", () => {
    expect(applies(row, { key: "Z", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(applies(row, { key: "z", ctrlKey: true, altKey: true })).toBe(false);
    expect(applies(row, { key: "z", ctrlKey: true, isComposing: true })).toBe(false);
    const prevent = (event: Event): void => event.preventDefault();
    row.addEventListener("keydown", prevent);
    expect(applies(row, { key: "z", ctrlKey: true })).toBe(false);
    row.removeEventListener("keydown", prevent);
    expect(applies(row, { key: "z", ctrlKey: true })).toBe(true);
  });

  it("yields to menus, dialogs, popovers, and text boxes inside the surface", () => {
    for (const [name, value] of [
      ["role", "menu"],
      ["role", "dialog"],
      ["role", "textbox"],
      ["role", "combobox"],
      ["class", "agent-popover"],
    ] as const) {
      const owner = document.createElement("div");
      owner.setAttribute(name, value);
      const inner = document.createElement("button");
      owner.append(inner);
      surface.append(owner);
      expect(applies(inner, { key: "z", ctrlKey: true })).toBe(false);
      owner.remove();
    }
    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    const option = document.createElement("button");
    option.setAttribute("role", "option");
    list.append(option);
    surface.append(list);
    expect(applies(option, { key: "z", ctrlKey: true })).toBe(true);
  });

  it("does not apply while the thread surface is hidden, inert, or detached", () => {
    surface.hidden = true;
    expect(applies(document.body, { key: "z", ctrlKey: true })).toBe(false);
    surface.hidden = false;
    surface.setAttribute("inert", "");
    expect(applies(document.body, { key: "z", ctrlKey: true })).toBe(false);
    surface.removeAttribute("inert");
    expect(applies(document.body, { key: "z", ctrlKey: true })).toBe(true);
    surface.remove();
    expect(applies(document.body, { key: "z", ctrlKey: true })).toBe(false);
  });

  it("does not apply when focus sits in an editable element even if the event targets the page", () => {
    const input = document.createElement("input");
    surface.append(input);
    input.focus();
    let result = true;
    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const listener = (dispatched: Event): void => {
      result = agentThreadUndoShortcutApplies(dispatched as KeyboardEvent, {
        surface,
        platform: "linux",
        ownsLastInteraction: true,
      });
    };
    window.addEventListener("keydown", listener);
    document.body.dispatchEvent(event);
    window.removeEventListener("keydown", listener);
    expect(result).toBe(false);
  });

  it("needs the last interaction to belong to the thread surface when nothing is focused", () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    expect(applies(document.body, { key: "z", ctrlKey: true }, "linux", true)).toBe(true);
    expect(applies(document.body, { key: "z", ctrlKey: true }, "linux", false)).toBe(false);
    expect(applies(document.documentElement, { key: "z", ctrlKey: true }, "linux", false)).toBe(
      false,
    );
    expect(applies(row, { key: "z", ctrlKey: true }, "linux", false)).toBe(true);
  });
});

describe("agentThreadUndoInteractionOwned", () => {
  it("follows interactions into and out of the thread surface", () => {
    const surface = document.createElement("section");
    const row = document.createElement("button");
    const outside = document.createElement("button");
    surface.append(row);
    document.body.append(surface, outside);

    expect(agentThreadUndoInteractionOwned(row, surface, false)).toBe(true);
    expect(agentThreadUndoInteractionOwned(outside, surface, true)).toBe(false);
    expect(agentThreadUndoInteractionOwned(document.body, surface, true)).toBe(false);
    expect(agentThreadUndoInteractionOwned(row, null, true)).toBe(false);
    expect(agentThreadUndoInteractionOwned(document, surface, true)).toBe(true);
    expect(agentThreadUndoInteractionOwned(null, surface, false)).toBe(false);
    surface.remove();
    outside.remove();
  });

  it("keeps the previous owner while a menu, dialog, or popover outside the surface is used", () => {
    const surface = document.createElement("section");
    document.body.append(surface);
    for (const [name, value] of [
      ["role", "menu"],
      ["role", "menubar"],
      ["role", "dialog"],
      ["class", "agent-popover"],
    ] as const) {
      const overlay = document.createElement("div");
      overlay.setAttribute(name, value);
      const item = document.createElement("button");
      overlay.append(item);
      document.body.append(overlay);
      expect(agentThreadUndoInteractionOwned(item, surface, true)).toBe(true);
      expect(agentThreadUndoInteractionOwned(item, surface, false)).toBe(false);
      overlay.remove();
    }
    surface.remove();
  });
});
