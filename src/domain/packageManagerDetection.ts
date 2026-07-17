export type NodePackageManager = "npm" | "pnpm" | "yarn" | "bun";

const NODE_PACKAGE_MANAGERS: readonly NodePackageManager[] = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
];

const LOCKFILE_DETECTION_ORDER: ReadonlyArray<{
  fileName: string;
  packageManager: NodePackageManager;
}> = [
  { fileName: "pnpm-lock.yaml", packageManager: "pnpm" },
  { fileName: "yarn.lock", packageManager: "yarn" },
  { fileName: "bun.lockb", packageManager: "bun" },
  { fileName: "bun.lock", packageManager: "bun" },
  { fileName: "package-lock.json", packageManager: "npm" },
];

interface DetectNodePackageManagerOptions {
  rootFileNames: readonly string[];
  packageJsonText?: string | null;
}

export function detectNodePackageManager({
  rootFileNames,
  packageJsonText,
}: DetectNodePackageManagerOptions): NodePackageManager {
  const declared = declaredPackageManager(packageJsonText);

  if (declared) {
    return declared;
  }

  const fileNames = new Set(rootFileNames);

  for (const { fileName, packageManager } of LOCKFILE_DETECTION_ORDER) {
    if (fileNames.has(fileName)) {
      return packageManager;
    }
  }

  return "npm";
}

function declaredPackageManager(
  packageJsonText: string | null | undefined,
): NodePackageManager | null {
  if (!packageJsonText) {
    return null;
  }

  let manifest: unknown;

  try {
    manifest = JSON.parse(packageJsonText);
  } catch {
    return null;
  }

  if (typeof manifest !== "object" || manifest === null) {
    return null;
  }

  const field = (manifest as Record<string, unknown>).packageManager;

  if (typeof field !== "string") {
    return null;
  }

  const name = field.split("@", 1)[0];

  return isNodePackageManager(name) ? name : null;
}

function isNodePackageManager(value: string): value is NodePackageManager {
  return (NODE_PACKAGE_MANAGERS as readonly string[]).includes(value);
}
