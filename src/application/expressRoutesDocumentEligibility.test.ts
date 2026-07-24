import { describe, expect, it } from "vitest";
import type { EditorDocument, WorkspaceDescriptor } from "../domain/workspace";
import {
  dirtyExpressRoutesDocumentSnapshot,
  dirtyExpressRoutesDocumentSnapshots,
  expressRoutesDocumentScope,
} from "./expressRoutesDocumentEligibility";

const descriptor: WorkspaceDescriptor = {
  javaScriptTypeScript: {
    frameworks: ["Express"],
  } as WorkspaceDescriptor["javaScriptTypeScript"],
  php: null,
  rootPath: "/workspace",
};
const document: EditorDocument = {
  content: 'app.get("/health", handler);',
  language: "typescript",
  name: "routes.ts",
  path: "/workspace/src/routes.ts",
  savedContent: 'app.get("/health", handler);',
};

describe("expressRoutesDocumentScope", () => {
  it("returns a stable navigation scope for an eligible workspace document", () => {
    expect(expressRoutesDocumentScope(document, "/workspace", descriptor)).toEqual({
      content: document.content,
      path: document.path,
      rootPath: "/workspace",
    });
  });

  it.each([
    ["read-only", { ...document, readOnly: true }],
    ["outside the workspace", { ...document, path: "/workspace-other/routes.ts" }],
    ["traversing outside the workspace", { ...document, path: "/workspace/src/../../routes.ts" }],
  ])("rejects a %s document", (_label, candidate) => {
    expect(expressRoutesDocumentScope(candidate, "/workspace", descriptor)).toBeNull();
  });

  it("rejects a descriptor that is stale for the active workspace", () => {
    expect(expressRoutesDocumentScope(document, "/other", descriptor)).toBeNull();
  });
});

describe("dirtyExpressRoutesDocumentSnapshot", () => {
  it("returns a workspace-relative overlay only for a dirty editable JS/TS document", () => {
    expect(
      dirtyExpressRoutesDocumentSnapshot(
        { ...document, content: 'app.get("/dirty", handler);' },
        "/workspace",
      ),
    ).toEqual({
      relativeFilePath: "src/routes.ts",
      source: 'app.get("/dirty", handler);',
    });
    expect(dirtyExpressRoutesDocumentSnapshot(document, "/workspace")).toBeNull();
    expect(
      dirtyExpressRoutesDocumentSnapshot(
        { ...document, content: "<?php", language: "php" },
        "/workspace",
      ),
    ).toBeNull();
  });

  it("collects every dirty workspace document deterministically and lets the last duplicate win", () => {
    const first = { ...document, content: 'app.get("/first", handler);' };
    const inactive = {
      ...document,
      content: 'app.post("/inactive", handler);',
      path: "/workspace/src/inactive.ts",
    };
    const active = { ...document, content: 'app.get("/active", handler);' };

    expect(
      dirtyExpressRoutesDocumentSnapshots([first, inactive, active, document], "/workspace"),
    ).toEqual([
      { relativeFilePath: "src/inactive.ts", source: 'app.post("/inactive", handler);' },
      { relativeFilePath: "src/routes.ts", source: 'app.get("/active", handler);' },
    ]);
  });

  it("rejects read-only and outside-workspace dirty documents", () => {
    const dirty = { ...document, content: 'app.get("/dirty", handler);' };
    expect(
      dirtyExpressRoutesDocumentSnapshot({ ...dirty, readOnly: true }, "/workspace"),
    ).toBeNull();
    expect(
      dirtyExpressRoutesDocumentSnapshot({ ...dirty, path: "/other/routes.ts" }, "/workspace"),
    ).toBeNull();
  });
});
