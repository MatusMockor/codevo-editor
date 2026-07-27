import { describe, expect, it } from "vitest";
import {
  MAX_NODE_DEBUG_COMPOUND_MEMBERS,
  MIN_NODE_DEBUG_COMPOUND_MEMBERS,
} from "./nodeDebugCompoundSessionCoordinator";
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
          stopOnEntry: true,
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
      stopOnEntry: true,
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

  it("accepts and freezes exactly eight members while rejecting nine", () => {
    const eight = Array.from({ length: MAX_NODE_DEBUG_COMPOUND_MEMBERS }, (_, index) => ({
      launch: {
        kind: "node-script" as const,
        scriptPath: `/workspace/service-${index}.ts`,
      },
      preLaunchTask: null,
    }));

    const cloned = cloneNodeDebugCompoundMembers(eight);

    expect(cloned).toHaveLength(MAX_NODE_DEBUG_COMPOUND_MEMBERS);
    expect(cloned).not.toBe(eight);
    expect(Object.isFrozen(cloned)).toBe(true);
    expect(cloned?.every((member) => Object.isFrozen(member))).toBe(true);
    expect(cloned?.every((member) => Object.isFrozen(member.launch))).toBe(true);
    expect(cloneNodeDebugCompoundMembers([...eight, eight[0]!])).toBeNull();
    expect(
      cloneNodeDebugCompoundMembers(eight.slice(0, MIN_NODE_DEBUG_COMPOUND_MEMBERS - 1)),
    ).toBeNull();
  });

  it.each([null, "true", 1])(
    "rejects malformed stopOnEntry value %# in a compound member",
    (stopOnEntry) => {
      expect(
        cloneNodeDebugCompoundMembers([
          {
            launch: {
              kind: "node-script",
              scriptPath: "/workspace/api.ts",
              stopOnEntry,
            },
            preLaunchTask: null,
          },
          {
            launch: { kind: "node-script", scriptPath: "/workspace/worker.ts" },
            preLaunchTask: null,
          },
        ] as never),
      ).toBeNull();
    },
  );

  it.each([
    {
      launch: {
        kind: "node-script" as const,
        scriptPath: "/workspace/api.js",
        stopOnEntry: false,
      },
    },
    {
      launch: {
        args: [],
        env: {},
        kind: "node-npm-script" as const,
        packageRootPath: "/workspace",
        script: "worker",
        stopOnEntry: true,
      },
    },
  ])("preserves stopOnEntry for the $launch.kind compound member", ({ launch }) => {
    const cloned = cloneNodeDebugCompoundMembers([
      { launch, preLaunchTask: null },
      {
        launch: { kind: "node-script", scriptPath: "/workspace/worker.ts" },
        preLaunchTask: null,
      },
    ]);

    expect(cloned?.[0]?.launch).toMatchObject({ stopOnEntry: launch.stopOnEntry });
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
