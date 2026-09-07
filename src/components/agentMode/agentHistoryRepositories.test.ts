import { expect, it } from "vitest";
import { agentHistoryRepositories } from "./agentHistoryRepositories";
import { agentGitHistoryScope } from "./agentGitHistoryTarget";
import { projectFixture } from "./agentThreadsSurfaceTestFixtures";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import type { AgentSurfaceScope } from "./agentSurfacePolicy";

const base = projectFixture();
const project = {
  ...base,
  repositories: ["packages/api", "packages/web"].map((relative) => ({
    repositoryRoot: `${base.rootPath}/${relative}`,
    repositoryRelativePath: "",
    mapping: { rootRelativePath: relative },
  })),
};
const scope: AgentSurfaceScope = {
  kind: "repository",
  projectRootKey: project.rootKey,
  rootPath: project.rootPath,
  repositoryRoot: project.rootPath,
  ownerId: project.ownerId,
  generation: project.generation,
};
const target = agentGitHistoryScope([project], null, scope, project.rootPath, true, null);

it("offers discovered sibling repositories before loading a parent directory", () => {
  const model = agentHistoryRepositories([project], null, scope, target);
  expect(model?.defaultValue).toBe("root:choose");
  expect(model?.options.map((option) => [option.label, option.description])).toEqual([
    ["Choose a repository", project.label],
    ["api", "packages/api"],
    ["web", "packages/web"],
  ]);
  expect(model?.options[1]?.scope).toMatchObject({
    kind: "available",
    target: { rootPath: `${project.rootPath}/packages/api` },
  });
});

it("defaults a root repository or the sole nested repository", () => {
  expect(agentHistoryRepositories([base], null, scope, target)?.defaultValue).toBe(
    `root:${base.rootPath}`,
  );
  expect(
    agentHistoryRepositories(
      [{ ...project, repositories: project.repositories.slice(0, 1) }],
      null,
      scope,
      target,
    )?.defaultValue,
  ).toBe(`root:${project.repositories[0]?.repositoryRoot}`);
});

it("keeps the thread checkout separate from repository choices", () => {
  const thread = surfaceThreadView();
  const threadScope = agentGitHistoryScope([base], thread, scope, base.rootPath, true, null);
  const model = agentHistoryRepositories([base], thread, scope, threadScope);
  expect(model?.defaultValue).toBe("root:checkout");
  expect(model?.options[0]?.scope).toEqual(threadScope);
  expect(model?.options[1]?.scope).toMatchObject({ target: { rootPath: base.rootPath } });
});

it("fails closed for stale ownership and excludes foreign discovered roots", () => {
  const replacement = { ...project, generation: project.generation + 1 };
  const stale = agentGitHistoryScope([replacement], null, scope, project.rootPath, true, null);
  expect(agentHistoryRepositories([replacement], null, scope, stale)).toBeNull();
  const foreign = {
    repositoryRoot: "/other/repo",
    repositoryRelativePath: "",
    mapping: { rootRelativePath: "../other/repo" },
  };
  expect(
    agentHistoryRepositories([{ ...project, repositories: [foreign] }], null, scope, target),
  ).toBeNull();
});

it("invalidates selection identity after owner generation or repository removal", () => {
  const first = agentHistoryRepositories([project], null, scope, target);
  const nextProject = { ...project, generation: project.generation + 1 };
  const nextScope = { ...scope, generation: nextProject.generation };
  const nextTarget = agentGitHistoryScope(
    [nextProject],
    null,
    nextScope,
    project.rootPath,
    true,
    null,
  );
  expect(agentHistoryRepositories([nextProject], null, nextScope, nextTarget)?.identity).not.toBe(
    first?.identity,
  );
  expect(
    agentHistoryRepositories(
      [{ ...project, repositories: project.repositories.slice(1) }],
      null,
      scope,
      target,
    )?.identity,
  ).not.toBe(first?.identity);
});
