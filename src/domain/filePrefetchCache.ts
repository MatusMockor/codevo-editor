import { normalizedWorkspaceRootKey } from "./workspaceRootKey";

const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

const NON_PREFETCHABLE_EXTENSIONS = new Set<string>([
  "7z",
  "bin",
  "bmp",
  "br",
  "bz2",
  "class",
  "dll",
  "dmg",
  "doc",
  "docx",
  "dylib",
  "ear",
  "eot",
  "exe",
  "gif",
  "gz",
  "ico",
  "jar",
  "jpeg",
  "jpg",
  "lock",
  "mp3",
  "mp4",
  "o",
  "obj",
  "ogg",
  "otf",
  "pdf",
  "phar",
  "png",
  "ppt",
  "pptx",
  "rar",
  "so",
  "sqlite",
  "tar",
  "tgz",
  "ttf",
  "wasm",
  "wav",
  "webm",
  "webp",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "zip",
  "zst",
]);

export interface FilePrefetchCacheOptions {
  maxEntries?: number;
  maxTotalBytes?: number;
}

interface PrefetchEntry {
  rootKey: string;
  content: string;
  bytes: number;
}

/**
 * Per-workspace LRU cache of file contents prefetched on hover so that opening
 * a file can resolve synchronously instead of awaiting a fresh disk read.
 *
 * Entries are keyed by both the normalized workspace root and the file path so
 * that content from an inactive workspace can never satisfy a lookup for the
 * active one. Eviction is bounded by an entry count and a total byte budget to
 * keep memory predictable.
 */
export class FilePrefetchCache {
  private readonly entries = new Map<string, PrefetchEntry>();
  private readonly maxEntries: number;
  private readonly maxTotalBytes: number;
  private totalBytes = 0;

  constructor(options: FilePrefetchCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.maxTotalBytes = Math.max(
      1,
      options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    );
  }

  set(rootPath: string | null, path: string, content: string): void {
    const rootKey = normalizedWorkspaceRootKey(rootPath);

    if (!path) {
      return;
    }

    const existing = this.entries.get(path);

    if (existing) {
      this.totalBytes -= existing.bytes;
      this.entries.delete(path);
    }

    const bytes = byteLength(content);
    this.entries.set(path, { rootKey, content, bytes });
    this.totalBytes += bytes;
    this.evictUntilWithinBudget();
  }

  get(rootPath: string | null, path: string): string | null {
    const entry = this.entries.get(path);

    if (!entry) {
      return null;
    }

    if (entry.rootKey !== normalizedWorkspaceRootKey(rootPath)) {
      return null;
    }

    // Mark as most recently used.
    this.entries.delete(path);
    this.entries.set(path, entry);

    return entry.content;
  }

  has(rootPath: string | null, path: string): boolean {
    const entry = this.entries.get(path);

    if (!entry) {
      return false;
    }

    return entry.rootKey === normalizedWorkspaceRootKey(rootPath);
  }

  invalidate(path: string): void {
    const existing = this.entries.get(path);

    if (!existing) {
      return;
    }

    this.totalBytes -= existing.bytes;
    this.entries.delete(path);
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private evictUntilWithinBudget(): void {
    while (
      this.entries.size > this.maxEntries ||
      this.totalBytes > this.maxTotalBytes
    ) {
      const oldestKey = this.entries.keys().next().value;

      if (oldestKey === undefined) {
        return;
      }

      const oldest = this.entries.get(oldestKey);

      if (!oldest) {
        return;
      }

      this.totalBytes -= oldest.bytes;
      this.entries.delete(oldestKey);
    }
  }
}

export function shouldPrefetchFileContent(path: string): boolean {
  if (!path) {
    return false;
  }

  const extension = fileExtension(path);

  if (!extension) {
    return true;
  }

  return !NON_PREFETCHABLE_EXTENSIONS.has(extension);
}

export function isPrefetchableContentSize(
  content: string,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
): boolean {
  return byteLength(content) <= maxFileBytes;
}

function fileExtension(path: string): string {
  const normalized = path.split("\\").join("/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dotIndex = name.lastIndexOf(".");

  if (dotIndex <= 0) {
    return "";
  }

  return name.slice(dotIndex + 1).toLowerCase();
}

function byteLength(content: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(content).length;
  }

  return content.length;
}
