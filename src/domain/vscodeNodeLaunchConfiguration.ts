import { parseBoundedJsonc } from "./boundedJsonc";
import { isNodeDebugPort } from "./debug";
import type { NodeLaunchConfiguration } from "./nodeLaunchConfiguration";
import type { NodeDebugJustMyCodePolicy } from "./nodeDebugJustMyCode";
import {
  cloneNativeNodeWatchLaunchIntent,
  type NativeNodeWatchLaunchIntent,
} from "./nativeNodeWatchLaunchIntent";

export const VSCODE_NODE_LAUNCH_CONFIGURATION_PATH = ".vscode/launch.json";
export const VSCODE_NODE_LAUNCH_CONFIGURATION_MAX_BYTES = 256 * 1024;
export const VSCODE_PRE_LAUNCH_TASK_MAX_BYTES = 256;
export const VSCODE_POST_DEBUG_TASK_MAX_BYTES = VSCODE_PRE_LAUNCH_TASK_MAX_BYTES;
export const VSCODE_SERVER_READY_PATTERN_MAX_BYTES = 512;
export const VSCODE_SERVER_READY_URI_FORMAT_MAX_BYTES = 512;
export const VSCODE_NODE_INTERNALS_SKIP_PATTERN = "<node_internals>/**";
export const VSCODE_NODE_DEPENDENCIES_SKIP_PATTERN = "**/node_modules/**";
export type VscodeNodeScriptRuntime = "tsx" | "ts-node";

const MAX_CONFIGURATIONS = 64;
const MAX_COMPOUNDS = 16;
const MIN_COMPOUND_MEMBERS = 2;
const MAX_COMPOUND_MEMBERS = 4;
const MAX_ARGUMENTS = 128;
const MAX_ENVIRONMENT_ENTRIES = 128;
const MAX_NAME_BYTES = 256;
const MAX_NPM_SCRIPT_NAME_BYTES = 128;
const MAX_PATH_BYTES = 4 * 1024;
const MAX_VALUE_BYTES = 16 * 1024;
const BLOCKED_NPM_ENVIRONMENT_NAMES = new Set([
  "PATH",
  "NODE_OPTIONS",
  "SHELL",
  "COMSPEC",
  "PATHEXT",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
]);

export interface VscodeNodeLaunchConfiguration {
  readonly configuration: NodeLaunchConfiguration & {
    readonly envFile?: string;
    readonly runtime?: VscodeNodeScriptRuntime;
  };
  readonly envFile?: string;
  /** Private semantic import metadata; raw runtime arguments are never retained. */
  readonly nativeWatch?: NativeNodeWatchLaunchIntent;
  readonly justMyCode?: NodeDebugJustMyCodePolicy;
  /** Exact display-safe task label only. No task command or execution capability is projected. */
  readonly preLaunchTask?: string;
  /** Exact display-safe task label only. No task command or execution capability is projected. */
  readonly postDebugTask?: string;
  /**
   * Parser-owned semantic plan. The source regular expression and URI format are deliberately not
   * retained, so later IPC/runtime layers never need to evaluate attacker-controlled regex.
   */
  readonly serverReadyAction?: VscodeNodeServerReadyActionRecipe;
}

export interface VscodeNodeServerReadyActionRecipe {
  readonly action: "openExternally";
  readonly match: {
    readonly kind: "port";
    readonly prefix: string;
    readonly suffix: string;
  };
  readonly uri: {
    readonly scheme: "http" | "https";
    readonly host: "localhost" | "127.0.0.1" | "[::1]";
    readonly path: string;
  };
}

/**
 * Revalidates and defensively clones a semantic server-ready recipe at an application boundary.
 *
 * Parser output already satisfies this contract, but the runtime check keeps structural TypeScript
 * callers and future persistence boundaries from fabricating a more capable URL or matcher.
 */
