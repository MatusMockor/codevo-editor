// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TextClipboardGateway } from "../domain/textClipboard";

const mocks = vi.hoisted(() => ({
  coverageRun: vi.fn(async () => true),
  debugging: false,
  outputSnapshot: {
    generation: 3,
    output: {
      stderr: { text: "failure detail", truncated: true },
      stdout: { text: "test output", truncated: false },
    },
    owner: { rootPath: "/workspace", workspaceId: "workspace-id" },
  } as const,
  useJsTestExplorer: vi.fn(() => ({
    canCancelTestRun: () => false,
    canRerunFailedTests: () => false,
    canStartContinuousRun: () => false,
    continuousRunEnabled: false,
    continuousRunPending: false,
    continuousRunRunning: false,
    continuousRunStopping: false,
    error: null,
    failedRunCompleted: 0,
    failedRunPhase: "idle" as const,
    failedRunTotal: 0,
    isLoading: false,
    isRunning: false,
    outputSnapshot: null as unknown,
    problemSnapshot: null,
    refresh: vi.fn(),
    rerunFailedTests: vi.fn(),
    run: vi.fn(),
    startContinuousRun: vi.fn(() => true),
    stopContinuousRun: vi.fn(),
    tree: null,
    truncated: false,
    unavailable: null,
  })),
}));

vi.mock("../application/useJsTestExplorer", () => ({
  useJsTestExplorer: mocks.useJsTestExplorer,
}));
vi.mock("../application/useJsTestCoverage", () => ({
  useJsTestCoverage: vi.fn(() => ({
    clear: vi.fn(),
    error: null,
    isRunning: false,
    report: null,
    run: mocks.coverageRun,
    unavailable: null,
  })),
}));
vi.mock("../application/useJsTestExplorerDebug", () => ({
  useJsTestExplorerDebug: vi.fn(() => ({
    blocked: false,
    blockedReason: null,
    debug: vi.fn(),
    error: null,
    isDebugging: mocks.debugging,
    unavailable: null,
  })),
}));
vi.mock("../application/useJsTestExplorerScopeRunnerPort", () => ({
  useJsTestExplorerScopeRunnerPort: vi.fn(() => ({})),
}));

import { useJsTestExplorerPanelController } from "./useJsTestExplorerPanelController";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("useJsTestExplorerPanelController output composition", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useJsTestExplorerPanelController>;

  beforeEach(() => {
    mocks.debugging = false;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mocks.useJsTestExplorer.mockReturnValue({
      ...mocks.useJsTestExplorer(),
      outputSnapshot: mocks.outputSnapshot,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("forwards the accepted output and copies its domain-formatted text", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    const clipboard: TextClipboardGateway = {
      canWriteText: () => true,
      writeText,
    };
    await render(clipboard);

    expect(latest.output).toEqual(mocks.outputSnapshot.output);
    expect(latest.canCopyOutput).toBe(true);
    await expect(latest.onCopyOutput?.()).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      "stdout\ntest output\n\nstderr\n[Earlier output was truncated.]\nfailure detail",
    );
  });

  it("reports a clipboard write failure without leaking the rejection", async () => {
    const clipboard: TextClipboardGateway = {
      canWriteText: () => true,
      writeText: vi.fn(async () => {
        throw new Error("clipboard denied");
      }),
    };
    await render(clipboard);

    expect(latest.canCopyOutput).toBe(true);
    await expect(latest.onCopyOutput?.()).resolves.toBe(false);
  });

  it("keeps copying unavailable when the clipboard capability is absent", async () => {
    await render(null);

    expect(latest.output).toEqual(mocks.outputSnapshot.output);
    expect(latest.canCopyOutput).toBe(false);
    await expect(latest.onCopyOutput?.()).resolves.toBe(false);
  });

  it("serializes same-tick coverage and Continuous Run starts", async () => {
    await render(null);
    const results = mocks.useJsTestExplorer.mock.results;
    const explorer = results[results.length - 1]?.value;

    act(() => {
      latest.onRunCoverage();
      latest.onStartContinuousRun();
    });
    expect(mocks.coverageRun).toHaveBeenCalledOnce();
    expect(explorer?.startContinuousRun).not.toHaveBeenCalled();

    await act(async () => Promise.resolve());
    act(() => {
      latest.onStartContinuousRun();
      latest.onRunCoverage();
    });
    expect(explorer?.startContinuousRun).toHaveBeenCalledOnce();
    expect(mocks.coverageRun).toHaveBeenCalledOnce();
  });

  it.each(["selected", "external"] as const)(
    "rejects coverage while %s debugging is active",
    async (debugOwner) => {
      mocks.debugging = debugOwner === "selected";
      await render(null, () => debugOwner === "external");

      act(() => latest.onRunCoverage());

      expect(mocks.coverageRun).not.toHaveBeenCalled();
    },
  );

  async function render(
    outputClipboard: TextClipboardGateway | null,
    isDebugStartBlocked: () => boolean = () => false,
  ) {
    await act(async () => {
      root.render(
        <Harness
          outputClipboard={outputClipboard}
          isDebugStartBlocked={isDebugStartBlocked}
          onReady={(controller) => {
            latest = controller;
          }}
        />,
      );
    });
  }
});

function Harness({
  isDebugStartBlocked,
  onReady,
  outputClipboard,
}: {
  readonly isDebugStartBlocked: () => boolean;
  readonly onReady: (controller: ReturnType<typeof useJsTestExplorerPanelController>) => void;
  readonly outputClipboard: TextClipboardGateway | null;
}) {
  const controller = useJsTestExplorerPanelController({
    coverageGateway: {} as never,
    coverageInvalidationVersion: 0,
    debugStartBlocked: false,
    discoveryGateway: {} as never,
    discoveryVersion: 0,
    isDebugStartBlocked,
    isOpen: true,
    onOpenLocation: vi.fn(),
    openDebugPanel: vi.fn(),
    outputClipboard,
    rootPath: "/workspace",
    runGateway: {} as never,
    runRequestVersion: 0,
    startDebug: vi.fn(async () => undefined),
    workspaceId: "workspace-id",
    workspaceTrusted: true,
  });
  onReady(controller);
  return null;
}
