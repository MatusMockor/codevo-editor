import { describe, expect, it } from "vitest";
import {
  initialRemoteServerListAuthority,
  observeRemoteServerListStatus,
  remoteServerListState,
  remoteThreadSelection,
  remoteThreadSelectionBlocksComposer,
  retainedRemoteServerSelection,
  type RemoteThreadSelectionFacts,
} from "./remoteThreadSelection";

const THREAD = "remote-thread:linux:runner:conversation";
const LINUX = { id: "linux", name: "Linux", connected: true };

function facts(overrides: Partial<RemoteThreadSelectionFacts> = {}): RemoteThreadSelectionFacts {
  return {
    selectedThreadId: THREAD,
    threadResolved: false,
    serverList: "ready",
    servers: [LINUX],
    threadListSettled: false,
    waitExpired: false,
    ...overrides,
  };
}

describe("remote thread selection policy", () => {
  it("ignores local, empty, and resolved selections", () => {
    expect(remoteThreadSelection(facts({ selectedThreadId: null }))).toEqual({ kind: "none" });
    expect(remoteThreadSelection(facts({ selectedThreadId: "local-thread" }))).toEqual({
      kind: "none",
    });
    expect(remoteThreadSelection(facts({ threadResolved: true }))).toEqual({ kind: "none" });
  });

  it("waits only while the server is connected and its thread list is unsettled", () => {
    expect(remoteThreadSelection(facts())).toEqual({ kind: "resolving" });
  });

  it("names a registered disconnected server instead of waiting", () => {
    expect(
      remoteThreadSelection(
        facts({ servers: [{ ...LINUX, connected: false }], waitExpired: true }),
      ),
    ).toEqual({ kind: "disconnected", serverId: "linux", serverName: "Linux" });
  });

  it("treats a removed server as missing only once the server list is known", () => {
    expect(remoteThreadSelection(facts({ servers: [] }))).toEqual({ kind: "missing" });
    expect(remoteThreadSelection(facts({ servers: [], serverList: "loading" }))).toEqual({
      kind: "resolving",
    });
  });

  it("bounds an unknown server list with an unavailable state", () => {
    expect(
      remoteThreadSelection(facts({ servers: [], serverList: "loading", waitExpired: true })),
    ).toEqual({ kind: "unavailable", serverName: null });
    expect(remoteThreadSelection(facts({ servers: [], serverList: "unavailable" }))).toEqual({
      kind: "unavailable",
      serverName: null,
    });
  });

  it("uses a registered entry even while the server list is refreshing or failed", () => {
    const disconnected = [{ ...LINUX, connected: false }];
    for (const serverList of ["loading", "unavailable"] as const)
      expect(remoteThreadSelection(facts({ serverList, servers: disconnected }))).toEqual({
        kind: "disconnected",
        serverId: "linux",
        serverName: "Linux",
      });
  });

  it("treats a thread absent from the settled server list as missing", () => {
    expect(remoteThreadSelection(facts({ threadListSettled: true, waitExpired: true }))).toEqual({
      kind: "missing",
    });
  });

  it("stops waiting for a connected server once the wait expires", () => {
    expect(remoteThreadSelection(facts({ waitExpired: true }))).toEqual({
      kind: "unavailable",
      serverName: "Linux",
    });
  });

  it("fails closed for a malformed remote thread identity", () => {
    expect(
      remoteThreadSelection(facts({ selectedThreadId: "remote-thread:%ZZ:runner:conversation" })),
    ).toEqual({ kind: "unavailable", serverName: null });
  });

  it("blocks the composer for every unresolved remote state", () => {
    expect(remoteThreadSelectionBlocksComposer({ kind: "none" })).toBe(false);
    for (const selection of [
      { kind: "resolving" },
      { kind: "missing" },
      { kind: "unavailable", serverName: null },
      { kind: "disconnected", serverId: "linux", serverName: "Linux" },
    ] as const)
      expect(remoteThreadSelectionBlocksComposer(selection)).toBe(true);
  });
});

describe("remote server list state", () => {
  it("knows the server list only after a full listing succeeded", () => {
    const initial = initialRemoteServerListAuthority("loading");
    expect(remoteServerListState(null)).toBe("unavailable");
    expect(remoteServerListState(initial)).toBe("loading");
    const listed = observeRemoteServerListStatus(initial, "ready");
    expect(remoteServerListState(listed)).toBe("ready");
    for (const status of ["loading", "busy", "error", "ready"] as const)
      expect(remoteServerListState(observeRemoteServerListStatus(listed, status))).toBe("ready");
  });

  it("does not treat a single-server connect after a failed listing as a full list", () => {
    const failed = observeRemoteServerListStatus(
      initialRemoteServerListAuthority("loading"),
      "error",
    );
    expect(remoteServerListState(failed)).toBe("unavailable");
    const connected = observeRemoteServerListStatus(
      observeRemoteServerListStatus(failed, "busy"),
      "ready",
    );
    expect(remoteServerListState(connected)).toBe("loading");
    const refreshed = observeRemoteServerListStatus(
      observeRemoteServerListStatus(connected, "loading"),
      "ready",
    );
    expect(remoteServerListState(refreshed)).toBe("ready");
  });

  it("keeps the same authority when the status does not change", () => {
    const initial = initialRemoteServerListAuthority("loading");
    expect(observeRemoteServerListStatus(initial, "loading")).toBe(initial);
  });
});

describe("retained remote server selection", () => {
  it("drops a selection whose server is no longer registered", () => {
    expect(retainedRemoteServerSelection("linux", "ready", [])).toBeNull();
    expect(retainedRemoteServerSelection("linux", "ready", [LINUX])).toBe("linux");
  });

  it("keeps the selection until the server list is known", () => {
    expect(retainedRemoteServerSelection("linux", "loading", [])).toBe("linux");
    expect(retainedRemoteServerSelection("linux", "unavailable", [])).toBe("linux");
    expect(retainedRemoteServerSelection(null, "ready", [])).toBeNull();
  });
});
