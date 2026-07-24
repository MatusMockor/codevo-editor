import { useMemo } from "react";
import type { DebugLaunchTarget } from "../domain/debug";
import {
  validateNodeDebugPreLaunchTask,
  type NodeDebugPreLaunchTask,
} from "../domain/nodeDebugPreLaunchTask";
import { validateNodeDebugPostTask, type NodeDebugPostTask } from "../domain/nodeDebugPostTask";
import {
  nodeLaunchTargetFromConfiguration,
  type NodeLaunchConfigurationTarget,
} from "../domain/nodeLaunchConfiguration";
import type { NodeLaunchConfigurationReads } from "./nodeLaunchConfigurationLoader";
import type {
  NodeLaunchCompoundEntry,
  NodeLaunchConfigurationEntry,
} from "./nodeLaunchConfigurationLoader";
import type { VscodeNodeServerReadyActionRecipe } from "../domain/vscodeNodeLaunchConfiguration";
import {
  cloneNativeNodeWatchLaunchIntent,
  type NativeNodeWatchLaunchIntent,
} from "../domain/nativeNodeWatchLaunchIntent";
import { joinWorkspacePath } from "../domain/workspace";
import { cloneNodeDebugCompoundMembers } from "./nodeDebugCompoundRecipe";
import {
  boundedNodeLaunchConfigurationMessage,
  MAX_NODE_LAUNCH_CONFIGURATION_PICKER_MESSAGE_BYTES,
  useNodeLaunchConfigurationPicker,
  type NodeLaunchPickerCoordinator,
  type NodeLaunchConfigurationPickerState,
  type NodeLaunchConfigurationPickerStrategy,
  type PreparedNodeLaunchConfiguration,
} from "./useNodeLaunchConfigurationPicker";

export const MAX_NODE_DEBUG_CONFIGURATION_LAUNCHER_MESSAGE_BYTES =
  MAX_NODE_LAUNCH_CONFIGURATION_PICKER_MESSAGE_BYTES;
export const NODE_DEBUG_CONFIGURATION_START_ERROR =
  "Node debug configuration could not be started.";

export interface NodeDebugConfigurationChoice {
  readonly compoundMemberCount?: number;
  readonly default: boolean;
  readonly hasPreLaunchTask?: boolean;
  readonly name: string;
  readonly preLaunchTask?: string;
  readonly runnable?: boolean;
  readonly source?: NodeLaunchConfigurationEntry["source"];
  readonly targetKind: NodeLaunchConfigurationTarget["kind"] | "compound";
}

export type NodeDebugConfigurationLauncherState = NodeLaunchConfigurationPickerState;

export interface UseNodeDebugConfigurationLauncherOptions {
  readonly configurationVersion?: number;
  readonly coordinator?: NodeLaunchPickerCoordinator;
  readonly debugStartBlocked: boolean;
  readonly isDebugStartBlocked: () => boolean;
  readonly isWorkspaceCurrent: (rootPath: string, workspaceId: string) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly isDocumentClean?: (path: string) => boolean;
  readonly openDebugPanel: () => void;
  readonly rootPath: string | null;
  readonly startDebug: (prepared: PreparedNodeDebugLaunch) => Promise<boolean>;
  /** Reserved runtime port. Without it imported compounds remain visible but disabled. */
  readonly startCompoundDebug?: (prepared: PreparedNodeDebugCompoundLaunch) => Promise<boolean>;
  readonly workspaceId: string | null;
  readonly workspaceReads: NodeLaunchConfigurationReads;
  readonly workspaceTrusted: boolean;
}

export interface PreparedNodeDebugLaunch {
  readonly envFile?: string;
  readonly launch: DebugLaunchTarget & { readonly envFile?: string };
  readonly nativeWatch?: NativeNodeWatchLaunchIntent;
  readonly preLaunchTask: NodeDebugPreLaunchTask | null;
  readonly postDebugTask?: NodeDebugPostTask | null;
  /** Private application recipe; never projected into debug IPC or the public debug UI. */
  readonly serverReadyAction?: VscodeNodeServerReadyActionRecipe;
}

export interface PreparedNodeDebugCompoundLaunch {
  readonly kind: "compound";
  readonly members: readonly PreparedNodeDebugLaunch[];
  readonly name: string;
  readonly preLaunchTask: NodeDebugPreLaunchTask | null;
}

export type PreparedNodeDebugSelection =
  | { readonly kind: "single"; readonly value: PreparedNodeDebugLaunch }
  | PreparedNodeDebugCompoundLaunch;

