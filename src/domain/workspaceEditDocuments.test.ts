import { describe, expect, it } from "vitest";
import {
  canonicalWorkspaceEditDocumentVersion,
  mergeAliasedWorkspaceEditDocumentChanges,
} from "./workspaceEditDocuments";

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
