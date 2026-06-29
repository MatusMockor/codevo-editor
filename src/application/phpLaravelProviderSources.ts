import {
  joinWorkspacePath,
  workspaceRelativePath,
  type FileEntry,
} from "../domain/workspace";

// Minimal slice of the workspace files gateway needed to read service-provider
// sources. Injecting just these two methods keeps the loader unit-testable
// without the full file-system gateway and follows dependency inversion. It
// mirrors the migration source reader so the active workspace root is the only
// file system either loader ever touches, preserving per-project isolation.
export interface PhpLaravelProviderSourceReader {
  readDirectory(path: string): Promise<FileEntry[]>;
  readTextFile(path: string): Promise<string>;
}

const PROVIDERS_RELATIVE_DIR = "app/Providers";

export function phpLaravelProvidersDirectory(root: string): string {
  return joinWorkspacePath(root, PROVIDERS_RELATIVE_DIR);
}

// True when `path` lives at or under `<root>/app/Providers`. Used to decide
// whether a file-system change should invalidate the cached provider sources for
// that root. Conservative by design: any change under the directory counts
// (added/removed/renamed provider, sub-directory, etc.). A sibling directory
// whose name merely starts with "Providers" must not match, hence the trailing
// slash check.
export function isPhpLaravelProviderPath(root: string, path: string): boolean {
  const relativePath = workspaceRelativePath(root, path);

  if (relativePath === null) {
    return false;
  }

  return (
    relativePath === PROVIDERS_RELATIVE_DIR ||
    relativePath.startsWith(`${PROVIDERS_RELATIVE_DIR}/`)
  );
}

// Reads every `*.php` file under `<root>/app/Providers` and returns their
// contents sorted by path so the order - and therefore the signature - is
// stable. Service providers are where Laravel "magic" such as
// `Builder::macro('name', ...)` is registered, so feeding these sources into the
// completion pipeline lets provider-defined macros surface. Graceful by design:
// a missing directory or an unreadable file yields fewer (or no) sources, so
// callers transparently fall back to whatever the edited file alone declares.
export async function loadPhpLaravelProviderSources(
  root: string,
  reader: PhpLaravelProviderSourceReader,
): Promise<string[]> {
  const directory = phpLaravelProvidersDirectory(root);
  const filePaths = await collectProviderFilePaths(directory, reader);
  filePaths.sort();

  const sources: string[] = [];

  for (const filePath of filePaths) {
    try {
      sources.push(await reader.readTextFile(filePath));
      continue;
    } catch {
      // Skip an unreadable provider; the remaining files still contribute.
    }
  }

  return sources;
}

async function collectProviderFilePaths(
  directory: string,
  reader: PhpLaravelProviderSourceReader,
): Promise<string[]> {
  let entries: FileEntry[];

  try {
    entries = await reader.readDirectory(directory);
  } catch {
    return [];
  }

  const filePaths: string[] = [];

  for (const entry of entries) {
    if (entry.kind === "directory") {
      const nested = await collectProviderFilePaths(entry.path, reader);
      filePaths.push(...nested);
      continue;
    }

    if (entry.path.toLowerCase().endsWith(".php")) {
      filePaths.push(entry.path);
    }
  }

  return filePaths;
}

// FNV-1a over the provider sources, separated by a byte that cannot appear in
// the content boundary so re-partitioning the same bytes changes the hash. The
// signature feeds the PHP class-member cache key so a provider edit invalidates
// the cached members instead of serving stale macros.
export function phpLaravelProviderSourcesSignature(
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
    // A separator between files so re-partitioning the same bytes across a file
    // boundary changes the hash; the leading count below disambiguates further.
    update(" ");
  }

  return `${sources.length}:${hash >>> 0}`;
}
