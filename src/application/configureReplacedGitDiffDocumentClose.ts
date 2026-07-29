import type { MutableRefObject } from "react";
import type { EditorDocument } from "../domain/workspace";

export interface ReplacedGitDiffDocumentCloseDependencies {
  readonly closeRef: MutableRefObject<(document: EditorDocument) => void>;
  readonly currentRootRef: MutableRefObject<string | null>;
  reportJavaScriptTypeScript(rootPath: string | null, error: unknown): void;
  reportPhp(rootPath: string | null, error: unknown): void;
  syncJavaScriptTypeScript(document: EditorDocument): Promise<void>;
  syncPhp(document: EditorDocument): Promise<void>;
}

export function configureReplacedGitDiffDocumentClose({
  closeRef,
  currentRootRef,
  reportJavaScriptTypeScript,
  reportPhp,
  syncJavaScriptTypeScript,
  syncPhp,
}: ReplacedGitDiffDocumentCloseDependencies): void {
  closeRef.current = (document) => {
    const rootPath = currentRootRef.current;
    void syncPhp(document).catch((error) => reportPhp(rootPath, error));
    void syncJavaScriptTypeScript(document).catch((error) =>
      reportJavaScriptTypeScript(rootPath, error),
    );
  };
}
