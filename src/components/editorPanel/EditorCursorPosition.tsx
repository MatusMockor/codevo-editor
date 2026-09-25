import type {
  EditorCursorAuthority,
  EditorCursorStorePort,
} from "../../application/editorCursorStore";
import { cursorSnapshotMatchesAuthority } from "../../application/editorCursorAuthority";
import { useActiveEditorCursorSnapshot } from "../../application/useEditorCursorSnapshot";
import type { EditorPosition } from "../../domain/languageServerFeatures";

export interface EditorCursorPositionProps {
  readonly store: EditorCursorStorePort;
  readonly authority: EditorCursorAuthority | null;
  onShowGoToLine(): void;
}

export function EditorCursorPosition({
  authority,
  onShowGoToLine,
  store,
}: EditorCursorPositionProps) {
  const snapshot = useActiveEditorCursorSnapshot(store);
  const position =
    authority !== null &&
    snapshot.status === "available" &&
    cursorSnapshotMatchesAuthority(snapshot, authority)
      ? snapshot.position
      : null;
  if (position === null) return null;
  const label = cursorPositionLabel(position);
  return (
    <button
      aria-label={label}
      className="cv-esub__pos"
      onClick={onShowGoToLine}
      title="Go to Line/Column"
      type="button"
    >
      {label}
    </button>
  );
}

function cursorPositionLabel(position: Readonly<EditorPosition>): string {
  return `Ln ${position.lineNumber}, Col ${position.column}`;
}
