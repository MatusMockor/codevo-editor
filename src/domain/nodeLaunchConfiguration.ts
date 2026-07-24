import { isNodeDebugPort, type DebugLaunchTarget } from "./debug";
import { joinWorkspacePath, workspaceRelativePath } from "./workspace";

export const NODE_LAUNCH_CONFIGURATION_PATH = ".codevo/launch.json";
export const NODE_LAUNCH_CONFIGURATION_MAX_BYTES = 256 * 1024;

const MAX_CONFIGURATIONS = 64;
const MAX_ARGUMENTS = 128;
const MAX_ENVIRONMENT_ENTRIES = 128;
const MAX_NAME_BYTES = 256;
const MAX_PATH_BYTES = 4 * 1024;
const MAX_SCRIPT_NAME_BYTES = 256;
const MAX_ARGUMENT_BYTES = 16 * 1024;
const MAX_ENVIRONMENT_NAME_BYTES = 256;
const MAX_ENVIRONMENT_VALUE_BYTES = 16 * 1024;

export type NodeLaunchConfigurationTarget =
  | { readonly kind: "attach"; readonly port: number }
  | { readonly kind: "script"; readonly path: string }
  | {
      readonly kind: "test";
      readonly path: string;
      readonly runner: "vitest" | "jest";
      readonly packageRoot?: string;
    }
  | {
      readonly kind: "npm";
      readonly script: string;
      readonly packageRoot?: string;
    };

export interface NodeLaunchConfiguration {
  readonly name: string;
  readonly default: boolean;
  readonly target: NodeLaunchConfigurationTarget;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env: Readonly<Record<string, string>>;
}

export type ParseNodeLaunchConfigurationsResult =
  | { readonly kind: "ok"; readonly configurations: readonly NodeLaunchConfiguration[] }
  | { readonly kind: "error"; readonly message: string };

export type SerializeNodeLaunchConfigurationsResult =
  | {
      readonly kind: "ok";
      readonly configurations: readonly NodeLaunchConfiguration[];
      readonly source: string;
    }
  | { readonly kind: "error"; readonly message: string };

