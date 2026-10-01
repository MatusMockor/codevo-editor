import type { ReactNode } from "react";
import { useEditorChrome } from "./EditorChromeContext";
import { EditorPathCrumbs } from "./EditorPathCrumbs";
import { EditorSubheaderActions } from "./EditorSubheaderActions";
import "./editorPanel.css";

export interface EditorSubheaderProps {
  readonly groupId: string | null;
  readonly rootPath: string | null;
  readonly documentPath: string;
  readonly symbols: ReactNode;
  onFind(): void;
}

export function EditorSubheader({
  documentPath,
  groupId,
  onFind,
  rootPath,
  symbols,
}: EditorSubheaderProps) {
  const chrome = useEditorChrome();
  return (
    <div className="cv-esub">
      <nav aria-label="Breadcrumbs" className="cv-esub__crumbs">
        <EditorPathCrumbs
          documentPath={documentPath}
          onReveal={chrome === null ? noop : chrome.revealInFiles}
          rootPath={rootPath}
        />
        {symbols}
      </nav>
      <EditorSubheaderActions groupId={groupId} onFind={onFind} />
    </div>
  );
}

function noop(): void {}
