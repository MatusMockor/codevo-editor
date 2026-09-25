import { createContext, useEffect, useMemo, useRef } from "react";
import type { EditorGroup } from "../../domain/editorGroups";
import type { AgentRightPanelEditorDocuments } from "../agentMode/rightPanel/agentRightPanelTabEntries";
import type { EditorGroupDocument } from "../EditorGroupView";
import {
  editorPanelDocuments,
  editorPanelDocumentsEqual,
  type EditorPanelDocumentsSnapshot,
  type EditorPanelFileStatuses,
} from "./editorPanelDocuments";

export type EditorPanelDocumentsValue = Omit<AgentRightPanelEditorDocuments, "surfaceActive">;

export const EditorPanelDocumentsContext = createContext<EditorPanelDocumentsValue | null>(null);

export interface EditorPanelDocumentsInput {
  readonly ownerKey: string | null;
  readonly group: EditorGroup | null;
  readonly documents: ReadonlyArray<EditorGroupDocument>;
  readonly fileStatusesByPath: EditorPanelFileStatuses;
  onActivate(path: string): void;
  onClose(path: string): void;
  onOpenFile(): void;
  onPin(path: string): void;
  onEmpty(): void;
}

interface ObservedDocuments {
  readonly ownerKey: string | null;
  readonly hadDocuments: boolean;
}

export function useEditorPanelDocumentsValue(
  input: EditorPanelDocumentsInput,
): EditorPanelDocumentsValue | null {
  const handlersRef = useRef(input);
  useEffect(() => {
    handlersRef.current = input;
  });
  const snapshotRef = useRef<EditorPanelDocumentsSnapshot | null>(null);
  const next =
    input.group === null
      ? null
      : editorPanelDocuments(input.group, input.documents, input.fileStatusesByPath);
  const previous = snapshotRef.current;
  const snapshot =
    next !== null && previous !== null && editorPanelDocumentsEqual(previous, next)
      ? previous
      : next;
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);
  const empty = snapshot !== null && snapshot.documents.length === 0;
  const ownerKey = input.ownerKey;
  const observedRef = useRef<ObservedDocuments | null>(null);

  useEffect(() => {
    const previous = observedRef.current;
    observedRef.current = snapshot === null ? null : { ownerKey, hadDocuments: !empty };
    if (previous === null || snapshot === null || previous.ownerKey !== ownerKey) return;
    if (!empty || !previous.hadDocuments) return;
    handlersRef.current.onEmpty();
  }, [empty, ownerKey, snapshot]);

  return useMemo(() => {
    if (snapshot === null) return null;
    return {
      documents: snapshot.documents,
      activeDocumentId: snapshot.activeDocumentId,
      onActivate: (documentId: string) => handlersRef.current.onActivate(documentId),
      onClose: (documentId: string) => handlersRef.current.onClose(documentId),
      onOpenFile: () => handlersRef.current.onOpenFile(),
      onPin: (documentId: string) => handlersRef.current.onPin(documentId),
    };
  }, [snapshot]);
}
