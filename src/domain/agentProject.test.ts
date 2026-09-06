import { describe, expect, it } from "vitest";
import { MAX_AGENT_TASK_PATH_BYTES, MAX_AGENT_TASK_WORKSPACE_ID_BYTES } from "./agentTask";
import {
  agentProjectNestedRepositories,
  agentProjectOwnsLaunchRoot,
  agentProjectRootIsRepository,
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

describe("agent project launch roots", () => {
  const nested = {
    mapping: { rootRelativePath: "pa-ai-be" },
    repositoryRoot: "/projects/playablemaker/pa-ai-be",
    repositoryRelativePath: "",
  };
  const rootRepository = {
    mapping: { rootRelativePath: "" },
    repositoryRoot: "/projects/playablemaker",
    repositoryRelativePath: "",
  };

  it("always owns the project folder and every nested repository, nothing else", () => {
    const folder = { rootPath: "/projects/playablemaker", repositories: [nested] };
    expect(agentProjectOwnsLaunchRoot(folder, "/projects/playablemaker")).toBe(true);
    expect(agentProjectOwnsLaunchRoot(folder, nested.repositoryRoot)).toBe(true);
    expect(agentProjectOwnsLaunchRoot(folder, "/projects/playablemaker/mongo-init")).toBe(false);
    expect(agentProjectOwnsLaunchRoot(folder, "/projects/other")).toBe(false);
  });

  it("tells a repository root apart from a plain folder that only contains repositories", () => {
    expect(
      agentProjectRootIsRepository({ rootPath: "/projects/playablemaker", repositories: [nested] }),
    ).toBe(false);
    expect(
      agentProjectRootIsRepository({
        rootPath: "/projects/playablemaker",
        repositories: [rootRepository, nested],
      }),
    ).toBe(true);
    expect(agentProjectRootIsRepository({ rootPath: "/projects/empty", repositories: [] })).toBe(
      false,
    );
  });

  it("lists nested repositories without the project root itself", () => {
    expect(
      agentProjectNestedRepositories({
        rootPath: "/projects/playablemaker",
        repositories: [rootRepository, nested],
      }),
    ).toEqual([nested]);
    expect(
      agentProjectNestedRepositories({
        rootPath: "/projects/playablemaker",
        repositories: [rootRepository],
      }),
    ).toEqual([]);
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

  it("parses only an exact lease token and workspace identity receipt", () => {
    expect(
      parseAgentRootLeaseReceipt({
        leaseToken: Number.MAX_SAFE_INTEGER,
        workspaceId: "ws-agent-root",
      }),
    ).toEqual({
      leaseToken: Number.MAX_SAFE_INTEGER,
      workspaceId: "ws-agent-root",
    });

    const rejected: readonly unknown[] = [
      null,
      {},
      { leaseToken: 0 },
      { leaseToken: 1, workspaceId: "" },
      { leaseToken: -1 },
      { leaseToken: 1.5 },
      { leaseToken: "1" },
      { leaseToken: 1, workspaceId: "ws-agent-root", extra: true },
    ];
    for (const value of rejected) {
      expect(() => parseAgentRootLeaseReceipt(value)).toThrow(TypeError);
    }
  });
});
