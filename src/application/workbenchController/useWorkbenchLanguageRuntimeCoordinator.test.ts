// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { SmartModeGateway } from "../../domain/intelligence";
import { defaultWorkspaceSettings, type WorkspaceSettings } from "../../domain/settings";
import type { IntelligenceMode } from "../../domain/workspace";
import { createWorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import {
  beginWorkbenchSmartModeIntent,
  createSmartModeSetRequest,
  languageRuntimeDocumentSyncAuthorityChanged,
  languageRuntimeDocumentSyncSignature,
  type WorkbenchSmartModeIntentState,
  useWorkbenchLanguageRuntimeOwnership,
  useWorkbenchSmartModeCoordinator,
} from "./useWorkbenchLanguageRuntimeCoordinator";

describe("languageRuntimeDocumentSyncSignature", () => {
  it("changes across same-root same-session owner generation replacement", () => {
    const rootPath = "/workspace";
    const owner = createWorkspaceRuntimeOwner("workspace-a", rootPath);
    const runtimeStatus = {
      capabilities: {} as never,
      kind: "running" as const,
      rootPath,
      sessionId: 17,
    };

    const first = languageRuntimeDocumentSyncSignature(runtimeStatus, rootPath, rootPath, owner, 4);
    const replacement = languageRuntimeDocumentSyncSignature(
      runtimeStatus,
      rootPath,
      rootPath,
      createWorkspaceRuntimeOwner("workspace-a", rootPath),
      6,
    );

    expect(first).not.toBe(replacement);
  });

  it("fails closed without a registered runtime generation", () => {
    expect(
      languageRuntimeDocumentSyncSignature(
        {
          capabilities: {} as never,
          kind: "running",
          rootPath: "/workspace",
          sessionId: 17,
        },
        "/workspace",
        "/workspace",
        createWorkspaceRuntimeOwner("workspace-a", "/workspace"),
        null,
      ),
    ).toBeNull();
  });

  it("fails closed when the runtime owner root differs from the workspace", () => {
    expect(
      languageRuntimeDocumentSyncSignature(
        {
          capabilities: {} as never,
          kind: "running",
          rootPath: "/workspace",
          sessionId: 17,
        },
        "/workspace",
        "/workspace",
        createWorkspaceRuntimeOwner("workspace-a", "/replacement"),
        1,
      ),
    ).toBeNull();
  });

  it("invalidates equal signatures across exact owner replacements", () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", "/workspace");
    const replacementOwner = createWorkspaceRuntimeOwner("workspace-a", "/workspace");
    const signature = "workspace:workspace-a:1:17";
    expect(
      languageRuntimeDocumentSyncAuthorityChanged(
        signature,
        signature,
        firstOwner,
        replacementOwner,
      ),
    ).toBe(true);
  });
});

describe("createSmartModeSetRequest", () => {
  const owner = createWorkspaceRuntimeOwner("workspace-a", "/workspace");

  it("binds a registered identity admission to the exact owner", () => {
    expect(
      createSmartModeSetRequest(
        { admissionToken: 7, canonicalRoot: "/canonical", workspaceId: "workspace-a" },
        owner,
        "fullSmart",
      ),
    ).toEqual({
      admissionToken: 7,
      mode: "fullSmart",
      rootPath: "/canonical",
      workspaceId: "workspace-a",
    });
  });

  it("fails closed for a legacy or mismatched identity", () => {
    expect(
      createSmartModeSetRequest(
        { canonicalRoot: "/canonical", workspaceId: "workspace-a" },
        owner,
        "fullSmart",
      ),
    ).toBeNull();
    expect(
      createSmartModeSetRequest(
        { admissionToken: 7, canonicalRoot: "/canonical", workspaceId: "replacement" },
        owner,
        "fullSmart",
      ),
    ).toBeNull();
  });
});

