import { describe, expect, it } from "vitest";
import {
  createOpaquePrivateValueDescriptors,
  createOpaqueTargetDescriptors,
} from "./realWorkspaceIdentity.mjs";
import {
  assertRealWorkspaceScenarioManifest,
  createRealWorkspaceScenarioManifest,
  REAL_WORKSPACE_MUTATION_POLICY,
  REAL_WORKSPACE_SCENARIOS,
  REAL_WORKSPACE_SCENARIO_IDS,
} from "./realWorkspaceScenarioManifest.mjs";

const digest = (character) => character.repeat(64);
const hmacKey = Buffer.alloc(32, 9);
const workspaceIdentity = digest("f");
const targets = createOpaqueTargetDescriptors({
  hmacKey,
  workspaceIdentity,
  targets: [1, 2, 3, 4, 5].map((number) => ({
    kind: "document",
    relativePath: `src/file-${number}.ts`,
    line: number,
    column: 1,
  })),
});
const queries = createOpaquePrivateValueDescriptors({
  hmacKey,
  workspaceIdentity,
  kind: "query",
  values: ["private-a", "private-b"],
});

function validBindings() {
  return Object.fromEntries(
    REAL_WORKSPACE_SCENARIO_IDS.map((id) => {
      if (id === "quickopen-ui") {
        return [id, { targetIds: [], queryIds: ["query-001", "query-002"] }];
      }
      if (id.startsWith("workspace-open") || id.startsWith("explorer-src")) {
        return [id, { targetIds: [], queryIds: [] }];
      }
      if (id === "tab-switch-cycle") {
        return [id, { targetIds: targets.map(({ id: targetId }) => targetId), queryIds: [] }];
      }
      return [id, { targetIds: ["target-001"], queryIds: [] }];
    }),
  );
}

function validManifest() {
  return createRealWorkspaceScenarioManifest({
    hmacKey,
    workspaceIdentity,
    targets,
    queries,
    bindings: validBindings(),
  });
}

