// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadSearchMatch } from "../../domain/agentThreadSearch";
import type { AgentThreadRevealRequest } from "./agentSidebarPresentation";
import {
  AGENT_THREAD_SEARCH_OPTION_PREFIX,
  AgentThreadSearchResults,
  type AgentThreadSearchResultsProps,
} from "./AgentThreadSearchResults";

const TITLES = new Map([
  ["agt-1", "Refactor the parser"],
  ["agt-2", "Fix the flaky test"],
]);

describe("AgentThreadSearchResults", () => {
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

  it("lists one option per match inside a listbox", () => {
    render({ matches: [titleMatch(), userMatch()] });

    const listbox = host.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(
      [...host.querySelectorAll(".agent-search-row__title")].map((node) => node.textContent),
    ).toEqual(["Refactor the parser", "Refactor the parser"]);
  });

  it("shows only the title for a title hit", () => {
    render({ matches: [titleMatch()] });

    expect(host.querySelector(".agent-search-row__snippet")).toBeNull();
  });

  it("prefixes content hits with the speaker and marks the ranges", () => {
    render({ matches: [userMatch(), assistantMatch()] });

    const who = [...host.querySelectorAll(".agent-search-row__who")];
    expect(who.map((node) => node.textContent)).toEqual(["You:", "Agent:"]);
    expect(who[0]?.className).toContain("agent-search-row__who--user");
    expect(who[1]?.className).toContain("agent-search-row__who--agent");
    expect([...host.querySelectorAll("mark")].map((node) => node.textContent)).toEqual([
      "parser",
      "parser",
    ]);
  });

  it("marks the active option for aria-activedescendant", () => {
    render({ matches: [titleMatch(), userMatch()], activeIndex: 1 });

    const options = [...host.querySelectorAll('[role="option"]')];
    expect(options.map((node) => node.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(options[1]?.id).toBe(`${AGENT_THREAD_SEARCH_OPTION_PREFIX}1`);
    expect(options[1]?.className).toContain("agent-search-row--active");
  });

  it("selects a title hit without a reveal request", () => {
    const onSelect = vi.fn();
    render({ matches: [titleMatch()], onSelect });

    clickOption(0);

    expect(onSelect).toHaveBeenCalledWith("agt-1", null);
  });

  it("selects a content hit with the reveal coordinates", () => {
    const onSelect = vi.fn<(threadId: string, reveal: AgentThreadRevealRequest | null) => void>();
    render({ matches: [assistantMatch()], onSelect });

    clickOption(0);

    expect(onSelect).toHaveBeenCalledWith("agt-1", {
      query: "parser",
      turnId: "agt-1-t2",
      eventIndex: 3,
      start: 4,
      end: 10,
    });
  });

  it("highlights the hovered option", () => {
    const onHighlight = vi.fn();
    render({ matches: [titleMatch(), userMatch()], onHighlight });

    const option = host.querySelectorAll('[role="option"]')[1];
    act(() => {
      option?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    });

    expect(onHighlight).toHaveBeenCalledWith(1);
  });

  it("reports the result count for assistive technology", () => {
    render({ matches: [titleMatch()] });

    expect(host.querySelector('[role="status"]')?.textContent).toBe("1 result");

    render({ matches: [titleMatch(), userMatch()] });

    expect(host.querySelector('[role="status"]')?.textContent).toBe("2 results");
  });

  it("announces the pending search instead of an empty state", () => {
    render({ matches: [], pending: true });

    expect(host.querySelector('[role="status"]')?.textContent).toBe("Searching…");
    expect(host.querySelector(".agent-search-results__empty")).toBeNull();
  });

  it("states the empty result once the search settled", () => {
    render({ matches: [], pending: false });

    expect(host.querySelector(".agent-search-results__empty")?.textContent).toBe(
      "No threads found",
    );
  });

  it("exposes both truncation bounds instead of presenting partial data as complete", () => {
    render({ matches: [titleMatch()], truncated: true, documentsTruncated: true });

    expect(
      [...host.querySelectorAll(".agent-search-results__note")].map((node) => node.textContent),
    ).toEqual(["Showing first 50", "Older messages not searched"]);
  });

  function clickOption(index: number): void {
    const option = host.querySelectorAll<HTMLElement>('[role="option"]')[index];
    expect(option).not.toBeUndefined();
    act(() => option?.click());
  }

  function render(overrides: Partial<AgentThreadSearchResultsProps> = {}): void {
    act(() => root.render(<AgentThreadSearchResults {...defaults()} {...overrides} />));
  }
});

function defaults(): AgentThreadSearchResultsProps {
  return {
    activeIndex: 0,
    matches: [],
    onHighlight: () => undefined,
    onSelect: () => undefined,
    pending: false,
    query: "parser",
    titles: TITLES,
    truncated: false,
  };
}

function titleMatch(): AgentThreadSearchMatch {
  return {
    threadId: "agt-1",
    source: "title",
    turnId: null,
    eventIndex: null,
    snippet: "Refactor the parser",
    ranges: [{ start: 13, end: 19 }],
    segmentStart: 13,
    segmentEnd: 19,
    score: 200,
  };
}

function userMatch(): AgentThreadSearchMatch {
  return {
    threadId: "agt-1",
    source: "user",
    turnId: "agt-1-t1",
    eventIndex: null,
    snippet: "the parser is slow",
    ranges: [{ start: 4, end: 10 }],
    segmentStart: 4,
    segmentEnd: 10,
    score: 400,
  };
}

function assistantMatch(): AgentThreadSearchMatch {
  return {
    threadId: "agt-1",
    source: "assistant",
    turnId: "agt-1-t2",
    eventIndex: 3,
    snippet: "the parser now streams",
    ranges: [{ start: 4, end: 10 }],
    segmentStart: 4,
    segmentEnd: 10,
    score: 400,
  };
}