export function cloneVscodeNodeServerReadyActionRecipe(
  value: unknown,
): VscodeNodeServerReadyActionRecipe | null {
  try {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["action", "match", "uri"]) ||
      value.action !== "openExternally" ||
      !isRecord(value.match) ||
      !hasExactKeys(value.match, ["kind", "prefix", "suffix"]) ||
      value.match.kind !== "port" ||
      !safeString(value.match.prefix, VSCODE_SERVER_READY_PATTERN_MAX_BYTES) ||
      !safeString(value.match.suffix, VSCODE_SERVER_READY_PATTERN_MAX_BYTES) ||
      !literalServerOutput(value.match.prefix, false) ||
      !literalServerOutput(value.match.suffix, true) ||
      startsWithAsciiDigit(value.match.suffix) ||
      byteLength(`${value.match.prefix}([0-9]+)${value.match.suffix}`) >
        VSCODE_SERVER_READY_PATTERN_MAX_BYTES ||
      !isRecord(value.uri) ||
      !hasExactKeys(value.uri, ["scheme", "host", "path"]) ||
      (value.uri.scheme !== "http" && value.uri.scheme !== "https") ||
      (value.uri.host !== "localhost" &&
        value.uri.host !== "127.0.0.1" &&
        value.uri.host !== "[::1]") ||
      typeof value.uri.path !== "string" ||
      !safeServerReadyPath(value.uri.path) ||
      byteLength(`${value.uri.scheme}://${value.uri.host}:%s${value.uri.path}`) >
        VSCODE_SERVER_READY_URI_FORMAT_MAX_BYTES
    ) {
      return null;
    }
    return Object.freeze({
      action: "openExternally",
      match: Object.freeze({
        kind: "port",
        prefix: value.match.prefix,
        suffix: value.match.suffix,
      }),
      uri: Object.freeze({
        scheme: value.uri.scheme,
        host: value.uri.host,
        path: value.uri.path,
      }),
    });
  } catch {
    return null;
  }
}

/**
 * A resolved, read-only compound import. Members are exact parser-owned launch entries so later
 * layers never need to bind an untrusted name again.
 */
export interface VscodeNodeLaunchCompound {
  readonly name: string;
  readonly members: readonly VscodeNodeLaunchConfiguration[];
  /** Exact display-safe task label only. No task command or execution capability is projected. */
  readonly preLaunchTask?: string;
}

export interface VscodeNodeLaunchDiagnostic {
  readonly configurationIndex?: number;
  readonly compoundIndex?: number;
  readonly message: string;
}

export type ParseVscodeNodeLaunchConfigurationsResult =
  | {
      readonly kind: "ok";
      readonly configurations: readonly VscodeNodeLaunchConfiguration[];
      /** Present only when the source declared compounds; kept private from Codevo persistence. */
      readonly compounds?: readonly VscodeNodeLaunchCompound[];
      readonly diagnostics: readonly VscodeNodeLaunchDiagnostic[];
    }
  | { readonly kind: "error"; readonly message: string };

/** Imports a strict, process-safe Node subset of VS Code launch.json without executing tasks. */
export function parseVscodeNodeLaunchConfigurations(
  source: string,
): ParseVscodeNodeLaunchConfigurationsResult {
  if (byteLength(source) > VSCODE_NODE_LAUNCH_CONFIGURATION_MAX_BYTES) {
    return invalid(`may be at most ${VSCODE_NODE_LAUNCH_CONFIGURATION_MAX_BYTES} UTF-8 bytes`);
  }
  let value: unknown;
  try {
    value = parseBoundedJsonc(source, { maxDepth: 32, maxNodes: 4_096 });
  } catch {
    return invalid("must contain valid JSONC without duplicate fields");
  }
  if (!isRecord(value) || value.version !== "0.2.0" || !Array.isArray(value.configurations)) {
    return invalid('must contain { "version": "0.2.0", "configurations": [...] }');
  }
  const rootUnknown = unknownKey(value, ["version", "configurations", "compounds"]);
  if (rootUnknown) return invalid(`root contains unknown field "${rootUnknown}"`);
  if (value.configurations.length > MAX_CONFIGURATIONS) {
    return invalid(`may contain at most ${MAX_CONFIGURATIONS} configurations`);
  }
  if (
    value.compounds !== undefined &&
    (!Array.isArray(value.compounds) || value.compounds.length > MAX_COMPOUNDS)
  ) {
    return invalid(`compounds must be an array of at most ${MAX_COMPOUNDS} entries`);
  }

  const candidates: VscodeNodeLaunchConfiguration[] = [];
  const diagnostics: VscodeNodeLaunchDiagnostic[] = [];
  value.configurations.forEach((candidate, index) => {
    const parsed = parseConfiguration(candidate, index);
    if (parsed.kind === "error") {
      diagnostics.push({ configurationIndex: index, message: parsed.message });
      return;
    }
    candidates.push(parsed.value);
  });
  const duplicateNames = new Set(
    candidates
      .map(({ configuration }) => configuration.name)
      .filter((name, index, names) => names.indexOf(name) !== index),
  );
  const configurations = candidates.filter(({ configuration }) => {
    if (!duplicateNames.has(configuration.name)) return true;
    diagnostics.push({
      message: `All configurations named "${configuration.name}" were ignored because the name is ambiguous.`,
    });
    return false;
  });
  if (value.compounds === undefined) {
    return { kind: "ok", configurations, diagnostics };
  }
  const compounds = parseCompounds(value.compounds, configurations, diagnostics);
  return {
    kind: "ok",
    configurations,
    compounds: Object.freeze(compounds),
    diagnostics,
  };
}

