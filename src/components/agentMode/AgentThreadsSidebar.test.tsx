// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadSearchSurface, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult } from "../../domain/agentSettings";
import type { AgentThread, AgentTurnStatus } from "../../domain/agentThread";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type { AgentThreadSearchResult } from "../../domain/agentThreadSearch";
import { AgentClockProvider } from "./agentClock";
import type { AgentProjectGroup } from "./agentModePresentation";
import { AgentThreadsSidebar, type AgentThreadsSidebarProps } from "./AgentThreadsSidebar";
import {
  ARCHIVED_PAGE_COUNT,
  THREAD_JUMP_HINT_SHOW_DELAY_MS,
  agentRailScopeEntries,
} from "./agentSidebarPresentation";

const ROOT = "/workspace/app";
const OTHER = "/workspace/api";
const NOW = 1_700_000_600_000;
const AGENT_MODE_CSS = readFileSync(resolve(import.meta.dirname, "./agentMode.css"), "utf8");

describe("AgentThreadsSidebar", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
    });
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    restoreNavigator();
  });

  it("renders the chrome, search row and scope row without headings or filters", () => {
    render();

    expect(host.querySelector('[aria-label="Collapse sidebar"]')).not.toBeNull();
    expect(
      host.querySelector('input[role="combobox"][aria-label="Search threads"]'),
    ).not.toBeNull();
    expect(host.querySelector('[aria-label="New thread"]')).not.toBeNull();
    expect(host.querySelector("#agent-rail-scope")?.textContent).toContain("app");
    expect(host.querySelector(".agent-rail__title")).toBeNull();
    expect(host.querySelector(".agent-rail__filters")).toBeNull();
    expect(host.textContent).not.toContain("running");
  });

  it("places provider status after the independently scrolling thread list", () => {
    render();

    const scroll = host.querySelector(".agent-rail__scroll");
    expect(scroll?.nextElementSibling).toBe(host.querySelector(".agent-provider-footer"));
  });

  it("opens Usage as a viewport-bound workspace page beside the rail", () => {
    expect(cssRule(".workbench-frame > .agent-usage-layer")).toContain("position: fixed");
    expect(cssRule(".workbench-frame > .agent-usage-layer")).toContain(
      "left: var(--agent-rail-track)",
    );
    expect(cssRule(".agent-usage-popover")).toContain("inset: 0");
    expect(cssRule(".agent-usage-popover")).toContain("overflow: hidden");
    expect(cssRule(".agent-usage-popover:focus-visible")).toContain("box-shadow: none");
    expect(AGENT_MODE_CSS).toContain("@media (max-width: 560px)");
    expect(AGENT_MODE_CSS).toContain("@container (max-width: 280px)");
    expect(AGENT_MODE_CSS).toContain("flex-direction: column");
    expect(cssRule(".agent-provider-footer__providers {")).toContain("overflow: hidden");
  });

  it("routes source control and opens and closes the real usage panel", () => {
    const onOpenSourceControl = vi.fn();
    render({ onOpenSourceControl });
    const usageButton = host.querySelector<HTMLButtonElement>('button[aria-label="Open Usage"]');
    expect(usageButton?.hasAttribute("aria-controls")).toBe(false);

    click('button[aria-label="Open Source Control"]');
    click('button[aria-label="Open Usage"]');

    expect(onOpenSourceControl).toHaveBeenCalledTimes(1);
    expect(document.querySelector('section[aria-label="Usage"]')).not.toBeNull();
    expect(usageButton?.getAttribute("aria-expanded")).toBe("true");
    expect(usageButton?.getAttribute("aria-controls")).toBe("agent-usage-panel-dialog");
    expect(document.activeElement).toBe(
      document.querySelector('[role="dialog"][aria-label="Usage details"]'),
    );

    act(() => {
      document
        .querySelector('[role="dialog"][aria-label="Usage details"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(document.querySelector('section[aria-label="Usage"]')).toBeNull();
    expect(document.activeElement).toBe(usageButton);
    expect(usageButton?.hasAttribute("aria-controls")).toBe(false);

    click('button[aria-label="Open Usage"]');
    act(() =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Close Usage"]')?.click(),
    );
    expect(document.querySelector('section[aria-label="Usage"]')).toBeNull();
    expect(document.activeElement).toBe(usageButton);

    click('button[aria-label="Open Usage"]');
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(document.querySelector('section[aria-label="Usage"]')).toBeNull();
    expect(document.activeElement).toBe(usageButton);
  });

  it("moves focus to Expand after outside-mousedown closes Usage before Collapse clicks", async () => {
    render({
      onCollapseSidebar: () =>
        root.render(
          <button aria-label="Expand sidebar" type="button">
            Expand
          </button>,
        ),
    });
    click('button[aria-label="Open Usage"]');
    expect(document.activeElement).toBe(
      document.querySelector('[role="dialog"][aria-label="Usage details"]'),
    );
    const collapse = host.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]');
    expect(collapse).not.toBeNull();

    await act(async () => {
      collapse?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      collapse?.focus();
      collapse?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      collapse?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await Promise.resolve();

    expect(document.querySelector('section[aria-label="Usage"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button[aria-label="Expand sidebar"]'));
  });

  it("lists every thread as one flat recency-sorted card list", () => {
    render({
      groups: [
        group(ROOT, "app", [
          settled("agt-old", "Old", { updatedAtEpochMs: NOW - 3 * 3_600_000 }),
          running("agt-new", "New", { updatedAtEpochMs: NOW - 60_000 }),
        ]),
        group(OTHER, "api", [settled("agt-mid", "Mid", { updatedAtEpochMs: NOW - 8 * 60_000 })]),
      ],
    });

    expect(rowIds()).toEqual(["agt-new", "agt-mid", "agt-old"]);
    expect(host.querySelector("section")).toBeNull();
    expect(host.querySelector(".agent-band")).toBeNull();
    expect(host.textContent).not.toContain("NEEDS ATTENTION");
    expect(host.textContent).not.toContain("+ New thread");
  });

  it("renders the three card lines: project, title, branch and provider glyph", () => {
    render({
      groups: [group(ROOT, "app", [settled("agt-1", "Fix the parser", { branch: "main" })])],
    });

    const card = row("agt-1");
    expect(card.querySelector(".agent-row__project")?.textContent).toBe("app");
    expect(card.querySelector(".agent-row__title")?.textContent).toBe("Fix the parser");
    expect(card.querySelector(".agent-row__branch")?.textContent).toBe("main");
    expect(card.querySelector('[aria-label="Claude Code"] svg')).not.toBeNull();
    expect(card.querySelector(".agent-row__time")?.textContent).toBe("2m");
  });

  it("prefixes the repository with the project label only for multi-repository projects", () => {
    render({
      groups: [{ ...group(ROOT, "app", [settled("agt-1", "One")]), singleRepo: false }],
    });

    expect(row("agt-1").querySelector(".agent-row__project")?.textContent).toBe("app / app");
    expect(row("agt-1").querySelector(".agent-row__branch")?.textContent).toBe("worktree");
  });

  it("shows the Codex mark for codex threads", () => {
    render({ groups: [group(ROOT, "app", [settled("agt-1", "One", { provider: "codex" })])] });

    expect(row("agt-1").querySelector('[aria-label="Codex"]')).not.toBeNull();
  });

  it("replaces the time with Working plus a live duration while a turn runs", () => {
    render({ groups: [group(ROOT, "app", [running("agt-1", "Busy")])] });

    const status = row("agt-1").querySelector(".agent-row__status--working");
    expect(status?.textContent).toContain("Working");
    expect(status?.querySelector("time")?.textContent).toBe("10m");
    expect(row("agt-1").classList.contains("agent-row--inflight")).toBe(true);
  });

  it("labels failed, stopped and unread done threads and keeps read ones quiet", () => {
    render({
      groups: [
        group(ROOT, "app", [
          failed("agt-f", "Broken"),
          settled("agt-s", "Stopped", { status: { kind: "stopped" } }),
          settled("agt-d", "Fresh", { viewedAtEpochMs: null, endedAtEpochMs: NOW }),
          settled("agt-r", "Read"),
        ]),
      ],
    });

    expect(row("agt-f").querySelector(".agent-row__status--failed")?.textContent).toBe("Failed");
    expect(row("agt-s").querySelector(".agent-row__status--stopped")?.textContent).toBe("Stopped");
    expect(row("agt-d").querySelector(".agent-row__status--done")?.textContent).toBe("Done");
    expect(row("agt-d").classList.contains("agent-row--unread")).toBe(true);
    expect(row("agt-r").querySelector(".agent-row__status")).toBeNull();
    expect(row("agt-r").classList.contains("agent-row--recede")).toBe(true);
    expect(row("agt-f").classList.contains("agent-row--recede")).toBe(false);
  });

  it("marks the selected card as on and never receded", () => {
    render({ groups: [group(ROOT, "app", [settled("agt-1", "Read")])], selectedThreadId: "agt-1" });

    expect(row("agt-1").classList.contains("agent-row--on")).toBe(true);
    expect(row("agt-1").classList.contains("agent-row--recede")).toBe(false);
    expect(row("agt-1").getAttribute("aria-current")).toBe("true");
  });

  it("puts pinned cards first behind a hairline divider and unpins from the pin glyph", () => {
    const onTogglePin = vi.fn();
    render({
      groups: [
        group(ROOT, "app", [
          settled("agt-1", "Newest", { updatedAtEpochMs: NOW - 1000 }),
          settled("agt-p", "Pinned", { pinned: true, updatedAtEpochMs: NOW - 9000 }),
        ]),
      ],
      onTogglePin,
    });

    expect(rowIds()).toEqual(["agt-p", "agt-1"]);
    expect(host.querySelector(".agent-list__divider")).not.toBeNull();
    expect(row("agt-1").querySelector(".agent-row__pin")).toBeNull();

    click('[aria-label="Unpin thread"]');

    expect(onTogglePin).toHaveBeenCalledWith("agt-p");
  });

  it("offers the hover Archive action on cards and disables it while working", () => {
    const onThreadMenuCommand = vi.fn();
    render({
      groups: [group(ROOT, "app", [running("agt-r", "Busy"), settled("agt-s", "Done")])],
      onThreadMenuCommand,
    });

    const busy = row("agt-r").querySelector<HTMLButtonElement>('[aria-label="Archive thread"]');
    expect(busy?.disabled).toBe(true);
    expect(busy?.closest(".agent-row__actions")).not.toBeNull();

    click('[data-thread-id="agt-s"] [aria-label="Archive thread"]');

    expect(onThreadMenuCommand).toHaveBeenCalledWith("agt-s", { kind: "archive" });
  });

  it("collapses archived threads into a slim shelf paginated by twenty", () => {
    const archived = Array.from({ length: ARCHIVED_PAGE_COUNT + 5 }, (_, index) =>
      settled(`arc-${index}`, `Archived ${index}`, {
        archived: true,
        updatedAtEpochMs: NOW - 86_400_000 * 4 - index,
      }),
    );
    render({ groups: [group(ROOT, "app", [settled("agt-1", "Live"), ...archived])] });

    expect(host.querySelector(".agent-shelf")?.textContent).toBe(
      `Archived (${ARCHIVED_PAGE_COUNT + 5})`,
    );
    expect(host.querySelector(".agent-row--slim")).toBeNull();

    click('.agent-shelf[aria-expanded="false"]');

    expect(host.querySelector(".agent-shelf")?.textContent).toBe("Archived");
    expect(host.querySelectorAll(".agent-row--slim[data-thread-id]")).toHaveLength(
      ARCHIVED_PAGE_COUNT,
    );
    expect(row("arc-0").querySelector(".agent-row__time")?.textContent).toBe("4d");
    expect(host.querySelector(".agent-row--more")?.textContent).toContain("Show 5 more");

    click(".agent-row--more");

    expect(host.querySelectorAll(".agent-row--slim[data-thread-id]")).toHaveLength(
      ARCHIVED_PAGE_COUNT + 5,
    );
    expect(host.querySelector(".agent-row--more")).toBeNull();
  });

  it("opens the T3-ordered context menu and dispatches commands", () => {
    const onThreadMenuCommand = vi.fn();
    render({
      groups: [group(ROOT, "app", [running("agt-1", "Busy", { branch: "feat/x" })])],
      onThreadMenuCommand,
    });

    act(() => {
      row("agt-1").dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 30,
        }),
      );
    });

    const menu = document.querySelector('[role="menu"]');
    const items = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])];
    expect(items.map((item) => item.textContent)).toEqual([
      "New thread on feat/x",
      "Pin",
      "Rename",
      "Mark unread",
      "Copy path",
      "Copy branch",
      "Copy thread ID",
      "Stop",
      "Archive",
      "Delete",
    ]);
    expect((items[8] as HTMLButtonElement).disabled).toBe(true);

    act(() => {
      (items[9] as HTMLButtonElement).click();
    });

    expect(onThreadMenuCommand).toHaveBeenCalledWith("agt-1", { kind: "delete" });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("renames inline from the context menu and commits on Enter", () => {
    const onThreadMenuCommand = vi.fn();
    render({ groups: [group(ROOT, "app", [settled("agt-1", "Old name")])], onThreadMenuCommand });

    act(() => {
      row("agt-1").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
    const rename = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Rename",
    );
    act(() => {
      (rename as HTMLButtonElement).click();
    });

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Rename thread"]');
    expect(input?.value).toBe("Old name");
    act(() => {
      nativeInputValue(input as HTMLInputElement, "New name");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onThreadMenuCommand).toHaveBeenCalledWith("agt-1", {
      kind: "rename",
      title: "New name",
    });
    expect(host.querySelector('input[aria-label="Rename thread"]')).toBeNull();
  });

  it("moves focus with the arrow keys, selects with Enter and pins with p", () => {
    const onSelectThread = vi.fn();
    const onTogglePin = vi.fn();
    render({
      groups: [
        group(ROOT, "app", [
          settled("agt-1", "One", { updatedAtEpochMs: NOW - 1000 }),
          settled("agt-2", "Two", { updatedAtEpochMs: NOW - 2000 }),
        ]),
      ],
      onSelectThread,
      onTogglePin,
    });

    expect(row("agt-1").tabIndex).toBe(0);
    expect(row("agt-2").tabIndex).toBe(-1);

    act(() => row("agt-1").focus());
    key(row("agt-1"), "ArrowDown");

    expect(document.activeElement).toBe(row("agt-2"));
    expect(row("agt-2").tabIndex).toBe(0);

    key(row("agt-2"), "Enter");
    expect(onSelectThread).toHaveBeenCalledWith("agt-2");

    key(row("agt-2"), "p");
    expect(onTogglePin).toHaveBeenCalledWith("agt-2");

    key(row("agt-2"), "Escape");
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Search threads"]'));
  });

  it("shows jump badges after holding the command key", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    render({ groups: [group(ROOT, "app", [settled("agt-1", "One"), settled("agt-2", "Two")])] });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    });
    expect(host.querySelector(".agent-row__jump")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
    });
    expect([...host.querySelectorAll(".agent-row__jump")].map((el) => el.textContent)).toEqual([
      "⌘1",
      "⌘2",
    ]);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
    });
    expect(host.querySelector(".agent-row__jump")).toBeNull();
  });

  it("uses Control and the Ctrl glyph off macOS and clears hints when the tab hides", () => {
    withUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    render({ groups: [group(ROOT, "app", [settled("agt-1", "One"), settled("agt-2", "Two")])] });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
      vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
    });
    expect(host.querySelector(".agent-row__jump")).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control" }));
      vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
    });
    expect([...host.querySelectorAll(".agent-row__jump")].map((el) => el.textContent)).toEqual([
      "Ctrl1",
      "Ctrl2",
    ]);

    withVisibility("hidden", () => {
      act(() => document.dispatchEvent(new Event("visibilitychange")));
    });
    expect(host.querySelector(".agent-row__jump")).toBeNull();
  });

  it("lets Enter on the archived shelf expand it instead of selecting the focused thread", () => {
    const onSelectThread = vi.fn();
    const onTogglePin = vi.fn();
    render({
      groups: [
        group(ROOT, "app", [
          settled("agt-1", "Live"),
          settled("arc-1", "Old", { archived: true, updatedAtEpochMs: NOW - 86_400_000 }),
        ]),
      ],
      onSelectThread,
      onTogglePin,
    });

    const shelf = host.querySelector<HTMLButtonElement>(".agent-shelf");
    expect(shelf?.getAttribute("aria-controls")).toBeNull();
    act(() => shelf?.focus());
    key(shelf as HTMLElement, "Enter");
    expect(onSelectThread).not.toHaveBeenCalled();
    expect(onTogglePin).not.toHaveBeenCalled();

    click(".agent-shelf");
    expect(shelf?.getAttribute("aria-expanded")).toBe("true");
    expect(shelf?.getAttribute("aria-controls")).toBe("agent-rail-archived");
    expect(host.querySelector("#agent-rail-archived")).not.toBeNull();

    key(shelf as HTMLElement, "p");
    expect(onTogglePin).not.toHaveBeenCalled();
    const archive = row("agt-1").querySelector<HTMLElement>('[aria-label="Archive thread"]');
    key(archive as HTMLElement, "Enter");
    expect(onSelectThread).not.toHaveBeenCalled();

    key(row("agt-1"), "Enter");
    expect(onSelectThread).toHaveBeenCalledWith("agt-1");
  });

  it("returns focus to the row that opened the context menu once it closes", () => {
    render({ groups: [group(ROOT, "app", [settled("agt-1", "One")])] });

    act(() => row("agt-1").focus());
    act(() => {
      row("agt-1").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.contains(document.activeElement)).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(row("agt-1"));

    act(() => {
      row("agt-1").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
    const copy = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Copy thread ID",
    );
    act(() => copy?.click());
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(row("agt-1"));
  });

  it("surfaces the document truncation bound from the search result", () => {
    render({
      search: searchSurface("parser", {
        query: "parser",
        truncated: false,
        documentsTruncated: true,
        matches: [],
      }),
    });

    expect(host.querySelector(".agent-search-results__note")?.textContent).toBe(
      "Older messages not searched",
    );
    expect(host.querySelector(".agent-search-results__empty")?.textContent).toBe(
      "No threads found",
    );
  });

  it("changes the scope from the project menu and reports scope state", () => {
    const onChangeScope = vi.fn();
    const groups = [
      group(ROOT, "app", [settled("agt-1", "One")]),
      group(OTHER, "api", [settled("agt-2", "Two", { repositoryRoot: OTHER })], {
        trust: "untrusted",
      }),
    ];
    render({ groups, onChangeScope });

    click("#agent-rail-scope");
    click(`[role="menuitemradio"][data-value="${OTHER}"]`);

    expect(onChangeScope).toHaveBeenCalledWith({
      projectRootKey: OTHER,
      repositoryRoot: OTHER,
    });

    const onTrustProject = vi.fn();
    render({
      groups,
      onTrustProject,
      scope: { projectRootKey: OTHER, repositoryRoot: OTHER },
    });

    expect(rowIds()).toEqual(["agt-2"]);
    expect(host.querySelector(".agent-scope__state")?.textContent).toContain("Untrusted");
    click('[aria-label="Trust project api"]');
    expect(onTrustProject).toHaveBeenCalledWith(OTHER);
    expect(host.querySelector(".agent-trust")).toBeNull();
  });

  it("starts a new thread in the scoped repository and fails closed when untrusted", () => {
    const onNewThread = vi.fn();
    const groups = [group(ROOT, "app", [], { trust: "untrusted" }), group(OTHER, "api", [])];
    render({ groups, onNewThread, scope: { projectRootKey: OTHER, repositoryRoot: OTHER } });

    click('[aria-label="New thread"]');
    expect(onNewThread).toHaveBeenCalledWith(OTHER, OTHER);

    render({ groups, onNewThread });
    expect(host.querySelector<HTMLButtonElement>('[aria-label="New thread"]')?.disabled).toBe(true);
  });

  it("renders the empty states and the overflow note", () => {
    render({ groups: [] });
    expect(host.querySelector(".agent-rail__empty-state")?.textContent).toBe("No projects yet");

    render({ groups: [group(ROOT, "app", [])], overflowRootPaths: ["/workspace/nine"] });
    expect(host.querySelector(".agent-rail__empty-state")?.textContent).toBe(
      "No threads in app yet",
    );
    expect(host.querySelector(".agent-rail__overflow")?.textContent).toBe(
      "1 more project is not shown (limit 8)",
    );
  });

  it("forwards typing to the search surface and clears on Escape", () => {
    const search = searchSurface("");
    render({ search });

    const input = host.querySelector<HTMLInputElement>('[aria-label="Search threads"]');
    act(() => {
      nativeInputValue(input as HTMLInputElement, "par");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(search.setQuery).toHaveBeenCalledWith("par");

    render({ search: searchSurface("par") });
    key(host.querySelector('[aria-label="Search threads"]') as HTMLElement, "Escape");
    expect(host.querySelector('[aria-label="Clear thread search"]')).not.toBeNull();
  });

  it("replaces the list with the search listbox and selects a hit with Enter", () => {
    const onSelectThread = vi.fn();
    const search = searchSurface("parser", {
      query: "parser",
      truncated: false,
      documentsTruncated: false,
      matches: [
        {
          threadId: "agt-2",
          source: "user",
          turnId: "agt-2-t1",
          eventIndex: null,
          snippet: "Fix the parser",
          ranges: [{ start: 8, end: 14 }],
          segmentStart: 8,
          segmentEnd: 14,
          score: 400,
        },
        {
          threadId: "agt-1",
          source: "title",
          turnId: null,
          eventIndex: null,
          snippet: "parser",
          ranges: [{ start: 0, end: 6 }],
          segmentStart: 0,
          segmentEnd: 6,
          score: 0,
        },
      ],
    });
    render({
      groups: [group(ROOT, "app", [settled("agt-1", "parser"), settled("agt-2", "Two")])],
      onSelectThread,
      search,
    });

    expect(host.querySelector(".agent-list")).toBeNull();
    const listbox = host.querySelector("#agent-rail-search-results");
    expect(listbox?.getAttribute("role")).toBe("listbox");
    const input = host.querySelector('[aria-label="Search threads"]') as HTMLElement;
    expect(input.getAttribute("aria-activedescendant")).toBe("agent-rail-search-result-0");

    key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe("agent-rail-search-result-1");

    key(input, "Enter");
    expect(onSelectThread).toHaveBeenCalledWith("agt-1", undefined);
    expect(search.clear).toHaveBeenCalled();
  });

  it("does not rerender untouched rows when one thread of two hundred updates", () => {
    const counters = new Map<string, { count: number }>();
    const views = Array.from({ length: 200 }, (_, index) => {
      const counter = { count: 0 };
      counters.set(`agt-${index}`, counter);
      return settled(`agt-${index}`, `Thread ${index}`, {
        countRenders: counter,
        updatedAtEpochMs: NOW - index * 1000,
      });
    });
    render({ groups: [group(ROOT, "app", views)] });

    expect(host.querySelectorAll("[data-thread-id]")).toHaveLength(200);
    const before = counters.get("agt-5")?.count ?? 0;
    expect(before).toBeGreaterThan(0);

    for (let update = 1; update <= 20; update += 1) {
      const target = settled("agt-0", `Thread 0 v${update}`, {
        countRenders: counters.get("agt-0") ?? { count: 0 },
        updatedAtEpochMs: NOW + update,
      });
      render({ groups: [group(ROOT, "app", [target, ...views.slice(1)])] });
    }

    expect(counters.get("agt-5")?.count).toBe(before);
    expect(counters.get("agt-0")?.count).toBeGreaterThan(before);
  });

  function render(overrides: Partial<AgentThreadsSidebarProps> = {}): void {
    const groups = overrides.groups ?? [group(ROOT, "app", [settled("agt-1", "Fix the parser")])];
    const props: AgentThreadsSidebarProps = {
      addProjectAvailable: true,
      accountUsage: { claudeCode: { kind: "idle" }, codex: { kind: "idle" } },
      groups,
      search: searchSurface(""),
      scope: { projectRootKey: ROOT, repositoryRoot: ROOT },
      scopeEntries: agentRailScopeEntries(groups),
      overflowRootPaths: [],
      selectedThreadId: null,
      providerManagement: providerManagement(),
      providerEnabled: { claudeCode: true, codex: true },
      onOpenProviderSettings: vi.fn(),
      onOpenSourceControl: vi.fn(),
      onSelectThread: vi.fn(),
      onTogglePin: vi.fn(),
      onChangeScope: vi.fn(),
      onThreadMenuCommand: vi.fn(),
      onNewThread: vi.fn(),
      onAddProject: vi.fn(),
      onTrustProject: vi.fn(),
      onReleaseProject: vi.fn(),
      onProjectCommand: vi.fn(),
      ...overrides,
    };
    act(() => {
      root.render(
        <AgentClockProvider nowTickMs={1000}>
          <AgentThreadsSidebar {...props} />
        </AgentClockProvider>,
      );
    });
  }

  function row(threadId: string): HTMLElement {
    const element = host.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
  }

  function rowIds(): ReadonlyArray<string> {
    return [...host.querySelectorAll<HTMLElement>("[data-thread-id]")].map(
      (element) => element.dataset.threadId ?? "",
    );
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    act(() => element?.click());
  }

  function cssRule(selector: string): string {
    const start = AGENT_MODE_CSS.indexOf(selector);
    expect(start).toBeGreaterThanOrEqual(0);
    const bodyStart = AGENT_MODE_CSS.indexOf("{", start);
    const end = AGENT_MODE_CSS.indexOf("}", bodyStart);
    return AGENT_MODE_CSS.slice(bodyStart + 1, end);
  }

  function key(element: HTMLElement, keyName: string): void {
    act(() => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true }),
      );
    });
  }
});

