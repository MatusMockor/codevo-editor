import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRemoteAgentInventory } from "../application/remoteAgentInventoryLoad";
import type { RemoteRunnerDescriptor, RemoteRunnerGateway } from "./remoteRunner";
import { RemoteRunnerRequestRejectedError } from "./remoteRunnerErrors";
import {
  isRemoteRunnerReachable,
  MAX_REMOTE_RUNNER_FAILURE_REASON_LENGTH,
  NO_REMOTE_RUNNER_DESCRIPTOR_FOLLOW_UP,
  remoteRunnerDisconnected,
  remoteRunnerFailureReason,
  remoteRunnerNeedsDescriptorFollowUp,
  remoteRunnerReachability,
  remoteRunnerRefreshReachability,
  REMOTE_RUNNER_IDENTITY_CHANGED_PATTERN,
  REMOTE_RUNNER_REACHABLE,
  REMOTE_RUNNER_RECONNECTING,
  REMOTE_RUNNER_SERVER_NOT_CONNECTED_MESSAGE,
  type RemoteRunnerDescriptorFollowUp,
} from "./remoteRunnerReachability";

const REPLACED = remoteRunnerDisconnected("runnerReplaced");
const NOT_CONNECTED = remoteRunnerDisconnected("serverDisconnected");

const unanswered = (error: unknown, expectedRunnerId: string | null = "runner") =>
  remoteRunnerRefreshReachability({
    kind: "failed",
    error,
    expectedRunnerId,
    answeredRunnerId: null,
    followUp: NO_REMOTE_RUNNER_DESCRIPTOR_FOLLOW_UP,
  });

const answered = (
  followUp: RemoteRunnerDescriptorFollowUp,
  error: unknown = new Error("The runner returned invalid task history."),
  expectedRunnerId: string | null = "runner",
  answeredRunnerId = "runner",
) =>
  remoteRunnerRefreshReachability({
    kind: "failed",
    error,
    expectedRunnerId,
    answeredRunnerId,
    followUp,
  });

const rustSource = (name: string): string =>
  readFileSync(`${process.cwd()}/src-tauri/src/remote_runner/${name}`, "utf8");

