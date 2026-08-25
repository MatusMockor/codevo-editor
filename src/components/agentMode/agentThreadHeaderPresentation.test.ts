import { describe, expect, it } from "vitest";
import {
  agentRevealRootForPath,
  MAX_AGENT_REVEAL_PATH_BYTES,
} from "./agentThreadHeaderPresentation";

const ROOTS = ["/workspace/app", "/workspace/api"];

describe("agentRevealRootForPath", () => {
  it("resolves the owning root for a worktree path", () => {
    expect(agentRevealRootForPath("/workspace/app/.worktrees/agt-1", ROOTS)).toBe("/workspace/app");
  });

  it("resolves the root itself", () => {
    expect(agentRevealRootForPath("/workspace/api", ROOTS)).toBe("/workspace/api");
  });

  it("prefers the longest matching root for nested project roots", () => {
    expect(
      agentRevealRootForPath("/workspace/app/packages/web/src", [...ROOTS, "/workspace"]),
    ).toBe("/workspace/app");
  });

  it("rejects a sibling directory sharing a prefix", () => {
    expect(agentRevealRootForPath("/workspace/app-docs/readme.md", ROOTS)).toBeNull();
  });

  it("rejects a path outside every root", () => {
    expect(agentRevealRootForPath("/etc/passwd", ROOTS)).toBeNull();
    expect(agentRevealRootForPath("", ROOTS)).toBeNull();
    expect(agentRevealRootForPath("/workspace/app/x", [])).toBeNull();
  });

  it("rejects an unbounded path and a NUL byte", () => {
    const long = `/workspace/app/${"a".repeat(MAX_AGENT_REVEAL_PATH_BYTES)}`;
    expect(agentRevealRootForPath(long, ROOTS)).toBeNull();
    expect(agentRevealRootForPath("/workspace/app/\u0000etc", ROOTS)).toBeNull();
  });
});
