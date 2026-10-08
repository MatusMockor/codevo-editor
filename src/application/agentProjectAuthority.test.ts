import { describe, expect, it } from "vitest";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import {
  agentLaunchReplacedBeforeSendNotice,
  agentNoticeForProject,
  isCurrentProjectOwner,
  launchAuthorityHolds,
  isCurrentThreadLaunchAuthority,
  projectAuthority,
  taskLaunchAuthority,
} from "./agentProjectAuthority";
import type { AgentTasksNotice } from "./agentThreadPorts";

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

describe("replaced launch root notice", () => {
  const refusal = agentLaunchReplacedBeforeSendNotice("workspaceReplaced", ROOT);
  const other = { kind: "warning", message: "Other", action: null } as const;
  const publishFor = (
    origin: AgentProjectDescriptor["origin"],
    slot: AgentTasksNotice | null = null,
  ) => {
    let notice = slot;
    const held = launchAuthorityHolds(
      {
        current: {
          projects: [{ ...project, origin }],
          launchIdentityForProject: () => IDENTITY,
          setNotice: (update) => {
            notice = typeof update === "function" ? update(notice) : update;
          },
        },
      },
      "workspaceReplaced",
      ROOT,
    );
    return { held, notice };
  };

  it("is published into an empty slot for the project the surface is showing", () => {
    expect(publishFor("active-tab")).toEqual({ held: false, notice: refusal });
  });

  it("replaces an earlier refusal of the same project", () => {
    const earlier = agentLaunchReplacedBeforeSendNotice("projectReopened", ROOT);
    expect(publishFor("active-tab", earlier)).toEqual({ held: false, notice: refusal });
  });

  it.each([
    ["another operation's notice", other],
    ["another project's refusal", agentLaunchReplacedBeforeSendNotice("workspaceReplaced", "/b")],
  ] as const)("never replaces %s", (_label, slot) => {
    expect(publishFor("active-tab", slot)).toEqual({ held: false, notice: slot });
  });

  it.each(["background-tab", "closed-tab-live-tasks"] as const)(
    "is not published once its project is a %s",
    (origin) => {
      expect(publishFor(origin)).toEqual({ held: false, notice: null });
    },
  );

  it("is shown only while its own project is selected", () => {
    expect(agentNoticeForProject(refusal, ROOT)).toBe(refusal);
    expect(agentNoticeForProject(refusal, "/workspace/other")).toBeNull();
    expect(agentNoticeForProject(refusal, null)).toBeNull();
    expect(agentNoticeForProject(other, "/workspace/other")).toBe(other);
  });
});
