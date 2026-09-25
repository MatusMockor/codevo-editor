import type { RefObject } from "react";
import { useOpenEditorsMru } from "../../application/useOpenEditorsMru";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";
import { OpenEditorsSwitcher } from "../OpenEditorsSwitcher";

export interface EditorGroupOpenEditorsSwitcherProps {
  readonly activePath: string | null;
  readonly documents: ReadonlyArray<{ readonly name: string; readonly path: string }>;
  readonly groupElementRef: RefObject<HTMLElement | null>;
  readonly groupId: string;
  readonly projectId: string;
  onActivate(path: string): void;
}

export function EditorGroupOpenEditorsSwitcher({
  activePath,
  documents,
  groupElementRef,
  groupId,
  onActivate,
  projectId,
}: EditorGroupOpenEditorsSwitcherProps) {
  const openEditorsMru = useOpenEditorsMru({
    activePath,
    entries: documents.map(({ name, path }) => ({ name, path })),
    groupElementRef,
    groupId,
    onActivate,
    projectId: normalizedWorkspaceRootKey(projectId),
    stripRef: groupElementRef,
  });
  return (
    <OpenEditorsSwitcher
      activeIndex={openEditorsMru.activeIndex}
      entries={openEditorsMru.entries}
      isOpen={openEditorsMru.isOpen}
      onCancel={openEditorsMru.cancel}
      onSelect={openEditorsMru.select}
    />
  );
}
