import { describe, expect, it } from "vitest";
import {
  deviceMcpSyncFailureNotice,
  deviceMcpSyncNotice,
  deviceMcpSyncPersistentFingerprint,
  isRemoteMcpDeviceSyncProjectKind,
  isRemoteMcpDeviceSyncRootPath,
  parseRemoteRunnerMcpDeviceSyncReport,
  type RemoteMcpDeviceSyncResult,
  type RemoteRunnerMcpDeviceSyncReport,
} from "./remoteRunnerMcpDeviceSync";

const entry = (
  name: string,
  outcome: RemoteMcpDeviceSyncResult["outcome"],
  hints: RemoteMcpDeviceSyncResult["hints"] = [],
  transport: RemoteMcpDeviceSyncResult["transport"] = "stdio",
): RemoteMcpDeviceSyncResult => ({ name, transport, outcome, hints });
const report = (
  results: readonly RemoteMcpDeviceSyncResult[],
  omitted = 0,
): RemoteRunnerMcpDeviceSyncReport => ({ version: 1, results, omitted });

describe("MCP device sync report parsing", () => {
  it("accepts the closed report including runner-only and unknown transports", () => {
    const value = report(
      [
        entry("files", "added", ["mayNeedSignIn", "oauthClient"], "http"),
        entry("old", "removed", [], "unknown"),
        entry("ws-server", "skipped", ["unsupportedTransport"], "unknown"),
        entry("broken", "skipped", ["invalidConfig"]),
        entry("extra", "skipped", ["overLimit"]),
      ],
      2,
    );
    expect(parseRemoteRunnerMcpDeviceSyncReport(value)).toEqual(value);
  });

  it.each([
    ["unknown top-level key", { ...report([]), secret: "x" }],
    ["missing omitted", { version: 1, results: [] }],
    ["negative omitted", report([], -1)],
    ["fractional omitted", report([], 1.5)],
    ["wrong version", { ...report([]), version: 2 }],
    ["unknown outcome", report([{ ...entry("a", "added"), outcome: "installed" } as never])],
    ["unknown transport", report([{ ...entry("a", "added"), transport: "ws" } as never])],
    ["unknown hint", report([{ ...entry("a", "added"), hints: ["token"] } as never])],
    ["duplicate hint", report([entry("a", "added", ["macPath", "macPath"])])],
    ["duplicate name", report([entry("a", "added"), entry("a", "removed")])],
    ["control character name", report([entry("a\u0007b", "added")])],
    ["untrimmed name", report([entry(" a", "added")])],
    ["oversized name", report([entry("n".repeat(129), "added")])],
    ["entry value field", report([{ ...entry("a", "added"), env: { K: "V" } } as never])],
    ["missing hints", report([{ name: "a", transport: "stdio", outcome: "added" } as never])],
    [
      "too many results",
      report(Array.from({ length: 129 }, (_, index) => entry(`s${index}`, "unchanged"))),
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => parseRemoteRunnerMcpDeviceSyncReport(value)).toThrow(
      "Invalid MCP device sync report.",
    );
  });

  it("validates project kinds and local root paths", () => {
    expect(isRemoteMcpDeviceSyncProjectKind("folder")).toBe(true);
    expect(isRemoteMcpDeviceSyncProjectKind("git")).toBe(true);
    expect(isRemoteMcpDeviceSyncProjectKind("repository")).toBe(false);
    expect(isRemoteMcpDeviceSyncRootPath("/Users/me/project")).toBe(true);
    for (const path of ["", "/", "relative", "/a//b", "/a/../b", "/a/./b", "/a\\b", "/a\u0000b"])
      expect(isRemoteMcpDeviceSyncRootPath(path)).toBe(false);
    expect(isRemoteMcpDeviceSyncRootPath(`/${"x".repeat(4096)}`)).toBe(false);
  });
});

