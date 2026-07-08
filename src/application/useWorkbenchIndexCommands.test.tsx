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
  useWorkbenchIndexCommands,
  type WorkbenchIndexActions,
  type WorkbenchIndexCommandsOptions,
} from "./useWorkbenchIndexCommands";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other-workspace";

function startResult(rootPath = ROOT): InitialMetadataScanStart {
  return {
    databasePath: `${rootPath}/.editor/index.sqlite`,
    rootPath,
    status: "started",
  };
}

function indexProgressGateway(): IndexProgressGateway {
  return {
    clearWorkspaceIndex: vi.fn(),
    startInitialMetadataScan: vi.fn(),
    startReindex: vi.fn(async (rootPath) => startResult(rootPath)),
    subscribeIndexProgress: vi.fn(),
    subscribeMetadataScanCompletion: vi.fn(),
  };
}

function makeOptions(
  overrides: Partial<WorkbenchIndexCommandsOptions> = {},
): WorkbenchIndexCommandsOptions {
  return {
    activeIndexRootRef: { current: null },
    currentWorkspaceRootRef: { current: ROOT },
    indexProgressGateway: indexProgressGateway(),
    intelligenceMode: "fullSmart",
    pendingIndexRootRef: { current: null },
    pendingIndexScanRef: { current: false },
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

  function Harness({
    dependencies,
  }: {
    dependencies: WorkbenchIndexCommandsOptions;
  }) {
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
      ROOT,
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
      ROOT,
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
      ROOT,
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
    expect(options.pendingIndexScanRef.current).toBe(false);
    expect(options.pendingIndexRootRef.current).toBeNull();
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
    expect(options.setIndexProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        databasePath: `${ROOT}/.editor/index.sqlite`,
        rootPath: ROOT,
        status: "scanning",
      }),
    );
    expect(options.setIndexProgress).not.toHaveBeenCalledWith(
      initialIndexProgress(),
    );
    expect(options.setMessage).toHaveBeenCalledWith("Index scan started.");
  });
});