describe("beginWorkbenchSmartModeIntent", () => {
  it("makes the latest same-owner intent win before either request settles", () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", "/workspace");
    const intentGenerationRef = { current: 0 };
    const intentStateRef = { current: null };
    const dependencies = {
      currentWorkspaceRootRef: { current: "/workspace" },
      identity: { admissionToken: 7, canonicalRoot: "/workspace", workspaceId: "workspace-a" },
      intentGenerationRef,
      intentStateRef,
      owner,
      rootPath: "/workspace",
      workspaceRuntimeOwnerClaimsRef: { current: { generationFor: () => 4 } },
      workspaceRuntimeOwnerRef: { current: owner },
    };
    const settingsIntent = beginWorkbenchSmartModeIntent({
      ...dependencies,
      mode: "fullSmart",
    });
    const commandIntent = beginWorkbenchSmartModeIntent({ ...dependencies, mode: "basic" });

    expect(settingsIntent?.isCurrent()).toBe(false);
    expect(commandIntent?.isCurrent()).toBe(true);
    expect(intentGenerationRef.current).toBe(2);
  });

  it.each(["settings", "workspace open"])(
    "suppresses a deferred %s result after a newer command intent",
    async () => {
      const owner = createWorkspaceRuntimeOwner("workspace-a", "/workspace");
      const intentGenerationRef = { current: 0 };
      const intentStateRef = { current: null };
      const dependencies = {
        currentWorkspaceRootRef: { current: "/workspace" },
        identity: {
          admissionToken: 7,
          canonicalRoot: "/workspace",
          workspaceId: "workspace-a",
        },
        intentGenerationRef,
        intentStateRef,
        owner,
        rootPath: "/workspace",
        workspaceRuntimeOwnerClaimsRef: { current: { generationFor: () => 4 } },
        workspaceRuntimeOwnerRef: { current: owner },
      };
      const olderIntent = beginWorkbenchSmartModeIntent({
        ...dependencies,
        mode: "fullSmart",
      });
      if (!olderIntent) throw new Error("Missing older smart mode intent");
      const settlement = deferred<void>();
      const publish = vi.fn();
      const pending = settlement.promise.then(() => {
        if (olderIntent.isCurrent()) publish();
      });

      beginWorkbenchSmartModeIntent({ ...dependencies, mode: "basic" });
      settlement.resolve();
      await pending;

      expect(publish).not.toHaveBeenCalled();
    },
  );

  it("coalesces the same desired mode without invalidating the owning transaction", () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", "/workspace");
    const intentGenerationRef = { current: 0 };
    const intentStateRef = { current: null };
    const dependencies = {
      currentWorkspaceRootRef: { current: "/workspace" },
      identity: { admissionToken: 7, canonicalRoot: "/workspace", workspaceId: "workspace-a" },
      intentGenerationRef,
      intentStateRef,
      mode: "basic" as const,
      owner,
      rootPath: "/workspace",
      workspaceRuntimeOwnerClaimsRef: { current: { generationFor: () => 4 } },
      workspaceRuntimeOwnerRef: { current: owner },
    };
    const firstIntent = beginWorkbenchSmartModeIntent(dependencies);
    const repeatedIntent = beginWorkbenchSmartModeIntent(dependencies);

    expect(firstIntent?.isCurrent()).toBe(true);
    expect(repeatedIntent?.isCurrent()).toBe(true);
    expect(intentGenerationRef.current).toBe(1);
  });

  it("shares one backend mutation across concurrent same-mode callers", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", "/workspace");
    const intentGenerationRef = { current: 0 };
    const intentStateRef = { current: null };
    const dependencies = {
      currentWorkspaceRootRef: { current: "/workspace" },
      identity: { admissionToken: 7, canonicalRoot: "/workspace", workspaceId: "workspace-a" },
      intentGenerationRef,
      intentStateRef,
      mode: "basic" as const,
      owner,
      rootPath: "/workspace",
      workspaceRuntimeOwnerClaimsRef: { current: { generationFor: () => 4 } },
      workspaceRuntimeOwnerRef: { current: owner },
    };
    const firstIntent = beginWorkbenchSmartModeIntent(dependencies);
    const repeatedIntent = beginWorkbenchSmartModeIntent(dependencies);
    if (!firstIntent || !repeatedIntent) throw new Error("Missing smart mode intent");
    const settlement = deferred<{ message: string; mode: "basic"; status: "off" }>();
    const gateway = {
      getState: vi.fn(async () => ({
        message: "Basic mode enabled.",
        mode: "basic" as const,
        status: "off" as const,
      })),
      setMode: vi.fn(() => settlement.promise),
    };

    const first = firstIntent.setMode(gateway);
    const repeated = repeatedIntent.setMode(gateway);
    settlement.resolve({ message: "Basic mode enabled.", mode: "basic", status: "off" });

    await expect(first).resolves.toEqual({
      message: "Basic mode enabled.",
      mode: "basic",
      status: "off",
    });
    await expect(repeated).resolves.toEqual({
      message: "Basic mode enabled.",
      mode: "basic",
      status: "off",
    });
    expect(gateway.setMode).toHaveBeenCalledTimes(1);
    expect(firstIntent.claimEffects()).toBe(true);
    expect(repeatedIntent.claimEffects()).toBe(false);
  });
});