describe("MCP device sync notice", () => {
  it("stays silent when everything is unchanged", () => {
    expect(deviceMcpSyncNotice(report([]))).toBeNull();
    expect(deviceMcpSyncNotice(report([entry("a", "unchanged", ["mayNeedSignIn"])]))).toBeNull();
  });

  it("lists at most three names and counts the rest", () => {
    const names = ["a", "b", "c", "d", "e"];
    expect(deviceMcpSyncNotice(report(names.map((name) => entry(name, "added"))))).toBe(
      "Synced MCP servers from this Mac to the server: a, b, c and 2 more.",
    );
  });

  it("points installed servers that may need sign-in to Settings", () => {
    expect(
      deviceMcpSyncNotice(
        report([entry("linear", "updated", ["mayNeedSignIn"], "http"), entry("db", "unchanged")]),
      ),
    ).toBe(
      "Synced MCP servers from this Mac to the server: linear. Sign in on the server in Settings > MCP servers: linear.",
    );
  });

  it("explains every non-installed outcome truthfully", () => {
    const notice = deviceMcpSyncNotice(
      report([
        entry("gone", "removed", [], "unknown"),
        entry("tool", "commandMissing"),
        entry("bad", "failed"),
        entry("mine", "keptServerEntry"),
        entry("ws", "skipped", ["unsupportedTransport"], "unknown"),
        entry("broken", "skipped", ["invalidConfig"]),
        entry("extra", "skipped", ["overLimit"]),
        entry("twice", "conflict"),
      ]),
    );
    expect(notice).toBe(
      [
        "Removed synced MCP servers that are no longer on this Mac: gone.",
        "Not installed because the command is missing on the server: tool.",
        "Could not install on the server: bad.",
        "Kept the server's own settings for: mine.",
        "Not synced because their settings on this Mac are invalid: broken.",
        "Not synced because they cannot be transferred to the server: ws.",
        "Not synced because at most 32 MCP servers can be synced: extra.",
        "Not synced because nested folders define them differently: twice.",
      ].join(" "),
    );
  });

  it("warns about Mac paths and variable references only for installed servers", () => {
    expect(
      deviceMcpSyncNotice(
        report([
          entry("local", "added", ["macPath", "envExpansion"]),
          entry("same", "unchanged", ["macPath"]),
        ]),
      ),
    ).toBe(
      "Synced MCP servers from this Mac to the server: local. Uses a Mac path that may not exist on the server: local. Uses environment variable references the server must provide: local.",
    );
  });

  it("mentions names that could not be shown as a count", () => {
    expect(deviceMcpSyncNotice(report([], 1))).toBe(
      "The name of 1 more MCP server could not be shown.",
    );
    expect(deviceMcpSyncNotice(report([entry("a", "added")], 3))).toBe(
      "Synced MCP servers from this Mac to the server: a. Names of 3 more MCP servers could not be shown.",
    );
  });

  it("shortens long names and falls back to counts when the notice would be too long", () => {
    const long = "n".repeat(100);
    expect(deviceMcpSyncNotice(report([entry(long, "added")]))).toBe(
      `Synced MCP servers from this Mac to the server: ${"n".repeat(47)}….`,
    );
    const outcomes = [
      "added",
      "removed",
      "commandMissing",
      "failed",
      "keptServerEntry",
      "conflict",
    ];
    const many = outcomes.flatMap((outcome) =>
      ["a", "b", "c"].map((suffix) =>
        entry(
          `${outcome}-${suffix}-${"x".repeat(60)}`,
          outcome as RemoteMcpDeviceSyncResult["outcome"],
          ["mayNeedSignIn", "macPath", "envExpansion"],
        ),
      ),
    );
    const notice = deviceMcpSyncNotice(report(many, 2));
    expect(notice).toBe(
      "MCP server sync from this Mac reported changes for 18 MCP servers. Review them in Settings > MCP servers. Names of 2 more MCP servers could not be shown.",
    );
  });

  it("describes timeouts and failures without inventing outcomes", () => {
    expect(deviceMcpSyncFailureNotice({ kind: "timeout", seconds: 20 })).toBe(
      "MCP server sync from this Mac did not finish within 20 seconds. The conversation starts with the server's current MCP servers.",
    );
    expect(deviceMcpSyncFailureNotice({ kind: "failed", detail: "Too many MCP servers" })).toBe(
      "MCP servers from this Mac could not be synced to the server. Too many MCP servers. The conversation starts with the server's current MCP servers.",
    );
    expect(deviceMcpSyncFailureNotice({ kind: "failed", detail: "x".repeat(601) })).toBe(
      "MCP servers from this Mac could not be synced to the server. The conversation starts with the server's current MCP servers.",
    );
    expect(deviceMcpSyncFailureNotice({ kind: "failed", detail: "bad\u0000detail" })).toBe(
      "MCP servers from this Mac could not be synced to the server. The conversation starts with the server's current MCP servers.",
    );
  });

  it("hides only persistent states when asked and fingerprints them canonically", () => {
    const mixed = report(
      [
        entry("new", "added"),
        entry("bad", "failed"),
        entry("mine", "keptServerEntry"),
        entry("ws", "skipped", ["unsupportedTransport", "mayNeedSignIn"], "unknown"),
      ],
      1,
    );
    expect(deviceMcpSyncNotice(mixed, "hide")).toBe(
      "Synced MCP servers from this Mac to the server: new. Could not install on the server: bad.",
    );
    expect(deviceMcpSyncNotice(report([entry("mine", "keptServerEntry")], 2), "hide")).toBeNull();
    const reordered = report(
      [
        entry("ws", "skipped", ["mayNeedSignIn", "unsupportedTransport"], "unknown"),
        entry("mine", "keptServerEntry"),
        entry("other", "added"),
      ],
      1,
    );
    expect(deviceMcpSyncPersistentFingerprint(reordered)).toBe(
      deviceMcpSyncPersistentFingerprint(mixed),
    );
    expect(deviceMcpSyncPersistentFingerprint(report([entry("a", "added")]))).toBeNull();
    expect(deviceMcpSyncPersistentFingerprint(report([], 1))).not.toBeNull();
    expect(deviceMcpSyncPersistentFingerprint(report([entry("mine", "conflict")]))).not.toBe(
      deviceMcpSyncPersistentFingerprint(report([entry("mine", "keptServerEntry")])),
    );
  });
});
