// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import { classicTerminalTheme } from "../domain/editorColorThemes";
import type { TerminalGateway } from "../domain/terminal";
import { BottomPanel, type BottomPanelProps } from "./BottomPanel";

interface CapturedTerminalPanelProps {
  isActive: boolean;
  onCwdChange?(cwd: string | null): void;
  onOpenLink?(path: string, line?: number, column?: number): boolean | Promise<boolean> | undefined;
  profileId: string | null;
  rootPath: string | null;
}

const bottomPanelMocks = vi.hoisted(() => ({
  terminalProps: [] as unknown[],
  terminalUnmounts: 0,
}));

vi.mock("./TerminalPanel", async () => {
  const React = await import("react");
  return {
    TerminalPanel: (props: CapturedTerminalPanelProps) => {
      React.useEffect(
        () => () => {
          bottomPanelMocks.terminalUnmounts += 1;
        },
        [],
      );
      bottomPanelMocks.terminalProps.push(props);
      return <div aria-label="Mock terminal" />;
    },
  };
});

describe("BottomPanel terminal links", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    bottomPanelMocks.terminalProps.length = 0;
    bottomPanelMocks.terminalUnmounts = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("keeps the terminal session mounted while hidden behind a drawer view", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
    );
    const first = activeTerminalProps();

    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      { hidden: true },
    );
    expect(host.querySelector('section[aria-label="Panel"]')?.hasAttribute("hidden")).toBe(true);
    expect(terminalProps().isActive).toBe(false);

    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      { hidden: false },
    );
    expect(host.querySelector('section[aria-label="Panel"]')?.hasAttribute("hidden")).toBe(false);
    expect(bottomPanelMocks.terminalUnmounts).toBe(0);
    expect(activeTerminalProps().rootPath).toBe(first.rootPath);
  });

  it("offers an explicit hide action independently of terminal session controls", async () => {
    const onClose = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        onClose,
      },
    );
    const close = host.querySelector<HTMLButtonElement>('button[aria-label="Hide panel"]');
    expect(close?.disabled).toBe(false);
    expect(close?.querySelector("svg.lucide-x")).not.toBeNull();
    act(() => close?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bottomPanelMocks.terminalUnmounts).toBe(0);
  });

  it("builds terminal navigation targets with exact and default positions", async () => {
    const onOpenProblem = vi.fn(async () => true);

    await renderPanel(root, "/workspace", onOpenProblem);
    const onOpenLink = terminalProps().onOpenLink;

    expect(onOpenLink).toBeTypeOf("function");

    const exactResult = await onOpenLink?.("/workspace/src/Foo.php", 12, 4);
    const defaultResult = await onOpenLink?.("/workspace/src/Bar.php");

    expect(exactResult).toBe(true);
    expect(defaultResult).toBe(true);
    expect(onOpenProblem.mock.calls).toEqual([
      [
        {
          id: "terminal:/workspace/src/Foo.php:12:4",
          message: "/workspace/src/Foo.php",
          navigationTarget: {
            path: "/workspace/src/Foo.php",
            range: {
              end: { column: 4, lineNumber: 12 },
              start: { column: 4, lineNumber: 12 },
            },
          },
          severity: "info",
          source: "Terminal",
        },
      ],
      [
        {
          id: "terminal:/workspace/src/Bar.php:1:1",
          message: "/workspace/src/Bar.php",
          navigationTarget: {
            path: "/workspace/src/Bar.php",
            range: {
              end: { column: 1, lineNumber: 1 },
              start: { column: 1, lineNumber: 1 },
            },
          },
          severity: "info",
          source: "Terminal",
        },
      ],
    ]);
  });

  it("drops a stale terminal activation after the workspace root changes", async () => {
    const onOpenProblem = vi.fn(async () => true);

    await renderPanel(root, "/workspace/old", onOpenProblem);
    const staleOnOpenLink = terminalProps().onOpenLink;

    await renderPanel(root, "/workspace/new", onOpenProblem);
    await staleOnOpenLink?.("/workspace/old/src/Foo.php", 3, 2);

    expect(onOpenProblem).not.toHaveBeenCalled();
  });

  it("replaces terminal ownership when a same-root workspace identity changes", async () => {
    const onOpenProblem = vi.fn(async () => true);
    await renderPanel(root, "/workspace", onOpenProblem, undefined, {
      terminalOwnerKey: "workspace-a",
    });
    const first = terminalProps();

    await renderPanel(root, "/workspace", onOpenProblem, undefined, {
      terminalOwnerKey: "workspace-b",
    });

    expect(bottomPanelMocks.terminalUnmounts).toBe(1);
    expect(terminalProps()).not.toBe(first);
  });

  it("loads the default profile, updates the active tab, and restores each tab profile", async () => {
    const gateway = terminalGateway();
    gateway.listProfiles = vi.fn(async () => [
      { command: "/bin/zsh", id: "zsh", label: "Zsh" },
      { command: "/bin/fish", id: "fish", label: "Fish" },
    ]);
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        terminalGateway: gateway,
      },
    );

    const profile = host.querySelector<HTMLSelectElement>('[aria-label="Terminal profile"]');
    expect(profile?.value).toBe("zsh");
    expect(activeTerminalProps().profileId).toBe("zsh");

    act(() => {
      host.querySelector<HTMLButtonElement>('[aria-label="New Terminal"]')?.click();
    });
    if (!profile) throw new Error("Missing terminal profile selector");
    act(() => {
      profile.value = "fish";
      profile.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(activeTerminalProps().profileId).toBe("fish");

    const terminalTabs = () =>
      [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter((button) =>
        button.getAttribute("aria-controls")?.startsWith("terminal-"),
      );
    act(() => terminalTabs()[0]?.click());
    expect(profile.value).toBe("zsh");
    expect(activeTerminalProps().profileId).toBe("zsh");
    act(() => terminalTabs()[1]?.click());
    expect(profile.value).toBe("fish");
    expect(activeTerminalProps().profileId).toBe("fish");
  });

  it("renders the active terminal cwd as a button inside the workspace", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      vi.fn(),
    );

    act(() => terminalProps().onCwdChange?.("/workspace/src"));

    const cwd = host.querySelector('[title="/workspace/src"]');

    expect(cwd?.tagName).toBe("BUTTON");
    expect(cwd?.textContent).toBe("/workspace/src");
    expect(cwd?.getAttribute("aria-label")).toBe("Reveal /workspace/src in file tree");
  });

  it("renders the cwd as a plain span outside the workspace or without a root", async () => {
    const onRevealDirectoryInTree = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      onRevealDirectoryInTree,
    );

    act(() => terminalProps().onCwdChange?.("/other/src"));

    expect(host.querySelector('[title="/other/src"]')?.tagName).toBe("SPAN");

    await renderPanel(
      root,
      null,
      vi.fn(async () => true),
      onRevealDirectoryInTree,
    );
    act(() => terminalProps().onCwdChange?.("/other/src"));

    expect(host.querySelector('[title="/other/src"]')?.tagName).toBe("SPAN");
  });

  it("reveals the current terminal cwd when its button is clicked", async () => {
    const onRevealDirectoryInTree = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      onRevealDirectoryInTree,
    );

    act(() => terminalProps().onCwdChange?.("/workspace/src"));
    act(() => {
      (host.querySelector('[title="/workspace/src"]') as HTMLButtonElement).click();
    });

    expect(onRevealDirectoryInTree).toHaveBeenCalledWith("/workspace/src");
  });

  it("renders only the terminal: no view tabs or Problems", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
    );

    expect(host.querySelector(".bottom-panel-tabs")).toBeNull();
    const terminalSession = host.querySelector('[aria-label="Terminal sessions"]');
    expect(terminalSession?.closest(".bottom-panel-body")).not.toBeNull();
    expect(terminalSession?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector(".bottom-panel-terminal-title")?.textContent).toBe("Terminal");
    expect(host.querySelector('.bottom-panel-header [aria-label="New Terminal"]')).not.toBeNull();
    expect(host.querySelector(".bottom-panel-body > .terminal-tabs-toolbar")).toBeNull();
    expect(host.querySelector('[aria-label="Problems"]')).toBeNull();
    expect(activeTerminalProps().isActive).toBe(true);
  });
});

