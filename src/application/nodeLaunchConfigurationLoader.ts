import type { DebugLaunchTarget } from "../domain/debug";
import type { NodeDebugJustMyCodePolicy } from "../domain/nodeDebugJustMyCode";
import {
  configuredNodeLaunchConfigurationForDocument,
  NODE_LAUNCH_CONFIGURATION_MAX_BYTES,
  NODE_LAUNCH_CONFIGURATION_PATH,
  nodeLaunchTargetFromConfiguration,
  parseNodeLaunchConfigurations,
  type NodeLaunchConfiguration,
} from "../domain/nodeLaunchConfiguration";
import { joinWorkspacePath, type FileEntry } from "../domain/workspace";
import {
  loadVscodeNodeLaunchConfigurations,
  type VscodeNodeLaunchConfigurationsLoadResult,
} from "./vscodeNodeLaunchConfigurationLoader";
import type { VscodeNodeLaunchCompound } from "../domain/vscodeNodeLaunchConfiguration";
import type { VscodeNodeServerReadyActionRecipe } from "../domain/vscodeNodeLaunchConfiguration";
import type { NativeNodeWatchLaunchIntent } from "../domain/nativeNodeWatchLaunchIntent";

export const NODE_LAUNCH_CONFIGURATION_READ_ERROR = `${NODE_LAUNCH_CONFIGURATION_PATH} could not be read.`;

export type NodeLaunchConfigurationEntry =
  | {
      readonly source: "codevo";
      readonly configuration: NodeLaunchConfiguration;
    }
  | {
      readonly source: "vscode";
      readonly configuration: NodeLaunchConfiguration;
      /** Private closed semantic intent; never projected into Codevo persistence. */
      readonly nativeWatch?: NativeNodeWatchLaunchIntent;
      readonly justMyCode?: NodeDebugJustMyCodePolicy;
      readonly sourceMaps?: boolean;
      readonly stopOnEntry?: boolean;
      /** Display-safe label only; task execution remains owned by the task coordinator. */
      readonly preLaunchTask?: string;
      /** Display-safe label only; task execution remains owned by the task coordinator. */
      readonly postDebugTask?: string;
      /** Private semantic action; raw output pattern and URI format are never retained. */
      readonly serverReadyAction?: VscodeNodeServerReadyActionRecipe;
    };

/**
 * Private picker-only import metadata. Compound members must never join the compatibility
 * `configurations` projection used by F5 matching or `.codevo/launch.json` persistence.
 */
export interface NodeLaunchCompoundEntry {
  readonly source: "vscode";
  readonly compound: VscodeNodeLaunchCompound;
}

export interface NodeLaunchConfigurationDiagnostic {
  readonly source: "vscode";
  readonly configurationIndex?: number;
  readonly compoundIndex?: number;
  readonly message: string;
}

export type NodeLaunchConfigurationsLoadResult =
  | {
      readonly kind: "loaded";
      /**
       * Compatibility projection for existing launch strategies. Source-specific metadata must
       * stay on `entries` so it can never leak into `.codevo/launch.json` persistence.
       */
      readonly configurations: readonly NodeLaunchConfiguration[];
      readonly entries: readonly NodeLaunchConfigurationEntry[];
      readonly pickerCompounds?: readonly NodeLaunchCompoundEntry[];
      readonly diagnostics: readonly NodeLaunchConfigurationDiagnostic[];
    }
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "stale" };

export type NodeLaunchConfigurationLoadResult =
  | {
      readonly kind: "configured";
      readonly entry: NodeLaunchConfigurationEntry;
      readonly launch: DebugLaunchTarget;
    }
  | Exclude<NodeLaunchConfigurationsLoadResult, { readonly kind: "loaded" }>;

export interface NodeLaunchConfigurationReads {
  readonly readDirectory: (path: string) => Promise<readonly FileEntry[]>;
  readonly readFile: (path: string) => Promise<string>;
  readonly readFileBounded?: (
    path: string,
    maxBytes: number,
  ) => Promise<
    { readonly status: "ok"; readonly content: string } | { readonly status: "tooLarge" }
  >;
}

export interface NodeLaunchConfigurationLoaderDependencies extends NodeLaunchConfigurationReads {
  readonly workspaceRoot: string;
  readonly documentPath: string;
  readonly isCurrent: () => boolean;
}

/** Reads and parses the complete bounded launch collection for one exact workspace owner. */
export async function loadNodeLaunchConfigurations(
  workspaceRoot: string,
  { readDirectory, readFile, readFileBounded }: NodeLaunchConfigurationReads,
  isCurrent: () => boolean,
): Promise<NodeLaunchConfigurationsLoadResult> {
  const vscode = await loadVscodeNodeLaunchConfigurations(
    workspaceRoot,
    { readDirectory, readFile, readFileBounded },
    isCurrent,
  );
  if (vscode.kind !== "none") return importedVscodeResult(vscode);
  return loadCodevoNodeLaunchConfigurations(
    workspaceRoot,
    { readDirectory, readFile, readFileBounded },
    isCurrent,
  );
}

