import {
  activateEditorGroupPath,
  editorGroupVisiblePaths,
  type EditorGroup,
  type EditorGroupsState,
} from "../domain/editorGroups";
import type { EditorDocument, ImageTab } from "../domain/workspace";
import {
  documentSessionPathTransitionForOpenedPath,
  pinDocumentSessionPath,
  replaceableDocumentSessionPreview,
} from "./documentSessionState";

export interface DocumentTabSessionSnapshot {
  activeDocument: EditorDocument | null;
  activePath: string | null;
  documents: Record<string, EditorDocument>;
  editorGroups: EditorGroupsState;
  imageTabs: Record<string, ImageTab>;
  openPaths: string[];
  previewPath: string | null;
}

type DeepReadonly<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value;

export type DocumentTabSessionView = DeepReadonly<DocumentTabSessionSnapshot>;

export interface TextDocumentOpenCommit {
  document: EditorDocument;
  pin: boolean;
}

export interface DocumentTabSessionCommitResult {
  replacedDocument: EditorDocument | null;
}

export interface ExistingDocumentOpenInput {
  path: string;
  pin: boolean;
  readOnly: boolean;
}

export interface ExistingDocumentOpenResult
  extends DocumentTabSessionCommitResult {
  document: EditorDocument;
}

export interface DocumentTabSessionPort {
  activate(path: string): void;
  commitImageOpen(image: ImageTab): DocumentTabSessionCommitResult;
  commitTextOpen(
    input: TextDocumentOpenCommit,
  ): DocumentTabSessionCommitResult;
  getActivePath(): string | null;
  getDocument(path: string): DeepReadonly<EditorDocument> | null;
  getTabDisplayName(path: string): string | null;
  openExistingDocument(
    input: ExistingDocumentOpenInput,
  ): ExistingDocumentOpenResult | null;
  openReadOnlyDocument(
    document: EditorDocument,
    pin: boolean,
  ): DocumentTabSessionCommitResult;
  pin(path: string): void;
  refreshCleanDocument(
    path: string,
    content: string,
  ): EditorDocument | null;
  snapshot(): DocumentTabSessionView;
}

export function activateDocumentTabSessionPath(
  snapshot: DocumentTabSessionSnapshot,
  path: string,
): DocumentTabSessionSnapshot {
  return updateActiveGroup(snapshot, (group) =>
    activateEditorGroupPath(group, path),
  );
}

export function pinDocumentTabSessionPath(
  snapshot: DocumentTabSessionSnapshot,
  path: string,
): DocumentTabSessionSnapshot {
  return updateActiveGroup(snapshot, (group) => {
    const transition = pinDocumentSessionPath(
      group.openPaths,
      group.previewPath,
      path,
    );

    return {
      ...group,
      openPaths: transition.nextOpenPaths,
      previewPath: transition.nextPreviewPath,
    };
  });
}

export function commitTextDocumentOpen(
  snapshot: DocumentTabSessionSnapshot,
  input: TextDocumentOpenCommit,
): {
  result: DocumentTabSessionCommitResult;
  snapshot: DocumentTabSessionSnapshot;
} {
  const group = activeGroup(snapshot.editorGroups);
  const activeDocument = group.activePath
    ? snapshot.documents[group.activePath] ?? null
    : null;
  const replaceablePreview = replaceableDocumentSessionPreview(
    activeDocument,
    snapshot.documents,
    group.openPaths,
    group.previewPath,
  );
  const replacement = replaceablePreview?.path === input.document.path
    ? null
    : replaceablePreview;
  const replacedPath = replacement?.path ?? null;
  const currentPreview = group.previewPath
    ? snapshot.documents[group.previewPath] ?? null
    : null;
  const dirtyPreviewPath = currentPreview &&
    currentPreview.path !== input.document.path &&
    currentPreview.content !== currentPreview.savedContent
    ? currentPreview.path
    : null;
  const openPaths = dirtyPreviewPath && !group.openPaths.includes(dirtyPreviewPath)
    ? [...group.openPaths, dirtyPreviewPath]
    : group.openPaths;
  const pathTransition = documentSessionPathTransitionForOpenedPath({
    openPaths,
    path: input.document.path,
    pin: input.pin,
    replacedPath,
  });
  const nextSnapshot = updateActiveGroup(snapshot, () => ({
    activePath: pathTransition.nextActivePath,
    openPaths: pathTransition.nextOpenPaths,
    previewPath: pathTransition.nextPreviewPath,
  }));
  const documents = {
    ...nextSnapshot.documents,
    [input.document.path]: input.document,
  };
  const replacementStillVisible = replacedPath
    ? Object.values(nextSnapshot.editorGroups.groups).some((candidate) =>
        editorGroupVisiblePaths(candidate).includes(replacedPath),
      )
    : false;
  const replacedDocument = replacement && !replacementStillVisible
    ? replacement
    : null;

  if (replacedDocument) {
    delete documents[replacedDocument.path];
  }

  return {
    result: { replacedDocument },
    snapshot: synchronizeSnapshotView({ ...nextSnapshot, documents }),
  };
}

export function openExistingDocumentInSession(
  snapshot: DocumentTabSessionSnapshot,
  input: ExistingDocumentOpenInput,
): {
  result: ExistingDocumentOpenResult | null;
  snapshot: DocumentTabSessionSnapshot;
} {
  const current = snapshot.documents[input.path];

  if (!current) {
    return { result: null, snapshot };
  }

  const document = input.readOnly && !current.readOnly
    ? { ...current, readOnly: true }
    : current;

  if (input.pin) {
    const transition = openPinnedDocumentPreservingPreview(snapshot, document);

    return {
      result: { document, replacedDocument: null },
      snapshot: transition,
    };
  }

  const transition = commitTextDocumentOpen(snapshot, {
    document,
    pin: false,
  });

  return {
    result: {
      document,
      replacedDocument: transition.result.replacedDocument,
    },
    snapshot: transition.snapshot,
  };
}

