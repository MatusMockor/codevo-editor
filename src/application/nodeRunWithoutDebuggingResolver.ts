import type { NodeRunTarget } from "../domain/nodeRunTask";
import { toNodeRunTarget } from "../domain/nodeRunTask";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import { detectJsTestRunnerContext } from "./jsTestRunnerDetection";
import { loadConfiguredNodeLaunch } from "./nodeLaunchConfigurationLoader";
import { boundedNodeDebugConfigurationMessage } from "./useNodeDebugConfigurationLauncher";
import { isDebuggableNodeScriptPath } from "./workbenchDebugCommands";

export type NodeRunTargetResolution =
  | { readonly kind: "target"; readonly target: NodeRunTarget }
  | { readonly kind: "warning"; readonly message: string }
  | { readonly kind: "stale" };

/** Resolves one saved active document to a structured backend target, never a shell string. */
export async function resolveNodeRunWithoutDebuggingTarget({
  document,
  isActiveDocumentJsTest,
  isCurrent,
  readFileIfExists,
  workspaceFiles,
  workspaceRoot,
}: {
  readonly document: EditorDocument;
  readonly isActiveDocumentJsTest: boolean;
  readonly isCurrent: () => boolean;
  readonly readFileIfExists: (path: string) => Promise<string | null>;
  readonly workspaceFiles: Pick<
    WorkspaceFileGateway,
    "readDirectory" | "readTextFile" | "readTextFileBounded"
  >;
  readonly workspaceRoot: string;
}): Promise<NodeRunTargetResolution> {
  const configured = await loadConfiguredNodeLaunch({
    documentPath: document.path,
    isCurrent,
    readDirectory: workspaceFiles.readDirectory,
    readFile: workspaceFiles.readTextFile,
    readFileBounded: workspaceFiles.readTextFileBounded,
    workspaceRoot,
  });
  if (configured.kind === "stale") return { kind: "stale" };
  if (configured.kind === "invalid") {
    return {
      kind: "warning",
      message: boundedNodeDebugConfigurationMessage(`Run: ${configured.message}`),
    };
  }
  if (configured.kind === "configured") {
    if (debugLaunchEnablesInspector(configured.launch)) {
      return {
        kind: "warning",
        message: "Run Without Debugging does not accept --inspect options.",
      };
    }
    let target: NodeRunTarget | null;
    try {
      target = toNodeRunTarget(configured.launch);
    } catch {
      return {
        kind: "warning",
        message: "Run Without Debugging configuration contains unsupported options.",
      };
    }
    if (!target) {
      return {
        kind: "warning",
        message: "Run Without Debugging cannot run attach, PHP, or test-selection configurations.",
      };
    }
    return { kind: "target", target };
  }
  if (!isCurrent()) return { kind: "stale" };
  if (!isDebuggableNodeScriptPath(document.path)) {
    return {
      kind: "warning",
      message: "Run Without Debugging requires a JavaScript or TypeScript file.",
    };
  }
  if (!isActiveDocumentJsTest) {
    return { kind: "target", target: { kind: "node-script", scriptPath: document.path } };
  }
  const guardedReadFileIfExists = async (path: string) => {
    if (!isCurrent()) return null;
    const content = await readFileIfExists(path);
    return isCurrent() ? content : null;
  };
  const runner = await detectJsTestRunnerContext(
    workspaceRoot,
    guardedReadFileIfExists,
    document.path,
  );
  if (!isCurrent()) return { kind: "stale" };
  if (!runner) {
    return {
      kind: "warning",
      message: "No Vitest or Jest runner was found for the active test file.",
    };
  }
  return {
    kind: "target",
    target: {
      filePath: document.path,
      kind: "js-test-file",
      packageRootPath: runner.rootPath,
      runner: runner.runner,
    },
  };
}

function debugLaunchEnablesInspector(launch: Parameters<typeof toNodeRunTarget>[0]): boolean {
  if (
    launch.kind !== "node-configured-script" &&
    launch.kind !== "js-configured-test" &&
    launch.kind !== "node-npm-script"
  )
    return false;
  return launch.args.some((argument) => /^--inspect(?:-brk|-port)?(?:=|$)/.test(argument));
}