describe("remote runner reachability", () => {
  it("reports a successful refresh as reachable", () => {
    expect(remoteRunnerRefreshReachability({ kind: "succeeded" })).toBe(REMOTE_RUNNER_REACHABLE);
    expect(isRemoteRunnerReachable(REMOTE_RUNNER_REACHABLE)).toBe(true);
  });

  it("treats a refresh the runner never answered as an outage the app retries", () => {
    expect(unanswered(new Error("The runner is unreachable."))).toBe(REMOTE_RUNNER_RECONNECTING);
    expect(unanswered("Runner connection failed. The request outcome may be unknown.")).toBe(
      REMOTE_RUNNER_RECONNECTING,
    );
    expect(unanswered("SSH tunnel authentication failed.")).toBe(REMOTE_RUNNER_RECONNECTING);
    expect(unanswered(new Error("Invalid remote runner getRunner response."))).toBe(
      REMOTE_RUNNER_RECONNECTING,
    );
    expect(unanswered(undefined, null)).toBe(REMOTE_RUNNER_RECONNECTING);
    expect(isRemoteRunnerReachable(REMOTE_RUNNER_RECONNECTING)).toBe(false);
  });

  it("keeps the runner reachable when it authoritatively rejected the descriptor request", () => {
    expect(
      unanswered(new RemoteRunnerRequestRejectedError("Runner request failed (HTTP 404).")),
    ).toBe(REMOTE_RUNNER_REACHABLE);
  });

  it("does not trust an earlier descriptor answer when the refresh failed afterwards", () => {
    expect(answered(NO_REMOTE_RUNNER_DESCRIPTOR_FOLLOW_UP)).toBe(REMOTE_RUNNER_RECONNECTING);
    expect(answered({ kind: "failed", error: new Error("The runner is unreachable.") })).toBe(
      REMOTE_RUNNER_RECONNECTING,
    );
    expect(answered({ kind: "failed", error: "Runner connection is closed." })).toBe(
      REMOTE_RUNNER_RECONNECTING,
    );
  });

  it("keeps the runner reachable when the follow-up descriptor request answers again", () => {
    expect(answered({ kind: "answered", runnerId: "runner" })).toBe(REMOTE_RUNNER_REACHABLE);
    expect(answered({ kind: "answered", runnerId: "runner" }, "anything", null)).toBe(
      REMOTE_RUNNER_REACHABLE,
    );
    expect(
      answered({
        kind: "failed",
        error: new RemoteRunnerRequestRejectedError("Runner request failed (HTTP 409)."),
      }),
    ).toBe(REMOTE_RUNNER_REACHABLE);
  });

  it("maps a replaced runner to a disconnected state instead of an endless retry", () => {
    expect(answered(NO_REMOTE_RUNNER_DESCRIPTOR_FOLLOW_UP, "anything", "runner", "other")).toBe(
      REPLACED,
    );
    expect(answered({ kind: "answered", runnerId: "other" })).toBe(REPLACED);
    expect(answered({ kind: "answered", runnerId: "other" }, "anything", null)).toBe(REPLACED);
    expect(
      answered({
        kind: "failed",
        error: "Runner identity changed. Reconnect the server before continuing.",
      }),
    ).toBe(REPLACED);
    expect(unanswered("Runner identity changed. Reconnect the server before continuing.")).toBe(
      REPLACED,
    );
    expect(REPLACED).toEqual({ kind: "disconnected", reason: "runnerReplaced" });
    expect(isRemoteRunnerReachable(REPLACED)).toBe(false);
  });

  it("maps a revoked native connection to a disconnected server", () => {
    expect(unanswered(REMOTE_RUNNER_SERVER_NOT_CONNECTED_MESSAGE)).toBe(NOT_CONNECTED);
    expect(answered({ kind: "failed", error: REMOTE_RUNNER_SERVER_NOT_CONNECTED_MESSAGE })).toBe(
      NOT_CONNECTED,
    );
  });

  it("lets a follow-up answer from the expected runner supersede an earlier disconnect text", () => {
    const notConnected = REMOTE_RUNNER_SERVER_NOT_CONNECTED_MESSAGE;
    expect(answered({ kind: "answered", runnerId: "runner" }, notConnected)).toBe(
      REMOTE_RUNNER_REACHABLE,
    );
    expect(answered({ kind: "answered", runnerId: "runner" }, notConnected, null)).toBe(
      REMOTE_RUNNER_REACHABLE,
    );
    expect(answered(NO_REMOTE_RUNNER_DESCRIPTOR_FOLLOW_UP, notConnected)).toBe(NOT_CONNECTED);
    expect(answered({ kind: "failed", error: new Error("offline") }, notConnected)).toBe(
      NOT_CONNECTED,
    );
    expect(answered({ kind: "answered", runnerId: "other" }, notConnected)).toBe(REPLACED);
  });

  it("does not classify an oversized message", () => {
    expect(unanswered(`Runner identity changed.${"x".repeat(1_000)}`)).toBe(
      REMOTE_RUNNER_RECONNECTING,
    );
  });

  it("asks for a follow-up only when an expected runner answered before the failure", () => {
    expect(remoteRunnerNeedsDescriptorFollowUp("runner", null)).toBe(false);
    expect(remoteRunnerNeedsDescriptorFollowUp(null, null)).toBe(false);
    expect(remoteRunnerNeedsDescriptorFollowUp("runner", "other")).toBe(false);
    expect(remoteRunnerNeedsDescriptorFollowUp("runner", "runner")).toBe(true);
    expect(remoteRunnerNeedsDescriptorFollowUp(null, "runner")).toBe(true);
  });

  it("returns the same frozen value for the same meaning", () => {
    expect(unanswered(new Error("offline"))).toBe(unanswered("offline again"));
    expect(remoteRunnerDisconnected("serverDisconnected")).toBe(NOT_CONNECTED);
    expect(Object.isFrozen(REMOTE_RUNNER_REACHABLE)).toBe(true);
    expect(Object.isFrozen(REMOTE_RUNNER_RECONNECTING)).toBe(true);
    expect(Object.isFrozen(REPLACED)).toBe(true);
    expect(Object.isFrozen(NO_REMOTE_RUNNER_DESCRIPTOR_FOLLOW_UP)).toBe(true);
  });

  it("derives the published state from the server registration and the last refresh", () => {
    const derive = (
      serverConnected: boolean,
      connectionCurrent: boolean,
      lastRefresh: Parameters<typeof remoteRunnerReachability>[0]["lastRefresh"],
    ) => remoteRunnerReachability({ serverConnected, connectionCurrent, lastRefresh });
    expect(derive(false, true, REMOTE_RUNNER_REACHABLE)).toBe(NOT_CONNECTED);
    expect(derive(true, false, REMOTE_RUNNER_REACHABLE)).toBe(REMOTE_RUNNER_RECONNECTING);
    expect(derive(true, true, null)).toBe(REMOTE_RUNNER_RECONNECTING);
    expect(derive(true, true, REMOTE_RUNNER_REACHABLE)).toBe(REMOTE_RUNNER_REACHABLE);
    expect(derive(true, true, REPLACED)).toBe(REPLACED);
  });
});

