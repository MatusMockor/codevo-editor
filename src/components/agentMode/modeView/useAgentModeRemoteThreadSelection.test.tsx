// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { remoteAgentProjectKey } from "../../../application/remoteAgentProjection";
import type { RemoteRunnerServer } from "../../../domain/remoteRunner";
import type {
  RemoteServerListState,
  RemoteThreadSelection,
} from "../../../domain/remoteThreadSelection";
import {
  RemoteRunnerContext,
  type RemoteRunnerContextValue,
} from "../../remoteRunner/remoteRunnerContext";
import {
  REMOTE_THREAD_MISSING_CONFIRM_MS,
  REMOTE_THREAD_WAIT_MS,
  useAgentModeRemoteThreadSelection,
  type AgentModeRemoteInventory,
} from "./useAgentModeRemoteThreadSelection";

const THREAD = "remote-thread:linux:runner:conversation";
const OTHER_THREAD = "remote-thread:linux:runner:other";
const LINUX: RemoteRunnerServer = {
  id: "linux",
  name: "Linux",
  host: "linux",
  username: "codex",
  port: 22,
  connected: true,
};
const AUTHORITATIVE = new Set([remoteAgentProjectKey("linux", "runner", "project")]);

interface Frame {
  readonly selectedThreadId: string | null;
  readonly servers: readonly RemoteRunnerServer[];
  readonly serverList: RemoteServerListState;
  readonly inventory: AgentModeRemoteInventory;
}

describe("remote thread selection hook", () => {
  let host: HTMLDivElement;
  let root: Root;
  let observed: RemoteThreadSelection | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    host = document.createElement("div");
    root = createRoot(host);
    observed = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  function Probe({ frame }: { readonly frame: Frame }) {
    observed = useAgentModeRemoteThreadSelection(frame.selectedThreadId, false, frame.inventory);
    return null;
  }

  function render(frame: Frame): void {
    const value = {
      servers: frame.servers,
      serverList: frame.serverList,
      error: null,
      selectedServerId: null,
    } as unknown as RemoteRunnerContextValue;
    act(() =>
      root.render(
        <RemoteRunnerContext.Provider value={value}>
          <Probe frame={frame} />
        </RemoteRunnerContext.Provider>,
      ),
    );
  }

  function advance(milliseconds: number): void {
    act(() => {
      vi.advanceTimersByTime(milliseconds);
    });
  }

  function frame(overrides: Partial<Frame> = {}): Frame {
    return {
      selectedThreadId: THREAD,
      servers: [LINUX],
      serverList: "ready",
      inventory: {
        selectedThreadId: THREAD,
        loading: false,
        authoritativeProjectKeys: AUTHORITATIVE,
      },
      ...overrides,
    };
  }

  it("confirms a missing thread only after the settled list stays stable", () => {
    render(frame());
    expect(observed).toEqual({ kind: "resolving" });
    advance(REMOTE_THREAD_MISSING_CONFIRM_MS - 1);
    expect(observed).toEqual({ kind: "resolving" });
    advance(1);
    expect(observed).toEqual({ kind: "missing" });
  });

  it("restarts confirmation when the inventory reloads for the selection", () => {
    render(frame());
    advance(REMOTE_THREAD_MISSING_CONFIRM_MS - 10);
    render(frame({ inventory: { ...frame().inventory, loading: true } }));
    render(frame());
    advance(REMOTE_THREAD_MISSING_CONFIRM_MS - 10);
    expect(observed).toEqual({ kind: "resolving" });
    advance(10);
    expect(observed).toEqual({ kind: "missing" });
  });

  it("never confirms a missing thread from an inventory owned by another selection", () => {
    render(frame({ inventory: { ...frame().inventory, selectedThreadId: OTHER_THREAD } }));
    advance(REMOTE_THREAD_MISSING_CONFIRM_MS * 3);
    expect(observed).toEqual({ kind: "resolving" });
  });

  it("does not carry an elapsed deadline across A to B to A selections", () => {
    const inventory = { ...frame().inventory, loading: true };
    render(frame({ inventory }));
    advance(REMOTE_THREAD_WAIT_MS);
    expect(observed).toEqual({ kind: "unavailable", serverName: "Linux" });
    render(frame({ selectedThreadId: OTHER_THREAD, inventory }));
    render(frame({ inventory }));
    expect(observed).toEqual({ kind: "resolving" });
  });

  it("starts a fresh wait after the server reconnects", () => {
    const inventory = { ...frame().inventory, loading: true };
    render(frame({ inventory }));
    advance(REMOTE_THREAD_WAIT_MS);
    expect(observed).toEqual({ kind: "unavailable", serverName: "Linux" });
    render(frame({ inventory, servers: [{ ...LINUX, connected: false }] }));
    expect(observed).toEqual({ kind: "disconnected", serverId: "linux", serverName: "Linux" });
    render(frame({ inventory }));
    expect(observed).toEqual({ kind: "resolving" });
  });

  it("bounds the wait for a server list that never loads", () => {
    render(frame({ servers: [], serverList: "loading" }));
    expect(observed).toEqual({ kind: "resolving" });
    advance(REMOTE_THREAD_WAIT_MS);
    expect(observed).toEqual({ kind: "unavailable", serverName: null });
  });
});