export function parseNodeLaunchConfigurations(source: string): ParseNodeLaunchConfigurationsResult {
  if (utf8ByteLength(source) > NODE_LAUNCH_CONFIGURATION_MAX_BYTES) {
    return invalid(`may be at most ${NODE_LAUNCH_CONFIGURATION_MAX_BYTES} UTF-8 bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return invalid("must contain valid JSON");
  }

  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.configurations)) {
    return invalid('must contain { "version": 1, "configurations": [...] }');
  }
  const rootKeys = rejectUnknownKeys(value, ["version", "configurations"], "root");
  if (rootKeys) return rootKeys;
  if (value.configurations.length > MAX_CONFIGURATIONS) {
    return invalid(`may contain at most ${MAX_CONFIGURATIONS} configurations`);
  }

  const configurations: NodeLaunchConfiguration[] = [];
  const names = new Set<string>();
  for (let index = 0; index < value.configurations.length; index += 1) {
    const parsed = parseConfiguration(value.configurations[index], index);
    if (parsed.kind === "error") return parsed;
    if (names.has(parsed.configuration.name)) {
      return invalid(`has duplicate configuration name "${parsed.configuration.name}"`);
    }
    names.add(parsed.configuration.name);
    configurations.push(parsed.configuration);
  }

  if (configurations.filter((configuration) => configuration.default).length > 1) {
    return invalid("may have only one default configuration");
  }
  return { kind: "ok", configurations };
}

export function serializeNodeLaunchConfigurations(
  configurations: readonly NodeLaunchConfiguration[],
): SerializeNodeLaunchConfigurationsResult {
  if (
    configurations.some(
      (configuration) =>
        configuration.target.kind === "attach" &&
        (configuration.args.length > 0 ||
          configuration.cwd !== undefined ||
          Object.keys(configuration.env).length > 0),
    )
  ) {
    return invalid("attach configurations may not define args, cwd, or env");
  }
  const persistedConfigurations = configurations.map(persistedNodeLaunchConfiguration);
  const source = `${JSON.stringify({ version: 1, configurations: persistedConfigurations }, null, 2)}\n`;
  const parsed = parseNodeLaunchConfigurations(source);
  return parsed.kind === "error"
    ? parsed
    : { kind: "ok", configurations: parsed.configurations, source };
}

function persistedNodeLaunchConfiguration(configuration: NodeLaunchConfiguration) {
  if (configuration.target.kind === "attach") {
    return {
      name: configuration.name,
      default: configuration.default,
      target: configuration.target,
    };
  }
  return configuration;
}

export function upsertNodeLaunchConfiguration(
  configurations: readonly NodeLaunchConfiguration[],
  previousName: string | null,
  configuration: NodeLaunchConfiguration,
): SerializeNodeLaunchConfigurationsResult {
  const index = previousName
    ? configurations.findIndex((candidate) => candidate.name === previousName)
    : -1;
  const next = [...configurations];
  if (index < 0) next.push(configuration);
  else next[index] = configuration;
  if (configuration.default) {
    for (let candidateIndex = 0; candidateIndex < next.length; candidateIndex += 1) {
      if (candidateIndex !== (index < 0 ? next.length - 1 : index)) {
        next[candidateIndex] = { ...next[candidateIndex]!, default: false };
      }
    }
  }
  return serializeNodeLaunchConfigurations(next);
}

export function deleteNodeLaunchConfiguration(
  configurations: readonly NodeLaunchConfiguration[],
  name: string,
): readonly NodeLaunchConfiguration[] {
  return configurations.filter((configuration) => configuration.name !== name);
}

export function configuredNodeLaunchForDocument(
  configurations: readonly NodeLaunchConfiguration[],
  workspaceRoot: string,
  documentPath: string,
): DebugLaunchTarget | null {
  const configuration = configuredNodeLaunchConfigurationForDocument(
    configurations,
    workspaceRoot,
    documentPath,
  );
  return configuration ? nodeLaunchTargetFromConfiguration(configuration, workspaceRoot) : null;
}

export function configuredNodeLaunchConfigurationForDocument(
  configurations: readonly NodeLaunchConfiguration[],
  workspaceRoot: string,
  documentPath: string,
): NodeLaunchConfiguration | null {
  const relativeDocumentPath = workspaceRelativePath(workspaceRoot, documentPath);
  if (!relativeDocumentPath) return null;

  return (
    configurations.find(
      (candidate) =>
        (candidate.target.kind === "script" || candidate.target.kind === "test") &&
        normalizeRelativePath(candidate.target.path) === relativeDocumentPath,
    ) ??
    configurations.find((candidate) => candidate.default) ??
    null
  );
}

export function nodeLaunchTargetFromConfiguration(
  configuration: NodeLaunchConfiguration,
  workspaceRoot: string,
): DebugLaunchTarget {
  switch (configuration.target.kind) {
    case "attach":
      return { kind: "node-attach", port: configuration.target.port };
    case "script":
      return {
        kind: "node-configured-script",
        scriptPath: joinWorkspacePath(workspaceRoot, configuration.target.path),
        ...configuredNodeLaunchOptions(configuration, workspaceRoot),
      };
    case "test": {
      const packageRootPath = joinWorkspacePath(
        workspaceRoot,
        configuration.target.packageRoot ?? "",
      );
      return {
        kind: "js-configured-test",
        runner: configuration.target.runner,
        filePath: joinWorkspacePath(workspaceRoot, configuration.target.path),
        packageRootPath,
        ...configuredNodeLaunchOptions(configuration, workspaceRoot),
      };
    }
    case "npm":
      return {
        kind: "node-npm-script",
        script: configuration.target.script,
        packageRootPath: joinWorkspacePath(workspaceRoot, configuration.target.packageRoot ?? ""),
        ...configuredNodeLaunchOptions(configuration, workspaceRoot),
      };
  }
}

function configuredNodeLaunchOptions(
  configuration: NodeLaunchConfiguration,
  workspaceRoot: string,
) {
  return {
    args: [...configuration.args],
    cwd: configuration.cwd ? joinWorkspacePath(workspaceRoot, configuration.cwd) : undefined,
    env: { ...configuration.env },
  };
}

function parseConfiguration(
  value: unknown,
  index: number,
):
  | { readonly kind: "ok"; readonly configuration: NodeLaunchConfiguration }
  | { readonly kind: "error"; readonly message: string } {
  const path = `configurations[${index}]`;
  if (!isRecord(value)) return invalid(`${path} must be an object`);
  const target = parseTarget(value.target, `${path}.target`);
  if (target.kind === "error") return target;
  const keys = rejectUnknownKeys(
    value,
    target.target.kind === "attach"
      ? ["name", "default", "target"]
      : ["name", "default", "target", "args", "cwd", "env"],
    path,
  );
  if (keys) return keys;
  if (!isSafeConfigurationName(value.name)) {
    return invalid(
      `${path}.name must be a non-empty display-safe string of at most ${MAX_NAME_BYTES} UTF-8 bytes`,
    );
  }
  if (value.default !== undefined && typeof value.default !== "boolean") {
    return invalid(`${path}.default must be a boolean`);
  }
  if (target.target.kind === "attach") {
    return {
      kind: "ok",
      configuration: {
        name: value.name,
        default: value.default ?? false,
        target: target.target,
        args: [],
        env: {},
      },
    };
  }
  const args = parseStringArray(value.args, `${path}.args`, MAX_ARGUMENTS);
  if (args.kind === "error") return args;
  const cwd = parseOptionalRelativePath(value.cwd, `${path}.cwd`);
  if (cwd.kind === "error") return cwd;
  const env = parseEnvironment(value.env, `${path}.env`);
  if (env.kind === "error") return env;

  return {
    kind: "ok",
    configuration: {
      name: value.name,
      default: value.default ?? false,
      target: target.target,
      args: args.values,
      ...(cwd.value ? { cwd: cwd.value } : {}),
      env: env.value,
    },
  };
}

function parseTarget(
  value: unknown,
  path: string,
):
  | { readonly kind: "ok"; readonly target: NodeLaunchConfigurationTarget }
  | { readonly kind: "error"; readonly message: string } {
  if (!isRecord(value)) return invalid(`${path} must be an object`);
  const allowedTargetKeys =
    value.kind === "attach"
      ? ["kind", "port"]
      : value.kind === "script"
        ? ["kind", "path"]
        : value.kind === "test"
          ? ["kind", "path", "runner", "packageRoot"]
          : value.kind === "npm"
            ? ["kind", "script", "packageRoot"]
            : ["kind"];
  const keys = rejectUnknownKeys(value, allowedTargetKeys, path);
  if (keys) return keys;
  if (value.kind === "attach") {
    return isNodeDebugPort(value.port)
      ? { kind: "ok", target: { kind: "attach", port: value.port } }
      : invalid(`${path}.port must be an integer between 1 and 65535`);
  }
  if (value.kind === "script") {
    const targetPath = parseRequiredRelativePath(value.path, `${path}.path`);
    return targetPath.kind === "error"
      ? targetPath
      : { kind: "ok", target: { kind: "script", path: targetPath.value } };
  }
  if (value.kind === "test") {
    if (value.runner !== "vitest" && value.runner !== "jest") {
      return invalid(`${path}.runner must be "vitest" or "jest"`);
    }
    const targetPath = parseRequiredRelativePath(value.path, `${path}.path`);
    if (targetPath.kind === "error") return targetPath;
    const packageRoot = parseOptionalRelativePath(value.packageRoot, `${path}.packageRoot`);
    if (packageRoot.kind === "error") return packageRoot;
    return {
      kind: "ok",
      target: {
        kind: "test",
        path: targetPath.value,
        runner: value.runner,
        ...(packageRoot.value ? { packageRoot: packageRoot.value } : {}),
      },
    };
  }
  if (value.kind === "npm") {
    if (!isNonEmptyString(value.script, MAX_SCRIPT_NAME_BYTES) || /[\r\n\0]/.test(value.script)) {
      return invalid(
        `${path}.script must be a non-empty single-line string of at most ${MAX_SCRIPT_NAME_BYTES} UTF-8 bytes`,
      );
    }
    const packageRoot = parseOptionalRelativePath(value.packageRoot, `${path}.packageRoot`);
    if (packageRoot.kind === "error") return packageRoot;
    return {
      kind: "ok",
      target: {
        kind: "npm",
        script: value.script,
        ...(packageRoot.value ? { packageRoot: packageRoot.value } : {}),
      },
    };
  }
  return invalid(`${path}.kind must be "attach", "script", "test", or "npm"`);
}

function parseStringArray(value: unknown, path: string, maximum: number) {
  if (value === undefined) return { kind: "ok" as const, values: [] as string[] };
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    !value.every((entry) => isSafeValue(entry, MAX_ARGUMENT_BYTES))
  ) {
    return invalid(
      `${path} must be an array of at most ${maximum} strings of at most ${MAX_ARGUMENT_BYTES} UTF-8 bytes without NUL bytes`,
    );
  }
  return { kind: "ok" as const, values: [...value] };
}

function parseEnvironment(value: unknown, path: string) {
  if (value === undefined) return { kind: "ok" as const, value: {} as Record<string, string> };
  if (!isRecord(value) || Object.keys(value).length > MAX_ENVIRONMENT_ENTRIES) {
    return invalid(`${path} must be an object with at most ${MAX_ENVIRONMENT_ENTRIES} entries`);
  }
  const environment: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
      utf8ByteLength(key) > MAX_ENVIRONMENT_NAME_BYTES ||
      !isSafeValue(entry, MAX_ENVIRONMENT_VALUE_BYTES)
    ) {
      return invalid(
        `${path} must contain valid environment names of at most ${MAX_ENVIRONMENT_NAME_BYTES} UTF-8 bytes and values of at most ${MAX_ENVIRONMENT_VALUE_BYTES} UTF-8 bytes without NUL bytes`,
      );
    }
    environment[key] = entry;
  }
  return { kind: "ok" as const, value: environment };
}

function parseRequiredRelativePath(value: unknown, path: string) {
  const parsed = parseOptionalRelativePath(value, path);
  if (parsed.kind === "error") return parsed;
  return parsed.value ? parsed : invalid(`${path} must be a non-empty workspace-relative path`);
}

function parseOptionalRelativePath(value: unknown, path: string) {
  if (value === undefined || value === "") return { kind: "ok" as const, value: undefined };
  if (!isNonEmptyString(value, MAX_PATH_BYTES)) {
    return invalid(
      `${path} must be a workspace-relative path of at most ${MAX_PATH_BYTES} UTF-8 bytes`,
    );
  }
  const normalized = normalizeRelativePath(value);
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    return invalid(`${path} must stay inside the workspace`);
  }
  return { kind: "ok" as const, value: normalized };
}

function normalizeRelativePath(path: string): string {
  return path
    .trim()
    .split("\\")
    .join("/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/");
}

function isSafeValue(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && !value.includes("\0") && utf8ByteLength(value) <= maxBytes;
}

function isNonEmptyString(value: unknown, maxBytes: number): value is string {
  return isSafeValue(value, maxBytes) && value.trim().length > 0;
}

function isSafeConfigurationName(value: unknown): value is string {
  return (
    isNonEmptyString(value, MAX_NAME_BYTES) &&
    !/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value)
  );
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): { readonly kind: "error"; readonly message: string } | null {
  const unknown = Object.keys(record).find((key) => !allowed.includes(key));
  return unknown ? invalid(`${path} contains unknown field "${unknown}"`) : null;
}

function invalid(message: string) {
  return { kind: "error" as const, message: `${NODE_LAUNCH_CONFIGURATION_PATH} ${message}.` };
}
