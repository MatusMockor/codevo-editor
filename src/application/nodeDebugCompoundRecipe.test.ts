import { describe, expect, it } from "vitest";
import { cloneNodeDebugCompoundMembers } from "./nodeDebugCompoundRecipe";

describe("cloneNodeDebugCompoundMembers", () => {
  it("defensively deep-clones and freezes exact supported launch recipes", () => {
    const args = ["--watch"];
    const env = { PRIVATE_TOKEN: "original" };
    const source = [
      {
        launch: {
          args,
          env,
          justMyCode: "nodeInternalsAndDependencies" as const,
          kind: "node-configured-script" as const,
          scriptPath: "/workspace/api.ts",
          sourceMaps: false,
        },
        preLaunchTask: null,
      },
      {
        launch: {
          args: [],
          env: {},
          justMyCode: "dependencies" as const,
          kind: "node-npm-script" as const,
          packageRootPath: "/workspace",
          script: "worker",
        },
        preLaunchTask: null,
      },
    ];

    const cloned = cloneNodeDebugCompoundMembers(source);
    expect(cloned).not.toBeNull();
    args[0] = "--mutated";
    env.PRIVATE_TOKEN = "mutated";

    expect(cloned?.[0]?.launch).toMatchObject({
      args: ["--watch"],
      env: { PRIVATE_TOKEN: "original" },
      justMyCode: "nodeInternalsAndDependencies",
      sourceMaps: false,
    });
    expect(cloned?.[1]?.launch).toMatchObject({ justMyCode: "dependencies" });
    expect(Object.isFrozen(cloned)).toBe(true);
    expect(Object.isFrozen(cloned?.[0])).toBe(true);
    expect(Object.isFrozen(cloned?.[0]?.launch)).toBe(true);
    if (cloned?.[0] && "args" in cloned[0].launch) {
      expect(Object.isFrozen(cloned[0].launch.args)).toBe(true);
      expect(Object.isFrozen(cloned[0].launch.env)).toBe(true);
    }
  });

  it.each([
    {
      label: "attach",
      member: { launch: { kind: "node-attach" as const, port: 9229 }, preLaunchTask: null },
    },
    {
      label: "member pre-task",
      member: {
        launch: { kind: "node-script" as const, scriptPath: "/workspace/api.ts" },
        preLaunchTask: { label: "build" },
      },
    },
    {
      label: "member post-task",
      member: {
        launch: { kind: "node-script" as const, scriptPath: "/workspace/api.ts" },
        postDebugTask: { label: "cleanup" },
        preLaunchTask: null,
      },
    },
  ])("rejects $label recipes", ({ member }) => {
    expect(
      cloneNodeDebugCompoundMembers([
        member,
        {
          launch: { kind: "node-script", scriptPath: "/workspace/worker.ts" },
          preLaunchTask: null,
        },
      ]),
    ).toBeNull();
  });
});
