import type { IndexProgressState } from "./indexProgress";
import type { LanguageServerRuntimeStatus } from "./languageServerRuntime";
import { workspaceRootKeysEqual } from "./workspaceRootKey";

export type IdeProgressState = "active" | "idle" | "problem" | "scanning";

export interface IdeProgressIndicator {
  busy: boolean;
  state: IdeProgressState;
  text: string | null;
}

export interface IdeProgressInput {
  workspaceRoot: string | null;
  phpRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus | null;
  indexProgress: IndexProgressState;
}

const IDLE_INDICATOR: IdeProgressIndicator = {
  busy: false,
  state: "idle",
  text: null,
};

/**
 * Derives a prominent, workbench-toolbar progress indicator from the active
 * workspace's background IDE activity (index scan + language server boot).
 *
 * The label logic is intentionally extensible: an "installing" PHP engine
 * state (Slice B) can be added by surfacing an install flag in the input and
 * returning a busy/scanning indicator with "Installing PHP engine…" ahead of
 * the starting/indexing branches.
 */
export function ideProgressIndicator(
  input: IdeProgressInput,
): IdeProgressIndicator {
  const { workspaceRoot } = input;

  if (!workspaceRoot) {
    return IDLE_INDICATOR;
  }

  const phpKind = runtimeKindForWorkspace(input.phpRuntimeStatus, workspaceRoot);
  const javaScriptTypeScriptKind = runtimeKindForWorkspace(
    input.javaScriptTypeScriptRuntimeStatus,
    workspaceRoot,
  );
  const index = indexProgressForWorkspace(input.indexProgress, workspaceRoot);

  if (phpKind === "crashed") {
    return { busy: false, state: "problem", text: "PHP engine crashed" };
  }

  if (javaScriptTypeScriptKind === "crashed") {
    return { busy: false, state: "problem", text: "TS engine crashed" };
  }

  if (index.status === "failed") {
    return { busy: false, state: "problem", text: "Indexing failed" };
  }

  if (index.erroredEntries > 0) {
    return {
      busy: false,
      state: "problem",
      text: "Indexing finished with errors",
    };
  }

  if (index.status === "scanning") {
    return { busy: true, state: "scanning", text: indexingLabel(index) };
  }

  if (phpKind === "starting") {
    return { busy: true, state: "scanning", text: "Starting PHP engine…" };
  }

  if (javaScriptTypeScriptKind === "starting") {
    return { busy: true, state: "scanning", text: "Starting TS engine…" };
  }

  if (
    phpKind === "running" ||
    javaScriptTypeScriptKind === "running" ||
    index.status === "completed"
  ) {
    return { busy: false, state: "active", text: null };
  }

  return IDLE_INDICATOR;
}

function indexingLabel(index: IndexProgressState): string {
  if (index.indexedFiles > 0) {
    return `Indexing workspace… ${index.indexedFiles} files`;
  }

  return "Indexing workspace…";
}

function runtimeKindForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  workspaceRoot: string,
): LanguageServerRuntimeStatus["kind"] | null {
  if (!status) {
    return null;
  }

  if (!status.rootPath || !workspaceRootKeysEqual(status.rootPath, workspaceRoot)) {
    return null;
  }

  return status.kind;
}

function indexProgressForWorkspace(
  index: IndexProgressState,
  workspaceRoot: string,
): IndexProgressState {
  if (index.status === "idle") {
    return index;
  }

  if (!index.rootPath || !workspaceRootKeysEqual(index.rootPath, workspaceRoot)) {
    return { ...index, status: "idle", erroredEntries: 0 };
  }

  return index;
}
