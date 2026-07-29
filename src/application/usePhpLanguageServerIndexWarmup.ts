import { useCallback, type MutableRefObject } from "react";
import type { LanguageServerFeaturesGateway } from "../domain/languageServerFeatures";

export interface PhpLanguageServerIndexWarmupDependencies {
  readonly gateway: LanguageServerFeaturesGateway;
  isSessionCurrent(rootPath: string, sessionId: number): boolean;
  readonly warmedRootsRef: MutableRefObject<Set<string>>;
}

/** Starts one best-effort low-priority index warmup for each exact PHP session root. */
export function usePhpLanguageServerIndexWarmup({
  gateway,
  isSessionCurrent,
  warmedRootsRef,
}: PhpLanguageServerIndexWarmupDependencies) {
  return useCallback(
    (rootPath: string, path: string, sessionId: number) => {
      if (warmedRootsRef.current.has(rootPath)) return;
      if (!isSessionCurrent(rootPath, sessionId)) return;
      warmedRootsRef.current.add(rootPath);
      void (async () => {
        try {
          await gateway.documentSymbols(rootPath, path);
        } catch {
          warmedRootsRef.current.delete(rootPath);
        }
      })();
    },
    [gateway, isSessionCurrent, warmedRootsRef],
  );
}