interface UnresolvedVscodeNodeLaunchCompound {
  readonly index: number;
  readonly name: string;
  readonly memberNames: readonly string[];
  readonly preLaunchTask?: string;
}

function parseCompounds(
  values: readonly unknown[],
  configurations: readonly VscodeNodeLaunchConfiguration[],
  diagnostics: VscodeNodeLaunchDiagnostic[],
): readonly VscodeNodeLaunchCompound[] {
  const candidates: UnresolvedVscodeNodeLaunchCompound[] = [];
  values.forEach((value, index) => {
    const parsed = parseCompound(value, index);
    if (parsed.kind === "error") {
      diagnostics.push({ compoundIndex: index, message: parsed.message });
    } else {
      candidates.push(parsed.value);
    }
  });

  const duplicateNames = new Set(
    candidates
      .map(({ name }) => name)
      .filter((name, index, names) => names.indexOf(name) !== index),
  );
  const configurationsByName = new Map(
    configurations.map((configuration) => [configuration.configuration.name, configuration]),
  );
  const compounds: VscodeNodeLaunchCompound[] = [];
  for (const candidate of candidates) {
    if (duplicateNames.has(candidate.name)) {
      diagnostics.push({
        compoundIndex: candidate.index,
        message: `All compounds named "${candidate.name}" were ignored because the name is ambiguous.`,
      });
      continue;
    }
    if (configurationsByName.has(candidate.name)) {
      diagnostics.push({
        compoundIndex: candidate.index,
        message: `compounds[${candidate.index}].name collides with a launch configuration name.`,
      });
      continue;
    }
    const members = candidate.memberNames.map((name) => configurationsByName.get(name));
    const missingMember = candidate.memberNames.find((_name, index) => !members[index]);
    if (missingMember !== undefined) {
      diagnostics.push({
        compoundIndex: candidate.index,
        message: `compounds[${candidate.index}] references an unknown launch configuration.`,
      });
      continue;
    }
    const ownedMembers = members as VscodeNodeLaunchConfiguration[];
    if (
      ownedMembers.some(
        ({ configuration, nativeWatch, preLaunchTask, postDebugTask, serverReadyAction }) =>
          configuration.target.kind === "attach" ||
          nativeWatch !== undefined ||
          preLaunchTask !== undefined ||
          postDebugTask !== undefined ||
          serverReadyAction !== undefined,
      )
    ) {
      diagnostics.push({
        compoundIndex: candidate.index,
        message: `compounds[${candidate.index}] members must be task-free script or npm launch configurations without serverReadyAction.`,
      });
      continue;
    }
    compounds.push(
      Object.freeze({
        name: candidate.name,
        members: Object.freeze(ownedMembers.map(frozenCompoundMember)),
        ...(candidate.preLaunchTask ? { preLaunchTask: candidate.preLaunchTask } : {}),
      }),
    );
  }
  return compounds;
}

function frozenCompoundMember(entry: VscodeNodeLaunchConfiguration): VscodeNodeLaunchConfiguration {
  const { configuration } = entry;
  return Object.freeze({
    configuration: Object.freeze({
      ...configuration,
      args: Object.freeze([...configuration.args]),
      env: Object.freeze({ ...configuration.env }),
      target: Object.freeze({ ...configuration.target }),
    }),
    ...(entry.nativeWatch ? { nativeWatch: entry.nativeWatch } : {}),
    ...(entry.justMyCode ? { justMyCode: entry.justMyCode } : {}),
  });
}

function parseCompound(
  value: unknown,
  index: number,
):
  | { readonly kind: "ok"; readonly value: UnresolvedVscodeNodeLaunchCompound }
  | { readonly kind: "error"; readonly message: string } {
  const path = `compounds[${index}]`;
  if (!isRecord(value)) return rejected(`${path} must be an object`);
  const unknown = unknownKey(value, ["name", "configurations", "stopAll", "preLaunchTask"]);
  if (unknown) return rejected(`${path} contains unsupported field "${unknown}"`);
  if (!displaySafe(value.name, MAX_NAME_BYTES)) {
    return rejected(`${path}.name must be a bounded display-safe string`);
  }
  if (value.stopAll !== true) return rejected(`${path}.stopAll must be true`);
  if (
    !Array.isArray(value.configurations) ||
    value.configurations.length < MIN_COMPOUND_MEMBERS ||
    value.configurations.length > MAX_COMPOUND_MEMBERS ||
    !value.configurations.every((name) => displaySafe(name, MAX_NAME_BYTES))
  ) {
    return rejected(
      `${path}.configurations must contain ${MIN_COMPOUND_MEMBERS} to ${MAX_COMPOUND_MEMBERS} bounded display-safe names`,
    );
  }
  if (new Set(value.configurations).size !== value.configurations.length) {
    return rejected(`${path}.configurations must contain unique member names`);
  }
  const preLaunchTask = optionalTaskLabel(value.preLaunchTask, `${path}.preLaunchTask`);
  if (preLaunchTask.kind === "error") return preLaunchTask;
  return {
    kind: "ok",
    value: {
      index,
      name: value.name,
      memberNames: Object.freeze([...value.configurations]),
      ...(preLaunchTask.value ? { preLaunchTask: preLaunchTask.value } : {}),
    },
  };
}

