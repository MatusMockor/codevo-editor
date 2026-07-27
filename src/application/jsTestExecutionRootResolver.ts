import type { JsTestExecutionAuthority } from "../domain/jsTestExecutionAuthority";
import { validatedJsTestExecutionAuthority } from "../domain/jsTestExecutionAuthority";
import type { JsTestRunScope } from "../domain/jsTestRunScope";
import { joinWorkspacePath, workspaceRelativePath } from "../domain/workspace";
import { detectJsTestRunnerContext, type WorkspaceFileReader } from "./jsTestRunnerDetection";

export type JsTestExecutionRootResolver = (
  scope: JsTestRunScope,
) => Promise<JsTestExecutionAuthority>;

export function createJsTestExecutionRootResolver(
  workspaceRoot: string,
  readFileIfExists: WorkspaceFileReader,
): JsTestExecutionRootResolver {
  return async (scope) => {
    const target =
      scope.kind === "all" ? null : joinWorkspacePath(workspaceRoot, scope.relativeFilePath);
    const context = await detectJsTestRunnerContext(workspaceRoot, readFileIfExists, target);
    const packageRootRelativePath = context
      ? workspaceRelativePath(workspaceRoot, context.rootPath)
      : "";
    return validatedJsTestExecutionAuthority({
      packageRootRelativePath: packageRootRelativePath ?? "",
    });
  };
}
