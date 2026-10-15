import { describe, expect, it } from "vitest";
import { agentBranchCheckoutBlockedReason as reason } from "./agentBranchCheckoutPolicy";

describe("agent working branch checkout", () => {
  it("does not block a sibling repository or a separate worktree", () => {
    expect(
      reason("/projects/app-copy", [{ rootPath: "/projects/app", running: true }], false),
    ).toBeNull();
    expect(
      reason("/worktrees/app", [{ rootPath: "/projects/app", running: true }], false),
    ).toBeNull();
  });
  it("blocks active agents sharing this checkout, including another thread", () => {
    expect(
      reason("/projects/app", [{ rootPath: "/projects/app", running: true }], false),
    ).toContain("Stop the agent");
    expect(
      reason("/projects/app", [{ rootPath: "/projects/app", running: false }], false),
    ).toBeNull();
  });
  it("fails closed while dispatch state is unsettled", () => {
    expect(reason("/projects/app", [], true)).not.toBeNull();
  });
});
