import { describe, expect, it } from "vitest";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { projectFixture } from "./agentThreadsSurfaceTestFixtures";
import { agentProjectWorkspaceTabRoot } from "./agentProjectWorkspaceTab";

function project(
  rootKey: string,
  origin: AgentProjectDescriptor["origin"] = "background-tab",
): AgentProjectDescriptor {
  return projectFixture({ rootKey, rootPath: rootKey, origin });
}

describe("agentProjectWorkspaceTabRoot", () => {
  const projects = [
    project("/workspace/editor", "active-tab"),
    project("/workspace/crm"),
    project("/workspace/editor-copy"),
    project("/workspace/closed", "closed-tab-live-tasks"),
    projectFixture({
      rootKey: "remote:srv:/srv/api",
      rootPath: "/srv/api",
      origin: "background-tab",
    }),
  ];

  it("returns the root of a background workspace tab", () => {
    expect(agentProjectWorkspaceTabRoot(projects, "/workspace/crm")).toBe("/workspace/crm");
  });

  it("does nothing for the current tab, closed tabs, remote and unknown projects", () => {
    expect(agentProjectWorkspaceTabRoot(projects, "/workspace/editor")).toBeNull();
    expect(agentProjectWorkspaceTabRoot(projects, "/workspace/closed")).toBeNull();
    expect(agentProjectWorkspaceTabRoot(projects, "remote:srv:/srv/api")).toBeNull();
    expect(agentProjectWorkspaceTabRoot(projects, "/workspace/gone")).toBeNull();
  });

  it("keeps the editor on its tab when a linked group already contains the current tab", () => {
    expect(
      agentProjectWorkspaceTabRoot(projects, "/workspace/editor-copy", ["/workspace/editor"]),
    ).toBeNull();
  });
});
