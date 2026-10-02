import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/remote-git-sync-wire.json";
import {
  REMOTE_GIT_ERROR_CODES,
  REMOTE_GIT_LIMITS,
  isRemoteGitBranchList,
  isRemoteGitBranchName,
  isRemoteGitCommitMessage,
  isRemoteGitRequest,
  remoteGitSyncWireChecks,
} from "./remoteGitSyncWire";

type WireCase = Readonly<{ name: string; value: unknown }>;
type WireSection = Readonly<{ accepted: readonly WireCase[]; rejected: readonly WireCase[] }>;
type GitSyncWireContract = Readonly<{
  schemaVersion: number;
  capability: string;
  errorCodes: readonly string[];
  sections: Readonly<Record<string, WireSection>>;
}>;

const contract = wireContract as unknown as GitSyncWireContract;
const sections = Object.entries(contract.sections);
const checkFor = (section: string) => {
  const check = remoteGitSyncWireChecks[section];
  expect(check).toBeDefined();
  return check ?? (() => false);
};
const acceptedCases = sections.flatMap(([section, cases]) =>
  cases.accepted.map((fixture) => [section, fixture.name, fixture.value] as const),
);
const rejectedCases = sections.flatMap(([section, cases]) =>
  cases.rejected.map((fixture) => [section, fixture.name, fixture.value] as const),
);
const branchList = (count: number) => ({
  defaultBranch: "main",
  checkoutBranch: null,
  fetchedAt: null,
  branches: Array.from({ length: count }, (_, index) => ({
    name: `feature/${index}`,
    sha: "3f786850e387550fdab836ed7e6dc881de23001b",
    committedAt: "2026-10-02T09:15:00Z",
  })),
  truncated: count >= REMOTE_GIT_LIMITS.branches,
});

describe("remote git sync wire contract", () => {
  it("pins the schema, capability and the closed error code set", () => {
    expect(contract.schemaVersion).toBe(1);
    expect(contract.capability).toBe("gitSync");
    expect(contract.errorCodes).toEqual([...REMOTE_GIT_ERROR_CODES]);
  });

  it("validates exactly the fixture sections", () => {
    expect(Object.keys(remoteGitSyncWireChecks).sort()).toEqual(
      Object.keys(contract.sections).sort(),
    );
    for (const [, cases] of sections) {
      expect(cases.accepted.length).toBeGreaterThan(0);
      expect(cases.rejected.length).toBeGreaterThan(0);
    }
  });

  it.each(acceptedCases)("%s accepts %s", (section, _name, value) => {
    expect(checkFor(section)(value)).toBe(true);
  });

  it.each(rejectedCases)("%s rejects %s", (section, _name, value) => {
    expect(checkFor(section)(value)).toBe(false);
  });

  it("bounds the branch list at the runner limit", () => {
    expect(isRemoteGitBranchList(branchList(REMOTE_GIT_LIMITS.branches))).toBe(true);
    expect(isRemoteGitBranchList(branchList(REMOTE_GIT_LIMITS.branches + 1))).toBe(false);
  });

  it("covers every editor git operation", () => {
    const accepted = contract.sections.editorGitRequest?.accepted ?? [];
    expect(accepted.every((fixture) => isRemoteGitRequest(fixture.value))).toBe(true);
    expect(
      new Set(accepted.map((fixture) => (fixture.value as { operation: string }).operation)),
    ).toEqual(
      new Set([
        "projectBranches",
        "projectFetch",
        "projectStatus",
        "projectUpdate",
        "threadStatus",
        "threadCommit",
        "threadPush",
        "operation",
      ]),
    );
  });

  it("rejects inherited operation names", () => {
    expect(
      isRemoteGitRequest({
        operation: "toString",
        serverId: "linux",
        runnerId: "linux-runner",
      }),
    ).toBe(false);
  });

  it("rejects lone surrogates that cannot cross the Rust boundary", () => {
    expect(isRemoteGitBranchName("feature/\ud800")).toBe(false);
    expect(isRemoteGitCommitMessage("Fix \udfff")).toBe(false);
    expect(isRemoteGitCommitMessage("Fix \u{1F600}")).toBe(true);
    expect(
      isRemoteGitRequest({
        operation: "projectStatus",
        serverId: "linux",
        runnerId: "linux\ud800",
        projectId: "storefront",
      }),
    ).toBe(false);
  });
});
