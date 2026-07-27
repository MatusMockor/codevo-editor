export const VSCODE_LAUNCH_GLOB_LIST_MAX_ELEMENTS = 128;
export const VSCODE_LAUNCH_GLOB_MAX_BYTES = 4 * 1024;

declare const vscodeLaunchGlobListBrand: unique symbol;

export type VscodeLaunchGlobList = readonly string[] & {
  readonly [vscodeLaunchGlobListBrand]: true;
};

export type ParseVscodeLaunchGlobListResult =
  | { readonly kind: "ok"; readonly value: VscodeLaunchGlobList | undefined }
  | { readonly kind: "error"; readonly message: string };

export function parseVscodeLaunchGlobList(
  value: unknown,
  path: string,
): ParseVscodeLaunchGlobListResult {
  if (value === undefined) return { kind: "ok", value: undefined };
  if (!Array.isArray(value)) return invalid(path);
  const globs = [...value];
  if (
    globs.length > VSCODE_LAUNCH_GLOB_LIST_MAX_ELEMENTS ||
    !globs.every(
      (glob) =>
        displaySafeString(glob, VSCODE_LAUNCH_GLOB_MAX_BYTES) &&
        !remainingGlob(glob).includes("${"),
    )
  ) {
    return invalid(path);
  }
  return {
    kind: "ok",
    value: Object.freeze(globs) as VscodeLaunchGlobList,
  };
}

export function displaySafeString(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value) &&
    byteLength(value) <= maximumBytes
  );
}

function remainingGlob(value: string): string {
  const withoutNegation = value.startsWith("!") ? value.slice(1) : value;
  if (!withoutNegation.startsWith("${workspaceFolder}")) return withoutNegation;
  return withoutNegation.slice("${workspaceFolder}".length);
}

function invalid(path: string): ParseVscodeLaunchGlobListResult {
  return {
    kind: "error",
    message: `${path} must be an array of at most ${VSCODE_LAUNCH_GLOB_LIST_MAX_ELEMENTS} display-safe glob strings of at most ${VSCODE_LAUNCH_GLOB_MAX_BYTES} UTF-8 bytes each with no dynamic substitutions after an optional leading \${workspaceFolder}.`,
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
