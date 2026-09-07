// @vitest-environment jsdom

import { act, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  WorkspaceFileChangeEvent,
  WorkspaceFileChangeGateway,
} from "../../domain/workspaceFileChange";
import { rescanOpenWorkspaceDocuments } from "../rescanOpenWorkspaceDocuments";
import type { EditorDocument } from "../../domain/workspace";
import {
  useWorkbenchWorkspaceFileChangeSubscription,
  useWorkspaceFileChangeSubscription,
} from "./useWorkspaceFileChangeSubscription";

const ROOT = "/workspace";
const CHANGE: WorkspaceFileChangeEvent = {
  kind: "modified",
  path: `${ROOT}/src/index.ts`,
  relativePath: "src/index.ts",
  rootPath: ROOT,
};

describe("useWorkspaceFileChangeSubscription", () => {
  it("keeps one native subscription while rendering with fresh event behavior", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    let listener: ((event: WorkspaceFileChangeEvent) => void) | null = null;
    let rerender: (() => void) | null = null;
    const firstHandler = vi.fn();
    const latestHandler = vi.fn();
    const reportError = vi.fn();
    let handler = firstHandler;
    const gateway: WorkspaceFileChangeGateway = {
      startWatching: vi.fn(async () => undefined),
      subscribeFileChanges: vi.fn(async (next) => {
        listener = next;
        return vi.fn();
      }),
    };

    function Harness() {
      const [, setVersion] = useState(0);
      const currentWorkspaceRootRef = useRef<string | null>(ROOT);
      const eventHandlerRef = useRef((event: WorkspaceFileChangeEvent) => handler(event));
      eventHandlerRef.current = (event) => handler(event);
      rerender = () => setVersion((version) => version + 1);
      useWorkspaceFileChangeSubscription({
        currentWorkspaceRootRef,
        eventHandlerRef,
        gateway,
        reportError,
        workspaceRoot: ROOT,
      });
      return null;
    }

    await act(async () => root.render(<Harness />));
    handler = latestHandler;
    await act(async () => rerender?.());
    act(() => listener?.(CHANGE));

    expect(gateway.startWatching).toHaveBeenCalledTimes(1);
    expect(gateway.subscribeFileChanges).toHaveBeenCalledTimes(1);
    expect(firstHandler).not.toHaveBeenCalled();
    expect(latestHandler).toHaveBeenCalledWith(CHANGE);
    act(() => root.unmount());
  });

  it("does not resubscribe when reporting a watcher start failure updates the host", async () => {
    const root = createRoot(document.createElement("div"));
    const failure = new Error("watch failed");
    const gateway: WorkspaceFileChangeGateway = {
      startWatching: vi.fn(async () => Promise.reject(failure)),
      subscribeFileChanges: vi.fn(async () => vi.fn()),
    };
    let reported = 0;

    function Harness() {
      const [, setMessage] = useState<string | null>(null);
      const currentWorkspaceRootRef = useRef<string | null>(ROOT);
      const eventHandlerRef = useRef(() => undefined);
      const reportError = useCallback((_source: string, error: unknown) => {
        reported += 1;
        setMessage(String(error));
      }, []);
      useWorkspaceFileChangeSubscription({
        currentWorkspaceRootRef,
        eventHandlerRef,
        gateway,
        reportError,
        workspaceRoot: ROOT,
      });
      return null;
    }

    await act(async () => root.render(<Harness />));
    await act(async () => undefined);

    expect(reported).toBe(1);
    expect(gateway.startWatching).toHaveBeenCalledTimes(1);
    expect(gateway.subscribeFileChanges).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});

it("retains both nested repository scopes when a second rescan supersedes a pending read", async () => {
  const root = createRoot(document.createElement("div"));
  let listener: ((event: WorkspaceFileChangeEvent) => void) | undefined;
  let settle!: () => void;
  const pending = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const paths = ["/workspace/repo-a/file.ts", "/workspace/repo-b/file.ts"];
  const documents: Record<string, EditorDocument> = Object.fromEntries(
    paths.map((path) => [
      path,
      {
        path,
        name: "file.ts",
        language: "typescript",
        content: "before",
        savedContent: "before",
      },
    ]),
  );
  let first = true;
  const files = {
    readDirectory: vi.fn(async (directory: string) => {
      if (first) {
        first = false;
        await pending;
      }
      return paths
        .filter((path) => path.startsWith(`${directory}/`))
        .map((path) => ({ path, name: "file.ts", kind: "file" as const }));
    }),
  };
  const gateway: WorkspaceFileChangeGateway = {
    startWatching: vi.fn(async () => undefined),
    subscribeFileChanges: vi.fn(async (handler) => {
      listener = handler;
      return () => undefined;
    }),
  };
  const handleWorkspaceFileChange = vi.fn();
  const reportError = vi.fn();
  function Harness() {
    useWorkbenchWorkspaceFileChangeSubscription({
      currentWorkspaceRootRef: useRef<string | null>(ROOT),
      externallyRemovedDocumentRootByPathRef: useRef({}),
      gateway,
      handleExternalFileChange: async () => false,
      handleWorkspaceDiscoveryFileChange: vi.fn(),
      handleWorkspaceFileChange,
      markExternallyRemovedDocumentPath: vi.fn(),
      refreshEditorConfigRoot: vi.fn(),
      reportError,
      setMessage: vi.fn(),
      workspaceRoot: ROOT,
      rescanOpenDocuments: (event, dispatch, isCurrent) =>
        rescanOpenWorkspaceDocuments({
          event,
          dispatch,
          isCurrent,
          documents,
          files,
          reportIncomplete: vi.fn(),
        }),
    });
    return null;
  }
  await act(async () => root.render(<Harness />));
  await act(async () =>
    listener?.({
      rootPath: ROOT,
      path: "/workspace/repo-a",
      relativePath: "repo-a",
      kind: "rescanRequired",
    }),
  );
  await act(async () =>
    listener?.({
      rootPath: ROOT,
      path: "/workspace/repo-b",
      relativePath: "repo-b",
      kind: "rescanRequired",
    }),
  );
  await act(async () => {
    settle();
    await pending;
  });
  await vi.waitFor(() =>
    expect(
      handleWorkspaceFileChange.mock.calls
        .filter(([event]) => event.kind === "modified")
        .map(([event]) => event.path),
    ).toEqual(paths),
  );
  expect(reportError).not.toHaveBeenCalled();
  act(() => root.unmount());
});
