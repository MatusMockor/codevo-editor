import { describe, expect, it } from "vitest";
import type { VscodeProcessTaskDisplay } from "./vscodeProcessTasks";
import { vscodeProcessTaskDependencyPlan } from "./vscodeProcessTaskDependencyPlan";

describe("vscodeProcessTaskDependencyPlan", () => {
  it("orders dependencies before their parent and preserves declaration order", () => {
    const plan = vscodeProcessTaskDependencyPlan(
      [
        task("Build", ["Generate", "Lint"]),
        task("Lint", ["Types"]),
        task("Generate"),
        task("Types"),
      ],
      "Build",
    );

    expect(plan).toEqual(["Generate", "Types", "Lint", "Build"]);
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it("includes a shared dependency exactly once", () => {
    expect(
      vscodeProcessTaskDependencyPlan(
        [
          task("All", ["Client", "Server"]),
          task("Client", ["Generate"]),
          task("Server", ["Generate"]),
          task("Generate"),
        ],
        "All",
      ),
    ).toEqual(["Generate", "Client", "Server", "All"]);
  });

  it.each([
    { name: "missing root", tasks: [task("Build")], root: "Missing" },
    { name: "missing dependency", tasks: [task("Build", ["Missing"])], root: "Build" },
    { name: "self-cycle", tasks: [task("Build", ["Build"])], root: "Build" },
    {
      name: "transitive cycle",
      tasks: [task("Build", ["Test"]), task("Test", ["Build"])],
      root: "Build",
    },
    { name: "duplicate labels", tasks: [task("Build"), task("Build")], root: "Build" },
    {
      name: "duplicate dependency",
      tasks: [task("Build", ["Lint", "Lint"]), task("Lint")],
      root: "Build",
    },
    {
      name: "non-executable dependency",
      tasks: [task("Build", ["Shell"]), task("Shell", [], false)],
      root: "Build",
    },
  ])("fails closed for $name", ({ tasks, root }) => {
    expect(vscodeProcessTaskDependencyPlan(tasks, root)).toBeNull();
  });

  it("does not mutate or freeze caller-owned task metadata", () => {
    const dependencies = ["Generate"];
    const tasks = [task("Build", dependencies), task("Generate")];

    expect(vscodeProcessTaskDependencyPlan(tasks, "Build")).toEqual(["Generate", "Build"]);
    expect(Object.isFrozen(tasks)).toBe(false);
    expect(Object.isFrozen(dependencies)).toBe(false);
  });
});

function task(
  label: string,
  dependsOn: readonly string[] = [],
  executable = true,
): VscodeProcessTaskDisplay {
  return {
    label,
    detail: null,
    group: "none",
    source: ".vscode/tasks.json",
    executable,
    dependsOn,
  };
}