export function prepareNodeDebugLaunch(
  configuration: Parameters<typeof nodeLaunchTargetFromConfiguration>[0],
  rootPath: string,
  entry: NodeLaunchConfigurationEntry,
  isDocumentClean: (path: string) => boolean = () => true,
): PreparedNodeLaunchConfiguration<PreparedNodeDebugLaunch> {
  const task = validateNodeDebugPreLaunchTask(
    entry.source === "vscode" ? entry.preLaunchTask : undefined,
  );
  if (task.kind === "invalid") {
    return { kind: "unsupported", reason: "invalidOptions" };
  }
  const postTask = validateNodeDebugPostTask(
    entry.source === "vscode" ? entry.postDebugTask : undefined,
  );
  if (postTask.kind === "invalid") {
    return { kind: "unsupported", reason: "invalidOptions" };
  }
  const nativeWatch =
    entry.source === "vscode" && entry.nativeWatch
      ? cloneNativeNodeWatchLaunchIntent({
          ...entry.nativeWatch,
          scriptPath: joinWorkspacePath(rootPath, entry.nativeWatch.scriptPath),
        })
      : null;
  if (nativeWatch?.kind === "error") {
    return { kind: "unsupported", reason: "invalidOptions" };
  }
  if (
    nativeWatch?.kind === "ok" &&
    !safelyDocumentClean(isDocumentClean, nativeWatch.intent.scriptPath)
  ) {
    return { kind: "unsupported", reason: "dirtyDocument" };
  }
  const envFile = importedEnvFile(configuration, entry);
  if (envFile.kind === "invalid") {
    return { kind: "unsupported", reason: "invalidOptions" };
  }
  const launch = debugLaunchWithJustMyCode(
    nodeLaunchTargetFromConfiguration(configuration, rootPath),
    entry,
  );
  if (envFile.value && launch.kind !== "node-configured-script") {
    return { kind: "unsupported", reason: "invalidOptions" };
  }
  const launchWithEnvFile =
    envFile.value && launch.kind === "node-configured-script"
      ? Object.freeze({ ...launch, envFile: envFile.value })
      : launch;
  return {
    kind: "supported",
    value: Object.freeze({
      ...(envFile.value ? { envFile: envFile.value } : {}),
      launch: launchWithEnvFile,
      ...(nativeWatch?.kind === "ok" ? { nativeWatch: nativeWatch.intent } : {}),
      preLaunchTask: task.kind === "valid" ? task.task : null,
      ...(postTask.kind === "valid" ? { postDebugTask: postTask.task } : {}),
      ...(entry.source === "vscode" && entry.serverReadyAction
        ? { serverReadyAction: entry.serverReadyAction }
        : {}),
    }),
  };
}

export function prepareNodeDebugCompoundLaunch(
  entry: NodeLaunchCompoundEntry,
  rootPath: string,
): PreparedNodeLaunchConfiguration<PreparedNodeDebugSelection> {
  const task = validateNodeDebugPreLaunchTask(entry.compound.preLaunchTask);
  if (task.kind === "invalid") return { kind: "unsupported", reason: "invalidOptions" };
  if (
    entry.compound.members.some((member) => {
      const envFile = importedEnvFile(member.configuration, { source: "vscode", ...member });
      return envFile.kind === "invalid" || envFile.value !== undefined;
    })
  ) {
    return { kind: "unsupported", reason: "invalidOptions" };
  }
  const recipes = cloneNodeDebugCompoundMembers(
    entry.compound.members.map((member) => ({
      launch: debugLaunchWithJustMyCode(
        nodeLaunchTargetFromConfiguration(member.configuration, rootPath),
        { source: "vscode", ...member },
      ),
      preLaunchTask: null,
    })),
  );
  if (!recipes) return { kind: "unsupported", reason: "invalidOptions" };
  const members = Object.freeze(
    recipes.map(({ launch }) => Object.freeze({ launch, preLaunchTask: null })),
  );
  return {
    kind: "supported",
    reason: "compoundRequiresDebugger",
    runnable: false,
    value: Object.freeze({
      kind: "compound",
      members: Object.freeze(members),
      name: entry.compound.name,
      preLaunchTask: task.kind === "valid" ? task.task : null,
    }),
  };
}

function debugLaunchWithJustMyCode(
  launch: DebugLaunchTarget,
  entry: NodeLaunchConfigurationEntry,
): DebugLaunchTarget {
  return entry.source === "vscode" && entry.justMyCode
    ? Object.freeze({ ...launch, justMyCode: entry.justMyCode })
    : launch;
}