function parseConfiguration(
  value: unknown,
  index: number,
):
  | { readonly kind: "ok"; readonly value: VscodeNodeLaunchConfiguration }
  | { readonly kind: "error"; readonly message: string } {
  const path = `configurations[${index}]`;
  if (!isRecord(value)) return rejected(`${path} must be an object`);
  const unknown = unknownKey(value, [
    "type",
    "request",
    "name",
    "program",
    "runtimeExecutable",
    "runtimeArgs",
    "args",
    "cwd",
    "env",
    "envFile",
    "port",
    "preLaunchTask",
    "postDebugTask",
    "skipFiles",
    "justMyCode",
    "serverReadyAction",
  ]);
  if (unknown) return rejected(`${path} contains unsupported field "${unknown}"`);
  if (
    Object.prototype.hasOwnProperty.call(value, "justMyCode") &&
    Object.prototype.hasOwnProperty.call(value, "skipFiles")
  ) {
    return rejected(
      `${path} must not define both justMyCode and skipFiles because the filtering policy is ambiguous`,
    );
  }
  if (value.type !== "node" && value.type !== "pwa-node") {
    return rejected(`${path}.type must be "node" or "pwa-node"`);
  }
  if (!displaySafe(value.name, MAX_NAME_BYTES)) {
    return rejected(`${path}.name must be a bounded display-safe string`);
  }
  const preLaunchTask = optionalTaskLabel(value.preLaunchTask, `${path}.preLaunchTask`);
  if (preLaunchTask.kind === "error") return preLaunchTask;
  const postDebugTask = optionalTaskLabel(value.postDebugTask, `${path}.postDebugTask`);
  if (postDebugTask.kind === "error") return postDebugTask;
  const serverReadyAction = parseServerReadyAction(
    value.serverReadyAction,
    `${path}.serverReadyAction`,
  );
  if (serverReadyAction.kind === "error") return serverReadyAction;
  if (value.request === "attach") {
    if (value.envFile !== undefined) {
      return rejected(`${path}.envFile is supported only for a script launch`);
    }
    if (serverReadyAction.value !== undefined) {
      return rejected(`${path}.serverReadyAction is supported only for launch`);
    }
    const justMyCode = attachJustMyCodePolicy(
      value.skipFiles,
      value.justMyCode,
      `${path}.skipFiles`,
      `${path}.justMyCode`,
    );
    if (justMyCode.kind === "error") return justMyCode;
    if (!isNodeDebugPort(value.port)) {
      return rejected(`${path}.port must be an integer between 1 and 65535`);
    }
    if (
      value.program !== undefined ||
      value.runtimeExecutable !== undefined ||
      value.runtimeArgs !== undefined ||
      value.args !== undefined ||
      value.cwd !== undefined ||
      value.env !== undefined
    ) {
      return rejected(`${path} attach configuration contains launch-only fields`);
    }
    return {
      kind: "ok",
      value: {
        configuration: {
          args: [],
          default: false,
          env: {},
          name: value.name,
          target: { kind: "attach", port: value.port },
        },
        ...(preLaunchTask.value ? { preLaunchTask: preLaunchTask.value } : {}),
        ...(postDebugTask.value ? { postDebugTask: postDebugTask.value } : {}),
      },
    };
  }
  if (value.request !== "launch") {
    return rejected(`${path}.request must be "launch" or "attach"`);
  }
  if (value.port !== undefined)
    return rejected(`${path} launch configuration contains attach port`);
  const justMyCode = launchJustMyCodePolicy(
    value.skipFiles,
    value.justMyCode,
    `${path}.skipFiles`,
    `${path}.justMyCode`,
  );
  if (justMyCode.kind === "error") return justMyCode;
  if (value.runtimeExecutable === undefined && value.runtimeArgs !== undefined) {
    return parseNativeNodeWatchConfiguration(
      value,
      path,
      preLaunchTask.value,
      postDebugTask.value,
      justMyCode.value,
      serverReadyAction.value,
    );
  }
  if (value.runtimeExecutable === "tsx" || value.runtimeExecutable === "ts-node") {
    return parseScriptLaunchConfiguration(
      value,
      path,
      preLaunchTask.value,
      postDebugTask.value,
      justMyCode.value,
      serverReadyAction.value,
      value.runtimeExecutable,
    );
  }
  if (value.runtimeExecutable !== undefined) {
    return parseNpmLaunchConfiguration(
      value,
      path,
      preLaunchTask.value,
      postDebugTask.value,
      justMyCode.value,
      serverReadyAction.value,
    );
  }
  return parseScriptLaunchConfiguration(
    value,
    path,
    preLaunchTask.value,
    postDebugTask.value,
    justMyCode.value,
    serverReadyAction.value,
  );
}

