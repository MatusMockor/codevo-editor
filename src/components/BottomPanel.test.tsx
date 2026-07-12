// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import type { GitHistoryGateway } from "../domain/git";
import { initialIndexProgress } from "../domain/indexProgress";
import type { RuntimeObservabilityGateway } from "../domain/runtimeObservability";
import { terminalThemeForAppTheme } from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import { BottomPanel } from "./BottomPanel";

interface CapturedTerminalPanelProps {
  onCwdChange?(cwd: string | null): void;
  onOpenLink?(
    path: string,
    line?: number,
    column?: number,
  ): boolean | Promise<boolean> | undefined;
  rootPath: string | null;
}

const bottomPanelMocks = vi.hoisted(() => ({
  terminalProps: [] as unknown[],
}));

vi.mock("./TerminalPanel", () => ({
  TerminalPanel: (props: CapturedTerminalPanelProps) => {
    bottomPanelMocks.terminalProps.push(props);
    return <div aria-label="Mock terminal" />;
  },
}));

describe("BottomPanel terminal links", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    bottomPanelMocks.terminalProps.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
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
    expect(cwd?.getAttribute("aria-label")).toBe(
      "Reveal /workspace/src in file tree",
    );
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
      (
        host.querySelector('[title="/workspace/src"]') as HTMLButtonElement
      ).click();
    });

    expect(onRevealDirectoryInTree).toHaveBeenCalledWith("/workspace/src");
  });
});

function terminalProps(): CapturedTerminalPanelProps {
  return bottomPanelMocks.terminalProps[
    bottomPanelMocks.terminalProps.length - 1
  ] as CapturedTerminalPanelProps;
}

async function renderPanel(
  root: Root,
  workspaceRoot: string | null,
  onOpenProblem: (notice: WorkbenchNotice) => Promise<boolean>,
  onRevealDirectoryInTree?: (path: string) => void,
) {
  await act(async () => {
    root.render(
      <BottomPanel
        activeView="terminal"
        gitHistoryGateway={{} as GitHistoryGateway}
        indexHealthLogs={[]}
        indexProgress={initialIndexProgress()}
        notices={[]}
        onClearProblems={vi.fn()}
        onClose={vi.fn()}
        onHardReindex={vi.fn()}
        onOpenCommitFileDiff={vi.fn()}
        onOpenProblem={onOpenProblem}
        onPhpReindex={vi.fn()}
        onRevealDirectoryInTree={onRevealDirectoryInTree}
        onResizeStart={vi.fn()}
        onSelectView={vi.fn()}
        onSoftReindex={vi.fn()}
        onTrustWorkspace={vi.fn()}
        runtimeObservabilityGateway={{} as RuntimeObservabilityGateway}
        terminalGateway={terminalGateway()}
        terminalShellIntegrationEnabled={false}
        terminalTheme={terminalThemeForAppTheme("dark")}
        workspaceRoot={workspaceRoot}
        workspaceTrusted
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

function terminalGateway(): TerminalGateway {
  return {
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
