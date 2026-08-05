import {
  assertOpaqueDescriptorBindings,
  REAL_WORKSPACE_IDENTITY_SCOPE,
  REAL_WORKSPACE_TRAVERSAL_AUTHORITY,
} from "./realWorkspaceIdentity.mjs";

export const REAL_WORKSPACE_SCENARIO_MANIFEST_VERSION = "real-workspace-scenarios-v1";
export const REAL_WORKSPACE_PROFILE_ID = "real-typescript-express-v1";

export const REAL_WORKSPACE_MUTATION_POLICY = Object.freeze({
  applyWorkspaceEdit: "forbidden",
  createFiles: "forbidden",
  deleteFiles: "forbidden",
  saveDocuments: "forbidden",
  writeFiles: "forbidden",
});

export const REAL_WORKSPACE_SCENARIOS = deepFreeze([
  coldScenario("workspace-open-cold", "process-launch-to-workspace-interactive"),
  warmScenario("workspace-open-warm", "workspace-open-dispatch-to-workspace-interactive", 1, 5),
  coldScenario("explorer-src-cold", "directory-expand-dispatch-to-stable-render"),
  warmScenario("explorer-src-warm", "directory-expand-dispatch-to-stable-render", 1, 10),
  warmScenario("quickopen-ui", "query-dispatch-to-stable-ranked-render", 2, 10),
  coldScenario("typescript-open-cold", "file-open-dispatch-to-active-model-stable-frame"),
  warmScenario("typescript-open-warm", "file-open-dispatch-to-active-model-stable-frame", 1, 10),
  warmScenario("definition-f12", "definition-action-dispatch-to-target-active-stable-frame", 2, 10),
  warmScenario("completion", "completion-provider-dispatch-to-ui-ready", 2, 10),
  warmScenario("references", "references-provider-dispatch-to-ui-ready", 2, 10),
  warmScenario(
    "rename-compute",
    "rename-provider-dispatch-to-workspace-edit-computed-no-apply",
    2,
    10,
  ),
  warmScenario("tab-switch-cycle", "tab-switch-dispatch-to-active-model-stable-frame", 5, 30),
]);

export const REAL_WORKSPACE_SCENARIO_IDS = Object.freeze(
  REAL_WORKSPACE_SCENARIOS.map(({ id }) => id),
);

const SCENARIO_BY_ID = new Map(REAL_WORKSPACE_SCENARIOS.map((entry) => [entry.id, entry]));

export function createRealWorkspaceScenarioManifest({
  hmacKey,
  workspaceIdentity,
  targets,
  queries,
  bindings,
}) {
  assertDigest(workspaceIdentity, "workspaceIdentity");
  const normalizedTargets = normalizeDescriptors(targets, "target");
  const normalizedQueries = normalizeDescriptors(queries, "query");
  assertOpaqueDescriptorBindings({
    hmacKey,
    workspaceIdentity,
    kind: "target",
    descriptors: normalizedTargets,
  });
  assertOpaqueDescriptorBindings({
    hmacKey,
    workspaceIdentity,
    kind: "query",
    descriptors: normalizedQueries,
  });
  const normalizedBindings = normalizeBindings(bindings, normalizedTargets, normalizedQueries);

  return deepFreeze({
    manifestVersion: REAL_WORKSPACE_SCENARIO_MANIFEST_VERSION,
    profileId: REAL_WORKSPACE_PROFILE_ID,
    workspaceIdentity,
    identityScope: REAL_WORKSPACE_IDENTITY_SCOPE,
    traversalAuthority: REAL_WORKSPACE_TRAVERSAL_AUTHORITY,
    mutationPolicy: { ...REAL_WORKSPACE_MUTATION_POLICY },
    scenarios: REAL_WORKSPACE_SCENARIOS.map((entry) => ({ ...entry })),
    targets: normalizedTargets,
    queries: normalizedQueries,
    bindings: normalizedBindings,
  });
}

export function assertRealWorkspaceScenarioManifest(value, { hmacKey } = {}) {
  const rebuilt = createRealWorkspaceScenarioManifest({
    hmacKey,
    workspaceIdentity: value?.workspaceIdentity,
    targets: value?.targets,
    queries: value?.queries,
    bindings: value?.bindings,
  });

  if (value?.manifestVersion !== REAL_WORKSPACE_SCENARIO_MANIFEST_VERSION) {
    throw new Error("Real-workspace scenario manifest has an unsupported version.");
  }
  if (value?.profileId !== REAL_WORKSPACE_PROFILE_ID) {
    throw new Error("Real-workspace scenario manifest has an unsupported profile.");
  }
  if (JSON.stringify(value) !== JSON.stringify(rebuilt)) {
    throw new Error("Real-workspace scenario manifest has an invalid or non-canonical shape.");
  }

  return true;
}

