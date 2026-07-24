import {
  parseVscodeNodeLaunchConfigurations,
  VSCODE_NODE_LAUNCH_CONFIGURATION_MAX_BYTES,
  VSCODE_NODE_LAUNCH_CONFIGURATION_PATH,
  type VscodeNodeLaunchConfiguration,
  type VscodeNodeLaunchCompound,
  type VscodeNodeLaunchDiagnostic,
} from "../domain/vscodeNodeLaunchConfiguration";
import { joinWorkspacePath } from "../domain/workspace";
import type { NodeLaunchConfigurationReads } from "./nodeLaunchConfigurationLoader";

export type VscodeNodeLaunchConfigurationsLoadResult =
  | {
      readonly kind: "loaded";
      readonly configurations: readonly VscodeNodeLaunchConfiguration[];
      /** Private resolved compound metadata; never projected into `.codevo/launch.json`. */
      readonly compounds?: readonly VscodeNodeLaunchCompound[];
      readonly diagnostics: readonly VscodeNodeLaunchDiagnostic[];
    }
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "stale" };

/** Reads `.vscode/launch.json` as an optional read-only import source. */
export async function loadVscodeNodeLaunchConfigurations(
  workspaceRoot: string,
  reads: NodeLaunchConfigurationReads,
  isCurrent: () => boolean,
): Promise<VscodeNodeLaunchConfigurationsLoadResult> {
  if (!current(isCurrent)) return { kind: "stale" };
  const directoryPath = joinWorkspacePath(workspaceRoot, ".vscode");
  const filePath = joinWorkspacePath(directoryPath, "launch.json");
  let source: string;
  try {
    const root = await reads.readDirectory(workspaceRoot);
    if (!current(isCurrent)) return { kind: "stale" };
    if (!root.some(({ kind, name }) => kind === "directory" && name === ".vscode")) {
      return { kind: "none" };
    }
    const directory = await reads.readDirectory(directoryPath);
    if (!current(isCurrent)) return { kind: "stale" };
    if (!directory.some(({ kind, name }) => kind === "file" && name === "launch.json")) {
      return { kind: "none" };
    }
    if (reads.readFileBounded) {
      const bounded = await reads.readFileBounded(
        filePath,
        VSCODE_NODE_LAUNCH_CONFIGURATION_MAX_BYTES,
      );
      if (!current(isCurrent)) return { kind: "stale" };
      if (bounded.status === "tooLarge") return tooLarge();
      source = bounded.content;
    } else {
      source = await reads.readFile(filePath);
      if (!current(isCurrent)) return { kind: "stale" };
      if (
        new TextEncoder().encode(source).byteLength > VSCODE_NODE_LAUNCH_CONFIGURATION_MAX_BYTES
      ) {
        return tooLarge();
      }
    }
  } catch {
    return current(isCurrent)
      ? { kind: "invalid", message: `${VSCODE_NODE_LAUNCH_CONFIGURATION_PATH} could not be read.` }
      : { kind: "stale" };
  }
  const parsed = parseVscodeNodeLaunchConfigurations(source);
  if (!current(isCurrent)) return { kind: "stale" };
  return parsed.kind === "error"
    ? { kind: "invalid", message: parsed.message }
    : {
        kind: "loaded",
        configurations: parsed.configurations,
        ...(parsed.compounds ? { compounds: parsed.compounds } : {}),
        diagnostics: parsed.diagnostics,
      };
}

function current(isCurrent: () => boolean): boolean {
  try {
    return isCurrent();
  } catch {
    return false;
  }
}

function tooLarge(): VscodeNodeLaunchConfigurationsLoadResult {
  return {
    kind: "invalid",
    message: `${VSCODE_NODE_LAUNCH_CONFIGURATION_PATH} may be at most ${VSCODE_NODE_LAUNCH_CONFIGURATION_MAX_BYTES} UTF-8 bytes.`,
  };
}
