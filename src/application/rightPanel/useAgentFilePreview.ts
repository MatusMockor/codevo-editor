import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FilePreview } from "../../domain/filePreview";
import {
  FilePreviewReadError,
  filePreviewFailureMessage,
  type FilePreviewReader,
} from "../filePreview/filePreviewReader";

export const FilePreviewReaderContext = createContext<FilePreviewReader | null>(null);

export interface AgentFilePreviewRequest {
  readonly owner: string | null;
  readonly root: string | null;
  readonly relativePath: string | null;
  readonly refreshKey: number;
}

export type AgentFilePreviewState =
  | { readonly kind: "idle" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly preview: FilePreview; readonly refreshing: boolean }
  | { readonly kind: "failed"; readonly message: string };

interface OwnedPreview {
  readonly owner: string | null;
  readonly root: string;
  readonly relativePath: string;
  readonly reader: FilePreviewReader;
  readonly refreshKey: number;
  readonly outcome:
    | { readonly kind: "loaded"; readonly preview: FilePreview }
    | { readonly kind: "failed"; readonly message: string };
}

const IDLE: AgentFilePreviewState = { kind: "idle" };
const UNAVAILABLE: AgentFilePreviewState = { kind: "unavailable" };
const LOADING: AgentFilePreviewState = { kind: "loading" };
const FALLBACK_FAILURE = filePreviewFailureMessage("operationFailed");

export function useAgentFilePreview({
  owner,
  refreshKey,
  relativePath,
  root,
}: AgentFilePreviewRequest): AgentFilePreviewState {
  const reader = useContext(FilePreviewReaderContext);
  const [owned, setOwned] = useState<OwnedPreview | null>(null);
  const [ownedTarget, setOwnedTarget] = useState({ owner, root, relativePath, reader });
  const generation = useRef(0);
  if (
    ownedTarget.owner !== owner ||
    ownedTarget.root !== root ||
    ownedTarget.relativePath !== relativePath ||
    ownedTarget.reader !== reader
  ) {
    setOwnedTarget({ owner, root, relativePath, reader });
    setOwned(null);
  }

  useEffect(() => {
    generation.current += 1;
    if (reader === null || root === null || relativePath === null) return undefined;
    const current = generation.current;
    const controller = new AbortController();
    const publish = (outcome: OwnedPreview["outcome"]) => {
      if (controller.signal.aborted || generation.current !== current) return;
      setOwned({ owner, root, relativePath, reader, refreshKey, outcome });
    };
    reader.read(root, relativePath, controller.signal).then(
      (preview) => {
        if (preview.relativePath !== relativePath) {
          publish({ kind: "failed", message: FALLBACK_FAILURE });
          return;
        }
        publish({ kind: "loaded", preview });
      },
      (error: unknown) => publish({ kind: "failed", message: failureMessage(error) }),
    );
    return () => {
      controller.abort();
      generation.current += 1;
    };
  }, [owner, reader, refreshKey, relativePath, root]);

  return useMemo(() => {
    if (root === null || relativePath === null) return IDLE;
    if (reader === null) return UNAVAILABLE;
    if (owned === null) return LOADING;
    if (
      owned.owner !== owner ||
      owned.root !== root ||
      owned.relativePath !== relativePath ||
      owned.reader !== reader
    ) {
      return LOADING;
    }
    const refreshing = owned.refreshKey !== refreshKey;
    if (owned.outcome.kind === "failed") return refreshing ? LOADING : owned.outcome;
    return { kind: "loaded", preview: owned.outcome.preview, refreshing };
  }, [owned, owner, reader, refreshKey, relativePath, root]);
}

function failureMessage(error: unknown): string {
  if (error instanceof FilePreviewReadError) return filePreviewFailureMessage(error.kind);
  return FALLBACK_FAILURE;
}
