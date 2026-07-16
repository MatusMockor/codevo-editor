import { describe, expect, it } from "vitest";
import {
  closeCompletionForDecision,
  collectDirtyCloseTargets,
  collectWorkspaceDirtyCloseTargets,
  isDirtyCloseDocument,
  type DirtyCloseDocumentMembership,
} from "./dirtyClose";
import type { EditorDocument, WorkspaceFileRevision } from "./workspace";
import {
  createWorkspaceRuntimeOwner,
  transferWorkspaceRuntimeOwner,
} from "./workspaceRuntimeOwner";

function document(
  path: string,
  content = "edited",
  savedContent = "saved",
  readOnly?: boolean,
  revision?: WorkspaceFileRevision | null,
): EditorDocument {
  return {
    content,
    language: "typescript",
    name: path.split("/").pop() ?? path,
    path,
    readOnly,
    revision,
    savedContent,
  };
}

describe("isDirtyCloseDocument", () => {
  it("accepts only dirty writable persistable documents", () => {
    expect(isDirtyCloseDocument(document("/project/src/a.ts"))).toBe(true);
    expect(
      isDirtyCloseDocument(document("/project/src/a.ts", "saved", "saved")),
    ).toBe(false);
    expect(
      isDirtyCloseDocument(document("/project/src/a.ts", "edited", "saved", true)),
    ).toBe(false);
    expect(
      isDirtyCloseDocument(document("mockor-git-diff:worktree:/project/src/a.ts")),
    ).toBe(false);
    expect(
      isDirtyCloseDocument(document("mockor-markdown-preview:/project/readme.md")),
    ).toBe(false);
  });
});

