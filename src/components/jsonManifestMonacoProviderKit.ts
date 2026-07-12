import type * as Monaco from "monaco-editor";
import { modelPath } from "./phpMonacoDocumentContext";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

interface ManifestWorkspace {
  rootPath: string;
}

interface ManifestProviderContext<Workspace> {
  getWorkspace(): Workspace | null;
}

export function manifestRequest<Workspace extends ManifestWorkspace, Context>(
  context: ManifestProviderContext<Workspace>,
  model: MonacoModel,
  position: MonacoPosition,
  manifestFileName: string,
  contextAt: (source: string, offset: number) => Context | null,
) {
  const workspace = context.getWorkspace();

  if (!workspace) {
    return null;
  }

  const path = modelPath(model);

  if (!path || !isManifestPathInWorkspace(path, workspace.rootPath, manifestFileName)) {
    return null;
  }

  const source = model.getValue();
  const offset = model.getOffsetAt(position);
  const manifestContext = contextAt(source, offset);

  if (!manifestContext) {
    return null;
  }

  return { manifestContext, offset, source, workspace };
}

export function jsonStringContentRangeAt(
  source: string,
  offset: number,
): { end: number; start: number } | null {
  let start = -1;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (start < 0) {
      if (character === '"') {
        start = index + 1;
      }

      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character !== '"') {
      continue;
    }

    if (offset >= start && offset <= index) {
      return { end: index, start };
    }

    start = -1;
  }

  return null;
}

export function monacoRangeForOffsets(
  monaco: MonacoApi,
  model: MonacoModel,
  start: number,
  end: number,
): Monaco.Range {
  const startPosition = model.getPositionAt(start);
  const endPosition = model.getPositionAt(end);

  return new monaco.Range(
    startPosition.lineNumber,
    startPosition.column,
    endPosition.lineNumber,
    endPosition.column,
  );
}

export function normalizedPathKey(path: string): string {
  const normalized = path.split("\\").join("/");

  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized.toLowerCase();
  }

  return normalized;
}

function isManifestPathInWorkspace(
  path: string,
  workspaceRoot: string,
  manifestFileName: string,
): boolean {
  const normalizedPath = normalizedPathKey(path);
  const normalizedRoot = normalizedPathKey(workspaceRoot).replace(/\/$/, "");

  if (!normalizedRoot || !normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return false;
  }

  const segments = normalizedPath.split("/");
  return segments[segments.length - 1] === manifestFileName;
}
