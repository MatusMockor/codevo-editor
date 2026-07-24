import { useMemo, useRef } from "react";

interface PathBearingValue {
  path: string;
}

export function useStableDocumentPaths(documents: readonly PathBearingValue[]): string[] {
  const previousPathsRef = useRef<string[]>([]);

  return useMemo(() => {
    const nextPaths = documents.map((document) => document.path);

    return reuseEqualStringArray(previousPathsRef, nextPaths);
  }, [documents]);
}

export function useStableNavigationHistoryPaths(
  backStack: readonly PathBearingValue[],
  forwardStack: readonly PathBearingValue[],
): string[] {
  const previousPathsRef = useRef<string[]>([]);

  return useMemo(() => {
    const nextPaths = Array.from(
      new Set([...backStack, ...forwardStack].map((location) => location.path)),
    );

    return reuseEqualStringArray(previousPathsRef, nextPaths);
  }, [backStack, forwardStack]);
}

function reuseEqualStringArray(
  previousPathsRef: { current: string[] },
  nextPaths: string[],
): string[] {
  if (areStringArraysEqual(previousPathsRef.current, nextPaths)) {
    return previousPathsRef.current;
  }

  previousPathsRef.current = nextPaths;
  return nextPaths;
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