function coldScenario(id, cutPoint) {
  return {
    id,
    cutPoint,
    cacheState: "cold",
    launchState: "fresh-process",
    workspaceState: "fresh-profile",
    trialCount: 5,
    samplesPerTrial: 1,
    warmups: 0,
    requiresUniqueProcessPerTrial: true,
    requiresPrimingReceipt: false,
    mutatesWorkspace: false,
  };
}

function warmScenario(id, cutPoint, warmups, samplesPerTrial) {
  return {
    id,
    cutPoint,
    cacheState: "warm",
    launchState: "reused-process",
    workspaceState: "primed",
    trialCount: 1,
    samplesPerTrial,
    warmups,
    requiresUniqueProcessPerTrial: false,
    requiresPrimingReceipt: true,
    mutatesWorkspace: false,
  };
}

function normalizeDescriptors(values, prefix) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    throw new Error(`Real-workspace ${prefix}s must contain between 1 and 100 entries.`);
  }

  const normalized = values.map((value) => {
    const exactKeys = ["fingerprint", "id", "workspaceBinding"];
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(exactKeys)
    ) {
      throw new Error(
        `Real-workspace ${prefix} descriptor must contain only id, fingerprint, and workspaceBinding.`,
      );
    }
    if (typeof value.id !== "string" || !new RegExp(`^${prefix}-[0-9]{3}$`).test(value.id)) {
      throw new Error(`Real-workspace ${prefix} id is invalid.`);
    }
    assertDigest(value.fingerprint, `${prefix} fingerprint`);
    assertDigest(value.workspaceBinding, `${prefix} workspaceBinding`);
    return {
      id: value.id,
      fingerprint: value.fingerprint,
      workspaceBinding: value.workspaceBinding,
    };
  });

  normalized.sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(normalized.map(({ id }) => id)).size !== normalized.length) {
    throw new Error(`Real-workspace ${prefix} ids must be unique.`);
  }
  if (new Set(normalized.map(({ fingerprint }) => fingerprint)).size !== normalized.length) {
    throw new Error(`Real-workspace ${prefix} fingerprints must be unique.`);
  }
  return normalized;
}

function normalizeBindings(bindings, targets, queries) {
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) {
    throw new Error("Real-workspace scenario bindings must be an object.");
  }

  const bindingIds = Object.keys(bindings).sort();
  if (JSON.stringify(bindingIds) !== JSON.stringify([...REAL_WORKSPACE_SCENARIO_IDS].sort())) {
    throw new Error(
      "Real-workspace scenario bindings must cover every closed scenario exactly once.",
    );
  }

  const targetIds = new Set(targets.map(({ id }) => id));
  const queryIds = new Set(queries.map(({ id }) => id));
  const normalized = {};

  for (const scenarioId of REAL_WORKSPACE_SCENARIO_IDS) {
    const binding = bindings[scenarioId];
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
      throw new Error(`Real-workspace binding for ${scenarioId} must be an object.`);
    }

    const targetIdsForScenario = normalizeBindingIds(binding.targetIds, targetIds, "target");
    const queryIdsForScenario = normalizeBindingIds(binding.queryIds, queryIds, "query");
    assertBindingShape(scenarioId, targetIdsForScenario, queryIdsForScenario);
    normalized[scenarioId] = { targetIds: targetIdsForScenario, queryIds: queryIdsForScenario };
  }

  return normalized;
}

function normalizeBindingIds(values, allowed, kind) {
  if (!Array.isArray(values) || values.length > 100) {
    throw new Error(`Real-workspace binding ${kind}Ids must be an array of at most 100 entries.`);
  }

  if (new Set(values).size !== values.length) {
    throw new Error(`Real-workspace binding ${kind}Ids must be unique.`);
  }

  for (const value of values) {
    if (typeof value !== "string" || !allowed.has(value)) {
      throw new Error(`Real-workspace binding references an unknown ${kind} id.`);
    }
  }
  return [...values];
}

function assertBindingShape(scenarioId, targetIds, queryIds) {
  if (!SCENARIO_BY_ID.has(scenarioId)) {
    throw new Error(`Unknown real-workspace scenario: ${scenarioId}`);
  }

  if (scenarioId === "quickopen-ui") {
    if (targetIds.length !== 0 || queryIds.length === 0) {
      throw new Error("quickopen-ui requires queries and forbids direct target bindings.");
    }
    return;
  }

  if (scenarioId.startsWith("workspace-open") || scenarioId.startsWith("explorer-src")) {
    if (targetIds.length !== 0 || queryIds.length !== 0) {
      throw new Error(`${scenarioId} forbids target and query bindings.`);
    }
    return;
  }

  if (queryIds.length !== 0) {
    throw new Error(`${scenarioId} forbids query bindings.`);
  }

  if (scenarioId === "tab-switch-cycle") {
    if (targetIds.length < 2) {
      throw new Error("tab-switch-cycle requires at least two opaque targets.");
    }
    return;
  }

  if (targetIds.length !== 1) {
    throw new Error(`${scenarioId} requires exactly one opaque target.`);
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`Real-workspace ${label} must be a lowercase SHA-256 HMAC digest.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}