function providerManagement(): AgentProviderManagementSurface {
  const preferences = defaultAgentProviderPreferences();
  return {
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: {
      claudeCode: {
        executable: {
          kind: "notFound",
          installCommand: "npm i -g @anthropic-ai/claude-code",
        },
        health: { kind: "notConfigured" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
      codex: {
        executable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
        health: { kind: "notConfigured" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
    },
    selectedProviderAuthority: null,
    toast: null,
    admissionAuthority: (provider) => ({
      provider,
      revision: 1,
      disposition: { kind: "disabled" },
    }),
    authority: (provider) => ({
      settingsRevision: 1,
      provider,
      preference: preferences[provider],
      cliPath: `/bin/${provider}`,
    }),
    dismissToast: vi.fn(),
    dismissUpdate: vi.fn(async () => true),
    refresh: vi.fn(async () => undefined),
    retryRegistration: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    saveWithOutcome: vi.fn(async () => ({ kind: "persisted" as const, policyRegistered: true })),
    update: vi.fn(async () => null),
  };
}

let savedUserAgent: PropertyDescriptor | undefined;

function withUserAgent(userAgent: string): void {
  savedUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
}

function restoreNavigator(): void {
  if (savedUserAgent === undefined) {
    Reflect.deleteProperty(navigator, "userAgent");
    return;
  }
  Object.defineProperty(navigator, "userAgent", savedUserAgent);
  savedUserAgent = undefined;
}

function withVisibility(state: DocumentVisibilityState, run: () => void): void {
  const saved = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  try {
    run();
  } finally {
    if (saved === undefined) Reflect.deleteProperty(document, "visibilityState");
    if (saved !== undefined) Object.defineProperty(document, "visibilityState", saved);
  }
}

function searchSurface(query: string, result: AgentThreadSearchResult | null = null) {
  const surface: AgentThreadSearchSurface = {
    query,
    active: query.trim().length >= 2,
    result,
    pending: false,
    setQuery: vi.fn(),
    clear: vi.fn(),
  };
  return surface;
}

function group(
  repositoryRoot: string,
  label: string,
  threads: ReadonlyArray<AgentThreadView>,
  overrides: Partial<Pick<AgentProjectGroup, "origin" | "rootPath" | "trust">> = {},
): AgentProjectGroup {
  return {
    projectRootKey: repositoryRoot,
    kind: "project",
    label,
    rootPath: repositoryRoot,
    trust: "trusted",
    origin: "active-tab",
    singleRepo: true,
    repos: [
      {
        repositoryRoot,
        label,
        repositoryResolved: true,
        threads: threads.filter((view) => !view.thread.archived),
        archived: threads.filter((view) => view.thread.archived),
        orphans: [],
        liveCount: threads.filter((view) => view.lifecycle === "running").length,
      },
    ],
    liveCount: threads.filter((view) => view.lifecycle === "running").length,
    ...overrides,
  };
}

interface ThreadViewOptions {
  readonly status?: AgentTurnStatus;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly updatedAtEpochMs?: number;
  readonly endedAtEpochMs?: number | null;
  readonly viewedAtEpochMs?: number | null;
  readonly branch?: string | null;
  readonly provider?: "claudeCode" | "codex";
  readonly repositoryRoot?: string;
  readonly countRenders?: { count: number };
}

function threadView(threadId: string, title: string, options: ThreadViewOptions): AgentThreadView {
  const {
    archived = false,
    branch = null,
    countRenders,
    endedAtEpochMs = null,
    pinned = false,
    provider = "claudeCode",
    repositoryRoot = ROOT,
    status = { kind: "running" },
    updatedAtEpochMs = NOW - 2 * 60_000,
    viewedAtEpochMs = null,
  } = options;
  const running = status.kind === "pending" || status.kind === "running";
  const thread: AgentThread = {
    threadId,
    owner: { rootKey: repositoryRoot, ownerId: `agent-root:${repositoryRoot}`, repositoryRoot },
    target: { isolation: "worktree", worktreePath: `${repositoryRoot}/.worktrees/${threadId}` },
    provider: { kind: provider, sessionId: null },
    title,
    pinned,
    archived,
    createdAtEpochMs: NOW - 10 * 60_000,
    updatedAtEpochMs,
    turns: [
      {
        turnId: `${threadId}-t1`,
        prompt: title,
        status,
        startedAtEpochMs: NOW - 10 * 60_000,
        endedAtEpochMs,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs,
    externalOrigin: null,
    integration: null,
  };
  if (countRenders !== undefined) countTitleReads(thread, title, countRenders);

  return {
    ship:
      branch === null
        ? { kind: "idle", status: null, loadingStatus: false }
        : {
            kind: "pushed",
            status: null,
            receipt: { branch, remote: "origin", compareUrl: null },
          },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: archived ? "archived" : running ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}

function running(
  threadId: string,
  title: string,
  options: ThreadViewOptions = {},
): AgentThreadView {
  return threadView(threadId, title, { status: { kind: "running" }, ...options });
}

function failed(threadId: string, title: string): AgentThreadView {
  return threadView(threadId, title, {
    endedAtEpochMs: NOW - 60_000,
    status: { kind: "failed", message: "boom" },
  });
}

function settled(
  threadId: string,
  title: string,
  options: ThreadViewOptions = {},
): AgentThreadView {
  return threadView(threadId, title, {
    endedAtEpochMs: NOW - 2 * 60_000,
    status: { kind: "exited", exitCode: 0 },
    viewedAtEpochMs: NOW,
    ...options,
  });
}

function nativeInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  expect(descriptor?.set).toBeTypeOf("function");
  descriptor?.set?.call(input, value);
}

function countTitleReads(thread: AgentThread, title: string, counter: { count: number }): void {
  Object.defineProperty(thread, "title", {
    configurable: true,
    enumerable: true,
    get: () => {
      counter.count += 1;
      return title;
    },
  });
}
