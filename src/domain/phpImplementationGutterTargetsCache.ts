import {
  phpImplementationGutterTargets,
  type PhpImplementationGutterTarget,
} from "./phpImplementationGutterTargets";

interface CachedEntry {
  contentLength: number;
  content: string;
  targets: PhpImplementationGutterTarget[];
}

const DEFAULT_MAX_ENTRIES = 32;

// Caches PHP implementation gutter targets per file path so navigating back to
// an unchanged document reuses the previous parse instead of re-scanning the
// whole file on the main thread. The cache is content-aware: a content change
// for the same path re-parses and replaces the entry, keeping gutter glyphs
// accurate. Keys are absolute document paths, which are globally unique per
// workspace root, plus full content, so the cache is safe to share across open
// project tabs - a hit can never serve another file's targets.
export class PhpImplementationGutterTargetsCache {
  private readonly entries = new Map<string, CachedEntry>();

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  resolve(path: string, content: string): PhpImplementationGutterTarget[] {
    const cached = this.entries.get(path);

    if (
      cached &&
      cached.contentLength === content.length &&
      cached.content === content
    ) {
      // Refresh recency so frequently revisited files survive eviction.
      this.entries.delete(path);
      this.entries.set(path, cached);
      return cached.targets;
    }

    const targets = phpImplementationGutterTargets(content);
    this.store(path, content, targets);
    return targets;
  }

  invalidate(path: string): void {
    this.entries.delete(path);
  }

  clear(): void {
    this.entries.clear();
  }

  private store(
    path: string,
    content: string,
    targets: PhpImplementationGutterTarget[],
  ): void {
    this.entries.delete(path);
    this.entries.set(path, {
      content,
      contentLength: content.length,
      targets,
    });

    if (this.entries.size <= this.maxEntries) {
      return;
    }

    const oldestPath = this.entries.keys().next().value;

    if (oldestPath === undefined) {
      return;
    }

    this.entries.delete(oldestPath);
  }
}