async function loadCodevoNodeLaunchConfigurations(
  workspaceRoot: string,
  { readDirectory, readFile, readFileBounded }: NodeLaunchConfigurationReads,
  isCurrent: () => boolean,
): Promise<NodeLaunchConfigurationsLoadResult> {
  if (!remainsCurrent(isCurrent)) return { kind: "stale" };
  let source: string;
  try {
    const rootEntries = await readDirectory(workspaceRoot);
    if (!remainsCurrent(isCurrent)) return { kind: "stale" };
    const configurationDirectory = rootEntries.find(
      (entry) => entry.kind === "directory" && entry.name === ".codevo",
    );
    if (!configurationDirectory) return { kind: "none" };

    const configurationDirectoryPath = joinWorkspacePath(workspaceRoot, ".codevo");
    const configurationEntries = await readDirectory(configurationDirectoryPath);
    if (!remainsCurrent(isCurrent)) return { kind: "stale" };
    const configurationFile = configurationEntries.find(
      (entry) => entry.kind === "file" && entry.name === "launch.json",
    );
    if (!configurationFile) return { kind: "none" };

    if (readFileBounded) {
      const bounded = await readFileBounded(
        joinWorkspacePath(configurationDirectoryPath, "launch.json"),
        NODE_LAUNCH_CONFIGURATION_MAX_BYTES,
      );
      if (!remainsCurrent(isCurrent)) return { kind: "stale" };
      if (bounded.status === "tooLarge") {
        return {
          kind: "invalid",
          message: `${NODE_LAUNCH_CONFIGURATION_PATH} may be at most ${NODE_LAUNCH_CONFIGURATION_MAX_BYTES} UTF-8 bytes.`,
        };
      }
      source = bounded.content;
    } else {
      source = await readFile(joinWorkspacePath(configurationDirectoryPath, "launch.json"));
      if (!remainsCurrent(isCurrent)) return { kind: "stale" };
    }
    if (new TextEncoder().encode(source).byteLength > NODE_LAUNCH_CONFIGURATION_MAX_BYTES) {
      return {
        kind: "invalid",
        message: `${NODE_LAUNCH_CONFIGURATION_PATH} may be at most ${NODE_LAUNCH_CONFIGURATION_MAX_BYTES} UTF-8 bytes.`,
      };
    }
  } catch {
    if (!remainsCurrent(isCurrent)) return { kind: "stale" };
    return {
      kind: "invalid",
      message: NODE_LAUNCH_CONFIGURATION_READ_ERROR,
    };
  }
  if (!remainsCurrent(isCurrent)) return { kind: "stale" };

  const parsed = parseNodeLaunchConfigurations(source);
  if (parsed.kind === "error") return { kind: "invalid", message: parsed.message };
  if (!remainsCurrent(isCurrent)) return { kind: "stale" };
  return {
    kind: "loaded",
    configurations: parsed.configurations,
    entries: parsed.configurations.map((configuration) => ({
      source: "codevo" as const,
      configuration,
    })),
    diagnostics: [],
  };
}

export async function loadConfiguredNodeLaunch({
  workspaceRoot,
  documentPath,
  readDirectory,
  readFile,
  readFileBounded,
  isCurrent,
}: NodeLaunchConfigurationLoaderDependencies): Promise<NodeLaunchConfigurationLoadResult> {
  const result = await loadNodeLaunchConfigurations(
    workspaceRoot,
    { readDirectory, readFile, readFileBounded },
    isCurrent,
  );
  if (result.kind !== "loaded") return result;
  const matchedConfiguration = configuredNodeLaunchConfigurationForDocument(
    result.configurations,
    workspaceRoot,
    documentPath,
  );
  const configuration = matchedConfiguration ?? singleImportedNpmConfiguration(result);
  if (!configuration) return { kind: "none" };
  const entry = result.entries.find((candidate) => candidate.configuration === configuration);
  return entry
    ? {
        kind: "configured",
        entry,
        launch: nodeLaunchTargetFromConfiguration(configuration, workspaceRoot),
      }
    : { kind: "stale" };
}

function singleImportedNpmConfiguration(
  result: Extract<NodeLaunchConfigurationsLoadResult, { readonly kind: "loaded" }>,
): NodeLaunchConfiguration | null {
  if (result.diagnostics.length > 0) return null;
  const entry = result.entries.length === 1 ? result.entries[0] : undefined;
  return entry?.source === "vscode" && entry.configuration.target.kind === "npm"
    ? entry.configuration
    : null;
}

function remainsCurrent(isCurrent: () => boolean): boolean {
  try {
    return isCurrent();
  } catch {
    return false;
  }
}

function importedVscodeResult(
  result: VscodeNodeLaunchConfigurationsLoadResult,
): NodeLaunchConfigurationsLoadResult {
  if (result.kind !== "loaded") return result;
  const entries = result.configurations.map(
    ({
      configuration,
      nativeWatch,
      justMyCode,
      sourceMaps,
      stopOnEntry,
      preLaunchTask,
      postDebugTask,
      serverReadyAction,
    }): NodeLaunchConfigurationEntry => ({
      source: "vscode",
      configuration,
      ...(nativeWatch ? { nativeWatch } : {}),
      ...(justMyCode ? { justMyCode } : {}),
      ...(sourceMaps !== undefined ? { sourceMaps } : {}),
      ...(stopOnEntry !== undefined ? { stopOnEntry } : {}),
      ...(preLaunchTask ? { preLaunchTask } : {}),
      ...(postDebugTask ? { postDebugTask } : {}),
      ...(serverReadyAction ? { serverReadyAction } : {}),
    }),
  );
  return {
    kind: "loaded",
    configurations: entries.map(({ configuration }) => configuration),
    entries,
    ...(result.compounds
      ? {
          pickerCompounds: Object.freeze(
            result.compounds.map((compound) => Object.freeze({ source: "vscode", compound })),
          ),
        }
      : {}),
    diagnostics: result.diagnostics.map((diagnostic) => ({
      source: "vscode",
      ...diagnostic,
    })),
  };
}
