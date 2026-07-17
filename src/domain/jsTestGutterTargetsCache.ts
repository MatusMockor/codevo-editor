import { jsTestGutterTargets } from "./jsTestGutterTargets";
import type { TestGutterTarget } from "./testGutterTargets";

interface CachedEntry {
  contentLength: number;
  content: string;
  targets: TestGutterTarget[];
}

const DEFAULT_MAX_ENTRIES = 32;

export class JsTestGutterTargetsCache {
  private readonly entries = new Map<string, CachedEntry>();

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  resolve(path: string, content: string): TestGutterTarget[] {
    const cached = this.entries.get(path);

    if (
      cached &&
      cached.contentLength === content.length &&
      cached.content === content
    ) {
      this.entries.delete(path);
      this.entries.set(path, cached);
      return cached.targets;
    }

    const targets = jsTestGutterTargets(content);
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
    targets: TestGutterTarget[],
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