function importedEnvFile(
  configuration: Parameters<typeof nodeLaunchTargetFromConfiguration>[0],
  entry: NodeLaunchConfigurationEntry,
): { readonly kind: "valid"; readonly value?: string } | { readonly kind: "invalid" } {
  if (entry.source !== "vscode") return { kind: "valid" };
  const value = (configuration as NodeLaunchConfigurationWithEnvFile).envFile;
  if (value === undefined) return { kind: "valid" };
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    new TextEncoder().encode(value).length > 4 * 1024 ||
    value.includes("\\") ||
    value.includes("${") ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//u.test(value) ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return { kind: "invalid" };
  }
  return { kind: "valid", value };
}

type NodeLaunchConfigurationWithEnvFile = Parameters<
  typeof nodeLaunchTargetFromConfiguration
>[0] & {
  readonly envFile?: unknown;
};

export interface NodeDebugConfigurationLauncher {
  readonly busy: boolean;
  readonly choices: readonly NodeDebugConfigurationChoice[];
  readonly pickerOpen: boolean;
  readonly selectedName: string | null;
  readonly state: NodeDebugConfigurationLauncherState;
  canOpenPicker(): boolean;
  closePicker(): void;
  load(): Promise<void>;
  openPicker(): void;
  refresh(): Promise<void>;
  select(name: string): void;
  startNamed(name: string): Promise<boolean>;
  startSelected(): Promise<boolean>;
}

/** Debug-specific Strategy wrapper over the shared private picker lifecycle. */
export function useNodeDebugConfigurationLauncher(
  options: UseNodeDebugConfigurationLauncherOptions,
): NodeDebugConfigurationLauncher {
  const { startCompoundDebug, startDebug } = options;
  const strategy = useMemo<NodeLaunchConfigurationPickerStrategy<PreparedNodeDebugSelection>>(
    () => ({
      prepare: (configuration, rootPath, entry) => {
        const prepared = prepareNodeDebugLaunch(
          configuration,
          rootPath,
          entry,
          options.isDocumentClean,
        );
        return prepared.kind === "supported"
          ? {
              kind: "supported",
              value: Object.freeze({ kind: "single", value: prepared.value }),
            }
          : prepared;
      },
      prepareCompound: (entry, rootPath) => {
        const prepared = prepareNodeDebugCompoundLaunch(entry, rootPath);
        return prepared.kind === "supported" && startCompoundDebug
          ? { ...prepared, runnable: true }
          : prepared;
      },
      start: (prepared) =>
        prepared.kind === "single"
          ? startDebug(prepared.value)
          : (startCompoundDebug?.(prepared) ?? Promise.resolve(false)),
      startErrorMessage: NODE_DEBUG_CONFIGURATION_START_ERROR,
    }),
    [options.isDocumentClean, startCompoundDebug, startDebug],
  );
  const picker = useNodeLaunchConfigurationPicker({
    blocked: options.debugStartBlocked,
    configurationVersion: options.configurationVersion,
    coordinator: options.coordinator,
    isBlocked: options.isDebugStartBlocked,
    isWorkspaceCurrent: options.isWorkspaceCurrent,
    isWorkspaceTrusted: options.isWorkspaceTrusted,
    revealBeforeStart: options.openDebugPanel,
    revealPicker: options.openDebugPanel,
    rootPath: options.rootPath,
    strategy,
    workspaceId: options.workspaceId,
    workspaceReads: options.workspaceReads,
    workspaceTrusted: options.workspaceTrusted,
  });
  const choices = useMemo<readonly NodeDebugConfigurationChoice[]>(
    () =>
      Object.freeze(
        picker.choices.map(
          ({
            compoundMemberCount,
            default: isDefault,
            hasPreLaunchTask,
            name,
            preLaunchTask,
            runnable,
            source,
            targetKind,
          }) =>
            Object.freeze({
              ...(compoundMemberCount ? { compoundMemberCount } : {}),
              default: isDefault,
              ...(hasPreLaunchTask ? { hasPreLaunchTask } : {}),
              name,
              ...(preLaunchTask ? { preLaunchTask } : {}),
              ...(runnable ? {} : { runnable: false }),
              ...(source ? { source } : {}),
              targetKind,
            }),
        ),
      ),
    [picker.choices],
  );
  return useMemo(
    () => ({
      ...picker,
      choices,
    }),
    [choices, picker],
  );
}

export const boundedNodeDebugConfigurationMessage = boundedNodeLaunchConfigurationMessage;

function safelyDocumentClean(check: (path: string) => boolean, path: string): boolean {
  try {
    return check(path);
  } catch {
    return false;
  }
}
