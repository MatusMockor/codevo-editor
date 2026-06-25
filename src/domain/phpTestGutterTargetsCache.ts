import {
  phpTestGutterTargets,
  type PhpTestGutterTarget,
} from "./phpTestGutterTargets";

interface CachedEntry {
  contentLength: number;
  content: string;
  targets: PhpTestGutterTarget[];
}

const DEFAULT_MAX_ENTRIES = 32;

// Caches PHP test gutter targets per file path so navigating back to an
// unchanged test file reuses the previous parse instead of re-scanning the
// whole file on the main thread. Mirrors `PhpImplementationGutterTargetsCache`:
// content-aware (a change for the same path re-parses and replaces the entry)
// and keyed by absolute document path - globally unique per workspace root -
// plus full content, so a hit can never serve another file's targets across
// open project tabs.
export class PhpTestGutterTargetsCache {
  private readonly entries = new Map<string, CachedEntry>();

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  resolve(path: string, content: string): PhpTestGutterTarget[] {
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

    const targets = phpTestGutterTargets(content);
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
    targets: PhpTestGutterTarget[],
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