describe("collectDirtyCloseTargets", () => {
  it("deduplicates shared memberships without mutating the input", () => {
    const owner = createWorkspaceRuntimeOwner("project-a", "/project");
    const dirty = document("/project/src/a.ts");
    const memberships: DirtyCloseDocumentMembership[] = [
      { owner, documentIdentity: "src/a.ts", document: dirty },
      { owner, documentIdentity: "src/a.ts", document: dirty },
    ];

    const targets = collectDirtyCloseTargets(memberships);

    expect(targets).toEqual([
      {
        ownerKey: owner.ownerKey,
        executionRoot: "/project",
        documentIdentity: "src/a.ts",
        path: "/project/src/a.ts",
        document: dirty,
      },
    ]);
    expect(memberships).toHaveLength(2);
  });

  it("deduplicates equivalent snapshots across workspace aliases", () => {
    const owner = createWorkspaceRuntimeOwner("project-a", "/real/project");
    const aliasOwner = transferWorkspaceRuntimeOwner(owner, "/alias/project");
    const dirty = document("/real/project/src/a.ts");

    const targets = collectDirtyCloseTargets([
      {
        owner,
        documentIdentity: "src/a.ts",
        document: dirty,
      },
      {
        owner: aliasOwner,
        documentIdentity: "src/a.ts",
        document: { ...dirty },
      },
    ]);

    expect(targets).toHaveLength(1);
    expect(targets[0].ownerKey).toBe(owner.ownerKey);
    expect(targets[0].path).toBe("/real/project/src/a.ts");
  });

  it("normalizes optional writable and revision defaults during deduplication", () => {
    const owner = createWorkspaceRuntimeOwner("project-a", "/project");
    const implicitDefaults = document("/project/src/a.ts");
    const explicitDefaults = document(
      "/project/src/a.ts",
      "edited",
      "saved",
      false,
      null,
    );

    const targets = collectDirtyCloseTargets([
      {
        owner,
        documentIdentity: "src/a.ts",
        document: implicitDefaults,
      },
      {
        owner,
        documentIdentity: "src/a.ts",
        document: explicitDefaults,
      },
    ]);

    expect(implicitDefaults.readOnly).toBeUndefined();
    expect(implicitDefaults.revision).toBeUndefined();
    expect(explicitDefaults.readOnly).toBe(false);
    expect(explicitDefaults.revision).toBeNull();
    expect(targets).toHaveLength(1);
    expect(targets[0].document).toBe(implicitDefaults);
  });

  it("preserves divergent content and saved baselines for one identity", () => {
    const owner = createWorkspaceRuntimeOwner("project-a", "/project");

    const targets = collectDirtyCloseTargets([
      {
        owner,
        documentIdentity: "src/a.ts",
        document: document("/project/src/a.ts", "first edit", "baseline"),
      },
      {
        owner,
        documentIdentity: "src/a.ts",
        document: document("/project/src/a.ts", "second edit", "baseline"),
      },
      {
        owner,
        documentIdentity: "src/a.ts",
        document: document("/project/src/a.ts", "first edit", "older baseline"),
      },
    ]);

    expect(targets.map((target) => target.document.content)).toEqual([
      "first edit",
      "second edit",
      "first edit",
    ]);
    expect(targets.map((target) => target.document.savedContent)).toEqual([
      "baseline",
      "baseline",
      "older baseline",
    ]);
  });

  it("preserves divergent paths and filesystem revisions for one identity", () => {
    const owner = createWorkspaceRuntimeOwner("project-a", "/real/project");
    const aliasOwner = transferWorkspaceRuntimeOwner(owner, "/alias/project");
    const revision = {
      contentHash: "1",
      device: "2",
      inode: "3",
      modifiedNanoseconds: 4,
      modifiedSeconds: 5,
      size: 6,
    };

    const targets = collectDirtyCloseTargets([
      {
        owner,
        documentIdentity: "src/a.ts",
        document: document(
          "/real/project/src/a.ts",
          "edited",
          "saved",
          false,
          revision,
        ),
      },
      {
        owner: aliasOwner,
        documentIdentity: "src/a.ts",
        document: document(
          "/alias/project/src/a.ts",
          "edited",
          "saved",
          false,
          revision,
        ),
      },
      {
        owner,
        documentIdentity: "src/a.ts",
        document: document(
          "/real/project/src/a.ts",
          "edited",
          "saved",
          false,
          { ...revision, contentHash: "7" },
        ),
      },
    ]);

    expect(targets).toHaveLength(3);
    expect(targets.map((target) => target.path)).toEqual([
      "/real/project/src/a.ts",
      "/alias/project/src/a.ts",
      "/real/project/src/a.ts",
    ]);
  });

  it("keeps distinct workspace owners isolated even at the same root", () => {
    const ownerA = createWorkspaceRuntimeOwner("project-a", "/project");
    const ownerB = createWorkspaceRuntimeOwner("project-b", "/project");

    const targets = collectDirtyCloseTargets([
      {
        owner: ownerA,
        documentIdentity: "src/a.ts",
        document: document("/project/src/a.ts"),
      },
      {
        owner: ownerB,
        documentIdentity: "src/a.ts",
        document: document("/project/src/a.ts"),
      },
    ]);

    expect(targets.map((target) => target.ownerKey)).toEqual([
      ownerA.ownerKey,
      ownerB.ownerKey,
    ]);
  });

  it("skips empty identities and ineligible documents", () => {
    const owner = createWorkspaceRuntimeOwner("project-a", "/project");

    expect(
      collectDirtyCloseTargets([
        { owner, documentIdentity: "", document: document("/project/a.ts") },
        {
          owner,
          documentIdentity: "clean.ts",
          document: document("/project/clean.ts", "same", "same"),
        },
        {
          owner,
          documentIdentity: "diff.ts",
          document: document("mockor-git-diff:worktree:/project/diff.ts"),
        },
      ]),
    ).toEqual([]);
  });
});

describe("collectWorkspaceDirtyCloseTargets", () => {
  it("deduplicates repeated memberships but preserves divergent alias buffers", () => {
    const owner = createWorkspaceRuntimeOwner("project-a", "/real/project");
    const aliasOwner = transferWorkspaceRuntimeOwner(owner, "/alias/project");
    const realDocument = document("/real/project/src/a.ts");
    const aliasDocument = document("/alias/project/src/a.ts");

    const targets = collectWorkspaceDirtyCloseTargets([
      {
        owner,
        documentIdentities: ["src/a.ts", "src/a.ts"],
        documents: { "src/a.ts": realDocument },
      },
      {
        owner: aliasOwner,
        documentIdentities: ["src/a.ts", "missing.ts"],
        documents: { "src/a.ts": aliasDocument },
      },
    ]);

    expect(targets).toHaveLength(2);
    expect(targets[0].document).toBe(realDocument);
    expect(targets[1].document).toBe(aliasDocument);
  });
});

describe("closeCompletionForDecision", () => {
  it("resolves terminal decisions and leaves save pending application work", () => {
    expect(closeCompletionForDecision("cancel")).toBe("cancelled");
    expect(closeCompletionForDecision("discard")).toBe("closed");
    expect(closeCompletionForDecision("save")).toBeNull();
  });
});
