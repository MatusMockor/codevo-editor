export interface ExternalFileSnapshot {
  content: string;
  path: string;
  revision?: import("./workspace").WorkspaceFileRevision | null;
}

/** Content equality is the semantic conflict boundary for external watcher reads. */
export function externalFileSnapshotHasBaselineContent(
  baseline: ExternalFileSnapshot,
  disk: ExternalFileSnapshot,
): boolean {
  return baseline.content === disk.content;
}

export interface ModifiedExternalFileConflictInput {
  kind: "modified";
  baseline: ExternalFileSnapshot;
  disk: ExternalFileSnapshot;
}

export interface DeletedExternalFileConflictInput {
  kind: "deleted";
  baseline: ExternalFileSnapshot;
  disk: null;
}

export interface RenamedExternalFileConflictInput {
  kind: "renamed";
  baseline: ExternalFileSnapshot;
  disk: ExternalFileSnapshot;
}

export interface UnreadableExternalFileConflictInput {
  kind: "unreadable";
  attemptedKind: "modified" | "renamed";
  attemptedPath: string;
  baseline: ExternalFileSnapshot;
  disk: null;
}

export type ExternalFileConflictInput =
  | ModifiedExternalFileConflictInput
  | DeletedExternalFileConflictInput
  | RenamedExternalFileConflictInput
  | UnreadableExternalFileConflictInput;

export type ExternalFileConflict = ExternalFileConflictInput & {
  id: number;
  revision: number;
};

export interface ExternalFileConflictRef {
  id: number;
  revision: number;
}

export type ExternalFileConflictResolutionAction =
  | "followRename"
  | "overwrite"
  | "recreate"
  | "reload"
  | "retryRead";

export type ExternalFileConflictAction =
  | "compare"
  | ExternalFileConflictResolutionAction;

export interface ExternalFileConflictActionDescriptor {
  action: ExternalFileConflictAction;
  label: string;
  tone: "default" | "primary" | "warning";
}

export interface ExternalFileConflictLabels {
  baseline: string;
  detail: string;
  disk: string;
  title: string;
}

interface ExternalFileConflictStateBase {
  nextId: number;
  nextRevision: number;
}

export interface IdleExternalFileConflictState
  extends ExternalFileConflictStateBase {
  status: "idle";
  conflict: null;
  compareOpen: false;
  error: null;
}

export interface AttentionExternalFileConflictState
  extends ExternalFileConflictStateBase {
  status: "attention";
  conflict: ExternalFileConflict;
  compareOpen: boolean;
  error: string | null;
}

export interface ResolvingExternalFileConflictState
  extends ExternalFileConflictStateBase {
  status: "resolving";
  conflict: ExternalFileConflict;
  pendingConflict: ExternalFileConflict | null;
  compareOpen: boolean;
  error: null;
  action: ExternalFileConflictResolutionAction;
}

export type ExternalFileConflictState =
  | IdleExternalFileConflictState
  | AttentionExternalFileConflictState
  | ResolvingExternalFileConflictState;

export type ExternalFileConflictEvent =
  | { type: "detected"; conflict: ExternalFileConflictInput }
  | { type: "compareOpened"; target: ExternalFileConflictRef }
  | { type: "compareClosed"; target: ExternalFileConflictRef }
  | {
      type: "actionStarted";
      target: ExternalFileConflictRef;
      action: ExternalFileConflictResolutionAction;
    }
  | {
      type: "actionFailed";
      target: ExternalFileConflictRef;
      message: string;
    }
  | { type: "resolved"; target: ExternalFileConflictRef };

export function createExternalFileConflictState(): ExternalFileConflictState {
  return {
    status: "idle",
    conflict: null,
    compareOpen: false,
    error: null,
    nextId: 1,
    nextRevision: 1,
  };
}

export function transitionExternalFileConflict(
  state: ExternalFileConflictState,
  event: ExternalFileConflictEvent,
): ExternalFileConflictState {
  if (event.type === "detected") {
    if (state.status === "resolving") {
      return queueDetectedConflict(state, event.conflict);
    }

    return detectConflict(state, event.conflict);
  }

  if (!matchesCurrentConflict(state, event.target)) {
    return state;
  }

  if (event.type === "compareOpened") {
    return { ...state, compareOpen: true };
  }

  if (event.type === "compareClosed") {
    return { ...state, compareOpen: false };
  }

  if (event.type === "actionStarted") {
    if (state.status !== "attention") {
      return state;
    }

    if (!isResolutionActionAvailable(state.conflict, event.action)) {
      return state;
    }

    return {
      ...state,
      status: "resolving",
      action: event.action,
      error: null,
      pendingConflict: null,
    };
  }

  if (event.type === "actionFailed") {
    if (state.status !== "resolving") {
      return state;
    }

    const conflict = state.pendingConflict ?? state.conflict;

    return {
      status: "attention",
      conflict,
      compareOpen: state.compareOpen,
      error: event.message.trim() || "The file action failed.",
      nextId: state.nextId,
      nextRevision: state.nextRevision,
    };
  }

  if (state.status === "resolving" && state.pendingConflict) {
    return {
      status: "attention",
      conflict: state.pendingConflict,
      compareOpen: state.compareOpen,
      error: null,
      nextId: state.nextId,
      nextRevision: state.nextRevision,
    };
  }

  return {
    status: "idle",
    conflict: null,
    compareOpen: false,
    error: null,
    nextId: state.nextId,
    nextRevision: state.nextRevision,
  };
}

