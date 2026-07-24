import { describe, expect, it, vi } from "vitest";
import type { NodePackageScript } from "../domain/nodePackageScripts";
import {
  createWorkspaceRoot,
  DEFAULT_WORKSPACE_PATH_POLICY,
  type WorkspacePathPolicy,
  type WorkspaceRootDescriptor,
} from "../domain/workspacePath";
import {
  createNpmRunSelectedScriptCoordinator,
  npmRunSelectedScriptInvalidSelectionMessage,
  type NpmRunSelectedScriptAuthority,
} from "./npmRunSelectedScriptCoordinator";

const CONTENT = '{"scripts":{"build":"vite","dirty-only":"custom"}}';
const SCRIPT = script("apps/web/package.json", "build");
const MODEL = {};

describe("npm run selected script coordinator", () => {
  it("runs the canonical discovered script from one exact current editor capture", () => {
    let active = false;
    const run = vi.fn((script: NodePackageScript) => {
      expect(script).toBe(SCRIPT);
      active = true;
    });
    const current = authority();
    const readAuthority = vi.fn(() => current);
    const coordinator = createNpmRunSelectedScriptCoordinator(
      readAuthority,
      {
        isActive: () => active,
        run,
      },
      vi.fn(),
    );

    expect(coordinator.runSelectedScript()).toBe(true);
    expect(readAuthority).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith(SCRIPT);
  });

  it("fails closed for trust, execution, owner, active-task, and dirty-only discovery gaps", () => {
    const run = vi.fn();
    for (const current of [
      authority({ trusted: false }),
      authority({ executionAvailable: false }),
      authority({ editor: { ...editor(), workspaceId: "other" } }),
      authority({ scripts: [] }),
      authority({
        editor: { ...editor(), anchorOffset: CONTENT.indexOf('"dirty-only"') },
      }),
    ]) {
      const coordinator = createNpmRunSelectedScriptCoordinator(
        () => current,
        {
          isActive: () => false,
          run,
        },
        vi.fn(),
      );
      expect(coordinator.runSelectedScript()).toBe(false);
    }
    const activeCoordinator = createNpmRunSelectedScriptCoordinator(
      () => authority(),
      {
        isActive: () => true,
        run,
      },
      vi.fn(),
    );
    expect(activeCoordinator.runSelectedScript()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("reports only an eligible invalid cursor with the exact official message", () => {
    const reportError = vi.fn();
    const invalid = authority({ editor: { ...editor(), anchorOffset: 0 } });
    const coordinator = createNpmRunSelectedScriptCoordinator(
      () => invalid,
      { isActive: () => false, run: vi.fn() },
      reportError,
    );
    expect(coordinator.runSelectedScript()).toBe(false);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: npmRunSelectedScriptInvalidSelectionMessage }),
    );

    const disabled = createNpmRunSelectedScriptCoordinator(
      () => authority({ trusted: false }),
      { isActive: () => false, run: vi.fn() },
      reportError,
    );
    expect(disabled.runSelectedScript()).toBe(false);
    expect(reportError).toHaveBeenCalledOnce();
  });

  it.each([
    ["model", { modelIdentity: {} }],
    ["version", { modelVersion: 8 }],
    ["content", { content: `${CONTENT} ` }],
    ["anchor", { anchorOffset: CONTENT.indexOf('"build"') + 1 }],
    ["document", { documentPath: "/workspace/other/package.json" }],
    ["editor owner", { ownerKey: "owner:replacement" }],
  ])("rejects %s drift across the atomic double capture", (_label, editorChange) => {
    const first = authority();
    const second = authority({ editor: { ...editor(), ...editorChange } });
    const run = vi.fn();
    let reads = 0;
    const coordinator = createNpmRunSelectedScriptCoordinator(
      () => (++reads === 1 ? first : second),
      { isActive: () => false, run },
      vi.fn(),
    );
    expect(coordinator.runSelectedScript()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects workspace, discovery snapshot, and admission drift before mutation", () => {
    const first = authority();
    const cases = [
      authority({ activationEpoch: 8 }),
      authority({ ownerKey: "owner:replacement" }),
      authority({ rootPath: "/other" }),
      authority({ workspaceId: "workspace-2" }),
      authority({ discoveryGeneration: 14, scripts: [SCRIPT] }),
      authority({ trusted: false }),
    ];
    for (const second of cases) {
      const run = vi.fn();
      let reads = 0;
      const coordinator = createNpmRunSelectedScriptCoordinator(
        () => (++reads === 1 ? first : second),
        { isActive: () => false, run },
        vi.fn(),
      );
      expect(coordinator.runSelectedScript()).toBe(false);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("copies scalar authority before validation and rejects mutable alias drift", () => {
    const shared = authority({ scripts: [{ ...SCRIPT }] });
    let reads = 0;
    const read = () => {
      reads += 1;
      if (reads === 2) {
        (shared as { authorityGeneration: number }).authorityGeneration = 12;
        (shared.editor as { modelVersion: number }).modelVersion = 8;
        (shared.scripts[0] as { scriptName: string }).scriptName = "spoofed";
      }
      return shared;
    };
    const run = vi.fn();
    const coordinator = createNpmRunSelectedScriptCoordinator(
      read,
      { isActive: () => false, run },
      vi.fn(),
    );
    expect(coordinator.runSelectedScript()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("uses semantic snapshots instead of array or object pointer liveness", () => {
    const first = authority();
    const second = authority({
      editor: { ...editor() },
      scripts: [{ ...SCRIPT }],
      workspaceRoots: [{ ...ROOT, policy: { ...ROOT.policy } }],
    });
    let active = false;
    let reads = 0;
    const coordinator = createNpmRunSelectedScriptCoordinator(
      () => (++reads === 1 ? first : second),
      {
        isActive: () => active,
        run: () => {
          active = true;
        },
      },
      vi.fn(),
    );
    expect(coordinator.runSelectedScript()).toBe(true);
  });

  it("uses the explicit generation to reject A to B to A resurrection", () => {
    const first = authority();
    const resurrected = authority({ authorityGeneration: 13 });
    let reads = 0;
    const run = vi.fn();
    const coordinator = createNpmRunSelectedScriptCoordinator(
      () => (++reads === 1 ? first : resurrected),
      { isActive: () => false, run },
      vi.fn(),
    );
    expect(coordinator.runSelectedScript()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("silently rejects invalid owners, generations, roots, and descriptor sets", () => {
    const otherRoot = workspaceRoot("workspace-2", "/workspace");
    const invalid: NpmRunSelectedScriptAuthority[] = [
      authority({ activationEpoch: -1 }),
      authority({ authorityGeneration: -1 }),
      authority({ discoveryGeneration: Number.NaN }),
      authority({ ownerKey: "" }),
      authority({ ownerKey: "   " }),
      authority({ ownerKey: "owner\ud800" }),
      authority({ rootPath: "" }),
      authority({ workspaceId: "" }),
      authority({ workspaceRoots: [] }),
      authority({ workspaceRoots: [otherRoot] }),
      authority({ rootPath: "/workspace/apps" }),
      authority({ workspaceRoots: [ROOT, ROOT] }),
      authority({ editor: { ...editor(), documentPath: "/workspace/package-lock.json" } }),
    ];
    const reportError = vi.fn();
    const run = vi.fn();
    for (const current of invalid) {
      const coordinator = createNpmRunSelectedScriptCoordinator(
        () => current,
        { isActive: () => false, run },
        reportError,
      );
      expect(coordinator.runSelectedScript()).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("derives the manifest path key and rejects cross-manifest and traversal spoofs", () => {
    const traversalScript = {
      ...SCRIPT,
      key: "node-package-script:apps%2Fweb%2F..%2Fweb%2Fpackage.json:build",
      manifestRelativePath: "apps/web/../web/package.json",
      packageRootRelativePath: "apps/web/../web",
    };
    const cases = [
      authority({ editor: { ...editor(), documentPath: "/workspace/apps/api/package.json" } }),
      authority({
        editor: { ...editor(), documentPath: "/workspace/apps/web/../api/package.json" },
      }),
      authority({ scripts: [traversalScript] }),
    ];
    const run = vi.fn();
    const reportError = vi.fn();
    for (const current of cases) {
      const coordinator = createNpmRunSelectedScriptCoordinator(
        () => current,
        { isActive: () => false, run },
        reportError,
      );
      expect(coordinator.runSelectedScript()).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it.each([
    ["Windows", "C:\\Workspace", "c:\\workspace\\apps\\web\\package.json"],
    ["UNC", "\\\\Server\\Share", "\\\\server\\share\\apps\\web\\package.json"],
  ])("resolves an authoritative %s manifest", (_label, rootPath, documentPath) => {
    const root = workspaceRoot("workspace-1", rootPath, CASE_INSENSITIVE);
    const current = authority({
      editor: { ...editor(), documentPath, rootPath },
      rootPath,
      workspaceRoots: [root],
    });
    let active = false;
    const run = vi.fn(() => {
      active = true;
    });
    const coordinator = createNpmRunSelectedScriptCoordinator(
      () => current,
      { isActive: () => active, run },
      vi.fn(),
    );
    expect(coordinator.runSelectedScript()).toBe(true);
    expect(run).toHaveBeenCalledWith(SCRIPT);
  });

  it("single-flights reentrant dispatch and requires lifecycle admission", () => {
    let active = false;
    let nested = true;
    const current = authority();
    const coordinatorRef: { current?: ReturnType<typeof createNpmRunSelectedScriptCoordinator> } =
      {};
    const run = vi.fn(() => {
      nested = coordinatorRef.current!.runSelectedScript();
      active = true;
    });
    const coordinator = createNpmRunSelectedScriptCoordinator(
      () => current,
      {
        isActive: () => active,
        run,
      },
      vi.fn(),
    );
    coordinatorRef.current = coordinator;
    expect(coordinator.runSelectedScript()).toBe(true);
    expect(nested).toBe(false);
    expect(run).toHaveBeenCalledOnce();

    const rejected = createNpmRunSelectedScriptCoordinator(
      () => authority(),
      {
        isActive: () => false,
        run: vi.fn(),
      },
      vi.fn(),
    );
    expect(rejected.runSelectedScript()).toBe(false);
  });

  it("releases the flight and hides synchronous reader and lifecycle failures", () => {
    const readAuthority = vi
      .fn<() => NpmRunSelectedScriptAuthority | null>()
      .mockImplementationOnce(() => {
        throw new Error("private capture failure");
      })
      .mockReturnValue(authority());
    const run = vi.fn().mockImplementationOnce(() => {
      throw new Error("private lifecycle failure");
    });
    let active = false;
    const coordinator = createNpmRunSelectedScriptCoordinator(
      readAuthority,
      {
        isActive: () => active,
        run: (selected) => {
          run(selected);
          active = true;
        },
      },
      vi.fn(),
    );
    expect(coordinator.runSelectedScript()).toBe(false);
    expect(coordinator.runSelectedScript()).toBe(false);
    expect(coordinator.runSelectedScript()).toBe(true);
  });
});

function authority(
  overrides: Partial<NpmRunSelectedScriptAuthority> = {},
): NpmRunSelectedScriptAuthority {
  return {
    activationEpoch: 7,
    authorityGeneration: 11,
    discoveryGeneration: 13,
    editor: editor(),
    executionAvailable: true,
    ownerKey: "owner:workspace-1:7",
    rootPath: "/workspace",
    scripts: SCRIPTS,
    trusted: true,
    workspaceId: "workspace-1",
    workspaceRoots: [ROOT],
    ...overrides,
  };
}

function editor() {
  return {
    activationEpoch: 7,
    anchorOffset: CONTENT.indexOf('"build"'),
    content: CONTENT,
    documentPath: "/workspace/apps/web/package.json",
    modelIdentity: MODEL,
    modelVersion: 7,
    ownerKey: "owner:workspace-1:7",
    rootPath: "/workspace",
    workspaceId: "workspace-1",
  };
}

const SCRIPTS = [SCRIPT];
const ROOT = workspaceRoot("workspace-1", "/workspace");
const CASE_INSENSITIVE = {
  caseSensitive: false as const,
  foldCase: (value: string) => value.toLocaleLowerCase("en-US"),
  unicodeNormalization: "none" as const,
};

function workspaceRoot(
  workspaceId: string,
  path: string,
  policy: WorkspacePathPolicy = DEFAULT_WORKSPACE_PATH_POLICY,
): WorkspaceRootDescriptor {
  const result = createWorkspaceRoot(workspaceId, path, policy);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function script(manifestRelativePath: string, scriptName: string): NodePackageScript {
  return {
    key: `node-package-script:${encodeURIComponent(manifestRelativePath)}:${encodeURIComponent(scriptName)}`,
    manifestRelativePath,
    packageManager: "npm",
    packageName: null,
    packageRootRelativePath: "apps/web",
    scriptName,
  };
}
