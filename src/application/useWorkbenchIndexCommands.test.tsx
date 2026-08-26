// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initialIndexProgress,
  type IndexProgressGateway,
  type InitialMetadataScanStart,
} from "../domain/indexProgress";
import {
  attachIndexStartReceipt,
  useWorkbenchIndexCommands,
  type WorkbenchIndexActions,
  type WorkbenchIndexCommandsOptions,
} from "./useWorkbenchIndexCommands";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other-workspace";

function startResult(rootPath = ROOT, operationGeneration = 7): InitialMetadataScanStart {
  return {
    databasePath: `${rootPath}/.editor/index.sqlite`,
    operationGeneration,
    rootPath,
    status: "started",
  };
}

function indexProgressGateway(): IndexProgressGateway {
  return {
    clearWorkspaceIndex: vi.fn(),
    startInitialMetadataScan: vi.fn(),
    startReindex: vi.fn(async (request) =>
      startResult(request.rootPath, request.operationGeneration),
    ),
    subscribeIndexProgress: vi.fn(),
    subscribeMetadataScanCompletion: vi.fn(),
  };
}

function makeOptions(
  overrides: Partial<WorkbenchIndexCommandsOptions> = {},
): WorkbenchIndexCommandsOptions {
  return {
    activeIndexRootRef: { current: null },
    abandonIndexOperation: vi.fn(),
    beginIndexOperation: vi.fn((rootPath) => ({
      admissionToken: 11,
      operationGeneration: 7,
      requestIsCurrent: () => true,
      rootPath,
      workspaceId: "workspace-a",
    })),
    indexProgressGateway: indexProgressGateway(),
    indexOperationIsCurrent: vi.fn(() => true),
    intelligenceMode: "fullSmart",
    reportError: vi.fn(),
    setIndexHealthLogs: vi.fn(),
    setIndexProgress: vi.fn(),
    setMessage: vi.fn(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

let mountedRoot: Root | null = null;
let container: HTMLDivElement | null = null;

function renderHook(options: WorkbenchIndexCommandsOptions) {
  container = document.createElement("div");
  mountedRoot = createRoot(container);
  const captured: { actions: WorkbenchIndexActions | null } = {
    actions: null,
  };

  function Harness({ dependencies }: { dependencies: WorkbenchIndexCommandsOptions }) {
    captured.actions = useWorkbenchIndexCommands(dependencies);
    return null;
  }

  act(() => {
    mountedRoot?.render(<Harness dependencies={options} />);
  });

  return {
    actions: (): WorkbenchIndexActions => {
      if (!captured.actions) {
        throw new Error("hook not mounted");
      }

      return captured.actions;
    },
  };
}

afterEach(() => {
  if (mountedRoot) {
    act(() => {
      mountedRoot?.unmount();
    });
  }
  mountedRoot = null;
  container?.remove();
  container = null;
  vi.clearAllMocks();
});

describe("useWorkbenchIndexCommands", () => {
  it("is a no-op without a workspace", async () => {
    const options = makeOptions({ workspaceRoot: null });
    const hook = renderHook(options);

    await act(async () => {
      await hook.actions().startIndexScan();
    });

    expect(options.indexProgressGateway.startReindex).not.toHaveBeenCalled();
    expect(options.setMessage).not.toHaveBeenCalled();
    expect(options.setIndexProgress).not.toHaveBeenCalled();
  });

  it("shows the enable-smart message when indexing is disabled", async () => {
    const options = makeOptions({ intelligenceMode: "basic" });
    const hook = renderHook(options);

    await act(async () => {
      await hook.actions().startIndexScan();
    });

    expect(options.indexProgressGateway.startReindex).not.toHaveBeenCalled();
    expect(options.setMessage).toHaveBeenCalledWith(
      "Enable Smart Index or IDE Mode to index this workspace.",
    );
  });

  it("starts a soft reindex", async () => {
    const options = makeOptions();
    const hook = renderHook(options);

    await act(async () => {
      await hook.actions().startIndexScan();
    });

    expect(options.indexProgressGateway.startReindex).toHaveBeenCalledWith(
      {
        admissionToken: 11,
        operationGeneration: 7,
        rootPath: ROOT,
        workspaceId: "workspace-a",
      },
      "soft",
      undefined,
    );
  });

  it("starts a PHP language reindex", async () => {
    const options = makeOptions();
    const hook = renderHook(options);

    await act(async () => {
      await hook.actions().startPhpReindex();
    });

    expect(options.indexProgressGateway.startReindex).toHaveBeenCalledWith(
      {
        admissionToken: 11,
        operationGeneration: 7,
        rootPath: ROOT,
        workspaceId: "workspace-a",
      },
      "language",
      "php",
    );
  });

  it("starts a hard reindex", async () => {
    const options = makeOptions();
    const hook = renderHook(options);

    await act(async () => {
      await hook.actions().startHardReindex();
    });

    expect(options.indexProgressGateway.startReindex).toHaveBeenCalledWith(
      {
        admissionToken: 11,
        operationGeneration: 7,
        rootPath: ROOT,
        workspaceId: "workspace-a",
      },
      "hard",
      undefined,
    );
  });

  it("ignores a stale cross-root start response", async () => {
    const options = makeOptions({
      indexProgressGateway: {
        ...indexProgressGateway(),
        startReindex: vi.fn(async () => startResult(OTHER_ROOT)),
      },
    });
    const hook = renderHook(options);

    await act(async () => {
      await hook.actions().startIndexScan();
    });

    expect(options.activeIndexRootRef.current).toBeNull();
    expect(options.abandonIndexOperation).toHaveBeenCalledOnce();
    expect(options.setIndexProgress).not.toHaveBeenCalled();
    expect(options.setIndexHealthLogs).not.toHaveBeenCalled();
    expect(options.setMessage).not.toHaveBeenCalledWith("Index scan started.");
  });

  it("sets active root and progress for the active workspace", async () => {
    const options = makeOptions();
    const hook = renderHook(options);

    await act(async () => {
      await hook.actions().startIndexScan();
    });

    expect(options.activeIndexRootRef.current).toBe(ROOT);
    const update = vi.mocked(options.setIndexProgress).mock.calls[0]?.[0];
    if (typeof update !== "function") throw new Error("Missing index progress update");
    expect(update(initialIndexProgress())).toEqual(
      expect.objectContaining({
        databasePath: `${ROOT}/.editor/index.sqlite`,
        rootPath: ROOT,
        status: "scanning",
      }),
    );
    expect(options.setIndexProgress).not.toHaveBeenCalledWith(initialIndexProgress());
    expect(options.setMessage).toHaveBeenCalledWith("Index scan started.");
  });
});

describe("attachIndexStartReceipt", () => {
  it("preserves exact progress that arrived before the receipt", () => {
    const current = {
      ...initialIndexProgress(),
      operationGeneration: 7,
      processedFiles: 9,
      rootPath: ROOT,
      status: "scanning" as const,
      totalFiles: 10,
    };
    expect(attachIndexStartReceipt(current, startResult(ROOT, 7))).toEqual({
      ...current,
      databasePath: `${ROOT}/.editor/index.sqlite`,
    });
  });
});
