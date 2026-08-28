import { describe, expect, it } from "vitest";
import { MAX_AGENT_TASK_PATH_BYTES, MAX_AGENT_TASK_WORKSPACE_ID_BYTES } from "./agentTask";
import {
  agentRootOwnerId,
  fnv1a64hex,
  MAX_AGENT_PROJECT_ROOTS,
  parseAgentRootLeaseReceipt,
  parseAgentRootLeaseReleaseResult,
  validateAgentRootLeaseAcquireRequest,
  validateAgentRootLeaseReleaseRequest,
} from "./agentProject";

const ENCODER = new TextEncoder();

describe("agent project domain", () => {
  it("pins the maximum project root count", () => {
    expect(MAX_AGENT_PROJECT_ROOTS).toBe(8);
  });

  it("matches the canonical FNV-1a 64-bit vectors", () => {
    expect(fnv1a64hex("")).toBe("cbf29ce484222325");
    expect(fnv1a64hex("a")).toBe("af63dc4c8601ec8c");
    expect(fnv1a64hex("foobar")).toBe("85944171f73967e8");
  });

  it("mints deterministic, distinct, bounded owner ids", () => {
    const ownerId = agentRootOwnerId("some/root/key");

    expect(ownerId).toMatch(/^agent-root:[0-9a-f]{16}$/);
    expect(agentRootOwnerId("some/root/key")).toBe(ownerId);
    expect(agentRootOwnerId("some/other/key")).not.toBe(ownerId);
    expect(ENCODER.encode(ownerId).byteLength).toBeLessThan(64);
    expect(ENCODER.encode(ownerId).byteLength).toBeLessThanOrEqual(
      MAX_AGENT_TASK_WORKSPACE_ID_BYTES,
    );
    expect(ownerId).not.toMatch(/\p{Cc}/u);
  });
});

describe("agent root lease validation", () => {
  it("validates acquire and release requests", () => {
    expect(validateAgentRootLeaseAcquireRequest({ rootPath: "/repo" })).toEqual({
      rootPath: "/repo",
    });
    expect(validateAgentRootLeaseReleaseRequest({ rootPath: "/repo", leaseToken: 7 })).toEqual({
      rootPath: "/repo",
      leaseToken: 7,
    });
    expect(
      validateAgentRootLeaseReleaseRequest({
        rootPath: "/repo",
        leaseToken: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({ rootPath: "/repo", leaseToken: Number.MAX_SAFE_INTEGER });
  });

  it("rejects malformed acquire requests", () => {
    const rejected: readonly unknown[] = [
      null,
      {},
      { rootPath: 1 },
      { rootPath: "" },
      { rootPath: "   " },
      { rootPath: "/repo\u0001" },
      { rootPath: "é".repeat(Math.floor(MAX_AGENT_TASK_PATH_BYTES / 2) + 1) },
      { rootPath: "/repo", extra: true },
    ];
    for (const value of rejected) {
      expect(() => validateAgentRootLeaseAcquireRequest(value)).toThrow(TypeError);
    }
  });

  it("rejects malformed release requests", () => {
    const rejected: readonly unknown[] = [
      {},
      { rootPath: "/repo" },
      { rootPath: "/repo", leaseToken: 0 },
      { rootPath: "/repo", leaseToken: -1 },
      { rootPath: "/repo", leaseToken: 1.5 },
      { rootPath: "/repo", leaseToken: Number.MAX_SAFE_INTEGER + 1 },
      { rootPath: "/repo", leaseToken: "1" },
      { rootPath: "/repo", leaseToken: 1, extra: true },
    ];
    for (const value of rejected) {
      expect(() => validateAgentRootLeaseReleaseRequest(value)).toThrow(TypeError);
    }
  });

  it("parses every exact root lease release disposition", () => {
    for (const kind of ["released", "notHeld", "foreignOwner"] as const) {
      expect(parseAgentRootLeaseReleaseResult({ kind, leaseToken: 7 })).toEqual({
        kind,
        leaseToken: 7,
      });
    }
    expect(
      parseAgentRootLeaseReleaseResult({
        kind: "released",
        leaseToken: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({ kind: "released", leaseToken: Number.MAX_SAFE_INTEGER });
  });

  it("rejects malformed root lease release results", () => {
    const rejected: readonly unknown[] = [
      null,
      {},
      { kind: "released" },
      { leaseToken: 7 },
      { kind: "unknown", leaseToken: 7 },
      { kind: "released", leaseToken: 0 },
      { kind: "released", leaseToken: -1 },
      { kind: "released", leaseToken: 1.5 },
      { kind: "released", leaseToken: "7" },
      { kind: "released", leaseToken: Number.MAX_SAFE_INTEGER + 1 },
      { kind: "released", leaseToken: 7, extra: true },
    ];
    for (const value of rejected) {
      expect(() => parseAgentRootLeaseReleaseResult(value)).toThrow(TypeError);
    }
  });

  it("parses only an exact positive safe lease token receipt", () => {
    expect(parseAgentRootLeaseReceipt({ leaseToken: Number.MAX_SAFE_INTEGER })).toEqual({
      leaseToken: Number.MAX_SAFE_INTEGER,
    });

    const rejected: readonly unknown[] = [
      null,
      {},
      { leaseToken: 0 },
      { leaseToken: -1 },
      { leaseToken: 1.5 },
      { leaseToken: "1" },
      { leaseToken: 1, extra: true },
    ];
    for (const value of rejected) {
      expect(() => parseAgentRootLeaseReceipt(value)).toThrow(TypeError);
    }
  });
});
