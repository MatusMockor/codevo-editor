import { describe, expect, it } from "vitest";
import {
  createExternalFileConflictState,
  documentNeedsAttention,
  externalFileConflictActions,
  externalFileConflictLabels,
  externalFileConflictRef,
  externalFileSnapshotHasBaselineContent,
  transitionExternalFileConflict,
  type ExternalFileConflictInput,
  type ExternalFileConflictState,
} from "./externalFileConflict";

describe("externalFileSnapshotHasBaselineContent", () => {
  it("matches unchanged content independently of metadata revision drift", () => {
    const value = {
      content: "<?php\n",
      path: "/workspace/new.php",
      revision: fileRevision(1),
    };

    expect(externalFileSnapshotHasBaselineContent(value, {
      ...value,
      path: "/workspace-alias/new.php",
    })).toBe(true);
    expect(externalFileSnapshotHasBaselineContent(value, {
      ...value,
      revision: fileRevision(2),
    })).toBe(true);
  });

  it("rejects changed content even when the trusted revision is unchanged", () => {
    const value = {
      content: "<?php\n",
      path: "/workspace/new.php",
      revision: fileRevision(1),
    };

    expect(externalFileSnapshotHasBaselineContent(value, {
      ...value,
      content: "<?php echo 1;\n",
    })).toBe(false);
  });
});

describe("external file conflict", () => {
  it("requires attention for either dirty content or an external conflict", () => {
    expect(documentNeedsAttention(true, false)).toBe(true);
    expect(documentNeedsAttention(false, true)).toBe(true);
    expect(documentNeedsAttention(false, false)).toBe(false);
  });

  it("creates modified conflicts with monotonic identities and revisions", () => {
    let state = detect(createExternalFileConflictState(), modified());
    expect(state.conflict).toMatchObject({ id: 1, revision: 1 });

    state = detect(state, modified({ content: "disk v3" }));
    expect(state.conflict).toMatchObject({ id: 1, revision: 2 });

    state = resolveCurrent(state);
    state = detect(state, deleted());
    expect(state.conflict).toMatchObject({ id: 2, revision: 3 });
  });

  it("preserves snapshots and derives labels and modified actions", () => {
    const state = detect(createExternalFileConflictState(), modified());
    const conflict = requireConflict(state);

    expect(conflict.baseline).toEqual({
      path: "/project/note.txt",
      content: "editor draft",
    });
    expect(conflict.disk).toEqual({
      path: "/project/note.txt",
      content: "disk v2",
    });
    expect(externalFileConflictLabels(conflict).title).toBe(
      "File changed on disk",
    );
    expect(externalFileConflictActions(conflict).map(({ action }) => action)).toEqual(
      ["compare", "reload", "overwrite"],
    );
  });

  it("derives deleted and renamed action sets", () => {
    const deletedConflict = requireConflict(
      detect(createExternalFileConflictState(), deleted()),
    );
    const renamedConflict = requireConflict(
      detect(createExternalFileConflictState(), renamed()),
    );

    expect(deletedConflict.disk).toBeNull();
    expect(
      externalFileConflictActions(deletedConflict).map(({ label }) => label),
    ).toEqual(["Compare", "Recreate"]);
    expect(externalFileConflictLabels(deletedConflict).disk).toBe(
      "Disk: file deleted",
    );
    expect(
      externalFileConflictActions(renamedConflict).map(({ label }) => label),
    ).toEqual(["Compare", "Follow Rename", "Overwrite"]);
    expect(externalFileConflictLabels(renamedConflict).detail).toContain(
      "/project/renamed.txt",
    );
  });

  it("offers only Retry Read for an unreadable external change", () => {
    const conflict = requireConflict(
      detect(createExternalFileConflictState(), {
        kind: "unreadable",
        attemptedKind: "renamed",
        attemptedPath: "/project/renamed.txt",
        baseline: baseline(),
        disk: null,
      }),
    );

    expect(externalFileConflictLabels(conflict).title).toBe(
      "File could not be read",
    );
    expect(externalFileConflictActions(conflict)).toEqual([
      { action: "retryRead", label: "Retry Read", tone: "primary" },
    ]);
  });

  it("tracks compare and resolution transitions without changing revision", () => {
    let state = detect(createExternalFileConflictState(), modified());
    const target = externalFileConflictRef(requireConflict(state));

    state = transitionExternalFileConflict(state, {
      type: "compareOpened",
      target,
    });
    expect(state.compareOpen).toBe(true);

    state = transitionExternalFileConflict(state, {
      type: "actionStarted",
      target,
      action: "reload",
    });
    expect(state).toMatchObject({ status: "resolving", action: "reload" });
    expect(state.conflict?.revision).toBe(target.revision);
    expect(
      transitionExternalFileConflict(state, {
        type: "actionStarted",
        target,
        action: "overwrite",
      }),
    ).toBe(state);

    state = transitionExternalFileConflict(state, {
      type: "actionFailed",
      target,
      message: "Permission denied",
    });
    expect(state).toMatchObject({
      status: "attention",
      error: "Permission denied",
      compareOpen: true,
    });
  });

  it("rejects unavailable and stale action transitions", () => {
    const state = detect(createExternalFileConflictState(), deleted());
    const current = externalFileConflictRef(requireConflict(state));

    expect(
      transitionExternalFileConflict(state, {
        type: "actionStarted",
        target: current,
        action: "reload",
      }),
    ).toBe(state);
    expect(
      transitionExternalFileConflict(state, {
        type: "resolved",
        target: { ...current, revision: current.revision - 1 },
      }),
    ).toBe(state);
  });

  it("queues the newest detection while resolving and remains locked", () => {
    let state = detect(createExternalFileConflictState(), modified());
    const target = externalFileConflictRef(requireConflict(state));
    state = transitionExternalFileConflict(state, {
      type: "actionStarted",
      target,
      action: "reload",
    });
    state = detect(state, modified({ content: "disk v3" }));
    state = detect(state, modified({ content: "disk v4" }));

    expect(state).toMatchObject({
      status: "resolving",
      action: "reload",
      conflict: { revision: 1 },
      pendingConflict: { revision: 3, disk: { content: "disk v4" } },
    });
    expect(
      transitionExternalFileConflict(state, {
        type: "actionStarted",
        target,
        action: "overwrite",
      }),
    ).toBe(state);

    state = transitionExternalFileConflict(state, { type: "resolved", target });

    expect(state).toMatchObject({
      status: "attention",
      conflict: { id: 1, revision: 3, disk: { content: "disk v4" } },
    });
    expect(documentNeedsAttention(false, state.conflict !== null)).toBe(true);
  });

  it("surfaces a queued detection deterministically after action failure", () => {
    let state = detect(createExternalFileConflictState(), modified());
    const target = externalFileConflictRef(requireConflict(state));
    state = transitionExternalFileConflict(state, {
      type: "actionStarted",
      target,
      action: "overwrite",
    });
    state = detect(state, deleted());
    state = transitionExternalFileConflict(state, {
      type: "actionFailed",
      target,
      message: "Permission denied",
    });

    expect(state).toMatchObject({
      status: "attention",
      conflict: { kind: "deleted", revision: 2 },
      error: "Permission denied",
    });
  });

  it("clears attention only when the current conflict resolves", () => {
    let state = detect(createExternalFileConflictState(), renamed());
    state = resolveCurrent(state);

    expect(state.status).toBe("idle");
    expect(documentNeedsAttention(false, state.conflict !== null)).toBe(false);
  });
});

