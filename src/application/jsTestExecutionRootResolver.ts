import type { JsTestExecutionAuthority } from "../domain/jsTestExecutionAuthority";
import { validatedJsTestExecutionAuthority } from "../domain/jsTestExecutionAuthority";
import type { JsTestRunScope } from "../domain/jsTestRunScope";
import { joinWorkspacePath, workspaceRelativePath } from "../domain/workspace";
import { detectJsTestRunnerContext, type WorkspaceFileReader } from "./jsTestRunnerDetection";

export interface JsTestExecutionRootResolver {
  (scope: JsTestRunScope): Promise<JsTestExecutionAuthority>;
  forGeneration?(): JsTestExecutionRootResolver;
}

const MAX_GENERATION_FILE_RECEIPTS = 20_000;

export function createJsTestExecutionRootResolver(
  workspaceRoot: string,
  readFileIfExists: WorkspaceFileReader,
): JsTestExecutionRootResolver {
  const resolver = resolverForReader(workspaceRoot, readFileIfExists);
  resolver.forGeneration = () =>
    resolverForReader(workspaceRoot, generationReader(readFileIfExists));
  return Object.freeze(resolver);
}

function resolverForReader(
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

function generationReader(reader: WorkspaceFileReader): WorkspaceFileReader {
  const receipts = new Map<string, Promise<string | null>>();
  return (path) => {
    const retained = receipts.get(path);
    if (retained) return retained;
    if (receipts.size >= MAX_GENERATION_FILE_RECEIPTS) {
      return Promise.reject(
        new Error("JavaScript test package planning exceeded its file receipt limit."),
      );
    }
    const pending = Promise.resolve().then(() => reader(path));
    receipts.set(path, pending);
    return pending;
  };
}
