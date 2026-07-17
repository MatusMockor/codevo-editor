import { JsTestGutterTargetsCache } from "./jsTestGutterTargetsCache";
import type { TestGutterTarget } from "./testGutterTargets";

export class JsGutterTargetsCoordinator {
  private readonly testTargets = new JsTestGutterTargetsCache();

  resolveTest(
    workspaceRoot: string | null,
    path: string,
    content: string,
  ): TestGutterTarget[] {
    return this.testTargets.resolve(this.cacheKey(workspaceRoot, path), content);
  }

  private cacheKey(workspaceRoot: string | null, path: string): string {
    return JSON.stringify([workspaceRoot, path]);
  }
}

export const jsGutterTargetsCoordinator = new JsGutterTargetsCoordinator();
