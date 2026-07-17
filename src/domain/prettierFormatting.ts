export type PrettierErrorKind = "syntax" | "timeout" | "inputTooLarge" | "failed";

export type PrettierFormatResult =
  | { status: "ok"; formatted: string }
  | { status: "unavailable"; message?: string }
  | { status: "error"; kind: PrettierErrorKind; message: string };

export interface PrettierFormattingGateway {
  format(
    rootPath: string,
    relativePath: string,
    content: string,
  ): Promise<PrettierFormatResult>;
}

export type PrettierConfigSource = "rcFile" | "configFile" | "packageJson";

const PRETTIER_RC_EXTENSIONS = [
  "json",
  "json5",
  "yml",
  "yaml",
  "toml",
  "js",
  "cjs",
  "mjs",
  "ts",
  "cts",
  "mts",
] as const;

const PRETTIER_CONFIG_EXTENSIONS = ["js", "cjs", "mjs", "ts", "cts", "mts"] as const;

export function detectPrettierConfigSource(
  workspaceFileNames: readonly string[],
  packageJsonContent: string | null,
): PrettierConfigSource | null {
  if (workspaceFileNames.some(isPrettierRcFileName)) {
    return "rcFile";
  }

  if (workspaceFileNames.some(isPrettierConfigFileName)) {
    return "configFile";
  }

  if (packageJsonDeclaresPrettier(packageJsonContent)) {
    return "packageJson";
  }

  return null;
}

export function isPrettierRcFileName(fileName: string): boolean {
  if (fileName === ".prettierrc") {
    return true;
  }

  return PRETTIER_RC_EXTENSIONS.some(
    (extension) => fileName === `.prettierrc.${extension}`,
  );
}

export function isPrettierConfigFileName(fileName: string): boolean {
  return PRETTIER_CONFIG_EXTENSIONS.some(
    (extension) => fileName === `prettier.config.${extension}`,
  );
}

export function packageJsonDeclaresPrettier(
  packageJsonContent: string | null,
): boolean {
  if (!packageJsonContent) {
    return false;
  }

  const manifest = parseJson(packageJsonContent);

  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(manifest, "prettier");
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}
