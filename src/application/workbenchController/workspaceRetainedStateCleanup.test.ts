import { describe, expect, it, vi } from "vitest";
import { createEditorSessionOwnerKey } from "../../domain/editorSessionOwnerKey";
import type { PackageScript } from "../../domain/packageScripts";
import { emptyRecentlyClosedTabs } from "../../domain/recentlyClosedTabs";
import { createWorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import {
  prepareWorkspaceTabRetainedStateCleanup,
  type WorkspaceTabRetainedStateCleanupDependencies,
} from "./workspaceRetainedStateCleanup";

const SELECTED = "/workspace";
const CANONICAL = "/real/workspace";

function harness() {
  const identity = {
    workspaceId: "workspace-id",
    selectedPath: SELECTED,
    canonicalRoot: CANONICAL,
    caseSensitive: true,
    unicodeNormalizationPolicy: "preserved" as const,
    policy: { caseSensitive: true as const, unicodeNormalization: "none" as const },
    admissionToken: 4,
  };
  const owner = createWorkspaceRuntimeOwner(identity.workspaceId, CANONICAL);
  const state: {
    tabs: string[];
    identities: Record<string, WorkspaceIdentityDescriptor>;
  } = {
    tabs: [SELECTED],
    identities: { [SELECTED]: identity, [CANONICAL]: identity },
  };
  const packageScripts: {
    current: Record<string, { composerScripts: PackageScript[]; hasArtisan: boolean }>;
  } = {
    current: {
      [SELECTED]: { composerScripts: [], hasArtisan: false },
      [CANONICAL]: { composerScripts: [], hasArtisan: false },
    },
  };
  const runtimeRootByTab = { [SELECTED]: CANONICAL, [CANONICAL]: CANONICAL };
  const runtimeOwnerByTab = { [SELECTED]: owner, [CANONICAL]: owner };
  const hasPhpWorkspaceByOwner = { [owner.ownerKey]: true };
  const ownerKey = createEditorSessionOwnerKey(identity.workspaceId, identity.canonicalRoot);
  const editorViewStatesByOwner = { [ownerKey]: { cursor: 1 } };
  const recentlyClosedTabsRef = { current: emptyRecentlyClosedTabs() };
  const forgetWorkspaceSettings = vi.fn();
  const releaseWorkspaceTrustOwner = vi.fn();
  const dependencies: WorkspaceTabRetainedStateCleanupDependencies = {
    workspaceTabs: () => state.tabs,
    identities: () => state.identities,
    currentWorkspaceRoot: () => SELECTED,
    runtimeRootByTab: () => runtimeRootByTab,
    runtimeOwnerByTab: () => runtimeOwnerByTab,
    resolveCurrentRuntimeOwner: () => owner,
    updatePackageScripts: (update) => {
      packageScripts.current = update(packageScripts.current);
    },
    forgetWorkspaceSettings,
    hasPhpWorkspaceByOwner: () => hasPhpWorkspaceByOwner,
    releaseWorkspaceTrustOwner,
    recentlyClosedTabsRef,
    editorViewStatesByOwner: () => editorViewStatesByOwner,
  };
  return {
    dependencies,
    editorViewStatesByOwner,
    forgetWorkspaceSettings,
    hasPhpWorkspaceByOwner,
    packageScripts,
    releaseWorkspaceTrustOwner,
    runtimeOwnerByTab,
    runtimeRootByTab,
    state,
  };
}

describe("prepareWorkspaceTabRetainedStateCleanup", () => {
  it("clears retained aliases, settings, runtime ownership, and trust after close", () => {
    const fixture = harness();
    const cleanup = prepareWorkspaceTabRetainedStateCleanup(fixture.dependencies, CANONICAL);
    fixture.state.tabs = [];
    cleanup();

    expect(fixture.packageScripts.current).toEqual({});
    expect(fixture.forgetWorkspaceSettings).toHaveBeenCalledWith(CANONICAL);
    expect(fixture.runtimeRootByTab).toEqual({});
    expect(fixture.runtimeOwnerByTab).toEqual({});
    expect(fixture.hasPhpWorkspaceByOwner).toEqual({});
    expect(fixture.releaseWorkspaceTrustOwner).toHaveBeenCalledWith("workspace-id");
    expect(fixture.editorViewStatesByOwner).toEqual({});
  });

  it("keeps retained state while an alias of the captured identity remains open", () => {
    const fixture = harness();
    const cleanup = prepareWorkspaceTabRetainedStateCleanup(fixture.dependencies, CANONICAL);
    cleanup();

    expect(fixture.packageScripts.current).not.toEqual({});
    expect(fixture.forgetWorkspaceSettings).not.toHaveBeenCalled();
    expect(fixture.releaseWorkspaceTrustOwner).not.toHaveBeenCalled();
  });

  it("does not clear retained state owned by a same-path replacement", () => {
    const fixture = harness();
    const cleanup = prepareWorkspaceTabRetainedStateCleanup(fixture.dependencies, SELECTED);
    fixture.state.identities = {
      [SELECTED]: { ...fixture.state.identities[SELECTED], workspaceId: "replacement" },
    };
    fixture.state.tabs = [];
    cleanup();

    expect(fixture.forgetWorkspaceSettings).not.toHaveBeenCalled();
    expect(fixture.releaseWorkspaceTrustOwner).not.toHaveBeenCalled();
  });

  it("cleans the live ref records after their backing objects are replaced", () => {
    const fixture = harness();
    let runtimeRoots = fixture.runtimeRootByTab;
    let runtimeOwners = fixture.runtimeOwnerByTab;
    let phpOwners = fixture.hasPhpWorkspaceByOwner;
    const cleanup = prepareWorkspaceTabRetainedStateCleanup(
      {
        ...fixture.dependencies,
        runtimeRootByTab: () => runtimeRoots,
        runtimeOwnerByTab: () => runtimeOwners,
        hasPhpWorkspaceByOwner: () => phpOwners,
      },
      SELECTED,
    );
    runtimeRoots = { ...runtimeRoots };
    runtimeOwners = { ...runtimeOwners };
    phpOwners = { ...phpOwners };
    fixture.state.tabs = [];
    fixture.state.identities = {};
    cleanup();

    expect(runtimeRoots).toEqual({});
    expect(runtimeOwners).toEqual({});
    expect(phpOwners).toEqual({});
  });
});
