// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TextClipboardGateway } from "../domain/textClipboard";

const mocks = vi.hoisted(() => ({
  coverageRun: vi.fn(async () => true),
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

  async function render(outputClipboard: TextClipboardGateway | null) {
    await act(async () => {
      root.render(
        <Harness
          outputClipboard={outputClipboard}
          onReady={(controller) => {
            latest = controller;
          }}
        />,
      );
    });
  }
});

function Harness({
  onReady,
  outputClipboard,
}: {
  readonly onReady: (controller: ReturnType<typeof useJsTestExplorerPanelController>) => void;
  readonly outputClipboard: TextClipboardGateway | null;
}) {
  const controller = useJsTestExplorerPanelController({
    coverageGateway: {} as never,
    coverageInvalidationVersion: 0,
    discoveryGateway: {} as never,
    discoveryVersion: 0,
    isOpen: true,
    onOpenLocation: vi.fn(),
    outputClipboard,
    rootPath: "/workspace",
    runGateway: {} as never,
    runRequestVersion: 0,
    workspaceId: "workspace-id",
    workspaceTrusted: true,
  });
  onReady(controller);
  return null;
}