function terminalProps(): CapturedTerminalPanelProps {
  return bottomPanelMocks.terminalProps[
    bottomPanelMocks.terminalProps.length - 1
  ] as CapturedTerminalPanelProps;
}

function activeTerminalProps(): CapturedTerminalPanelProps {
  const active = [...bottomPanelMocks.terminalProps]
    .reverse()
    .find((candidate) => (candidate as CapturedTerminalPanelProps).isActive);
  if (!active) throw new Error("Missing active terminal");
  return active as CapturedTerminalPanelProps;
}

async function renderPanel(
  root: Root,
  workspaceRoot: string | null,
  onOpenProblem: (notice: WorkbenchNotice) => Promise<boolean>,
  onRevealDirectoryInTree?: (path: string) => void,
  overrides: Partial<BottomPanelProps> = {},
) {
  await import("./TerminalTabsPanel");
  await act(async () => {
    root.render(
      <BottomPanel
        onClose={vi.fn()}
        onOpenProblem={onOpenProblem}
        onRevealDirectoryInTree={onRevealDirectoryInTree}
        onResizeStart={vi.fn()}
        onTrustWorkspace={vi.fn()}
        terminalGateway={terminalGateway()}
        terminalShellIntegrationEnabled={false}
        terminalTheme={classicTerminalTheme("classicDark")}
        workspaceRoot={workspaceRoot}
        workspaceTrusted
        {...overrides}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

function terminalGateway(): TerminalGateway {
  return {
    acknowledgeStart: vi.fn(async () => undefined),
    listProfiles: vi.fn(async () => []),
    resize: vi.fn(async () => undefined),
    start: vi.fn(async () => ({
      cols: 80,
      cwd: "/workspace",
      kind: "running" as const,
      rows: 24,
      sessionId: 1,
    })),
    stop: vi.fn(async (sessionId) => ({
      kind: "stopped" as const,
      sessionId,
    })),
    stopAll: vi.fn(async () => undefined),
    stopRoot: vi.fn(async () => undefined),
    subscribeOutput: vi.fn(async () => () => undefined),
    writeInput: vi.fn(async () => undefined),
  };
}
