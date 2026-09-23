import { describe, expect, it } from "vitest";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import {
  isCurrentProjectOwner,
  isCurrentThreadLaunchAuthority,
  projectAuthority,
  taskLaunchAuthority,
} from "./agentProjectAuthority";

const ROOT = "/workspace/app";
const WORKSPACE = "ws-current";
const IDENTITY = { workspaceId: WORKSPACE, generation: 7 };

const project: AgentProjectDescriptor = {
  rootKey: ROOT,
  rootPath: ROOT,
  ownerId: WORKSPACE,
  runtimeOwnerIds: [WORKSPACE],
  label: "app",
  generation: 3,
  trust: "trusted",
  origin: "active-tab",
  repositories: [
    { repositoryRoot: ROOT, repositoryRelativePath: "", mapping: { rootRelativePath: "" } },
  ],
  isolationPolicy: "auto",
  leaseToken: null,
};

const projectsRef = {
  current: { projects: [project], launchIdentityForProject: () => IDENTITY },
};
const mounted = { current: true };

describe("launch authority stays strict for root-owned threads", () => {
  it("accepts the live workspace owner for project and thread launch authority", () => {
    expect(isCurrentProjectOwner(projectsRef, mounted, projectAuthority(project), ROOT)).toBe(true);
    expect(
      isCurrentThreadLaunchAuthority(projectsRef, mounted, taskLaunchAuthority(project, IDENTITY)),
    ).toBe(true);
  });

  it("refuses a root owner id until the thread is rebound to the workspace owner", () => {
    const rootOwner = agentRootOwnerId(ROOT);
    expect(
      isCurrentProjectOwner(projectsRef, mounted, projectAuthority(project, rootOwner), ROOT),
    ).toBe(false);
    expect(
      isCurrentThreadLaunchAuthority(projectsRef, mounted, {
        ...taskLaunchAuthority(project, IDENTITY),
        ownerId: rootOwner,
      }),
    ).toBe(false);
  });
});
