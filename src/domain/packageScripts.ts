export interface PackageScript {
  name: string;
  command: string | string[];
}

const PACKAGE_SCRIPT_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._:-]*$/;

export function isPackageScriptName(name: string): boolean {
  return PACKAGE_SCRIPT_NAME_PATTERN.test(name);
}

export function parseComposerScripts(jsonText: string): PackageScript[] {
  const scripts = manifestScripts(jsonText);

  if (!scripts) {
    return [];
  }

  return Object.entries(scripts).flatMap<PackageScript>(([name, command]) => {
    if (!isPackageScriptName(name)) {
      return [];
    }

    if (typeof command === "string") {
      return [{ name, command }];
    }

    if (!isStringCommandArray(command)) {
      return [];
    }

    return [{ name, command: [...command] }];
  });
}

export function parsePackageJsonScripts(jsonText: string): PackageScript[] {
  const scripts = manifestScripts(jsonText);

  if (!scripts) {
    return [];
  }

  return Object.entries(scripts).flatMap<PackageScript>(([name, command]) => {
    if (!isPackageScriptName(name)) {
      return [];
    }

    if (typeof command !== "string") {
      return [];
    }

    return [{ name, command }];
  });
}

function manifestScripts(jsonText: string): Record<string, unknown> | null {
  let manifest: unknown;

  try {
    manifest = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!isRecord(manifest)) {
    return null;
  }

  if (!isRecord(manifest.scripts)) {
    return null;
  }

  return manifest.scripts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringCommandArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string")
  );
}