function queueDetectedConflict(
  state: ResolvingExternalFileConflictState,
  input: ExternalFileConflictInput,
): ResolvingExternalFileConflictState {
  return {
    ...state,
    pendingConflict: conflictFromInput(
      input,
      state.conflict.id,
      state.nextRevision,
    ),
    nextRevision: state.nextRevision + 1,
  };
}

export function documentNeedsAttention(
  dirty: boolean,
  hasConflict: boolean,
): boolean {
  return dirty || hasConflict;
}

export function externalFileConflictRef(
  conflict: ExternalFileConflict,
): ExternalFileConflictRef {
  return { id: conflict.id, revision: conflict.revision };
}

export function externalFileConflictLabels(
  conflict: ExternalFileConflict,
): ExternalFileConflictLabels {
  if (conflict.kind === "unreadable") {
    return {
      title: "File could not be read",
      detail: `The external ${conflict.attemptedKind} event could not be verified. Retry the disk read before saving.`,
      baseline: `Editor: ${conflict.baseline.path}`,
      disk: `Disk: unable to read ${conflict.attemptedPath}`,
    };
  }

  if (conflict.kind === "deleted") {
    return {
      title: "File deleted on disk",
      detail: "The open document still has changes that are not on disk.",
      baseline: `Editor: ${conflict.baseline.path}`,
      disk: "Disk: file deleted",
    };
  }

  if (conflict.kind === "renamed") {
    return {
      title: "File renamed on disk",
      detail: `The file moved to ${conflict.disk.path}.`,
      baseline: `Editor: ${conflict.baseline.path}`,
      disk: `Disk: ${conflict.disk.path}`,
    };
  }

  return {
    title: "File changed on disk",
    detail: "The disk version changed while this document was open.",
    baseline: `Editor: ${conflict.baseline.path}`,
    disk: `Disk: ${conflict.disk.path}`,
  };
}

export function externalFileConflictActions(
  conflict: ExternalFileConflict,
): readonly ExternalFileConflictActionDescriptor[] {
  const compare: ExternalFileConflictActionDescriptor = {
    action: "compare",
    label: "Compare",
    tone: "default",
  };

  if (conflict.kind === "unreadable") {
    return [
      { action: "retryRead", label: "Retry Read", tone: "primary" },
    ];
  }

  if (conflict.kind === "deleted") {
    return [
      compare,
      { action: "recreate", label: "Recreate", tone: "warning" },
    ];
  }

  if (conflict.kind === "renamed") {
    return [
      compare,
      {
        action: "followRename",
        label: "Follow Rename",
        tone: "primary",
      },
      { action: "overwrite", label: "Overwrite", tone: "warning" },
    ];
  }

  return [
    compare,
    { action: "reload", label: "Reload", tone: "primary" },
    { action: "overwrite", label: "Overwrite", tone: "warning" },
  ];
}

function detectConflict(
  state: ExternalFileConflictState,
  input: ExternalFileConflictInput,
): ExternalFileConflictState {
  const id = state.conflict?.id ?? state.nextId;
  const nextId = state.conflict ? state.nextId : state.nextId + 1;
  const conflict = conflictFromInput(input, id, state.nextRevision);

  return {
    status: "attention",
    conflict,
    compareOpen: state.compareOpen,
    error: null,
    nextId,
    nextRevision: state.nextRevision + 1,
  };
}

function conflictFromInput(
  input: ExternalFileConflictInput,
  id: number,
  revision: number,
): ExternalFileConflict {
  return { ...input, id, revision } as ExternalFileConflict;
}

function matchesCurrentConflict(
  state: ExternalFileConflictState,
  target: ExternalFileConflictRef,
): state is AttentionExternalFileConflictState | ResolvingExternalFileConflictState {
  if (!state.conflict) {
    return false;
  }

  return (
    state.conflict.id === target.id &&
    state.conflict.revision === target.revision
  );
}

function isResolutionActionAvailable(
  conflict: ExternalFileConflict,
  action: ExternalFileConflictResolutionAction,
): boolean {
  return externalFileConflictActions(conflict).some(
    (descriptor) => descriptor.action === action,
  );
}
