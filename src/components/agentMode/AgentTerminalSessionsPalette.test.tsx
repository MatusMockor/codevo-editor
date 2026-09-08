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

    expect(dialog()).toBeNull();
  });

  it("opens as a labelled dialog with one search row and a repository chip", async () => {
    await render({});

    expect(dialog()?.hasAttribute("aria-modal")).toBe(false);
    expect(dialog()?.getAttribute("aria-label")).toBe("Terminal sessions");
    expect(input().getAttribute("placeholder")).toBe("Search sessions");
    expect(repositoryChip()?.textContent).toBe("app");
    expect(repositoryChip()?.getAttribute("title")).toBe(ROOT);
    expect(host.querySelector(".quick-open")).toBeNull();
    expect(host.querySelector(".palette-search")).toBeNull();
    expect(host.querySelector(".palette-footer")).toBeNull();
  });

  it("derives the chip label from the repository root when no label is given", async () => {
    await render({ projectLabel: null });

    expect(repositoryChip()?.textContent).toBe("app");
  });

  it("hides the chip when neither a label nor a target is known", async () => {
    await render({ projectLabel: null, surface: surfaceFixture({ target: null }) });

    expect(repositoryChip()).toBeNull();
  });

  it("reports the initial loading state without a listbox or section label", async () => {
    await render({ surface: surfaceFixture({ sessions: [], state: "loading" }) });

    const state = stateBlock("loading");
    expect(state?.textContent).toContain("Loading terminal sessions…");
    expect(state?.previousElementSibling).toBeNull();
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().hasAttribute("aria-controls")).toBe(false);
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
    expect(continueButton()?.disabled).toBe(true);
  });

  it("keeps the retained rows and the combobox wiring during a background reload", async () => {
    const onImport = vi.fn();
    await render({ onImport, surface: surfaceFixture({ state: "loading" }) });

    expect(options()).toHaveLength(3);
    expect(input().getAttribute("aria-controls")).toBe("agent-terminal-sessions-listbox");
    expect(activeDescendant()).toBe("agent-terminal-sessions-option-0");
    expect(host.querySelector("[data-refreshing]")?.textContent).toBe("refreshing…");
    expect(continueButton()?.disabled).toBe(true);

    await press("Enter");
    expect(onImport).not.toHaveBeenCalled();

    await render({ onImport, surface: surfaceFixture({}) });
    expect(host.querySelector("[data-refreshing]")).toBeNull();
    expect(continueButton()?.disabled).toBe(false);
  });

  it("reports a failed listing and retries through the surface", async () => {
    const reload = vi.fn(async () => undefined);
    await render({ surface: surfaceFixture({ sessions: [], state: "failed", reload }) });

    const state = stateBlock("failed");
    expect(state?.textContent).toContain("Terminal sessions could not be loaded.");

    const retry = [...(state?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Retry",
    );
    await click(retry);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("names the repository in the empty state", async () => {
    await render({ surface: surfaceFixture({ sessions: [] }) });

    const state = stateBlock("empty");
    expect(state?.textContent).toContain("No terminal sessions for app.");
    expect(state?.previousElementSibling).toBeNull();
  });

  it("falls back to a generic empty state without a repository label", async () => {
    await render({ projectLabel: null, surface: surfaceFixture({ sessions: [], target: null }) });

    expect(stateBlock("empty")?.textContent).toContain("No terminal sessions for this project.");
  });

  it("renders rich rows with provider, title, meta line, relative time and the Imported badge", async () => {
    await render({});

    const rows = options();
    expect(rows).toHaveLength(3);
    expect(rows[0]?.getAttribute("data-provider")).toBe("claudeCode");
    expect(rows[1]?.getAttribute("data-provider")).toBe("codex");
    expect(rows[0]?.textContent).toContain("Fix the parser");
    expect(rows[0]?.textContent).toContain("Claude Code·6 turns");
    expect(rows[1]?.textContent).toContain("Codex·12+ turns");
    expect(rows[0]?.textContent).toContain("5m");
    expect(rows[0]?.textContent).not.toContain("Imported");
    expect(rows[2]?.textContent).toContain("Imported");
  });

  it("marks only the highlighted row as selected", async () => {
    await render({});

    expect(options().map((row) => row.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);

    await press("ArrowDown");

    expect(options().map((row) => row.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

  it("falls back to the first prompt line when a session has no title", async () => {
    await render();

    expect(options()[1]?.textContent).toContain("remember mango");
  });

  it("filters rows by title and by session id, and names an empty match", async () => {
    await render({});

    await type("parser");
    expect(options()).toHaveLength(1);

    await type(CODEX_ID.slice(0, 8));
    expect(options()).toHaveLength(1);
    expect(options()[0]?.textContent).toContain("remember mango");

    await type("no-such-session");
    expect(options()).toHaveLength(0);
    expect(stateBlock("no-matches")?.textContent).toContain("No sessions match “no-such-session”.");
    expect(stateBlock("no-matches")?.previousElementSibling).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("labels and filters a session from a nested repository", async () => {
    await render({
      surface: surfaceFixture({
        sessions: [sessionFixture({ cwd: `${ROOT}/packages/ebox-crm` })],
      }),
    });

    expect(options()[0]?.textContent).toContain("Claude Code·ebox-crm·6 turns");
    await type("packages/ebox-crm");
    expect(options()).toHaveLength(1);
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

  it("selects a row on click and imports it on double click", async () => {
    const onImport = vi.fn();
    await render({ onImport });

    const row = options()[1];
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(activeDescendant()).toBe("agent-terminal-sessions-option-1");
    expect(onImport).not.toHaveBeenCalled();

    await act(async () => {
      row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onImport).toHaveBeenCalledWith(CODEX_ID, "codex");
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

  it("keeps the action gated while the listing has failed", async () => {
    const onImport = vi.fn();
    await render({ onImport, surface: surfaceFixture({ state: "failed" }) });

    expect(options()).toHaveLength(3);
    expect(continueButton()?.disabled).toBe(true);

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
    expect(options()).toHaveLength(3);

    await press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape from any element inside the dialog and only clears the filter from the input", async () => {
    const onClose = vi.fn();
    await render({ onClose });

    await type("Security");
    const row = options()[0] ?? null;
    expect(row).not.toBeNull();

    await pressOn(row, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("Security");

    await pressOn(continueButton(), "Escape");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("moves the row selection with arrows while a row holds focus", async () => {
    await render({});

    await pressOn(options()[0] ?? null, "ArrowDown");

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
      dialog()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      host
        .querySelector('[role="presentation"]')
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

  it("invites a selection when no session is highlighted", async () => {
    await render({ surface: surfaceFixture({ sessions: [] }) });

    expect(stateBlock("preview-idle")?.textContent).toContain("Select a session to preview it.");
  });

  it("heads the drawer with the highlighted session and shows the pending preview state", async () => {
    await render({ surface: surfaceFixture({ previewPending: true }) });

    expect(preview()?.textContent).toContain("Fix the parser");
    expect(preview()?.textContent).toContain("Claude Code·6 turns·5 minutes ago");
    expect(stateBlock("preview-loading")?.textContent).toContain("Loading preview…");
  });

  it("renders the exchanges of the matching preview with you/agent role chips", async () => {
    await render({ surface: surfaceFixture({ preview: previewFixture({}) }) });

    const exchanges = previewExchanges();
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0]?.getAttribute("data-role")).toBe("user");
    expect(exchanges[0]?.firstElementChild?.textContent).toBe("you");
    expect(exchanges[0]?.textContent).toContain("remember plum");
    expect(exchanges[1]?.getAttribute("data-role")).toBe("assistant");
    expect(exchanges[1]?.firstElementChild?.textContent).toBe("agent");
    expect(host.textContent).not.toContain("Preview shows the beginning and end");
  });

  it("marks a truncated preview truthfully", async () => {
    await render({
      surface: surfaceFixture({ preview: previewFixture({ exchangesTruncated: true }) }),
    });

    expect(preview()?.textContent).toContain(
      "Preview shows the beginning and end of a long session.",
    );
  });

  it("names an empty preview instead of pretending content exists", async () => {
    await render({ surface: surfaceFixture({ preview: previewFixture({ exchanges: [] }) }) });

    expect(stateBlock("preview-empty")?.textContent).toContain(
      "No readable messages in this session.",
    );
    expect(previewExchanges()).toHaveLength(0);
  });

  it("offers a retry when the preview failed to load", async () => {
    const loadPreview = vi.fn(async () => undefined);
    await render({ surface: surfaceFixture({ loadPreview }) });

    expect(stateBlock("preview-failed")?.textContent).toContain("The preview could not be loaded.");

    const retry = [...(stateBlock("preview-failed")?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Retry",
    );
    await click(retry);

    expect(loadPreview).toHaveBeenCalledTimes(2);
    expect(loadPreview).toHaveBeenLastCalledWith(CLAUDE_ID);
  });

  it("ignores a stale preview that belongs to another session", async () => {
    await render({
      surface: surfaceFixture({ preview: previewFixture({ sessionId: CODEX_ID }) }),
    });

    expect(previewExchanges()).toHaveLength(0);
  });

  it("shows keyboard hints and the hidden count in the footer", async () => {
    await render({ surface: surfaceFixture({ skipped: 12, truncated: true }) });

    const footerText = footer()?.textContent ?? "";
    expect(footerText).toContain("navigate");
    expect(footerText).toContain("continue");
    expect(footerText).toContain("close");
    expect(footerText).toContain(
      "12 automated or unreadable sessions hidden · showing the newest 3",
    );
  });

  it("keeps the footer count silent when nothing was hidden", async () => {
    await render({});

    expect(footer()?.textContent).not.toContain("hidden");
  });

  it("imports checked sessions together while preview navigation stays independent", async () => {
    const onImportMany = vi.fn();
    const onImport = vi.fn();
    await render({ onImportMany, onImport });
    await checkAt(0);
    expect(continueButton()?.textContent).toBe("Import 1 session");
    await checkAt(1);
    expect(continueButton()?.textContent).toBe("Import 2 sessions");
    await press("End");
    expect(host.querySelector('[data-highlighted="true"]')?.textContent).toContain(
      "Security review",
    );
    await act(async () =>
      host
        .querySelector(".agent-tsp__row")
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    expect(onImport).not.toHaveBeenCalled();
    expect(onImportMany).not.toHaveBeenCalled();
    await press("Enter");
    expect(onImportMany).toHaveBeenCalledWith([
      { sessionId: CLAUDE_ID, provider: "claudeCode" },
      { sessionId: CODEX_ID, provider: "codex" },
    ]);
    expect(onImport).not.toHaveBeenCalled();
  });

  it("preserves checked sessions across filters, selects filtered results and clears explicitly", async () => {
    const onImportMany = vi.fn();
    await render({ onImportMany });
    await checkAt(0);
    await type(CODEX_ID);
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "Select filtered",
      ),
    );
    await type("no-match");
    expect(continueButton()?.disabled).toBe(false);
    await press("Enter");
    expect(onImportMany.mock.calls[0]?.[0]).toHaveLength(2);
    await click(
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Clear"),
    );
    expect(host.textContent).toContain("0 selected");
    expect(continueButton()?.disabled).toBe(true);
  });

  it("resets selection on close and target A to B to A replacement", async () => {
    const onImportMany = vi.fn();
    await render({ onImportMany });
    await checkAt(0);
    await render({ onImportMany, isOpen: false });
    await render({ onImportMany });
    expect(checkboxes()[0]?.checked).toBe(false);
    await checkAt(0);
    await render({
      onImportMany,
      surface: surfaceFixture({ target: { rootKey: "other", repositoryRoot: ROOT } }),
    });
    expect(checkboxes()[0]?.checked).toBe(false);
    await render({ onImportMany });
    expect(checkboxes()[0]?.checked).toBe(false);
  });

  it("clears selection when the target is reopened at the same path", async () => {
    const onImportMany = vi.fn();
    const surface = surfaceFixture({});
    await render({ onImportMany, surface });
    await checkAt(0);
    await render({ onImportMany, surface: { ...surface, previewPending: true } });
    expect(checkboxes()[0]?.checked).toBe(true);
    await render({
      onImportMany,
      surface: { ...surface, target: { rootKey: ROOT, repositoryRoot: ROOT } },
    });
    expect(checkboxes()[0]?.checked).toBe(false);
  });

  it("prunes removed or imported sessions and never selects imported entries", async () => {
    const onImportMany = vi.fn();
    await render({ onImportMany });
    expect(checkboxes()[2]?.disabled).toBe(true);
    await checkAt(0);
    await checkAt(1);
    await render({
      onImportMany,
      surface: surfaceFixture({
        sessions: [sessionFixture({ alreadyImportedThreadId: "existing" })],
      }),
    });
    expect(host.textContent).toContain("0 selected");
    await render({ onImportMany });
    expect(checkboxes().some((checkbox) => checkbox.checked)).toBe(false);
  });

  it("uses provider and session ID together for selection identity", async () => {
    const onImportMany = vi.fn();
    await render({
      onImportMany,
      surface: surfaceFixture({
        sessions: [sessionFixture({}), sessionFixture({ provider: "codex" })],
      }),
    });
    await checkAt(0);
    expect(checkboxes().map((checkbox) => checkbox.checked)).toEqual([true, false]);
    await checkAt(1);
    await press("Enter");
    expect(onImportMany).toHaveBeenCalledWith([
      { sessionId: CLAUDE_ID, provider: "claudeCode" },
      { sessionId: CLAUDE_ID, provider: "codex" },
    ]);
  });

  it("bounds selection at 50 with a visible explanation and permits deselection", async () => {
    const onImportMany = vi.fn();
    await render({
      onImportMany,
      surface: surfaceFixture({
        sessions: Array.from({ length: 52 }, (_, index) =>
          sessionFixture({ sessionId: `session-${index}` }),
        ),
      }),
    });
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "Select filtered",
      ),
    );
    expect(checkboxes().filter((checkbox) => checkbox.checked)).toHaveLength(50);
    expect(checkboxes()[50]?.disabled).toBe(true);
    expect(host.textContent).toContain("Up to 50 at a time");
    await checkAt(0);
    expect(checkboxes()[50]?.disabled).toBe(false);
    await checkAt(50);
    await press("Enter");
    expect(onImportMany.mock.calls[0]?.[0]).toHaveLength(50);
  });

  it("disables selection and activation during batch progress and displays the outcome", async () => {
    const onImportMany = vi.fn();
    const onImport = vi.fn();
    await render({
      onImportMany,
      onImport,
      importProgress: { completed: 1, total: 3 },
      importNotice: "One session could not be imported.",
    });
    expect(checkboxes().every((checkbox) => checkbox.disabled)).toBe(true);
    expect(continueButton()?.disabled).toBe(true);
    expect(continueButton()?.textContent).toBe("Importing 1 of 3…");
    expect(host.textContent).toContain("One session could not be imported.");
    await press("Enter");
    expect(onImportMany).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
    expect(host.querySelector("button input")).toBeNull();
  });

  it("uses native controls for batch selection and imports once from a focused checkbox", async () => {
    const onImportMany = vi.fn();
    await render({ onImportMany });
    expect(input().getAttribute("role")).toBe("searchbox");
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(host.querySelector('[role="group"][aria-label="Terminal sessions"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Preview Fix the parser"]')).not.toBeNull();
    await checkAt(0);
    await pressOn(checkboxes()[0] ?? null, "Enter");
    expect(onImportMany).toHaveBeenCalledTimes(1);
    expect(onImportMany).toHaveBeenCalledWith([{ sessionId: CLAUDE_ID, provider: "claudeCode" }]);
  });

  function checkboxes(): HTMLInputElement[] {
    return [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  }

  async function checkAt(index: number): Promise<void> {
    await act(async () => checkboxes()[index]?.click());
  }

  function dialog(): HTMLElement | null {
    return host.querySelector<HTMLElement>('[role="dialog"]');
  }

  function input(): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(
      'input[aria-label="Filter terminal sessions"]',
    );
    expect(element).not.toBeNull();
    return element as HTMLInputElement;
  }

  function repositoryChip(): HTMLElement | null {
    return host.querySelector<HTMLElement>('[data-chip="repository"]');
  }

  function options(): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>('[role="option"]')];
  }

  function stateBlock(label: string): HTMLElement | null {
    return host.querySelector<HTMLElement>(`[data-state="${label}"]`);
  }

  function preview(): HTMLElement | null {
    return host.querySelector<HTMLElement>('[aria-label="Session preview"]');
  }

  function previewExchanges(): HTMLElement[] {
    return [...(preview()?.querySelectorAll<HTMLElement>("article[data-role]") ?? [])];
  }

  function footer(): HTMLElement | null {
    return dialog()?.querySelector<HTMLElement>("footer") ?? null;
  }

  function continueButton(): HTMLButtonElement | null {
    const buttons = [...(footer()?.querySelectorAll("button") ?? [])];
    return buttons[buttons.length - 1] ?? null;
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
