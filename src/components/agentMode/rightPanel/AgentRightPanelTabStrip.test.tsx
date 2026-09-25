// @vitest-environment jsdom

import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import {
  click,
  mountUi,
  press,
  type MountedUi,
} from "../../../ui/foundation/foundationTestSupport";
import {
  AgentRightPanelTabStrip,
  type AgentRightPanelTabStripProps,
} from "./AgentRightPanelTabStrip";
import {
  agentRightPanelTabEntries,
  type AgentRightPanelEditorDocuments,
} from "./agentRightPanelTabEntries";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
});

function props(
  overrides: Partial<AgentRightPanelTabStripProps> = {},
): AgentRightPanelTabStripProps {
  return {
    entries: agentRightPanelTabEntries({
      openSurfaces: ["diff", "terminal", "git"],
      activeSurface: "diff",
      terminal: {
        sessions: [
          { id: "terminal-0", title: "dev", live: true, closable: true },
          { id: "terminal-1", title: "zsh", live: false, closable: true },
        ],
        activeSessionId: "terminal-0",
      },
      editorDocuments: null,
    }),
    addableSurfaces: ["terminal", "files", "diff", "git", "scripts", "pullRequest", "history"],
    editorDocuments: null,
    onActivateSurface: vi.fn(),
    onCloseSurface: vi.fn(),
    onTerminalSessionCommand: vi.fn(),
    onAddSurface: vi.fn(),
    tabPanelsRendered: true,
    ...overrides,
  };
}

function surfaceEntries(openSurfaces: ReadonlyArray<AgentSurfaceKind>, active: AgentSurfaceKind) {
  return agentRightPanelTabEntries({
    openSurfaces,
    activeSurface: active,
    terminal: null,
    editorDocuments: null,
  });
}

function ClosingHarness(harness: {
  readonly initial: ReadonlyArray<AgentSurfaceKind>;
  readonly active: AgentSurfaceKind;
}) {
  const [open, setOpen] = useState(harness.initial);
  const [active, setActive] = useState(harness.active);
  return (
    <AgentRightPanelTabStrip
      {...props({
        entries: surfaceEntries(open, active),
        onActivateSurface: setActive,
        onCloseSurface: (kind) => {
          const remaining = open.filter((surface) => surface !== kind);
          setOpen(remaining);
          setActive(remaining[0] ?? active);
        },
      })}
    />
  );
}

function tabTitled(host: HTMLElement, title: string): HTMLElement | undefined {
  return [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.title === title);
}

function mount(value: AgentRightPanelTabStripProps): HTMLElement {
  ui = mountUi();
  ui.render(<AgentRightPanelTabStrip {...value} />);
  return ui.host;
}

