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

  it("shows Tests but not Routes for a PHP workspace without Artisan", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      { hasArtisan: false, hasPhpWorkspace: true },
    );
    const labels = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[role='tab']"),
      (button) => button.textContent,
    );

    expect(labels).toContain("Tests");
    expect(labels).not.toContain("Routes");
  });

  it("shows the Tests tab for a JavaScript-only workspace", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      { hasArtisan: false, hasJsWorkspace: true, hasPhpWorkspace: false },
    );
    const labels = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[role='tab']"),
      (button) => button.textContent,
    );

    expect(labels).toContain("Tests");
  });

  it("renders only the JavaScript results block for a JS-only workspace", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "testResults",
        hasArtisan: false,
        hasJsWorkspace: true,
        hasPhpWorkspace: false,
      },
    );

    expect(
      host.querySelector('[aria-label="JavaScript test results"]'),
    ).not.toBeNull();
    expect(host.querySelector('[aria-label="PHP test results"]')).toBeNull();
  });

  it("renders PHP and JavaScript results blocks for a mixed workspace", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "testResults",
        hasArtisan: false,
        hasJsWorkspace: true,
        hasPhpWorkspace: true,
      },
    );

    expect(
      host.querySelector('[aria-label="JavaScript test results"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[aria-label="PHP test results"]'),
    ).not.toBeNull();
  });

  it("keeps the PHP-only results block for a PHP workspace", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "testResults",
        hasArtisan: true,
        hasJsWorkspace: false,
        hasPhpWorkspace: true,
      },
    );

    expect(
      host.querySelector('[aria-label="PHP test results"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[aria-label="JavaScript test results"]'),
    ).toBeNull();
  });

  it("always shows the Debug tab", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      { hasArtisan: false, hasJsWorkspace: false, hasPhpWorkspace: false },
    );
    const labels = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[role='tab']"),
      (button) => button.textContent,
    );

    expect(labels).toContain("Debug");
  });

  it("renders the debug panel with pass-through props for the debug view", async () => {
    const onStep = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "debug",
        debug: {
          breakpoints: [],
          evaluationHistory: [],
          lastStartError: null,
          onLoadVariables: vi.fn(),
          onEvaluate: vi.fn().mockResolvedValue(null),
          onNavigateToBreakpoint: vi.fn(),
          onNavigateToFrame: vi.fn(),
          onPause: vi.fn(),
          onRemoveBreakpoint: vi.fn(),
          onSelectFrame: vi.fn(),
          onSetBreakpointCondition: vi.fn(),
          onSetBreakpointEnabled: vi.fn(),
          onStep,
          onStop: vi.fn(),
          output: [],
          rootPath: "/workspace",
          scopes: [],
          selectedFrameId: null,
          snapshot: {
            state: {
              kind: "stopped",
              sessionId: 1,
              reason: "breakpoint",
              frames: [],
              topFrame: null,
            },
            lastSeq: 1,
          },
          variablesByReference: {},
          workspaceTrusted: true,
        },
      },
    );

    expect(host.querySelector('[aria-label="Debug"]')).not.toBeNull();

    act(() => {
      (
        host.querySelector('[aria-label="Continue"]') as HTMLButtonElement
      ).click();
    });

    expect(onStep).toHaveBeenCalledWith("continue");
  });

  it("renders no debug panel when debug props are not wired", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      { activeView: "debug" },
    );

    expect(host.querySelector('[aria-label="Debug"]')).toBeNull();
  });

  it("runs JavaScript tests from the JS results block", async () => {
    const onRunJsTests = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "testResults",
        hasArtisan: false,
        hasJsWorkspace: true,
        hasPhpWorkspace: false,
        onRunJsTests,
      },
    );

    act(() => {
      (
        host.querySelector(
          '[aria-label="Run JavaScript tests"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(onRunJsTests).toHaveBeenCalledTimes(1);
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
  overrides: Partial<Parameters<typeof BottomPanel>[0]> = {},
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
        {...overrides}
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
