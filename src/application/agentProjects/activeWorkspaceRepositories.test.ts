import { describe, expect, it } from "vitest";
import type { GitRepositoryStatus } from "../../domain/gitRepositoryMapping";
import { activeWorkspaceRepositories } from "./activeWorkspaceRepositories";

const ROOT_A = "/ws/a";
const ROOT_B = "/ws/b";
const ROOT_MAPPING = { rootRelativePath: "" };
const NESTED_MAPPING = { rootRelativePath: "nested" };

function nonRepositoryRootStatus(root: string): GitRepositoryStatus {
  return {
    mapping: ROOT_MAPPING,
    root,
    status: { branch: null, changes: [], isRepository: false, rootPath: root },
    failed: false,
  };
}

describe("active workspace repositories", () => {
  it("withholds the undiscovered fallback root mapping", () => {
    expect(
      activeWorkspaceRepositories({
        workspaceRoot: ROOT_A,
        discoveredRoot: null,
        mappings: [ROOT_MAPPING],
        statuses: [],
      }),
    ).toBeNull();
  });

  it("withholds mappings discovered for a different workspace root", () => {
    expect(
      activeWorkspaceRepositories({
        workspaceRoot: ROOT_B,
        discoveredRoot: ROOT_A,
        mappings: [ROOT_MAPPING, NESTED_MAPPING],
        statuses: [],
      }),
    ).toBeNull();
    expect(
      activeWorkspaceRepositories({
        workspaceRoot: null,
        discoveredRoot: null,
        mappings: [ROOT_MAPPING],
        statuses: [],
      }),
    ).toBeNull();
  });

  it("publishes discovered mappings for the exact active root and drops non-repository roots", () => {
    const repositories = activeWorkspaceRepositories({
      workspaceRoot: ROOT_A,
      discoveredRoot: `${ROOT_A}/`,
      mappings: [ROOT_MAPPING, NESTED_MAPPING],
      statuses: [nonRepositoryRootStatus(ROOT_A)],
    });
    expect(repositories?.map((repository) => repository.repositoryRoot)).toEqual([
      `${ROOT_A}/nested`,
    ]);
  });

  it("publishes an authoritative empty discovery result", () => {
    expect(
      activeWorkspaceRepositories({
        workspaceRoot: ROOT_A,
        discoveredRoot: ROOT_A,
        mappings: [],
        statuses: [],
      }),
    ).toEqual([]);
  });
});
