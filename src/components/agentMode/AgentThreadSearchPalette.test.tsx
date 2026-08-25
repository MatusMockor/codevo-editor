// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentThreadSearchMatch,
  AgentThreadSearchResult,
} from "../../domain/agentThreadSearch";
import {
  AgentThreadSearchPalette,
  type AgentThreadSearchPaletteProps,
} from "./AgentThreadSearchPalette";

const TITLES = new Map([
  ["agt-1", "Refactor the parser"],
  ["agt-2", "Parser regression"],
  ["agt-3", "Archived parser spike"],
]);

describe("AgentThreadSearchPalette", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders nothing while closed", () => {
    render({ isOpen: false });

    expect(host.querySelector(".palette-backdrop")).toBeNull();
  });

  it("reuses the shared quick open shell with a Threads section", () => {
    render({});

    expect(host.querySelector(".palette-backdrop")).not.toBeNull();
    expect(host.querySelector(".quick-open.agent-thread-palette")).not.toBeNull();
    expect(host.querySelector(".palette-search input")).not.toBeNull();
    expect(host.querySelector(".search-everywhere-section-label")?.textContent).toBe("Threads");
    expect(host.querySelector(".palette-footer")).not.toBeNull();
  });

  it("excludes archived threads from the palette results", () => {
    render({});

    expect(
      [...host.querySelectorAll(".agent-search-row__title")].map((node) => node.textContent),
    ).toEqual(["Refactor the parser", "Parser regression"]);
  });

  it("drops matches for threads that vanished between publish and render", () => {
    render({ titles: new Map([["agt-1", "Refactor the parser"]]) });

    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  });

  it("points aria-activedescendant at the moving selection", () => {
    render({});

    const input = requireInput();
    expect(input.getAttribute("aria-activedescendant")).toBe("agent-thread-palette-option-0");

    press("ArrowDown");

    expect(requireInput().getAttribute("aria-activedescendant")).toBe(
      "agent-thread-palette-option-1",
    );
  });

  it("wraps the selection at both ends", () => {
    render({});

    press("ArrowUp");
    expect(requireInput().getAttribute("aria-activedescendant")).toBe(
      "agent-thread-palette-option-1",
    );

    press("ArrowDown");
    expect(requireInput().getAttribute("aria-activedescendant")).toBe(
      "agent-thread-palette-option-0",
    );
  });

  it("activates the highlighted thread with its reveal request on Enter", () => {
    const onActivate = vi.fn();
    render({ onActivate });

    press("ArrowDown");
    press("Enter");

    expect(onActivate).toHaveBeenCalledWith("agt-2", {
      query: "parser",
      turnId: "agt-2-t1",
      eventIndex: 2,
      start: 0,
      end: 6,
    });
  });

  it("closes on Escape and on a backdrop press", () => {
    const onClose = vi.fn();
    render({ onClose });

    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      host
        .querySelector(".palette-backdrop")
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps a press inside the dialog from closing it", () => {
    const onClose = vi.fn();
    render({ onClose });

    act(() => {
      host
        .querySelector(".quick-open")
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("clips the typed query at the domain bound", () => {
    render({});

    expect(requireInput().maxLength).toBe(200);
  });

  function press(key: string): void {
    const input = requireInput();
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
    });
  }

  function requireInput(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>(".palette-search input");
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  function render(overrides: Partial<AgentThreadSearchPaletteProps> = {}): void {
    act(() => root.render(<AgentThreadSearchPalette {...defaults()} {...overrides} />));
  }
});

function defaults(): AgentThreadSearchPaletteProps {
  return {
    archivedThreadIds: new Set(["agt-3"]),
    isOpen: true,
    onActivate: () => undefined,
    onChangeQuery: () => undefined,
    onClose: () => undefined,
    pending: false,
    query: "parser",
    result: searchResult(),
    titles: TITLES,
  };
}

function searchResult(): AgentThreadSearchResult {
  return {
    query: "parser",
    matches: [titleMatch("agt-1"), assistantMatch("agt-2"), titleMatch("agt-3")],
    truncated: false,
    documentsTruncated: false,
  };
}

function titleMatch(threadId: string): AgentThreadSearchMatch {
  return {
    threadId,
    source: "title",
    turnId: null,
    eventIndex: null,
    snippet: TITLES.get(threadId) ?? threadId,
    ranges: [{ start: 0, end: 6 }],
    segmentStart: 0,
    segmentEnd: 6,
    score: 200,
  };
}

function assistantMatch(threadId: string): AgentThreadSearchMatch {
  return {
    threadId,
    source: "assistant",
    turnId: `${threadId}-t1`,
    eventIndex: 2,
    snippet: "parser rewrite landed",
    ranges: [{ start: 0, end: 6 }],
    segmentStart: 0,
    segmentEnd: 6,
    score: 400,
  };
}
