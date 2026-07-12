import { PhpImplementationGutterTargetsCache } from "./phpImplementationGutterTargetsCache";
import type { PhpImplementationGutterTarget } from "./phpImplementationGutterTargets";
import { PhpTestGutterTargetsCache } from "./phpTestGutterTargetsCache";
import type { PhpTestGutterTarget } from "./phpTestGutterTargets";

// Shares only pure parse results across editor panes. Decorations, click
// targets, and active-model checks remain owned by each EditorSurface.
export class PhpGutterTargetsCoordinator {
  private readonly implementationTargets =
    new PhpImplementationGutterTargetsCache();
  private readonly testTargets = new PhpTestGutterTargetsCache();

  resolveImplementation(
    workspaceRoot: string | null,
    path: string,
    content: string,
  ): PhpImplementationGutterTarget[] {
    return this.implementationTargets.resolve(
      this.cacheKey(workspaceRoot, path),
      content,
    );
  }

  resolveTest(
    workspaceRoot: string | null,
    path: string,
    content: string,
  ): PhpTestGutterTarget[] {
    return this.testTargets.resolve(this.cacheKey(workspaceRoot, path), content);
  }

  private cacheKey(workspaceRoot: string | null, path: string): string {
    return JSON.stringify([workspaceRoot, path]);
  }
}

export const phpGutterTargetsCoordinator = new PhpGutterTargetsCoordinator();
