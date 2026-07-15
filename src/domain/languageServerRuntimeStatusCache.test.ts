import { describe, expect, it } from "vitest";
import type { LanguageServerRuntimeStatus } from "./languageServerRuntime";
import {
  cachedLanguageServerRuntimeStatusForOwner,
  cachedLanguageServerRuntimeStatusForRoot,
  cacheLanguageServerRuntimeStatusForOwner,
  cacheLanguageServerRuntimeStatus,
  clearCachedLanguageServerRuntimeStatuses,
  forgetCachedLanguageServerRuntimeStatus,
  languageServerRuntimeStatusWithRoot,
  normalizedWorkspaceRootKey,
  removeCachedLanguageServerRuntimeStatus,
  type LanguageServerRuntimeStatusByOwner,
  type LanguageServerRuntimeStatusByRoot,
} from "./languageServerRuntimeStatusCache";
import {
  createLegacyWorkspaceRuntimeOwner,
  createWorkspaceRuntimeOwner,
  transferWorkspaceRuntimeOwner,
} from "./workspaceRuntimeOwner";

describe("workspace runtime owner", () => {
  it("separates stable ownership from the selected execution root", () => {
    const admitted = createWorkspaceRuntimeOwner(
      "workspace-a",
      "/links/workspace-a",
    );
    const legacy = createLegacyWorkspaceRuntimeOwner("/workspace-a/");

    expect(admitted).toEqual({
      ownerKey: "workspace-a",
      executionRoot: "/links/workspace-a",
    });
    expect(legacy).toEqual({
      ownerKey: "/workspace-a",
      executionRoot: "/workspace-a/",
    });
    expect(Object.isFrozen(admitted)).toBe(true);
    expect(Object.isFrozen(legacy)).toBe(true);
  });
});

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
    expect(
      languageServerRuntimeStatusWithRoot(stopped(), "/workspace"),
    ).toEqual({
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

    expect(languageServerRuntimeStatusWithRoot(status, "/workspace")).toBe(
      status,
    );
  });

  it("keeps the same object when the root only differs by trailing separators", () => {
    const status: LanguageServerRuntimeStatus = {
      kind: "starting",
      rootPath: "/workspace/",
      sessionId: 4,
    };

    expect(languageServerRuntimeStatusWithRoot(status, "/workspace")).toBe(
      status,
    );
  });
});