function parseScriptLaunchConfiguration(
  value: Record<string, unknown>,
  path: string,
  preLaunchTask: string | undefined,
  postDebugTask: string | undefined,
  justMyCode: NodeDebugJustMyCodePolicy | undefined,
  serverReadyAction: VscodeNodeServerReadyActionRecipe | undefined,
  runtime?: VscodeNodeScriptRuntime,
):
  | { readonly kind: "ok"; readonly value: VscodeNodeLaunchConfiguration }
  | { readonly kind: "error"; readonly message: string } {
  if (
    runtime &&
    value.runtimeArgs !== undefined &&
    (!Array.isArray(value.runtimeArgs) || value.runtimeArgs.length > 0)
  ) {
    return rejected(`${path}.runtimeArgs must be absent or empty for a direct ${runtime} launch`);
  }
  const program = workspaceRelative(value.program, `${path}.program`, false);
  if (program.kind === "error" || !program.value) {
    return program.kind === "error"
      ? program
      : rejected(`${path}.program must be a non-empty workspace path`);
  }
  if (runtime && !/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/u.test(program.value)) {
    return rejected(
      `${path}.program must be a workspace .ts, .tsx, .mts, .cts, .js, .mjs or .cjs path`,
    );
  }
  const cwd = workspaceRelative(value.cwd, `${path}.cwd`, true);
  if (cwd.kind === "error") return cwd;
  const args = stringArray(value.args, `${path}.args`);
  if (args.kind === "error") return args;
  const env = environment(value.env, `${path}.env`);
  if (env.kind === "error") return env;
  const envFile = workspaceRelative(value.envFile, `${path}.envFile`, true);
  if (envFile.kind === "error") return envFile;
  if (value.envFile !== undefined && !envFile.value) {
    return rejected(`${path}.envFile must be a non-empty workspace path`);
  }
  return {
    kind: "ok",
    value: {
      configuration: {
        args: args.value,
        ...(cwd.value ? { cwd: cwd.value } : {}),
        default: false,
        env: env.value,
        ...(envFile.value ? { envFile: envFile.value } : {}),
        name: value.name as string,
        ...(runtime ? { runtime } : {}),
        target: { kind: "script", path: program.value },
      },
      ...(envFile.value ? { envFile: envFile.value } : {}),
      ...(justMyCode ? { justMyCode } : {}),
      ...(preLaunchTask ? { preLaunchTask } : {}),
      ...(postDebugTask ? { postDebugTask } : {}),
      ...(serverReadyAction ? { serverReadyAction } : {}),
    },
  };
}

function parseNativeNodeWatchConfiguration(
  value: Record<string, unknown>,
  path: string,
  preLaunchTask: string | undefined,
  postDebugTask: string | undefined,
  justMyCode: NodeDebugJustMyCodePolicy | undefined,
  serverReadyAction: VscodeNodeServerReadyActionRecipe | undefined,
):
  | { readonly kind: "ok"; readonly value: VscodeNodeLaunchConfiguration }
  | { readonly kind: "error"; readonly message: string } {
  if (value.envFile !== undefined) {
    return rejected(`${path}.envFile is unsupported for a native Node watch launch`);
  }
  const preserveOutput =
    Array.isArray(value.runtimeArgs) &&
    value.runtimeArgs.length === 2 &&
    value.runtimeArgs[0] === "--watch" &&
    value.runtimeArgs[1] === "--watch-preserve-output";
  if (
    !Array.isArray(value.runtimeArgs) ||
    !((value.runtimeArgs.length === 1 && value.runtimeArgs[0] === "--watch") || preserveOutput)
  ) {
    return rejected(
      `${path}.runtimeArgs must be exactly ["--watch"] or ["--watch", "--watch-preserve-output"] for a native Node watch launch`,
    );
  }
  const program = workspaceRelative(value.program, `${path}.program`, false);
  if (program.kind === "error" || !program.value) {
    return program.kind === "error"
      ? program
      : rejected(`${path}.program must be a non-empty workspace path`);
  }
  if (value.cwd !== undefined) {
    return rejected(`${path}.cwd is unsupported for a native Node watch launch`);
  }
  const args = stringArray(value.args, `${path}.args`);
  if (args.kind === "error") return args;
  if (args.value.length > 0) {
    return rejected(`${path}.args must be absent or empty for a native Node watch launch`);
  }
  const env = environment(value.env, `${path}.env`);
  if (env.kind === "error") return env;
  if (Object.keys(env.value).length > 0) {
    return rejected(`${path}.env must be absent or empty for a native Node watch launch`);
  }
  const intent = cloneNativeNodeWatchLaunchIntent({
    kind: "native-node-watch",
    scriptPath: program.value,
    watch: true,
    ...(preserveOutput ? { preserveOutput: true } : {}),
  });
  if (intent.kind === "error") {
    return rejected(`${path}.program must be a workspace .js, .mjs or .cjs path`);
  }
  return {
    kind: "ok",
    value: {
      configuration: {
        args: [],
        default: false,
        env: {},
        name: value.name as string,
        target: { kind: "script", path: program.value },
      },
      nativeWatch: intent.intent,
      ...(justMyCode ? { justMyCode } : {}),
      ...(preLaunchTask ? { preLaunchTask } : {}),
      ...(postDebugTask ? { postDebugTask } : {}),
      ...(serverReadyAction ? { serverReadyAction } : {}),
    },
  };
}

