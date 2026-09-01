// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalSessionsSurface } from "../../application/agentThreadPorts";
import type {
  ExternalAgentSessionPreview,
  ExternalAgentSessionView,
} from "../../domain/externalAgentSession";
import {
  AgentTerminalSessionsPalette,
  type AgentTerminalSessionsPaletteProps,
} from "./AgentTerminalSessionsPalette";

const ROOT = "/workspace/app";
const NOW = 1_700_000_600_000;
const CLAUDE_ID = "34fbe185-0000-4000-8000-000000000001";
const CODEX_ID = "01a038a1-c2ee-7642-98e4-c94d7a479e0c";
const IMPORTED_ID = "987b95ad-c9bc-4d08-ae49-9b431efc8f87";

describe("AgentTerminalSessionsPalette", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("renders nothing while closed", async () => {
    await render({ isOpen: false });

    expect(host.querySelector(".palette-backdrop")).toBeNull();
  });

  it("names the project in the header and reuses the quick open shell", async () => {
    await render({});

    expect(host.querySelector(".quick-open.agent-terminal-sessions")).not.toBeNull();
    expect(host.querySelector(".agent-terminal-sessions__heading")?.textContent).toBe(
      "Terminal sessions - app",
    );
    expect(host.querySelector(".palette-search input")).not.toBeNull();
    expect(host.querySelector(".palette-footer")).not.toBeNull();
  });

  it("derives the header label from the repository root when no label is given", async () => {
    await render({ projectLabel: null });

    expect(host.querySelector(".agent-terminal-sessions__heading")?.textContent).toBe(
      "Terminal sessions - app",
    );
  });

  it("reports the loading state truthfully", async () => {
    await render({ surface: surfaceFixture({ sessions: [], state: "loading" }) });

    expect(host.textContent).toContain("Loading terminal sessions…");
  });

  it("reports a failed listing and retries through the surface", async () => {
    const reload = vi.fn(async () => undefined);
    await render({ surface: surfaceFixture({ sessions: [], state: "failed", reload }) });

    expect(host.textContent).toContain("Terminal sessions could not be loaded.");

    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    await click(retry);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("names the empty state for a project without sessions", async () => {
    await render({ surface: surfaceFixture({ sessions: [] }) });

    expect(host.textContent).toContain("No terminal sessions for this project.");
  });

  it("renders provider glyph, title, relative time, turn count and the Imported badge", async () => {
    await render({});

    const rows = [...host.querySelectorAll('[role="option"]')];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.querySelector(".agent-row__provider--claude")).not.toBeNull();
    expect(rows[1]?.querySelector(".agent-row__provider--codex")).not.toBeNull();
    expect(rows[0]?.textContent).toContain("Fix the parser");
    expect(rows[0]?.textContent).toContain("6 turns");
    expect(rows[1]?.textContent).toContain("12+ turns");
    expect(rows[0]?.textContent).toContain("5m");
    expect(rows[0]?.querySelector(".agent-terminal-sessions__badge")).toBeNull();
    expect(rows[2]?.querySelector(".agent-terminal-sessions__badge")?.textContent).toBe("Imported");
  });

  it("falls back to the first prompt line when a session has no title", async () => {
    await render();

    const rows = [...host.querySelectorAll('[role="option"]')];
    expect(rows[1]?.textContent).toContain("remember mango");
  });

  it("filters rows by title and by session id, and names an empty match", async () => {
    await render({});

    await type("parser");
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);

    await type(CODEX_ID.slice(0, 8));
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(host.querySelector('[role="option"]')?.textContent).toContain("remember mango");

    await type("no-such-session");
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(host.textContent).toContain("No sessions match");
  });

  it("moves the selection with arrows and wraps at both ends", async () => {
    await render({});

    expect(activeDescendant()).toBe("agent-terminal-sessions-option-0");
    await press("ArrowDown");
    expect(activeDescendant()).toBe("agent-terminal-sessions-option-1");
    await press("ArrowUp");
    await press("ArrowUp");
    expect(activeDescendant()).toBe("agent-terminal-sessions-option-2");
    await press("End");
    expect(activeDescendant()).toBe("agent-terminal-sessions-option-2");
    await press("Home");
    expect(activeDescendant()).toBe("agent-terminal-sessions-option-0");
  });

  it("imports the highlighted session on Enter", async () => {
    const onImport = vi.fn();
    const onSelectImported = vi.fn();
    await render({ onImport, onSelectImported });

    await press("ArrowDown");
    await press("Enter");

    expect(onImport).toHaveBeenCalledWith(CODEX_ID, "codex");
    expect(onSelectImported).not.toHaveBeenCalled();
  });

  it("routes an already imported session to the existing thread", async () => {
    const onImport = vi.fn();
    const onSelectImported = vi.fn();
    await render({ onImport, onSelectImported });

    await press("End");
    expect(continueButton()?.textContent).toBe("Open imported thread");

    await press("Enter");

    expect(onSelectImported).toHaveBeenCalledWith("agt-existing");
    expect(onImport).not.toHaveBeenCalled();
  });

  it("triggers the primary action from the Continue in Codevo button", async () => {
    const onImport = vi.fn();
    await render({ onImport });

    const button = continueButton();
    expect(button?.textContent).toBe("Continue in Codevo");
    await click(button);

    expect(onImport).toHaveBeenCalledWith(CLAUDE_ID, "claudeCode");
  });

  it("disables the action and reports progress while an import is pending", async () => {
    const onImport = vi.fn();
    await render({ onImport, surface: surfaceFixture({ importPending: true }) });

    expect(continueButton()?.disabled).toBe(true);
    expect(continueButton()?.textContent).toBe("Importing…");

    await press("Enter");
    expect(onImport).not.toHaveBeenCalled();
  });

  it("clears the filter on Escape before closing on the next Escape", async () => {
    const onClose = vi.fn();
    await render({ onClose });

    await type("parser");
    await press("Escape");

    expect(onClose).not.toHaveBeenCalled();
    expect(input().value).toBe("");
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(3);

    await press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape from any element inside the dialog and only clears the filter from the input", async () => {
    const onClose = vi.fn();
    await render({ onClose });

    await type("Security");
    const row = host.querySelector<HTMLElement>('[role="option"]');
    expect(row).not.toBeNull();

    await pressOn(row, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("Security");

    await pressOn(continueButton(), "Escape");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("moves the row selection with arrows while a row holds focus", async () => {
    await render({});

    const row = host.querySelector<HTMLElement>('[role="option"]');
    await pressOn(row, "ArrowDown");

    expect(activeDescendant()).toBe("agent-terminal-sessions-option-1");
  });

  it("leaves Enter to the footer button rather than importing twice", async () => {
    const reload = vi.fn(() => Promise.resolve());
    const onImport = vi.fn();
    await render({ onImport, surface: surfaceFixture({ sessions: [], state: "failed", reload }) });

    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    await pressOn(retry ?? null, "Enter");

    expect(onImport).not.toHaveBeenCalled();
  });

  it("closes on a backdrop press but not on a press inside the dialog", async () => {
    const onClose = vi.fn();
    await render({ onClose });

    await act(async () => {
      host
        .querySelector(".quick-open")
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      host
        .querySelector(".palette-backdrop")
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the opener when the palette closes", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    await render({});
    expect(document.activeElement).toBe(input());

    await render({ isOpen: false });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("lazily loads the preview for the highlighted session", async () => {
    const loadPreview = vi.fn(async () => undefined);
    await render({ surface: surfaceFixture({ loadPreview }) });

    expect(loadPreview).toHaveBeenCalledWith(CLAUDE_ID);

    await press("ArrowDown");
    expect(loadPreview).toHaveBeenCalledWith(CODEX_ID);
    expect(loadPreview).toHaveBeenCalledTimes(2);
  });

  it("shows the pending preview state", async () => {
    await render({ surface: surfaceFixture({ previewPending: true }) });

    expect(host.querySelector(".agent-terminal-sessions__preview")?.textContent).toContain(
      "Loading preview…",
    );
  });

  it("renders the exchanges of the matching preview with thread-style roles", async () => {
    await render({ surface: surfaceFixture({ preview: previewFixture({}) }) });

    const exchanges = [...host.querySelectorAll(".agent-terminal-sessions__exchange")];
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0]?.className).toContain("agent-terminal-sessions__exchange--user");
    expect(exchanges[0]?.querySelector(".agent-microlabel")?.textContent).toBe("you");
    expect(exchanges[0]?.textContent).toContain("remember plum");
    expect(exchanges[1]?.className).toContain("agent-terminal-sessions__exchange--assistant");
    expect(exchanges[1]?.querySelector(".agent-microlabel")?.textContent).toBe("agent");
    expect(host.textContent).not.toContain("Preview shows the beginning and end");
  });

  it("marks a truncated preview truthfully", async () => {
    await render({
      surface: surfaceFixture({ preview: previewFixture({ exchangesTruncated: true }) }),
    });

    expect(host.textContent).toContain("Preview shows the beginning and end of a long session.");
  });

  it("names an empty preview instead of pretending content exists", async () => {
    await render({ surface: surfaceFixture({ preview: previewFixture({ exchanges: [] }) }) });

    expect(host.textContent).toContain("No readable messages in this session.");
  });

  it("offers a retry when the preview failed to load", async () => {
    const loadPreview = vi.fn(async () => undefined);
    await render({ surface: surfaceFixture({ loadPreview }) });

    expect(host.querySelector(".agent-terminal-sessions__preview")?.textContent).toContain(
      "The preview could not be loaded.",
    );

    const retry = [
      ...(host.querySelector(".agent-terminal-sessions__preview")?.querySelectorAll("button") ??
        []),
    ].find((button) => button.textContent === "Retry");
    await click(retry);

    expect(loadPreview).toHaveBeenCalledTimes(2);
    expect(loadPreview).toHaveBeenLastCalledWith(CLAUDE_ID);
  });

  it("ignores a stale preview that belongs to another session", async () => {
    await render({
      surface: surfaceFixture({ preview: previewFixture({ sessionId: CODEX_ID }) }),
    });

    expect(host.querySelectorAll(".agent-terminal-sessions__exchange")).toHaveLength(0);
  });

  it("reports skipped and truncated counts in the footer", async () => {
    await render({ surface: surfaceFixture({ skipped: 12, truncated: true }) });

    expect(host.querySelector(".agent-terminal-sessions__status")?.textContent).toBe(
      "12 automated or unreadable sessions hidden · showing the newest 3",
    );
  });

  it("keeps the footer status silent when nothing was hidden", async () => {
    await render({});

    expect(host.querySelector(".agent-terminal-sessions__status")).toBeNull();
  });

  function input(): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(".palette-search input");
    expect(element).not.toBeNull();
    return element as HTMLInputElement;
  }

  function continueButton(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(".agent-terminal-sessions__continue");
  }

  function activeDescendant(): string | null {
    return input().getAttribute("aria-activedescendant");
  }

  async function press(key: string): Promise<void> {
    const element = input();
    await act(async () => {
      element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
    });
  }

  async function pressOn(element: HTMLElement | null, key: string): Promise<void> {
    expect(element).not.toBeNull();
    await act(async () => {
      element?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
    });
  }

  async function type(value: string): Promise<void> {
    const element = input();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function click(button: HTMLButtonElement | null | undefined): Promise<void> {
    expect(button ?? null).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  async function render(overrides: Partial<AgentTerminalSessionsPaletteProps> = {}): Promise<void> {
    await act(async () =>
      root.render(<AgentTerminalSessionsPalette {...defaults()} {...overrides} />),
    );
  }
});

function defaults(): AgentTerminalSessionsPaletteProps {
  return {
    isOpen: true,
    surface: surfaceFixture({}),
    projectLabel: "app",
    onClose: () => undefined,
    onImport: () => undefined,
    onSelectImported: () => undefined,
  };
}

function surfaceFixture(overrides: Partial<ExternalSessionsSurface>): ExternalSessionsSurface {
  return {
    state: "ready",
    target: { rootKey: ROOT, repositoryRoot: ROOT },
    sessions: [
      sessionFixture({}),
      sessionFixture({
        provider: "codex",
        sessionId: CODEX_ID,
        title: "",
        firstPrompt: "remember mango\nand more",
        turnCount: 12,
        turnCountExact: false,
      }),
      sessionFixture({
        sessionId: IMPORTED_ID,
        title: "Security review",
        alreadyImportedThreadId: "agt-existing",
      }),
    ],
    skipped: 0,
    truncated: false,
    preview: null,
    previewPending: false,
    importPending: false,
    open: async () => undefined,
    reload: async () => undefined,
    close: () => undefined,
    loadPreview: async () => undefined,
    ...overrides,
  };
}

function sessionFixture(overrides: Partial<ExternalAgentSessionView>): ExternalAgentSessionView {
  return {
    provider: "claudeCode",
    sessionId: CLAUDE_ID,
    cwd: ROOT,
    title: "Fix the parser",
    firstPrompt: "fix the parser crash",
    startedAtEpochMs: NOW - 60 * 60_000,
    lastActivityEpochMs: NOW - 5 * 60_000,
    turnCount: 6,
    turnCountExact: true,
    fileBytes: 4096,
    alreadyImportedThreadId: null,
    ...overrides,
  };
}

function previewFixture(
  overrides: Partial<ExternalAgentSessionPreview>,
): ExternalAgentSessionPreview {
  return {
    provider: "claudeCode",
    sessionId: CLAUDE_ID,
    exchanges: [
      { role: "user", text: "remember plum" },
      { role: "assistant", text: "plum" },
    ],
    exchangesTruncated: false,
    totalPreviewBytes: 128,
    ...overrides,
  };
}
