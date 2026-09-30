import { describe, expect, it } from "vitest";
import type { GitRepositoryStatus } from "../../domain/gitRepositoryMapping";
import {
  NO_LIVE_CHECKOUT_BRANCHES,
  agentLiveCheckoutBranch,
  agentLiveCheckoutBranches,
} from "./agentLiveCheckoutBranch";

function status(root: string, branch: string | null, failed = false): GitRepositoryStatus {
  return {
    mapping: { rootRelativePath: "" },
    root,
    failed,
    status: { branch, changes: [], isRepository: true, rootPath: root },
  };
}

describe("agentLiveCheckoutBranch", () => {
  it("reads the live branch of the exact repository root", () => {
    const live = agentLiveCheckoutBranches([status("/repo", "main"), status("/other", "dev")]);
    expect(agentLiveCheckoutBranch(live, "/repo")).toBe("main");
    expect(agentLiveCheckoutBranch(live, "/repo/")).toBeNull();
    expect(agentLiveCheckoutBranch(live, "/unknown")).toBeNull();
    expect(agentLiveCheckoutBranch(live, null)).toBeNull();
  });

  it("ignores repositories whose status could not be read", () => {
    const live = agentLiveCheckoutBranches([status("/repo", "main", true)]);
    expect(live).toBe(NO_LIVE_CHECKOUT_BRANCHES);
    expect(agentLiveCheckoutBranch(live, "/repo")).toBeNull();
  });

  it("reports a detached checkout as no branch", () => {
    const live = agentLiveCheckoutBranches([status("/repo", null)]);
    expect(agentLiveCheckoutBranch(live, "/repo")).toBeNull();
  });
});
