// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebugConsoleState, reduceDebugConsoleState } from "../domain/debugConsoleState";
import type { UseDebugConsoleResult } from "./useDebugConsole";
import {
  useDebugConsoleSurfaceCommands,
  type UseDebugConsoleSurfaceCommandsResult,
} from "./useDebugConsoleSurfaceCommands";

const OWNER = { sessionId: 7, pauseGeneration: 1 } as const;

describe("useDebugConsoleSurfaceCommands", () => {
  let host: HTMLDivElement;
  let root: Root;
  let current: UseDebugConsoleSurfaceCommandsResult;
  let consoleResult: UseDebugConsoleResult;
  let workspaceTrusted: boolean;
  let openDebugPanel: () => void;
  let trustError: Error | null;
  let workspaceOwnerKey: string | null;

  function Harness() {
    current = useDebugConsoleSurfaceCommands({
      console: consoleResult,
      isWorkspaceTrusted: () => {
        if (trustError) throw trustError;
        return workspaceTrusted;
      },
      openDebugPanel,
      workspaceOwnerKey,
    });
    return null;
  }

  function render() {
    act(() => root.render(<Harness />));
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
    consoleResult = {
      clear: vi.fn(),
      state: createDebugConsoleState(OWNER),
      submit: vi.fn(),
    };
    openDebugPanel = vi.fn();
    trustError = null;
    workspaceTrusted = true;
    workspaceOwnerKey = "workspace-a";
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("opens the panel and publishes monotonic focus requests for the current workspace", () => {
    render();

    act(() => current.focus());
    expect(openDebugPanel).toHaveBeenCalledOnce();
    expect(current.focusRequest).toEqual({ generation: 1, workspaceOwnerKey: "workspace-a" });

    act(() => current.focus());
    expect(openDebugPanel).toHaveBeenCalledTimes(2);
    expect(current.focusRequest).toEqual({ generation: 2, workspaceOwnerKey: "workspace-a" });
  });

  it("keeps a request available for a panel that mounts after the command", () => {
    render();
    act(() => current.focus());

    render();

    expect(current.focusRequest).toEqual({ generation: 1, workspaceOwnerKey: "workspace-a" });
  });

  it("acknowledges only the exact current request and does not replay it after remount", () => {
    render();
    act(() => current.focus());
    const first = current.focusRequest!;

    act(() =>
      current.acknowledgeFocusRequest({
        generation: first.generation + 1,
        workspaceOwnerKey: first.workspaceOwnerKey,
      }),
    );
    expect(current.focusRequest).toBe(first);

    act(() => current.acknowledgeFocusRequest(first));
    expect(current.focusRequest).toBeNull();
    render();
    expect(current.focusRequest).toBeNull();
  });

  it("does not let a stale acknowledgement consume a newer workspace request", () => {
    render();
    act(() => current.focus());
    const stale = current.focusRequest!;

    workspaceOwnerKey = "workspace-b";
    render();
    act(() => current.focus());
    const currentRequest = current.focusRequest;
    act(() => current.acknowledgeFocusRequest(stale));

    expect(current.focusRequest).toBe(currentRequest);
  });

  it("identifies stale requests after a workspace switch and targets new requests correctly", () => {
    render();
    act(() => current.focus());
    const staleRequest = current.focusRequest;

    workspaceOwnerKey = "workspace-b";
    render();
    expect(staleRequest?.workspaceOwnerKey).toBe("workspace-a");
    expect(current.workspaceOwnerKey).toBe("workspace-b");
    expect(current.focusRequest).toBeNull();

    act(() => current.focus());
    expect(current.focusRequest).toEqual({ generation: 2, workspaceOwnerKey: "workspace-b" });
  });

  it("does not revive an old request after switching away and back to its workspace", () => {
    render();
    act(() => current.focus());
    expect(current.focusRequest?.generation).toBe(1);

    workspaceOwnerKey = "workspace-b";
    render();
    expect(current.focusRequest).toBeNull();

    workspaceOwnerKey = "workspace-a";
    render();
    expect(current.focusRequest).toBeNull();

    act(() => current.focus());
    expect(current.focusRequest).toEqual({ generation: 2, workspaceOwnerKey: "workspace-a" });
  });

  it("makes focus a no-op without a current workspace owner", () => {
    workspaceOwnerKey = null;
    render();

    act(() => current.focus());

    expect(openDebugPanel).not.toHaveBeenCalled();
    expect(current.focusRequest).toBeNull();
  });

  it("rechecks current trust in retained focus and clear callbacks", () => {
    consoleResult = {
      ...consoleResult,
      state: reduceDebugConsoleState(consoleResult.state, {
        type: "output",
        owner: OWNER,
        stream: "stdout",
        text: "ready",
      }),
    };
    render();
    const retainedFocus = current.focus;
    const retainedClear = current.clear;
    expect(current.canClear).toBe(true);

    workspaceTrusted = false;
    render();
    expect(current.canClear).toBe(false);
    act(() => retainedFocus());
    retainedClear();

    expect(openDebugPanel).not.toHaveBeenCalled();
    expect(consoleResult.clear).not.toHaveBeenCalled();
    expect(current.focusRequest).toBeNull();
  });

  it("fails closed when the live trust reader throws", () => {
    consoleResult = {
      ...consoleResult,
      state: reduceDebugConsoleState(consoleResult.state, {
        type: "output",
        owner: OWNER,
        stream: "stdout",
        text: "ready",
      }),
    };
    trustError = new Error("trust unavailable");
    render();

    expect(current.canClear).toBe(false);
    expect(() => current.focus()).not.toThrow();
    expect(() => current.clear()).not.toThrow();
    expect(openDebugPanel).not.toHaveBeenCalled();
    expect(consoleResult.clear).not.toHaveBeenCalled();
  });

  it("derives clear capability from entries and delegates only while content remains", () => {
    render();
    expect(current.canClear).toBe(false);
    current.clear();
    expect(consoleResult.clear).not.toHaveBeenCalled();

    consoleResult = {
      ...consoleResult,
      state: reduceDebugConsoleState(consoleResult.state, {
        type: "output",
        owner: OWNER,
        stream: "stdout",
        text: "ready",
      }),
    };
    render();
    expect(current.canClear).toBe(true);
    current.clear();
    expect(consoleResult.clear).toHaveBeenCalledOnce();

    consoleResult = { ...consoleResult, state: createDebugConsoleState(OWNER) };
    render();
    current.clear();
    expect(consoleResult.clear).toHaveBeenCalledOnce();
  });

  it("recognizes pending work and refuses to clear a stale console after owner removal", () => {
    consoleResult = {
      ...consoleResult,
      state: reduceDebugConsoleState(consoleResult.state, {
        type: "evaluation-pending",
        owner: OWNER,
        requestId: "pending-1",
        expression: "slow()",
      }),
    };
    render();
    expect(current.canClear).toBe(true);

    workspaceOwnerKey = null;
    render();
    current.clear();
    expect(consoleResult.clear).not.toHaveBeenCalled();
  });

  it("does not clear the previous workspace console during an owner transition", () => {
    consoleResult = {
      ...consoleResult,
      state: reduceDebugConsoleState(consoleResult.state, {
        type: "output",
        owner: OWNER,
        stream: "stdout",
        text: "workspace-a",
      }),
    };
    render();
    expect(current.canClear).toBe(true);

    workspaceOwnerKey = "workspace-b";
    render();
    expect(current.canClear).toBe(false);
    current.clear();
    expect(consoleResult.clear).not.toHaveBeenCalled();

    const nextOwner = { sessionId: 8, pauseGeneration: 1 } as const;
    consoleResult = {
      ...consoleResult,
      state: reduceDebugConsoleState(createDebugConsoleState(nextOwner), {
        type: "output",
        owner: nextOwner,
        stream: "stdout",
        text: "workspace-b",
      }),
    };
    render();
    expect(current.canClear).toBe(true);
    current.clear();
    expect(consoleResult.clear).toHaveBeenCalledOnce();
  });
});
