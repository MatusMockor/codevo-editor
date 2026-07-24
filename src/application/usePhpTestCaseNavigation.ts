import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpTestCaseNavigationTarget, type PhpTestCase } from "../domain/phpTestResults";

interface PhpTestCaseNavigationOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly openNavigationTarget: (
    path: string,
    position: EditorPosition,
    label: string,
  ) => Promise<boolean>;
}

export function usePhpTestCaseNavigation({
  currentWorkspaceRootRef,
  openNavigationTarget,
}: PhpTestCaseNavigationOptions) {
  return useCallback(
    (testCase: PhpTestCase): Promise<boolean> => {
      const rootPath = currentWorkspaceRootRef.current;
      if (!rootPath) return Promise.resolve(false);

      const target = phpTestCaseNavigationTarget(rootPath, testCase);
      return target
        ? openNavigationTarget(target.path, target.position, testCase.name ?? target.path)
        : Promise.resolve(false);
    },
    [currentWorkspaceRootRef, openNavigationTarget],
  );
}
