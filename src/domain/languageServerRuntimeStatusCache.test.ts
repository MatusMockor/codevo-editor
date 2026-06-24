import { describe, expect, it } from "vitest";
import type { LanguageServerRuntimeStatus } from "./languageServerRuntime";
import {
  cachedLanguageServerRuntimeStatusForRoot,
  cacheLanguageServerRuntimeStatus,
  languageServerRuntimeStatusWithRoot,
  normalizedWorkspaceRootKey,
  removeCachedLanguageServerRuntimeStatus,
  type LanguageServerRuntimeStatusByRoot,
} from "./languageServerRuntimeStatusCache";

describe("normalizedWorkspaceRootKey", () => {
  it("collapses trailing workspace root separators conservatively", () => {
    expect(normalizedWorkspaceRootKey("/workspace-a/")).toBe("/workspace-a");
    expect(normalizedWorkspaceRootKey("/workspace-a\\\\")).toBe("/workspace-a");
    expect(normalizedWorkspaceRootKey("/")).toBe("/");
    expect(normalizedWorkspaceRootKey("C:\\")).toBe("C:\\");
  });
});

describe("languageServerRuntimeStatusWithRoot", () => {
  it("adds the workspace root to runtime statuses", () => {
    expect(languageServerRuntimeStatusWithRoot(stopped(), "/workspace")).toEqual({
      kind: "stopped",
      rootPath: "/workspace",
    });
  });

  it("keeps the same object when the status is already rooted", () => {
    const status: LanguageServerRuntimeStatus = {
      kind: "starting",
      rootPath: "/workspace",
      sessionId: 4,
    };

    expect(languageServerRuntimeStatusWithRoot(status, "/workspace")).toBe(status);
  });

  it("keeps the same object when the root only differs by trailing separators", () => {
    const status: LanguageServerRuntimeStatus = {
      kind: "starting",
      rootPath: "/workspace/",
      sessionId: 4,
    };

    expect(languageServerRuntimeStatusWithRoot(status, "/workspace")).toBe(status);
  });
});

describe("runtime status cache", () => {
  it("stores statuses by workspace root without leaking between projects", () => {
    const cache: LanguageServerRuntimeStatusByRoot = {};

    cacheLanguageServerRuntimeStatus(cache, "/workspace/api", stopped());
    cacheLanguageServerRuntimeStatus(cache, "/workspace/web", running(9));

    expect(cachedLanguageServerRuntimeStatusForRoot(cache, "/workspace/api")).toEqual({
      kind: "stopped",
      rootPath: "/workspace/api",
    });
    expect(cachedLanguageServerRuntimeStatusForRoot(cache, "/workspace/web")).toEqual({
      kind: "running",
      rootPath: "/workspace/web",
      sessionId: 9,
      capabilities: expect.any(Object),
    });
    expect(cachedLanguageServerRuntimeStatusForRoot(cache, "/workspace/other")).toBeNull();
  });

  it("removes closed workspace statuses", () => {
    const cache: LanguageServerRuntimeStatusByRoot = {
      "/workspace/api": stopped(),
    };

    removeCachedLanguageServerRuntimeStatus(cache, "/workspace/api");

    expect(cachedLanguageServerRuntimeStatusForRoot(cache, "/workspace/api")).toBeNull();
  });

  it("uses normalized workspace root keys for trailing slash variants", () => {
    const cache: LanguageServerRuntimeStatusByRoot = {};

    cacheLanguageServerRuntimeStatus(cache, "/workspace-a/", running(11));

    expect(cachedLanguageServerRuntimeStatusForRoot(cache, "/workspace-a")).toEqual({
      capabilities: expect.any(Object),
      kind: "running",
      rootPath: "/workspace-a/",
      sessionId: 11,
    });

    removeCachedLanguageServerRuntimeStatus(cache, "/workspace-a");

    expect(cachedLanguageServerRuntimeStatusForRoot(cache, "/workspace-a/")).toBeNull();
  });
});

function stopped(): LanguageServerRuntimeStatus {
  return { kind: "stopped" };
}

function running(sessionId: number): LanguageServerRuntimeStatus {
  return {
    kind: "running",
    sessionId,
    capabilities: {
      callHierarchy: true,
      codeAction: true,
      codeActionResolve: true,
      codeLens: true,
      completion: true,
      declaration: true,
      definition: true,
      documentHighlight: true,
      documentLink: true,
      documentSymbol: true,
      didRenameFiles: true,
      foldingRange: true,
      formatting: true,
      hover: true,
      implementation: true,
      inlayHint: true,
      linkedEditingRange: true,
      onTypeFormatting: true,
      prepareRename: true,
      rangeFormatting: true,
      references: true,
      rename: true,
      selectionRange: true,
      semanticTokens: true,
      signatureHelp: true,
      sourceDefinition: true,
      typeDefinition: true,
      typeHierarchy: true,
      willRenameFiles: true,
      workspaceSymbol: true,
    },
  };
}