describe("useWorkbenchSmartModeCoordinator", () => {
  it("invalidates an older index operation when a newer same-owner mode intent starts", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", "/workspace");
    const intelligenceModeRef: { current: IntelligenceMode } = { current: "basic" };
    const workspaceSettingsRef: { current: WorkspaceSettings } = {
      current: { ...defaultWorkspaceSettings(), intelligenceMode: "basic" },
    };
    const currentWorkspaceRootRef = { current: "/workspace" };
    const autoStartedLanguageServerRootRef = { current: null };
    const phpLanguageServerAutostartAttemptsByRootRef = { current: {} };
    const smartModeRequestGenerationRef = { current: 0 };
    const smartModeRequestIntentRef: { current: WorkbenchSmartModeIntentState | null } = {
      current: null,
    };
    const workspaceRuntimeOwnerClaimsRef = { current: { generationFor: () => 4 } };
    const workspaceRuntimeOwnerRef = { current: owner };
    const indexSettlement = deferred<void>();
    let indexRequestIsCurrent: (() => boolean) | null = null;
    let command: ((mode: IntelligenceMode) => Promise<void>) | null = null;
    let observedMode: IntelligenceMode = "basic";
    const root = createRoot(document.createElement("div"));
    const smartModeGateway: SmartModeGateway = {
      getState: vi.fn(async () => ({
        message: "basic ready",
        mode: "basic" as const,
        status: "off" as const,
      })),
      setMode: vi.fn(async (request) => ({
        message: `${request.mode} ready`,
        mode: request.mode,
        status: request.mode === "fullSmart" ? ("ready" as const) : ("off" as const),
      })),
    };

    function Harness() {
      const [intelligenceMode, setIntelligenceMode] = useState<IntelligenceMode>("basic");
      observedMode = intelligenceMode;
      command = useWorkbenchSmartModeCoordinator({
        autoStartedLanguageServerRootRef,
        clearWorkspaceIndex: vi.fn(async () => undefined),
        currentWorkspaceRootRef,
        intelligenceMode,
        intelligenceModeRef,
        persistWorkspaceSettings: vi.fn(async (_rootPath, settings) => {
          workspaceSettingsRef.current = settings;
        }),
        phpLanguageServerAutostartAttemptsByRootRef,
        reportErrorForActiveWorkspaceRoot: vi.fn(),
        runPhpWorkspaceProbe: vi.fn(async () => undefined),
        setIntelligenceMode,
        setMessage: vi.fn(),
        smartModeGateway,
        smartModeRequestGenerationRef,
        smartModeRequestIntentRef,
        startInitialIndexScan: vi.fn(async (_rootPath, requestIsCurrent) => {
          indexRequestIsCurrent = requestIsCurrent;
          await indexSettlement.promise;
        }),
        stopLanguageServerRuntime: vi.fn(async () => undefined),
        workspaceDescriptor: { php: true },
        workspaceIdentityDescriptor: {
          admissionToken: 7,
          canonicalRoot: "/workspace",
          workspaceId: "workspace-a",
        },
        workspaceRoot: "/workspace",
        workspaceRuntimeOwnerClaimsRef,
        workspaceRuntimeOwnerRef,
        workspaceSettingsRef,
      });
      return null;
    }

    act(() => root.render(createElement(Harness)));
    if (!command) throw new Error("Smart mode coordinator did not render");
    let older = Promise.resolve();
    act(() => {
      older = command?.("fullSmart") ?? Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const getIndexRequestIsCurrent = () => {
      const predicate = indexRequestIsCurrent;
      if (!predicate) throw new Error("Index operation did not start");
      return predicate;
    };

    await act(async () => {
      await command?.("basic");
    });

    expect(getIndexRequestIsCurrent()()).toBe(false);
    indexSettlement.resolve();
    await act(async () => older);

    expect(observedMode).toBe("basic");
    expect(workspaceSettingsRef.current.intelligenceMode).toBe("basic");
    act(() => root.unmount());
  });
});

describe("useWorkbenchLanguageRuntimeOwnership", () => {
  it("does not stop runtimes without a registered claim generation", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", "/workspace");
    const stopPhp = vi.fn(async () => undefined);
    const stopTypeScript = vi.fn(async () => undefined);
    let ownership: ReturnType<typeof useWorkbenchLanguageRuntimeOwnership> | null = null;
    const root = createRoot(document.createElement("div"));
    function Harness() {
      ownership = useWorkbenchLanguageRuntimeOwnership({
        isLegacyJavaScriptTypeScriptLanguageServerSessionActiveForRoot: () => false,
        isLegacyLanguageServerSessionActiveForRoot: () => false,
        javaScriptTypeScriptRuntimeStatusByRootRef: { current: {} },
        javaScriptTypeScriptTrustAutostartRef: { current: null },
        languageServerRuntimeStatusByRootRef: { current: {} },
        openWorkspaceRequestTokenRef: { current: 1 },
        refreshJavaScriptTypeScriptLanguageServerPlan: vi.fn(async () => undefined),
        resolveCurrentWorkspaceRuntimeOwner: () => owner,
        stopJavaScriptTypeScriptLanguageServerRuntime: stopTypeScript,
        stopLanguageServerRuntime: stopPhp,
        workspaceRuntimeOwnerClaimsRef: { current: { generationFor: () => null } },
        workspaceTrustRevisionByOwnerRef: { current: {} },
        workspaceTrustRevocationByOwnerRef: { current: {} },
      });
      return null;
    }
    act(() => root.render(createElement(Harness)));
    if (!ownership) throw new Error("Runtime ownership hook did not render");
    const renderedOwnership = ownership as ReturnType<typeof useWorkbenchLanguageRuntimeOwnership>;
    await act(async () => renderedOwnership.stopProjectLanguageServersAfterTrustRevocation(owner));

    expect(stopPhp).not.toHaveBeenCalled();
    expect(stopTypeScript).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
