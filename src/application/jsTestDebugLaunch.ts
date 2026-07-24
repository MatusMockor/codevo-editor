import type { DebugLaunchTarget } from "../domain/debug";
import type { JsTestDebugTarget } from "../domain/jsTestDebugScope";
import { joinWorkspacePath } from "../domain/workspace";
import {
  createConservativeWorkspaceRootFromPath,
  parseWorkspacePath,
} from "../domain/workspacePath";

/** Shared runner-neutral launch projection for Test Explorer and editor-cursor debug entry points. */
export function jsTestDebugLaunch(
  target: JsTestDebugTarget,
  workspaceRoot: string,
): DebugLaunchTarget {
  const root = createConservativeWorkspaceRootFromPath(workspaceRoot);
  if (!root.ok || !parseWorkspacePath(root.value, target.executionRoot).ok) {
    throw new TypeError("JavaScript test debug execution root must belong to the workspace.");
  }
  const filePath = joinWorkspacePath(workspaceRoot, target.scope.relativeFilePath);
  if (target.scope.kind === "file") {
    return {
      kind: "js-test-selection",
      runner: target.runner,
      filePath,
      packageRootPath: target.executionRoot,
      selection: { kind: "file" },
    };
  }
  if (target.scope.kind === "suite") {
    return {
      kind: "js-test-selection",
      runner: target.runner,
      filePath,
      packageRootPath: target.executionRoot,
      selection: { kind: "suite", fullName: target.scope.fullName },
    };
  }
  return {
    kind: "js-test-selection",
    runner: target.runner,
    filePath,
    packageRootPath: target.executionRoot,
    selection: {
      kind: "test",
      fullName: target.scope.fullName,
      nameMatch: target.namePattern?.match ?? "exact",
    },
  };
}
