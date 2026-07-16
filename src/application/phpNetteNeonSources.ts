import {
  getParentPath,
  joinWorkspacePath,
  workspaceRelativePath,
  type FileEntry,
} from "../domain/workspace";
import { neonIncludesFromSource } from "../domain/neonConfig";

export interface PhpNetteNeonSourceReader {
  readDirectory(path: string): Promise<FileEntry[]>;
  readTextFile(path: string): Promise<string>;
}

const NEON_EXTENSION = ".neon";
const NEON_SCAN_RELATIVE_DIRS = ["config", "app/config", "app/modules"];
const NEON_MAX_SOURCE_FILES = 300;

export interface PhpNetteNeonSource {
  path: string;
  source: string;
}

export interface PhpNetteNeonSourceCollection {
  discoveredPaths: ReadonlySet<string>;
  entries: readonly PhpNetteNeonSource[];
}

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
  return (await loadPhpNetteNeonConfigSourceEntries(root, reader)).map(
    (entry) => entry.source,
  );
}

export async function loadPhpNetteNeonConfigSourceEntries(
  root: string,
  reader: PhpNetteNeonSourceReader,
): Promise<PhpNetteNeonSource[]> {
  return [
    ...(await loadPhpNetteNeonConfigSourceCollection(root, reader)).entries,
  ];
}

export async function loadPhpNetteNeonConfigSourceCollection(
  root: string,
  reader: PhpNetteNeonSourceReader,
): Promise<PhpNetteNeonSourceCollection> {
  const filePaths = await collectPhpNetteNeonConfigPaths(root, reader);
  filePaths.sort();
  const discoveredPaths = new Set<string>();
  const entriesByPath = new Map<string, PhpNetteNeonSource>();
  const loadPath = async (filePath: string): Promise<void> => {
    if (
      discoveredPaths.has(filePath) ||
      discoveredPaths.size >= NEON_MAX_SOURCE_FILES ||
      workspaceRelativePath(root, filePath) === null ||
      !filePath.toLowerCase().endsWith(NEON_EXTENSION)
    ) {
      return;
    }

    discoveredPaths.add(filePath);

    let source: string;

    try {
      source = await reader.readTextFile(filePath);
    } catch {
      return;
    }

    entriesByPath.set(filePath, { path: filePath, source });

    for (const include of neonIncludesFromSource(source)) {
      const includedPath = resolvePhpNetteIncludePath(
        root,
        filePath,
        include.path,
      );

      if (!includedPath) {
        continue;
      }

      await loadPath(includedPath);
    }
  };

  for (const filePath of filePaths) {
    await loadPath(filePath);
  }

  return {
    discoveredPaths,
    entries: phpNetteNeonSourcesInMergePrecedence(
      root,
      Array.from(entriesByPath.values()),
    ),
  };
}

function phpNetteNeonSourcesInMergePrecedence(
  root: string,
  entries: readonly PhpNetteNeonSource[],
): PhpNetteNeonSource[] {
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const includesByPath = new Map<string, string[]>();
  const includedPaths = new Set<string>();

  for (const entry of entries) {
    const includes = neonIncludesFromSource(entry.source).flatMap((include) => {
      const path = resolvePhpNetteIncludePath(root, entry.path, include.path);
      return path && entriesByPath.has(path) ? [path] : [];
    });

    includesByPath.set(entry.path, includes);

    for (const path of includes) {
      includedPaths.add(path);
    }
  }

  const ordered: PhpNetteNeonSource[] = [];
  const visited = new Set<string>();
  const visit = (path: string): void => {
    if (visited.has(path) || ordered.length >= NEON_MAX_SOURCE_FILES) {
      return;
    }

    const entry = entriesByPath.get(path);

    if (!entry) {
      return;
    }

    visited.add(path);
    ordered.push(entry);

    for (const includedPath of [...(includesByPath.get(path) ?? [])].reverse()) {
      visit(includedPath);
    }
  };
  const rootPaths = entries
    .map((entry) => entry.path)
    .filter((path) => !includedPaths.has(path))
    .sort();

  for (const path of rootPaths) {
    visit(path);
  }

  for (const path of entries.map((entry) => entry.path).sort()) {
    visit(path);
  }

  return ordered;
}

function resolvePhpNetteIncludePath(
  root: string,
  includingPath: string,
  includePath: string,
): string | null {
  const reference = includePath.trim().split("\\").join("/");

  if (!reference) {
    return null;
  }

  const relativeBase = workspaceRelativePath(root, getParentPath(includingPath));
  const rootRelative = reference.startsWith("/");
  const combined = rootRelative
    ? reference.replace(/^\/+/, "")
    : [relativeBase, reference].filter(Boolean).join("/");
  const segments: string[] = [];

  for (const segment of combined.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }

      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  if (segments.length === 0) {
    return null;
  }

  const lastSegment = segments[segments.length - 1] ?? "";
  const relativePath = lastSegment.includes(".")
    ? segments.join("/")
    : `${segments.join("/")}${NEON_EXTENSION}`;

  return joinWorkspacePath(root, relativePath);
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
