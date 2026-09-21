import { expect, it } from "vitest";
import { matchingCloneProjectKey } from "./remoteAddProjectPendingClone";

it("requires the captured runner identity even when a replacement has the same project id", () => {
  const projects = [{ key: "remote:server:new-runner:project", label: "Project" }];
  expect(matchingCloneProjectKey(projects, "server", "old-runner", "project")).toBeUndefined();
  expect(matchingCloneProjectKey(projects, "server", null, "project")).toBeUndefined();
  expect(matchingCloneProjectKey(projects, "server", "new-runner", "project")).toBe(
    projects[0].key,
  );
});