describe("AgentRightPanelTabStrip", () => {
  it("renders one tab per surface and per terminal session with a live dot", () => {
    const host = mount(props());
    const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];

    expect(tabs.map((tab) => tab.title)).toEqual(["Diff", "dev", "zsh", "Git"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]?.querySelector('[aria-label="Running"]')).not.toBeNull();
    expect(tabs[2]?.querySelector('[aria-label="Running"]')).toBeNull();
  });

  it("activates a terminal session through the terminal surface", () => {
    const value = props();
    const host = mount(value);
    click(host.querySelectorAll('[role="tab"]')[2] as Element);

    expect(value.onActivateSurface).toHaveBeenCalledWith("terminal");
    expect(value.onTerminalSessionCommand).toHaveBeenCalledWith({
      kind: "activate",
      sessionId: "terminal-1",
    });
  });

  it("closes a session with Delete and a surface with its close glyph", () => {
    const value = props({
      entries: agentRightPanelTabEntries({
        openSurfaces: ["diff", "terminal", "git"],
        activeSurface: "terminal",
        terminal: {
          sessions: [
            { id: "terminal-0", title: "dev", live: true, closable: true },
            { id: "terminal-1", title: "zsh", live: false, closable: true },
          ],
          activeSessionId: "terminal-0",
        },
        editorDocuments: null,
      }),
    });
    const host = mount(value);
    const tabs = host.querySelectorAll<HTMLElement>('[role="tab"]');
    press(tabs[1] as Element, "Delete");
    click(tabs[3]?.querySelector(".cv-tab__close") as Element);

    expect(value.onTerminalSessionCommand).toHaveBeenCalledWith({
      kind: "close",
      sessionId: "terminal-0",
    });
    expect(value.onCloseSurface).toHaveBeenCalledWith("git");
  });

  it("moves focus to the next tab after closing the focused tab with Delete", () => {
    ui = mountUi();
    ui.render(<ClosingHarness active="git" initial={["diff", "git", "scripts"]} />);
    const git = tabTitled(ui.host, "Git");
    expect(git).toBeDefined();
    git?.focus();
    press(git as Element, "Delete");

    expect(tabTitled(ui.host, "Git")).toBeUndefined();
    expect(document.activeElement).toBe(tabTitled(ui.host, "Scripts"));
  });

  it("moves focus to the previous tab when the closed tab was the last one", () => {
    ui = mountUi();
    ui.render(<ClosingHarness active="scripts" initial={["diff", "git", "scripts"]} />);
    const scripts = tabTitled(ui.host, "Scripts");
    scripts?.focus();
    press(scripts as Element, "Delete");

    expect(tabTitled(ui.host, "Scripts")).toBeUndefined();
    expect(document.activeElement).toBe(tabTitled(ui.host, "Git"));
  });

  it("moves focus once the owner removes the tab in a later render", () => {
    const onCloseSurface = vi.fn();
    const value = props({ entries: surfaceEntries(["diff", "git"], "diff"), onCloseSurface });
    const host = mount(value);
    const diff = tabTitled(host, "Diff");
    diff?.focus();
    press(diff as Element, "Delete");
    expect(onCloseSurface).toHaveBeenCalledWith("diff");
    expect(document.activeElement).toBe(diff);

    ui?.render(<AgentRightPanelTabStrip {...value} entries={surfaceEntries(["git"], "git")} />);
    expect(document.activeElement).toBe(tabTitled(host, "Git"));
  });

  it("does not steal focus that moved outside the strip before the close settled", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const value = props({ entries: surfaceEntries(["diff", "git"], "diff") });
    const host = mount(value);
    const diff = tabTitled(host, "Diff");
    diff?.focus();
    press(diff as Element, "Delete");
    outside.focus();

    ui?.render(<AgentRightPanelTabStrip {...value} entries={surfaceEntries(["git"], "git")} />);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("scrolls the active tab into view whenever it changes", () => {
    const original = Element.prototype.scrollIntoView;
    const scrolled: Array<{ readonly title: string; readonly options: unknown }> = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: unknown) {
      scrolled.push({ title: (this as HTMLElement).title, options });
    };
    try {
      const open: ReadonlyArray<AgentSurfaceKind> = ["diff", "terminal", "git", "scripts"];
      ui = mountUi();
      ui.render(<AgentRightPanelTabStrip {...props({ entries: surfaceEntries(open, "diff") })} />);
      ui.render(<AgentRightPanelTabStrip {...props({ entries: surfaceEntries(open, "diff") })} />);
      ui.render(
        <AgentRightPanelTabStrip {...props({ entries: surfaceEntries(open, "scripts") })} />,
      );

      expect(scrolled).toEqual([
        { title: "Diff", options: { block: "nearest", inline: "nearest" } },
        { title: "Scripts", options: { block: "nearest", inline: "nearest" } },
      ]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("tolerates an environment without scrollIntoView", () => {
    const original = Element.prototype.scrollIntoView;
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: undefined,
      writable: true,
    });
    try {
      const host = mount(props());
      expect(host.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("links tabs to rendered surface panels only", () => {
    const editorDocuments = {
      documents: [
        {
          documentId: "doc-1",
          title: "app.ts",
          path: "/w/app.ts",
          dirty: false,
          preview: false,
          gitStatus: null,
        },
      ],
      activeDocumentId: "doc-1",
      surfaceActive: true,
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onOpenFile: vi.fn(),
      onPin: vi.fn(),
    };
    const withPanels = mount(
      props({
        editorDocuments,
        entries: agentRightPanelTabEntries({
          openSurfaces: ["diff", "editor"],
          activeSurface: "diff",
          terminal: null,
          editorDocuments,
        }),
      }),
    );
    expect(tabTitled(withPanels, "Diff")?.getAttribute("aria-controls")).toBe(
      "agent-surface-panel-diff",
    );
    expect(tabTitled(withPanels, "app.ts")?.getAttribute("aria-controls")).toBe(
      "agent-surface-panel-editor",
    );
    ui?.unmount();

    const withoutPanels = mount(props({ tabPanelsRendered: false }));
    const tabs = [...withoutPanels.querySelectorAll('[role="tab"]')];
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs.every((tab) => !tab.hasAttribute("aria-controls"))).toBe(true);
  });

  it("adds surfaces from the + menu with their shortcut letters", () => {
    const value = props();
    const host = mount(value);
    click(host.querySelector('[aria-label="Add panel surface"]') as Element);
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];

    expect(items.map((item) => item.textContent)).toEqual([
      "TerminalT",
      "FilesF",
      "DiffD",
      "GitG",
      "ScriptsS",
      "Pull requestP",
      "HistoryH",
    ]);
    click(items[3] as Element);
    expect(value.onAddSurface).toHaveBeenCalledWith("git");
  });

  it("shows the Open file button only when editor documents are provided", () => {
    const onOpenFile = vi.fn();
    const host = mount(
      props({
        editorDocuments: {
          documents: [],
          activeDocumentId: null,
          surfaceActive: false,
          onActivate: vi.fn(),
          onClose: vi.fn(),
          onOpenFile,
          onPin: vi.fn(),
        },
      }),
    );
    click(host.querySelector('[aria-label="Open file"]') as Element);
    expect(onOpenFile).toHaveBeenCalledOnce();
  });

  it("shows editor tab git badges and pins a preview tab on double click", () => {
    const onPin = vi.fn();
    const editorDocuments: AgentRightPanelEditorDocuments = {
      documents: [
        {
          documentId: "/w/a.ts",
          title: "a.ts",
          path: "/w/a.ts",
          dirty: false,
          preview: false,
          gitStatus: "untracked",
        },
        {
          documentId: "/w/b.ts",
          title: "b.ts",
          path: "/w/b.ts",
          dirty: false,
          preview: true,
          gitStatus: "deleted",
        },
        {
          documentId: "/w/c.ts",
          title: "c.ts",
          path: "/w/c.ts",
          dirty: false,
          preview: false,
          gitStatus: null,
        },
      ],
      activeDocumentId: "/w/a.ts",
      surfaceActive: true,
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onOpenFile: vi.fn(),
      onPin,
    };
    const host = mount(
      props({
        editorDocuments,
        entries: agentRightPanelTabEntries({
          openSurfaces: ["diff", "editor"],
          activeSurface: "editor",
          terminal: null,
          editorDocuments,
        }),
      }),
    );

    const untracked = tabTitled(host, "a.ts")?.querySelector(".cv-tab__badge");
    expect(untracked?.textContent).toBe("U");
    expect(untracked?.getAttribute("aria-label")).toBe("Untracked");
    expect(untracked?.classList.contains("cv-tab__badge--ok")).toBe(true);
    expect(
      tabTitled(host, "b.ts")
        ?.querySelector(".cv-tab__badge")
        ?.classList.contains("cv-tab__badge--danger"),
    ).toBe(true);
    expect(tabTitled(host, "c.ts")?.querySelector(".cv-tab__badge")).toBeNull();

    act(() => {
      tabTitled(host, "b.ts")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      tabTitled(host, "Diff")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onPin).toHaveBeenCalledWith("/w/b.ts");
  });
});
