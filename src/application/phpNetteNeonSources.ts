import {
  joinWorkspacePath,
  workspaceRelativePath,
  type FileEntry,
} from "../domain/workspace";

export interface PhpNetteNeonSourceReader {
  readDirectory(path: string): Promise<FileEntry[]>;
  readTextFile(path: string): Promise<string>;
}

const NEON_EXTENSION = ".neon";
const NEON_SCAN_RELATIVE_DIRS = ["config", "app/config", "app/modules"];
const NEON_MAX_SOURCE_FILES = 300;

export function isPhpNetteNeonConfigPath(root: string, path: string): boolean {
  const relativePath = workspaceRelativePath(root, path);

  if (relativePath === null) {
    return false;
  }

  if (!relativePath.toLowerCase().endsWith(NEON_EXTENSION)) {
    return false;
  }

  return NEON_SCAN_RELATIVE_DIRS.some(
    (directory) =>
      relativePath === directory || relativePath.startsWith(`${directory}/`),
  );
}

export async function loadPhpNetteNeonConfigSources(
  root: string,
  reader: PhpNetteNeonSourceReader,
): Promise<string[]> {
  const filePaths = await collectPhpNetteNeonConfigPaths(root, reader);
  filePaths.sort();

  const sources: string[] = [];

  for (const filePath of filePaths) {
    try {
      sources.push(await reader.readTextFile(filePath));
    } catch {
      // Missing/unreadable config files should not disable PHP intelligence.
    }
  }

  return sources;
}

export function phpNetteNeonConfigSourcesSignature(
  sources: readonly string[],
): string {
  let hash = 2166136261;

  const update = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };

  for (const source of sources) {
    update(source);
    update(" ");
  }

  return `${sources.length}:${hash >>> 0}`;
}

async function collectPhpNetteNeonConfigPaths(
  root: string,
  reader: PhpNetteNeonSourceReader,
): Promise<string[]> {
  const paths = new Set<string>();

  for (const relativeDirectory of NEON_SCAN_RELATIVE_DIRS) {
    if (paths.size >= NEON_MAX_SOURCE_FILES) {
      break;
    }

    await collectPhpNetteNeonConfigPathsUnderDirectory(
      joinWorkspacePath(root, relativeDirectory),
      reader,
      paths,
    );
  }

  return Array.from(paths);
}

async function collectPhpNetteNeonConfigPathsUnderDirectory(
  directory: string,
  reader: PhpNetteNeonSourceReader,
  paths: Set<string>,
): Promise<void> {
  if (paths.size >= NEON_MAX_SOURCE_FILES) {
    return;
  }

  let entries: FileEntry[];

  try {
    entries = await reader.readDirectory(directory);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (paths.size >= NEON_MAX_SOURCE_FILES) {
      return;
    }

    if (entry.kind === "directory") {
      await collectPhpNetteNeonConfigPathsUnderDirectory(
        entry.path,
        reader,
        paths,
      );
      continue;
    }

    if (entry.path.toLowerCase().endsWith(NEON_EXTENSION)) {
      paths.add(entry.path);
    }
  }
}