describe("runtime status cache", () => {
  it("collapses selected-path aliases that have the same admitted owner", () => {
    const cache: LanguageServerRuntimeStatusByOwner = {};
    const firstAlias = createWorkspaceRuntimeOwner(
      "workspace-a",
      "/links/workspace-a",
    );
    const secondAlias = createWorkspaceRuntimeOwner(
      "workspace-a",
      "/workspaces/workspace-a",
    );

    cacheLanguageServerRuntimeStatusForOwner(cache, firstAlias, stopped());
    cacheLanguageServerRuntimeStatusForOwner(cache, secondAlias, running(9));

    expect(Object.keys(cache)).toEqual(["workspace-a"]);
    expect(
      cachedLanguageServerRuntimeStatusForOwner(cache, secondAlias),
    ).toEqual({
      capabilities: expect.any(Object),
      kind: "running",
      rootPath: "/workspaces/workspace-a",
      sessionId: 9,
    });
  });

  it("isolates distinct admitted owners that select the same execution root", () => {
    const cache: LanguageServerRuntimeStatusByOwner = {};
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", "/workspace");
    const secondOwner = createWorkspaceRuntimeOwner(
      "workspace-b",
      "/workspace",
    );

    cacheLanguageServerRuntimeStatusForOwner(cache, firstOwner, stopped());
    cacheLanguageServerRuntimeStatusForOwner(cache, secondOwner, running(12));

    expect(
      cachedLanguageServerRuntimeStatusForOwner(cache, firstOwner)?.kind,
    ).toBe("stopped");
    expect(
      cachedLanguageServerRuntimeStatusForOwner(cache, secondOwner)?.kind,
    ).toBe("running");
  });

  it("transfers a cached status to the owner's selected execution root", () => {
    const cache: LanguageServerRuntimeStatusByOwner = {};
    const owner = createWorkspaceRuntimeOwner(
      "workspace-a",
      "/links/workspace-a",
    );
    const transferredOwner = transferWorkspaceRuntimeOwner(
      owner,
      "/workspaces/workspace-a",
    );

    cacheLanguageServerRuntimeStatusForOwner(cache, owner, running(14));

    const transferred = cachedLanguageServerRuntimeStatusForOwner(
      cache,
      transferredOwner,
    );
    expect(transferred).toEqual({
      capabilities: expect.any(Object),
      kind: "running",
      rootPath: "/workspaces/workspace-a",
      sessionId: 14,
    });
    expect(cache[transferredOwner.ownerKey]).toBe(transferred);
  });

  it("forgets one owner without removing another owner", () => {
    const cache: LanguageServerRuntimeStatusByOwner = {};
    const firstOwner = createWorkspaceRuntimeOwner(
      "workspace-a",
      "/workspace-a",
    );
    const secondOwner = createWorkspaceRuntimeOwner(
      "workspace-b",
      "/workspace-b",
    );

    cacheLanguageServerRuntimeStatusForOwner(cache, firstOwner, stopped());
    cacheLanguageServerRuntimeStatusForOwner(cache, secondOwner, running(16));

    forgetCachedLanguageServerRuntimeStatus(cache, firstOwner);

    expect(
      cachedLanguageServerRuntimeStatusForOwner(cache, firstOwner),
    ).toBeNull();
    expect(
      cachedLanguageServerRuntimeStatusForOwner(cache, secondOwner)?.kind,
    ).toBe("running");
  });

  it("clears all owners while keeping the cache object stable", () => {
    const cache: LanguageServerRuntimeStatusByOwner = {};
    const cacheReference = cache;

    cacheLanguageServerRuntimeStatusForOwner(
      cache,
      createWorkspaceRuntimeOwner("workspace-a", "/workspace-a"),
      stopped(),
    );
    cacheLanguageServerRuntimeStatusForOwner(
      cache,
      createLegacyWorkspaceRuntimeOwner("/legacy-workspace"),
      running(18),
    );

    clearCachedLanguageServerRuntimeStatuses(cache);

    expect(cache).toBe(cacheReference);
    expect(cache).toEqual({});
  });

  it("stores statuses by workspace root without leaking between projects", () => {
    const cache: LanguageServerRuntimeStatusByRoot = {};

    cacheLanguageServerRuntimeStatus(cache, "/workspace/api", stopped());
    cacheLanguageServerRuntimeStatus(cache, "/workspace/web", running(9));

    expect(
      cachedLanguageServerRuntimeStatusForRoot(cache, "/workspace/api"),
    ).toEqual({
      kind: "stopped",
      rootPath: "/workspace/api",
    });
    expect(
      cachedLanguageServerRuntimeStatusForRoot(cache, "/workspace/web"),
    ).toEqual({
      kind: "running",
      rootPath: "/workspace/web",
      sessionId: 9,
      capabilities: expect.any(Object),
    });
    expect(
      cachedLanguageServerRuntimeStatusForRoot(cache, "/workspace/other"),
    ).toBeNull();
  });

  it("removes closed workspace statuses", () => {
    const cache: LanguageServerRuntimeStatusByRoot = {
      "/workspace/api": stopped(),
    };

    removeCachedLanguageServerRuntimeStatus(cache, "/workspace/api");

    expect(
      cachedLanguageServerRuntimeStatusForRoot(cache, "/workspace/api"),
    ).toBeNull();
  });

  it("uses normalized workspace root keys for trailing slash variants", () => {
    const cache: LanguageServerRuntimeStatusByRoot = {};

    cacheLanguageServerRuntimeStatus(cache, "/workspace-a/", running(11));

    expect(
      cachedLanguageServerRuntimeStatusForRoot(cache, "/workspace-a"),
    ).toEqual({
      capabilities: expect.any(Object),
      kind: "running",
      rootPath: "/workspace-a/",
      sessionId: 11,
    });

    removeCachedLanguageServerRuntimeStatus(cache, "/workspace-a");

    expect(
      cachedLanguageServerRuntimeStatusForRoot(cache, "/workspace-a/"),
    ).toBeNull();
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
      didCreateFiles: true,
      didDeleteFiles: true,
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
      willCreateFiles: true,
      willDeleteFiles: true,
      willRenameFiles: true,
      workspaceSymbol: true,
    },
  };
}