describe("remote runner failure reason", () => {
  it("keeps a short reason on one line", () => {
    expect(remoteRunnerFailureReason("SSH tunnel\n authentication   failed.")).toBe(
      "SSH tunnel authentication failed.",
    );
    expect(remoteRunnerFailureReason(new Error(" offline "))).toBe("offline");
  });

  it("has no reason for an error without text", () => {
    expect(remoteRunnerFailureReason(undefined)).toBeNull();
    expect(remoteRunnerFailureReason("   ")).toBeNull();
    expect(remoteRunnerFailureReason({ code: 1 })).toBeNull();
  });

  it("bounds a long reason and marks the cut", () => {
    const reason = remoteRunnerFailureReason("x".repeat(5_000));
    expect(reason).toHaveLength(MAX_REMOTE_RUNNER_FAILURE_REASON_LENGTH);
    expect(reason?.endsWith("…")).toBe(true);
  });
});

describe("error texts the reachability classification depends on", () => {
  const descriptor = (runnerId: string): RemoteRunnerDescriptor => ({
    protocolVersion: 1,
    runnerId,
    name: "Linux",
    capabilities: { taskExecution: true, eventReplay: true },
  });

  it("recognises the identity change the inventory loader reports", async () => {
    const gateway = {
      getRunner: async () => descriptor("replacement"),
    } as unknown as RemoteRunnerGateway;
    const previous = {
      serverId: "linux",
      listingCursor: 0,
      connected: true,
      descriptor: descriptor("runner"),
      projects: [],
      tasks: [],
      replays: new Map(),
      resumes: new Map(),
      replayComplete: new Set<string>(),
      replayTruncated: new Set<string>(),
      error: null,
    };
    const failure: unknown = await loadRemoteAgentInventory(gateway, previous, null, () => true)
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(unanswered(failure, null)).toBe(REPLACED);
  });

  it("recognises the identity change the native transport reports", () => {
    const literalsOf = (name: string): readonly string[] =>
      [...rustSource(name).matchAll(/"(Runner identity changed[^"]*)"/g)].map(
        (match) => match[1] ?? "",
      );
    const transport = literalsOf("tunnel_http.rs");
    const surfaces = literalsOf("surfaces.rs");

    expect(transport).toHaveLength(2);
    expect(surfaces).toHaveLength(1);
    for (const literal of [...transport, ...surfaces]) {
      expect(REMOTE_RUNNER_IDENTITY_CHANGED_PATTERN.test(literal)).toBe(true);
      expect(unanswered(literal)).toBe(REPLACED);
    }
  });

  it("recognises the revoked connection the native service reports", () => {
    expect(rustSource("service.rs")).toContain(
      `.ok_or("${REMOTE_RUNNER_SERVER_NOT_CONNECTED_MESSAGE}".into())`,
    );
  });
});
