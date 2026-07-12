export const EDITOR_TAB_MIME = "application/x-codevo-editor-tab+json";
export const EDITOR_TAB_DRAG_VERSION = 1;

export interface EditorTabDragPayload {
  version: typeof EDITOR_TAB_DRAG_VERSION;
  projectId: string;
  sourceGroupId: string;
  path: string;
}

export function hasEditorTabDragType(
  dataTransfer: Pick<DataTransfer, "types">,
): boolean {
  return Array.from(dataTransfer.types).includes(EDITOR_TAB_MIME);
}

export function writeEditorTabDragPayload(
  dataTransfer: Pick<DataTransfer, "effectAllowed" | "setData">,
  payload: Omit<EditorTabDragPayload, "version">,
): void {
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData(
    EDITOR_TAB_MIME,
    JSON.stringify({ version: EDITOR_TAB_DRAG_VERSION, ...payload }),
  );
}

export function readEditorTabDragPayload(
  dataTransfer: Pick<DataTransfer, "getData">,
  projectId: string,
): EditorTabDragPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(dataTransfer.getData(EDITOR_TAB_MIME));
  } catch {
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }
  if (value.version !== EDITOR_TAB_DRAG_VERSION) {
    return null;
  }
  if (value.projectId !== projectId) {
    return null;
  }
  if (!isNonEmptyString(value.sourceGroupId) || !isNonEmptyString(value.path)) {
    return null;
  }

  return {
    version: EDITOR_TAB_DRAG_VERSION,
    projectId,
    sourceGroupId: value.sourceGroupId,
    path: value.path,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
