import { describe, expect, it } from "vitest";
import {
  createJsTestDebugTarget,
  validatedJsTestDebugScope,
} from "../domain/jsTestDebugScope";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { jsTestDebugLaunch } from "./jsTestDebugLaunch";

describe("jsTestDebugLaunch", () => {
  it("derives the file path from the validated scope and workspace root", () => {
    const target = createJsTestDebugTarget(
      createWorkspaceRuntimeOwner("owner", "/workspace/packages/api"),
      "jest",
      validatedJsTestDebugScope({
        kind: "test",
        relativeFilePath: "packages/api/src/cart.test.ts",
        fullName: "cart charges",
      }),
    );

    expect(jsTestDebugLaunch(target, "/workspace")).toMatchObject({
      filePath: "/workspace/packages/api/src/cart.test.ts",
      packageRootPath: "/workspace/packages/api",
    });
  });

  it("rejects an execution root outside the supplied workspace", () => {
    const target = createJsTestDebugTarget(
      createWorkspaceRuntimeOwner("owner", "/other"),
      "vitest",
      validatedJsTestDebugScope({ kind: "file", relativeFilePath: "src/cart.test.ts" }),
    );

    expect(() => jsTestDebugLaunch(target, "/workspace")).toThrow(/execution root/u);
  });

  it.each([
    {
      expected: "C:/workspace/packages/api/src/cart.test.ts",
      executionRoot: "C:\\workspace\\packages\\api",
      workspaceRoot: "C:\\workspace",
    },
    {
      expected: "//server/share/workspace/packages/api/src/cart.test.ts",
      executionRoot: "\\\\server\\share\\workspace\\packages\\api",
      workspaceRoot: "\\\\server\\share\\workspace",
    },
  ])("accepts contained native $workspaceRoot roots", ({ expected, executionRoot, workspaceRoot }) => {
    const target = createJsTestDebugTarget(
      createWorkspaceRuntimeOwner("owner", executionRoot),
      "jest",
      validatedJsTestDebugScope({
        kind: "test",
        relativeFilePath: "packages/api/src/cart.test.ts",
        fullName: "cart charges",
      }),
    );

    expect(jsTestDebugLaunch(target, workspaceRoot)).toMatchObject({ filePath: expected });
  });

  it.each([
    {
      executionRoot: "c:\\WORKSPACE\\Packages\\API",
      workspaceRoot: "C:\\workspace",
    },
    {
      executionRoot: "\\\\server\\SHARE\\Workspace\\Packages\\API",
      workspaceRoot: "\\\\SERVER\\share\\workspace",
    },
  ])(
    "accepts case aliases within conservative Windows/UNC root $workspaceRoot",
    ({ executionRoot, workspaceRoot }) => {
      const target = createJsTestDebugTarget(
        createWorkspaceRuntimeOwner("owner", executionRoot),
        "jest",
        validatedJsTestDebugScope({
          kind: "file",
          relativeFilePath: "packages/api/src/cart.test.ts",
        }),
      );

      expect(() => jsTestDebugLaunch(target, workspaceRoot)).not.toThrow();
    },
  );

  it.each([
    ["C:\\workspace", "D:\\workspace\\packages\\api"],
    ["\\\\server\\share\\workspace", "\\\\other\\share\\workspace\\packages\\api"],
    ["\\\\server\\share\\workspace", "\\\\server\\other\\workspace\\packages\\api"],
  ])("rejects cross-root native aliases %s -> %s", (workspaceRoot, executionRoot) => {
    const target = createJsTestDebugTarget(
      createWorkspaceRuntimeOwner("owner", executionRoot),
      "vitest",
      validatedJsTestDebugScope({ kind: "file", relativeFilePath: "src/cart.test.ts" }),
    );

    expect(() => jsTestDebugLaunch(target, workspaceRoot)).toThrow(/execution root/u);
  });
});