function blockedNpmEnvironmentName(name: string): boolean {
  const normalized = name.toUpperCase();
  return BLOCKED_NPM_ENVIRONMENT_NAMES.has(normalized) || normalized.startsWith("NPM_CONFIG_");
}

function parseNpmLaunchConfiguration(
  value: Record<string, unknown>,
  path: string,
  preLaunchTask: string | undefined,
  postDebugTask: string | undefined,
  justMyCode: NodeDebugJustMyCodePolicy | undefined,
  serverReadyAction: VscodeNodeServerReadyActionRecipe | undefined,
):
  | { readonly kind: "ok"; readonly value: VscodeNodeLaunchConfiguration }
  | { readonly kind: "error"; readonly message: string } {
  if (value.envFile !== undefined) {
    return rejected(`${path}.envFile is unsupported for an npm launch`);
  }
  if (value.runtimeExecutable !== "npm" && value.runtimeExecutable !== "npm.cmd") {
    return rejected(`${path}.runtimeExecutable must be exactly "npm" or "npm.cmd"`);
  }
  if (
    !Array.isArray(value.runtimeArgs) ||
    value.runtimeArgs.length !== 2 ||
    (value.runtimeArgs[0] !== "run" && value.runtimeArgs[0] !== "run-script") ||
    !safeNpmScriptName(value.runtimeArgs[1])
  ) {
    return rejected(
      `${path}.runtimeArgs must be exactly ["run" | "run-script", script] with a safe script name`,
    );
  }
  if (value.program !== undefined) {
    return rejected(`${path} npm launch configuration contains a script program`);
  }
  const packageRoot = workspaceRelative(value.cwd, `${path}.cwd`, true);
  if (packageRoot.kind === "error") return packageRoot;
  const args = stringArray(value.args, `${path}.args`);
  if (args.kind === "error") return args;
  if (args.value.length > 0) {
    return rejected(`${path}.args must be absent or empty for an npm launch`);
  }
  const env = environment(value.env, `${path}.env`);
  if (env.kind === "error") return env;
  if (Object.keys(env.value).some(blockedNpmEnvironmentName)) {
    return rejected(`${path}.env contains a protected environment name`);
  }
  return {
    kind: "ok",
    value: {
      configuration: {
        args: args.value,
        ...(packageRoot.value ? { cwd: packageRoot.value } : {}),
        default: false,
        env: env.value,
        name: value.name as string,
        target: {
          kind: "npm",
          script: value.runtimeArgs[1],
          ...(packageRoot.value ? { packageRoot: packageRoot.value } : {}),
        },
      },
      ...(justMyCode ? { justMyCode } : {}),
      ...(preLaunchTask ? { preLaunchTask } : {}),
      ...(postDebugTask ? { postDebugTask } : {}),
      ...(serverReadyAction ? { serverReadyAction } : {}),
    },
  };
}

function parseServerReadyAction(value: unknown, path: string) {
  if (value === undefined) {
    return {
      kind: "ok" as const,
      value: undefined as VscodeNodeServerReadyActionRecipe | undefined,
    };
  }
  if (!isRecord(value)) return rejected(`${path} must be an object`);
  const unknown = unknownKey(value, ["action", "pattern", "uriFormat"]);
  if (unknown) return rejected(`${path} contains an unsupported field`);
  if (value.action !== "openExternally") {
    return rejected(`${path}.action must be exactly "openExternally"`);
  }
  const match = parseServerReadyPortPattern(value.pattern, `${path}.pattern`);
  if (match.kind === "error") return match;
  const uri = parseServerReadyLoopbackUri(value.uriFormat, `${path}.uriFormat`);
  if (uri.kind === "error") return uri;
  return {
    kind: "ok" as const,
    value: Object.freeze({
      action: "openExternally" as const,
      match: Object.freeze(match.value),
      uri: Object.freeze(uri.value),
    }),
  };
}

