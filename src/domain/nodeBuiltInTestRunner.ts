export const MAX_NODE_TEST_PACKAGE_JSON_BYTES = 256 * 1024;
export const MAX_NODE_TEST_SCRIPT_COUNT = 128;
export const MAX_NODE_TEST_SCRIPT_NAME_BYTES = 128;
export const MIN_NODE_TEST_RUNNER_MAJOR = 20;

export interface NodeBuiltInTestManifest {
  readonly scriptNames: readonly string[];
}

export interface NodeTestRuntimeCapability {
  readonly executablePath: string;
  readonly version: {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
  };
}

/**
 * Detects an explicit package-owned opt-in to Node's built-in test runner.
 *
 * This intentionally does not infer a runner from `*.test.*` filenames or a
 * `node:test` import: those signals are shared with other runners and would
 * silently change the workspace's existing test command.
 */
export function detectNodeBuiltInTestManifest(
  packageJsonSource: string,
): NodeBuiltInTestManifest | null {
  if (utf8Length(packageJsonSource) > MAX_NODE_TEST_PACKAGE_JSON_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonSource);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.scripts)) return null;

  const entries = Object.entries(parsed.scripts);
  if (entries.length > MAX_NODE_TEST_SCRIPT_COUNT) return null;

  const scriptNames = entries
    .filter(
      ([name, command]) =>
        safeScriptName(name) && typeof command === "string" && isExplicitNodeTestCommand(command),
    )
    .map(([name]) => name)
    .sort();

  return scriptNames.length > 0 ? { scriptNames } : null;
}

export function nodeTestRuntimeCapability(
  executablePath: string,
  versionOutput: string,
): NodeTestRuntimeCapability | null {
  // Renderer-side evidence only. The backend must independently canonicalize,
  // launch, bound, and version-gate the runtime before constructing a run plan.
  const executable = executablePath.trim();
  if (!isAbsolutePath(executable) || hasControl(executable)) return null;

  const match = /^v(\d+)\.(\d+)\.(\d+)\r?\n?$/.exec(versionOutput);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch) ||
    major < MIN_NODE_TEST_RUNNER_MAJOR
  ) {
    return null;
  }

  return { executablePath: executable, version: { major, minor, patch } };
}

function isExplicitNodeTestCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || hasControl(trimmed) || /[;&|`$><()]/.test(trimmed)) return false;

  const tokens = trimmed.split(/ +/);
  if (tokens[0] !== "node" && tokens[0] !== "node.exe") return false;
  return tokens[1] === "--test";
}

function safeScriptName(name: string): boolean {
  return (
    name.length > 0 && utf8Length(name) <= MAX_NODE_TEST_SCRIPT_NAME_BYTES && !hasControl(name)
  );
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function hasControl(value: string): boolean {
  return /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
