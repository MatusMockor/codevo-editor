// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { UseJsTestRunSelectionCommandsOptions } from "./useJsTestRunSelectionCommands";

const mocks = vi.hoisted(() => ({
  runOptions: null as UseJsTestRunSelectionCommandsOptions | null,
}));

vi.mock("./useDebugWatchAtCursor", () => ({
  useDebugWatchAtCursor: () => ({}),
}));
vi.mock("./useJsTestDebugAtCursor", () => ({
  useJsTestDebugAtCursor: () => ({}),
}));
vi.mock("./useJsTestRunSelectionCommands", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("./useJsTestRunSelectionCommands")>();
  return {
    ...original,
    useJsTestRunSelectionCommands: (options: UseJsTestRunSelectionCommandsOptions) => {
      mocks.runOptions = options;
      return {};
    },
  };
});

import { useWorkbenchJsTestCursorDebugging } from "./useWorkbenchJsTestCursorDebugging";

describe("useWorkbenchJsTestCursorDebugging activation fence", () => {
  it("records trust, root, workspace ID, owner, and reader A-B-A transitions", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const readerA = { readDebugWatchAtCursorCapture: () => null };
    const readerB = { readDebugWatchAtCursorCapture: () => null };
    const state = {
      ownerKey: "owner-a" as string | null,
      reader: readerA,
      trusted: true,
      workspaceId: "workspace-a" as string | null,
      workspaceRoot: "/workspace-a" as string | null,
    };
    const render = () => {
      act(() => {
        root.render(
          <Harness
            ownerKey={state.ownerKey}
            reader={state.reader}
            trusted={() => state.trusted}
            workspaceId={state.workspaceId}
            workspaceRoot={state.workspaceRoot}
          />,
        );
      });
      return mocks.runOptions!.activationEpoch();
    };

    expect(render()).toBe(1);
    state.trusted = false;
    expect(render()).toBe(2);
    state.trusted = true;
    expect(render()).toBe(3);
    state.workspaceRoot = "/workspace-b";
    expect(render()).toBe(4);
    state.workspaceRoot = "/workspace-a";
    expect(render()).toBe(5);
    state.workspaceId = "workspace-b";
    expect(render()).toBe(6);
    state.workspaceId = "workspace-a";
    expect(render()).toBe(7);
    state.ownerKey = "owner-b";
    expect(render()).toBe(8);
    state.ownerKey = "owner-a";
    expect(render()).toBe(9);
    state.reader = readerB;
    expect(render()).toBe(10);
    state.reader = readerA;
    expect(render()).toBe(11);

    act(() => root.unmount());
  });

  it("fails the trust activation sample closed when the reader throws", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    expect(() => {
      act(() => {
        root.render(
          <Harness
            ownerKey="owner"
            reader={null}
            trusted={() => {
              throw new Error("trust");
            }}
            workspaceId="workspace"
            workspaceRoot="/workspace"
          />,
        );
      });
    }).not.toThrow();
    expect(mocks.runOptions!.activationEpoch()).toBe(1);
    act(() => root.unmount());
  });
});

function Harness({
  ownerKey,
  reader,
  trusted,
  workspaceId,
  workspaceRoot,
}: {
  readonly ownerKey: string | null;
  readonly reader: { readDebugWatchAtCursorCapture(): null } | null;
  readonly trusted: () => boolean;
  readonly workspaceId: string | null;
  readonly workspaceRoot: string | null;
}) {
  useWorkbenchJsTestCursorDebugging({
    activeDocument: () => null,
    captureReader: reader,
    isDebugStartBlocked: () => false,
    isWorkspaceCurrent: () => true,
    isWorkspaceTrusted: trusted,
    openDebugPanel: () => undefined,
    ownerKey,
    readTextFileBounded: undefined,
    reportWarning: () => undefined,
    startDebugAccepted: async () => true,
    watches: { add: () => false, canAdd: () => false },
    workspaceId,
    workspaceRoot,
  });
  return null;
}