function parseServerReadyPortPattern(value: unknown, path: string) {
  const portCapture = "([0-9]+)";
  if (
    !safeString(value, VSCODE_SERVER_READY_PATTERN_MAX_BYTES) ||
    value.split(portCapture).length !== 2
  ) {
    return rejected(`${path} must contain exactly one literal ([0-9]+) port capture`);
  }
  const [prefix, suffix] = value.split(portCapture) as [string, string];
  if (
    !literalServerOutput(prefix, false) ||
    !literalServerOutput(suffix, true) ||
    startsWithAsciiDigit(suffix)
  ) {
    return rejected(
      `${path} supports only a non-empty literal prefix, one numeric port capture, and an unambiguous literal suffix`,
    );
  }
  return {
    kind: "ok" as const,
    value: { kind: "port" as const, prefix, suffix },
  };
}

function parseServerReadyLoopbackUri(value: unknown, path: string) {
  if (!safeString(value, VSCODE_SERVER_READY_URI_FORMAT_MAX_BYTES)) {
    return rejected(`${path} must be a bounded loopback HTTP or HTTPS format`);
  }
  const marker = ":%s";
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0 || markerIndex !== value.lastIndexOf(marker)) {
    return rejected(`${path} must contain exactly one :%s loopback port substitution`);
  }
  const origin = value.slice(0, markerIndex);
  const pathSuffix = value.slice(markerIndex + marker.length);
  const originMatch = /^(http|https):\/\/(localhost|127\.0\.0\.1|\[::1\])$/u.exec(origin);
  if (!originMatch || !safeServerReadyPath(pathSuffix)) {
    return rejected(
      `${path} must be HTTP or HTTPS on localhost, 127.0.0.1, or [::1] with an optional literal path`,
    );
  }
  return {
    kind: "ok" as const,
    value: {
      scheme: originMatch[1] as "http" | "https",
      host: originMatch[2] as "localhost" | "127.0.0.1" | "[::1]",
      path: pathSuffix,
    },
  };
}

function literalServerOutput(value: string, mayBeEmpty: boolean): boolean {
  return (
    (mayBeEmpty || value.length > 0) &&
    // Excluding regex operators makes this fragment's VS Code regex meaning exactly literal.
    /^[A-Za-z0-9 \t,:;/_@#%&'"!=-]*$/u.test(value)
  );
}

function safeServerReadyPath(value: string): boolean {
  if (value === "") return true;
  if (
    !value.startsWith("/") ||
    !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/u.test(value) ||
    /%(?![0-9A-Fa-f]{2})/u.test(value)
  ) {
    return false;
  }
  // Keep URL serialization and common server decoders on the same path. Encoded dot segments,
  // separators, controls, and a second-stage percent escape could otherwise change its meaning.
  if (/%(?:0[0-9A-Fa-f]|1[0-9A-Fa-f]|23|25|2[eEfF]|3[fF]|5[cC]|7[fF])/u.test(value)) {
    return false;
  }
  return !value.split("/").some((segment) => segment === "." || segment === "..");
}

function startsWithAsciiDigit(value: string): boolean {
  const code = value.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function launchJustMyCodePolicy(
  skipFiles: unknown,
  justMyCode: unknown,
  skipFilesPath: string,
  justMyCodePath: string,
) {
  if (justMyCode !== undefined) {
    if (typeof justMyCode !== "boolean") {
      return rejected(`${justMyCodePath} must be a boolean`);
    }
    return {
      kind: "ok" as const,
      value: justMyCode ? ("nodeInternalsAndDependencies" as const) : undefined,
    };
  }
  if (skipFiles === undefined) {
    return { kind: "ok" as const, value: "nodeInternals" as const };
  }
  if (Array.isArray(skipFiles) && skipFiles.length === 0) {
    return { kind: "ok" as const, value: undefined };
  }
  if (
    !Array.isArray(skipFiles) ||
    skipFiles.length > 2 ||
    !skipFiles.every((entry) => typeof entry === "string")
  ) {
    return rejected(
      `${skipFilesPath} supports only exact Node-internals and node_modules launch filters`,
    );
  }
  const filters = new Set(skipFiles);
  if (
    filters.size !== skipFiles.length ||
    [...filters].some(
      (entry) =>
        entry !== VSCODE_NODE_INTERNALS_SKIP_PATTERN &&
        entry !== VSCODE_NODE_DEPENDENCIES_SKIP_PATTERN,
    )
  ) {
    return rejected(
      `${skipFilesPath} supports only unique exact Node-internals and node_modules launch filters`,
    );
  }
  if (filters.has(VSCODE_NODE_INTERNALS_SKIP_PATTERN)) {
    return {
      kind: "ok" as const,
      value: filters.has(VSCODE_NODE_DEPENDENCIES_SKIP_PATTERN)
        ? ("nodeInternalsAndDependencies" as const)
        : ("nodeInternals" as const),
    };
  }
  return filters.has(VSCODE_NODE_DEPENDENCIES_SKIP_PATTERN)
    ? { kind: "ok" as const, value: "dependencies" as const }
    : rejected(`${skipFilesPath} contains an unsupported launch filter`);
}

function attachJustMyCodePolicy(
  skipFiles: unknown,
  justMyCode: unknown,
  skipFilesPath: string,
  justMyCodePath: string,
) {
  if (justMyCode !== undefined && typeof justMyCode !== "boolean") {
    return rejected(`${justMyCodePath} must be a boolean`);
  }
  if (justMyCode === true) {
    return rejected(`${justMyCodePath} cannot enable filtering for attach`);
  }
  return skipFiles === undefined || (Array.isArray(skipFiles) && skipFiles.length === 0)
    ? { kind: "ok" as const, value: undefined }
    : rejected(`${skipFilesPath} must be absent or empty for attach`);
}

function safeNpmScriptName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    byteLength(value) <= MAX_NPM_SCRIPT_NAME_BYTES &&
    /^(?!-)[A-Za-z0-9:_\-.]+$/u.test(value)
  );
}