function detect(
  state: ExternalFileConflictState,
  conflict: ExternalFileConflictInput,
): ExternalFileConflictState {
  return transitionExternalFileConflict(state, { type: "detected", conflict });
}

function resolveCurrent(
  state: ExternalFileConflictState,
): ExternalFileConflictState {
  return transitionExternalFileConflict(state, {
    type: "resolved",
    target: externalFileConflictRef(requireConflict(state)),
  });
}

function requireConflict(state: ExternalFileConflictState) {
  if (!state.conflict) {
    throw new Error("Expected an external file conflict");
  }

  return state.conflict;
}

function baseline() {
  return { path: "/project/note.txt", content: "editor draft" };
}

function modified(
  diskOverrides: Partial<{ path: string; content: string }> = {},
): ExternalFileConflictInput {
  return {
    kind: "modified",
    baseline: baseline(),
    disk: { path: "/project/note.txt", content: "disk v2", ...diskOverrides },
  };
}

function deleted(): ExternalFileConflictInput {
  return { kind: "deleted", baseline: baseline(), disk: null };
}

function renamed(): ExternalFileConflictInput {
  return {
    kind: "renamed",
    baseline: baseline(),
    disk: { path: "/project/renamed.txt", content: "disk v2" },
  };
}

function fileRevision(contentHash: number) {
  return {
    contentHash: String(contentHash),
    device: "1",
    inode: "2",
    modifiedNanoseconds: 3,
    modifiedSeconds: 4,
    size: 5,
  };
}
