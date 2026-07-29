import { memo, useMemo, useRef } from "react";
import type { EditorCursorStorePort } from "../application/editorCursorStore";
import type { EditorCursorAuthority } from "../application/editorCursorStore";
import { cursorSnapshotMatchesAuthority } from "../application/editorCursorAuthority";
import {
  useActiveEditorCursorSnapshot,
  useEditorGroupCursorSnapshot,
} from "../application/useEditorCursorSnapshot";
import { breadcrumbPathFromCursorAndSymbols } from "../domain/breadcrumbs";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";
import type { EditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorGroupId } from "../domain/editorGroups";
import { Breadcrumbs } from "./Breadcrumbs";

interface CursorAwareBreadcrumbsProps {
  readonly documentPath: string;
  readonly fileName: string;
  readonly groupId: EditorGroupId;
  readonly onNavigate: (symbol: LanguageServerDocumentSymbol) => void;
  readonly ownerKey: EditorSessionOwnerKey;
  readonly store: EditorCursorStorePort;
  readonly symbols: LanguageServerDocumentSymbol[];
  readonly trackingActive: boolean;
}

export const CursorAwareBreadcrumbs = memo(function CursorAwareBreadcrumbs({
  documentPath,
  fileName,
  groupId,
  onNavigate,
  ownerKey,
  store,
  symbols,
  trackingActive,
}: CursorAwareBreadcrumbsProps) {
  const authority = useMemo<EditorCursorAuthority>(
    () => ({ documentPath, groupId, ownerKey }),
    [documentPath, groupId, ownerKey],
  );
  const activeSnapshot = useActiveEditorCursorSnapshot(store, trackingActive);
  const leaseRef = useRef<
    Extract<typeof activeSnapshot, { status: "available" }>["authority"] | null
  >(null);
  if (
    activeSnapshot.status === "available" &&
    cursorSnapshotMatchesAuthority(activeSnapshot, authority)
  ) {
    leaseRef.current = activeSnapshot.authority;
  }
  const groupSnapshot = useEditorGroupCursorSnapshot(store, leaseRef.current, !trackingActive);
  const snapshot = trackingActive ? activeSnapshot : groupSnapshot;
  const publishedPosition =
    snapshot.status === "available" && cursorSnapshotMatchesAuthority(snapshot, authority)
      ? snapshot.position
      : null;
  const generation = snapshot.status === "available" ? snapshot.authority.generation : 0;
  const authorityKey = `${authority.ownerKey}\0${authority.groupId}\0${authority.documentPath}\0${generation}`;
  const retainedPositionRef = useRef<{
    readonly authorityKey: string;
    readonly position: typeof publishedPosition;
  } | null>(null);
  if (publishedPosition) {
    retainedPositionRef.current = { authorityKey, position: publishedPosition };
  } else if (retainedPositionRef.current?.authorityKey !== authorityKey) {
    retainedPositionRef.current = null;
  }
  const position = publishedPosition ?? retainedPositionRef.current?.position ?? null;
  const path = useMemo(
    () => (position ? breadcrumbPathFromCursorAndSymbols(position, symbols) : []),
    [position, symbols],
  );

  return <Breadcrumbs fileName={fileName} onNavigate={onNavigate} path={path} symbols={symbols} />;
});