function optionalTaskLabel(value: unknown, path: string) {
  if (value === undefined) return { kind: "ok" as const, value: undefined };
  return displaySafe(value, VSCODE_PRE_LAUNCH_TASK_MAX_BYTES) && value.trim() === value
    ? { kind: "ok" as const, value }
    : rejected(
        `${path} must be a non-empty display-safe string of at most ${VSCODE_PRE_LAUNCH_TASK_MAX_BYTES} UTF-8 bytes`,
      );
}

function workspaceRelative(value: unknown, path: string, optional: boolean) {
  if (value === undefined && optional) return { kind: "ok" as const, value: undefined };
  if (!safeString(value, MAX_PATH_BYTES) || value.trim() === "") {
    return rejected(`${path} must be a bounded workspace path`);
  }
  const normalized = value.split("\\").join("/");
  const withoutRoot = normalized.startsWith("${workspaceFolder}/")
    ? normalized.slice("${workspaceFolder}/".length)
    : normalized === "${workspaceFolder}"
      ? ""
      : normalized;
  if (
    withoutRoot.includes("${") ||
    withoutRoot.startsWith("/") ||
    /^[A-Za-z]:\//u.test(withoutRoot) ||
    withoutRoot.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return rejected(`${path} must stay inside the workspace and use no dynamic variables`);
  }
  return { kind: "ok" as const, value: withoutRoot || undefined };
}

function stringArray(value: unknown, path: string) {
  if (value === undefined) return { kind: "ok" as const, value: [] as string[] };
  if (
    !Array.isArray(value) ||
    value.length > MAX_ARGUMENTS ||
    !value.every((entry) => safeLiteral(entry, MAX_VALUE_BYTES))
  ) {
    return rejected(`${path} must contain at most ${MAX_ARGUMENTS} bounded literal strings`);
  }
  return { kind: "ok" as const, value: [...value] };
}

function environment(value: unknown, path: string) {
  if (value === undefined) return { kind: "ok" as const, value: {} as Record<string, string> };
  if (!isRecord(value) || Object.keys(value).length > MAX_ENVIRONMENT_ENTRIES) {
    return rejected(`${path} must contain at most ${MAX_ENVIRONMENT_ENTRIES} entries`);
  }
  const entries: [string, string][] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ||
      byteLength(key) > 256 ||
      !safeLiteral(entry, MAX_VALUE_BYTES)
    ) {
      return rejected(`${path} must contain bounded literal string environment values`);
    }
    entries.push([key, entry]);
  }
  // `Object.fromEntries` defines own data properties even for names such as
  // `__proto__`; indexed assignment into `{}` would invoke the legacy setter.
  return { kind: "ok" as const, value: Object.fromEntries(entries) };
}

function displaySafe(value: unknown, maximumBytes: number): value is string {
  return (
    safeString(value, maximumBytes) &&
    value.trim().length > 0 &&
    !/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value)
  );
}

function safeLiteral(value: unknown, maximumBytes: number): value is string {
  return safeString(value, maximumBytes) && !value.includes("${");
}

function safeString(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" && !value.includes("\0") && byteLength(value) <= maximumBytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKey(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).find((key) => !allowed.includes(key));
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function rejected(message: string) {
  return { kind: "error" as const, message: `${message}.` };
}

function invalid(message: string) {
  return {
    kind: "error" as const,
    message: `${VSCODE_NODE_LAUNCH_CONFIGURATION_PATH} ${message}.`,
  };
}
