import { describe, expect, it } from "vitest";
import {
  canonicalWorkspaceEditDocumentVersion,
  mergeAliasedWorkspaceEditDocumentChanges,
  mergeWorkspaceEditDocumentChanges,
  workspaceEditDocumentVersion,
} from "./workspaceEditDocuments";
import { createWorkspaceRootFromPath } from "./workspacePath";

describe("workspace edit document aliases", () => {
  it("merges localhost and percent-encoded aliases deterministically", () => {
    const canonicalUri = "file:///project/src/User%20Service.ts";
    const aliasUri = "file://localhost/project/src/User%20Service.ts";
    const edit = mergeAliasedWorkspaceEditDocumentChanges({
      changes: {
        [canonicalUri]: [textEdit("X")],
        [aliasUri]: [textEdit("Y")],
      },
    });

    expect(edit.changes).toEqual({
      [canonicalUri]: [textEdit("X"), textEdit("Y")],
    });
    expect(canonicalWorkspaceEditDocumentVersion(edit, aliasUri)).toEqual({
      kind: "unversioned",
    });
  });

  it("preserves the first representative URI in the legacy wrapper", () => {
    const representativeUri =
      "file://localhost/project/src/%55ser%20Service.ts";
    const edit = mergeAliasedWorkspaceEditDocumentChanges({
      changes: {
        [representativeUri]: [textEdit("X")],
        "file:///project/src/User%20Service.ts": [textEdit("Y")],
      },
    });

    expect(edit.changes).toEqual({
      [representativeUri]: [textEdit("X"), textEdit("Y")],
    });
  });

  it("emits canonical URIs from the scoped merge helper", () => {
    const root = createWorkspaceRootFromPath("/project");

    expect(root.ok).toBe(true);
    if (!root.ok) {
      throw new Error(root.error.message);
    }

    const edit = mergeWorkspaceEditDocumentChanges(root.value, {
      changes: {
        "file://localhost/project/src/%55ser%20Service.ts": [textEdit("X")],
      },
    });

    expect(edit.changes).toEqual({
      "file:///project/src/User%20Service.ts": [textEdit("X")],
    });
  });

  it("uses one aliased version and rejects conflicting aliased versions", () => {
    const canonicalUri = "file:///project/src/User.ts";
    const aliasUri = "file://localhost/project/src/%55ser.ts";
    const oneVersion = {
      changes: { [canonicalUri]: [], [aliasUri]: [] },
      documentVersions: { [aliasUri]: 4 },
    };

    expect(canonicalWorkspaceEditDocumentVersion(oneVersion, canonicalUri)).toEqual({
      kind: "versioned",
      version: 4,
    });
    expect(
      canonicalWorkspaceEditDocumentVersion(
        {
          ...oneVersion,
          documentVersions: { [aliasUri]: 4, [canonicalUri]: 5 },
        },
        canonicalUri,
      ),
    ).toEqual({ kind: "conflict" });
  });

  it("rejects hostile aliases and documents outside a scoped workspace", () => {
    const root = createWorkspaceRootFromPath("/project");

    expect(root.ok).toBe(true);
    if (!root.ok) {
      throw new Error(root.error.message);
    }

    const edit = {
      changes: {
        "file:///project/src/App.ts": [textEdit("A")],
        "file:///project/src/bad%2Fname.ts": [textEdit("B")],
        "file:///other/Outside.ts": [textEdit("C")],
        "https://example.test/project/App.ts": [textEdit("D")],
      },
      documentVersions: {
        "file:///project/src/%41pp.ts": 7,
        "file:///other/Outside.ts": 9,
      },
    };

    expect(mergeWorkspaceEditDocumentChanges(root.value, edit).changes).toEqual({
      "file:///project/src/App.ts": [textEdit("A")],
    });
    expect(
      workspaceEditDocumentVersion(
        root.value,
        edit,
        "file://localhost/project/src/App.ts",
      ),
    ).toEqual({ kind: "versioned", version: 7 });
    expect(
      workspaceEditDocumentVersion(
        root.value,
        edit,
        "file:///other/Outside.ts",
      ),
    ).toEqual({ kind: "conflict" });
  });
});

function textEdit(newText: string) {
  return {
    newText,
    range: {
      end: { character: 0, line: 0 },
      start: { character: 0, line: 0 },
    },
  };
}
