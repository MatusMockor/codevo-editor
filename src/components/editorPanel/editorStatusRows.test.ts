import { describe, expect, it } from "vitest";
import { editorStatusRows } from "./editorStatusRows";

const BASE = {
  activeLanguage: "TypeScript",
  workspaceLabel: "orders-api · TS 5.8",
  gitBranch: "feat/idempotency-keys",
  branchRepositoryLabel: null,
  workspaceTrustLabel: "Trusted",
  intelligenceMode: "fullSmart" as const,
  largeDocumentStatus: null,
  dirtyCount: 0,
};

describe("editorStatusRows", () => {
  it("lists the former status bar readouts in a stable order", () => {
    expect(
      editorStatusRows({
        ...BASE,
        dirtyCount: 2,
        largeDocumentStatus: { label: "Large file", title: "t" },
      }),
    ).toEqual([
      { id: "language", label: "Language", value: "TypeScript" },
      { id: "project", label: "Project", value: "orders-api · TS 5.8" },
      { id: "branch", label: "Branch", value: "feat/idempotency-keys" },
      { id: "trust", label: "Trust", value: "Trusted" },
      { id: "mode", label: "Mode", value: "IDE Mode" },
      { id: "largeFile", label: "Large file", value: "Large file" },
      { id: "unsaved", label: "Unsaved", value: "2 files" },
    ]);
  });

  it("omits empty readouts and names every intelligence mode", () => {
    const rows = editorStatusRows({
      ...BASE,
      activeLanguage: null,
      gitBranch: null,
      workspaceTrustLabel: null,
      workspaceLabel: null,
      intelligenceMode: "basic",
    });

    expect(rows).toEqual([{ id: "mode", label: "Mode", value: "Editor Mode" }]);
    expect(
      editorStatusRows({ ...BASE, intelligenceMode: "lightSmart" }).find((row) => row.id === "mode")
        ?.value,
    ).toBe("Smart Index");
    expect(
      editorStatusRows({ ...BASE, dirtyCount: 1 }).find((row) => row.id === "unsaved")?.value,
    ).toBe("1 file");
  });

  it("joins the branch with its repository label when one is known", () => {
    expect(
      editorStatusRows({ ...BASE, branchRepositoryLabel: "api" }).find((row) => row.id === "branch")
        ?.value,
    ).toBe("feat/idempotency-keys · api");
    expect(
      editorStatusRows({ ...BASE, gitBranch: null, branchRepositoryLabel: "api" }).find(
        (row) => row.id === "branch",
      ),
    ).toBeUndefined();
  });
});