export function commitImageTabOpen(
  snapshot: DocumentTabSessionSnapshot,
  image: ImageTab,
): {
  result: DocumentTabSessionCommitResult;
  snapshot: DocumentTabSessionSnapshot;
} {
  const group = activeGroup(snapshot.editorGroups);
  const activeDocument = group.activePath
    ? snapshot.documents[group.activePath] ?? null
    : null;
  const replacement = replaceableDocumentSessionPreview(
    activeDocument,
    snapshot.documents,
    group.openPaths,
    group.previewPath,
  );
  const currentPreview = group.previewPath
    ? snapshot.documents[group.previewPath] ?? null
    : null;
  const dirtyPreviewPath = currentPreview &&
    currentPreview.content !== currentPreview.savedContent
    ? currentPreview.path
    : null;
  const openPaths = dirtyPreviewPath && !group.openPaths.includes(dirtyPreviewPath)
    ? [...group.openPaths, dirtyPreviewPath]
    : group.openPaths;
  const transition = documentSessionPathTransitionForOpenedPath({
    openPaths,
    path: image.path,
    pin: true,
    replacedPath: replacement?.path ?? null,
  });
  const nextSnapshot = updateActiveGroup(snapshot, () => ({
    activePath: transition.nextActivePath,
    openPaths: transition.nextOpenPaths,
    previewPath: transition.nextPreviewPath,
  }));

  const replacementStillVisible = replacement
    ? Object.values(nextSnapshot.editorGroups.groups).some((candidate) =>
        editorGroupVisiblePaths(candidate).includes(replacement.path),
      )
    : false;
  const replacedDocument = replacement && !replacementStillVisible
    ? replacement
    : null;
  const documents = { ...snapshot.documents };

  if (replacedDocument) {
    delete documents[replacedDocument.path];
  }

  return {
    result: { replacedDocument },
    snapshot: synchronizeSnapshotView({
    ...nextSnapshot,
    documents,
    imageTabs: { ...snapshot.imageTabs, [image.path]: image },
    }),
  };
}

export function openReadOnlyDocumentInSession(
  snapshot: DocumentTabSessionSnapshot,
  document: EditorDocument,
  pin: boolean,
): {
  result: DocumentTabSessionCommitResult;
  snapshot: DocumentTabSessionSnapshot;
} {
  if (!pin) {
    return commitTextDocumentOpen(snapshot, { document, pin: false });
  }

  return {
    result: { replacedDocument: null },
    snapshot: openPinnedDocumentPreservingPreview(snapshot, document),
  };
}

function openPinnedDocumentPreservingPreview(
  snapshot: DocumentTabSessionSnapshot,
  document: EditorDocument,
): DocumentTabSessionSnapshot {
  const nextSnapshot = updateActiveGroup(snapshot, (group) => ({
    activePath: document.path,
    openPaths: group.openPaths.includes(document.path)
      ? group.openPaths
      : [...group.openPaths, document.path],
    previewPath: group.previewPath === document.path
      ? null
      : group.previewPath,
  }));

  return synchronizeSnapshotView({
    ...nextSnapshot,
    documents: { ...nextSnapshot.documents, [document.path]: document },
  });
}

export function refreshCleanDocumentInSession(
  snapshot: DocumentTabSessionSnapshot,
  path: string,
  content: string,
): {
  document: EditorDocument | null;
  snapshot: DocumentTabSessionSnapshot;
} {
  const current = snapshot.documents[path];

  if (!current || current.content !== "" || current.savedContent !== "") {
    return { document: null, snapshot };
  }

  const document = { ...current, content, savedContent: content };

  return {
    document,
    snapshot: synchronizeSnapshotView({
      ...snapshot,
      documents: { ...snapshot.documents, [path]: document },
    }),
  };
}

function activeGroup(editorGroups: EditorGroupsState): EditorGroup {
  return editorGroups.groups[editorGroups.activeGroupId] ?? {
    activePath: null,
    openPaths: [],
    previewPath: null,
  };
}

function updateActiveGroup(
  snapshot: DocumentTabSessionSnapshot,
  update: (group: EditorGroup) => EditorGroup,
): DocumentTabSessionSnapshot {
  const groupId = snapshot.editorGroups.activeGroupId;
  const group = snapshot.editorGroups.groups[groupId];

  if (!group) {
    return snapshot;
  }

  const nextGroup = update(group);

  if (nextGroup === group) {
    return snapshot;
  }

  return synchronizeSnapshotView({
    ...snapshot,
    editorGroups: {
      ...snapshot.editorGroups,
      groups: { ...snapshot.editorGroups.groups, [groupId]: nextGroup },
    },
  });
}

export function synchronizeSnapshotView(
  snapshot: Omit<
    DocumentTabSessionSnapshot,
    "activeDocument" | "activePath" | "openPaths" | "previewPath"
  > & Partial<Pick<
    DocumentTabSessionSnapshot,
    "activeDocument" | "activePath" | "openPaths" | "previewPath"
  >>,
): DocumentTabSessionSnapshot {
  const group = activeGroup(snapshot.editorGroups);

  return {
    ...snapshot,
    activeDocument: group.activePath
      ? snapshot.documents[group.activePath] ?? null
      : null,
    activePath: group.activePath,
    openPaths: group.openPaths,
    previewPath: group.previewPath,
  };
}