describe("real-workspace scenario contract", () => {
  it("declares the complete closed non-mutating workflow", () => {
    expect(REAL_WORKSPACE_SCENARIO_IDS).toEqual([
      "workspace-open-cold",
      "workspace-open-warm",
      "explorer-src-cold",
      "explorer-src-warm",
      "quickopen-ui",
      "typescript-open-cold",
      "typescript-open-warm",
      "definition-f12",
      "completion",
      "references",
      "rename-compute",
      "tab-switch-cycle",
    ]);
    expect(new Set(REAL_WORKSPACE_SCENARIOS.map(({ cutPoint }) => cutPoint)).size).toBeGreaterThan(
      7,
    );
    expect(REAL_WORKSPACE_SCENARIOS.every(({ mutatesWorkspace }) => !mutatesWorkspace)).toBe(true);
    expect(
      REAL_WORKSPACE_SCENARIOS.filter(({ cacheState }) => cacheState === "cold").every(
        ({
          launchState,
          workspaceState,
          trialCount,
          samplesPerTrial,
          requiresUniqueProcessPerTrial,
        }) =>
          launchState === "fresh-process" &&
          workspaceState === "fresh-profile" &&
          trialCount === 5 &&
          samplesPerTrial === 1 &&
          requiresUniqueProcessPerTrial,
      ),
    ).toBe(true);
    expect(
      REAL_WORKSPACE_SCENARIOS.filter(({ cacheState }) => cacheState === "warm").every(
        ({ launchState, workspaceState, trialCount, requiresPrimingReceipt }) =>
          launchState === "reused-process" &&
          workspaceState === "primed" &&
          trialCount === 1 &&
          requiresPrimingReceipt,
      ),
    ).toBe(true);
    expect(REAL_WORKSPACE_MUTATION_POLICY).toEqual({
      applyWorkspaceEdit: "forbidden",
      createFiles: "forbidden",
      deleteFiles: "forbidden",
      saveDocuments: "forbidden",
      writeFiles: "forbidden",
    });
  });

  it("creates a deeply frozen canonical manifest containing opaque references only", () => {
    const manifest = validManifest();
    expect(assertRealWorkspaceScenarioManifest(manifest, { hmacKey })).toBe(true);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.scenarios)).toBe(true);
    expect(Object.isFrozen(manifest.bindings["rename-compute"])).toBe(true);

    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toMatch(
      /\/Users|\.ts|source|symbol|private-query|gitRemote|branch|commit/,
    );
    expect(serialized).toContain('"applyWorkspaceEdit":"forbidden"');
    expect(manifest.traversalAuthority).toBe(
      "best-effort-revalidation-on-non-adversarial-local-host",
    );
    expect(serialized).toContain("rename-provider-dispatch-to-workspace-edit-computed-no-apply");
  });

  it("sorts opaque descriptor tables without changing caller-owned arrays", () => {
    const reversedTargets = [...targets].reverse();
    const reversedQueries = [...queries].reverse();
    const manifest = createRealWorkspaceScenarioManifest({
      hmacKey,
      workspaceIdentity,
      targets: reversedTargets,
      queries: reversedQueries,
      bindings: validBindings(),
    });

    expect(manifest.targets.map(({ id }) => id)).toEqual(targets.map(({ id }) => id));
    expect(manifest.queries.map(({ id }) => id)).toEqual(queries.map(({ id }) => id));
    expect(reversedTargets[0].id).toBe("target-005");
  });

  it("accepts the producer's canonical 100-query boundary", () => {
    const boundaryQueries = createOpaquePrivateValueDescriptors({
      hmacKey,
      workspaceIdentity,
      kind: "query",
      values: Array.from({ length: 100 }, (_, index) => `private-${index}`),
    });
    const bindings = validBindings();
    bindings["quickopen-ui"] = {
      targetIds: [],
      queryIds: boundaryQueries.map(({ id }) => id),
    };

    const manifest = createRealWorkspaceScenarioManifest({
      hmacKey,
      workspaceIdentity,
      targets,
      queries: boundaryQueries,
      bindings,
    });
    expect(manifest.queries).toHaveLength(100);
    expect(manifest.queries.at(-1).id).toBe("query-100");
  });

  it("rejects unknown, missing, mutating, or malformed scenario bindings", () => {
    const missing = validBindings();
    delete missing.completion;
    expect(() =>
      createRealWorkspaceScenarioManifest({
        hmacKey,
        workspaceIdentity,
        targets,
        queries,
        bindings: missing,
      }),
    ).toThrow(/cover every closed scenario/);

    const unknown = { ...validBindings(), "debug-console": { targetIds: [], queryIds: [] } };
    expect(() =>
      createRealWorkspaceScenarioManifest({
        hmacKey,
        workspaceIdentity,
        targets,
        queries,
        bindings: unknown,
      }),
    ).toThrow(/cover every closed scenario/);

    const renameQuery = validBindings();
    renameQuery["rename-compute"] = {
      targetIds: ["target-001"],
      queryIds: ["query-001"],
    };
    expect(() =>
      createRealWorkspaceScenarioManifest({
        hmacKey,
        workspaceIdentity,
        targets,
        queries,
        bindings: renameQuery,
      }),
    ).toThrow(/rename-compute forbids query/);

    expect(() =>
      createRealWorkspaceScenarioManifest({
        hmacKey,
        workspaceIdentity,
        targets: [{ ...targets[0], path: "/private/workspace/src/index.ts" }],
        queries,
        bindings: validBindings(),
      }),
    ).toThrow(/only id, fingerprint/);
  });

  it("rejects opaque descriptors authenticated for a different workspace", () => {
    const foreignWorkspace = digest("e");
    const foreignTargets = createOpaqueTargetDescriptors({
      hmacKey,
      workspaceIdentity: foreignWorkspace,
      targets: [{ kind: "document", relativePath: "src/index.ts", line: 1, column: 1 }],
    });

    expect(() =>
      createRealWorkspaceScenarioManifest({
        hmacKey,
        workspaceIdentity,
        targets: foreignTargets,
        queries,
        bindings: validBindings(),
      }),
    ).toThrow(/not bound to this workspace/);
  });

  it("rejects any manifest whose closed mutation policy or scenario table was altered", () => {
    const manifest = JSON.parse(JSON.stringify(validManifest()));
    manifest.mutationPolicy.applyWorkspaceEdit = "allowed";
    expect(() => assertRealWorkspaceScenarioManifest(manifest, { hmacKey })).toThrow(
      /invalid or non-canonical/,
    );

    const changedCutPoint = JSON.parse(JSON.stringify(validManifest()));
    changedCutPoint.scenarios[0].cutPoint = "process-started";
    expect(() => assertRealWorkspaceScenarioManifest(changedCutPoint, { hmacKey })).toThrow(
      /invalid or non-canonical/,
    );
  });
});
