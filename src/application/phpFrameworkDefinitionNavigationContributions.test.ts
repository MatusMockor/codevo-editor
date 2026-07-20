import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkDefinitionNavigationRegistry,
  type PhpFrameworkDefinitionNavigationContribution,
} from "./phpFrameworkDefinitionNavigationContributions";
import type { PhpFrameworkActivationContext } from "./phpFrameworkExtensionRegistry";

function activation(
  overrides: Partial<PhpFrameworkActivationContext> = {},
): PhpFrameworkActivationContext {
  return {
    generation: 7,
    isCurrent: () => true,
    ownerKey: "owner-a",
    rootPath: "/workspace-a",
    ...overrides,
  };
}

function contribution({
  handled,
  id,
  priority,
  supported,
}: {
  handled: boolean;
  id: string;
  priority?: number;
  supported: boolean;
}): {
  contribution: PhpFrameworkDefinitionNavigationContribution;
  createProvider: ReturnType<typeof vi.fn>;
  provideDefinition: ReturnType<typeof vi.fn>;
} {
  const provideDefinition = vi.fn(async () => handled);
  const createProvider = vi.fn(() => ({ provideDefinition }));

  return {
    contribution: {
      id,
      priority,
      supports: () => supported,
      createProvider,
    },
    createProvider,
    provideDefinition,
  };
}

describe("phpFrameworkDefinitionNavigationContributions", () => {
  it("does not instantiate inactive provider contributions", async () => {
    const inactive = contribution({
      handled: true,
      id: "inactive",
      supported: false,
    });
    const registry = createPhpFrameworkDefinitionNavigationRegistry({
      activation: activation(),
      frameworkRuntime: {
        hasProvider: () => false,
        supports: () => false,
      },
      contributions: [inactive.contribution],
    });

    await expect(registry.provideDefinition("<?php", 0)).resolves.toBe(false);
    expect(inactive.createProvider).not.toHaveBeenCalled();
    expect(inactive.provideDefinition).not.toHaveBeenCalled();
  });

  it("stops after the first active provider handles navigation", async () => {
    const first = contribution({ handled: true, id: "first", supported: true });
    const second = contribution({
      handled: true,
      id: "second",
      supported: true,
    });
    const request = { canNavigate: () => true };
    const registry = createPhpFrameworkDefinitionNavigationRegistry({
      activation: activation(),
      frameworkRuntime: {
        hasProvider: () => false,
        supports: () => true,
      },
      contributions: [first.contribution, second.contribution],
    });

    await expect(registry.provideDefinition("<?php", 3, request)).resolves.toBe(
      true,
    );
    expect(first.provideDefinition).toHaveBeenCalledWith(
      "<?php",
      3,
      request,
      expect.objectContaining({
        generation: 7,
        ownerKey: "owner-a",
        rootPath: "/workspace-a",
      }),
    );
    expect(second.provideDefinition).not.toHaveBeenCalled();
  });

  it("uses shared deterministic priority before registration order", async () => {
    const lower = contribution({
      handled: true,
      id: "lower",
      priority: 10,
      supported: true,
    });
    const higher = contribution({
      handled: true,
      id: "higher",
      priority: 20,
      supported: true,
    });
    const registry = createPhpFrameworkDefinitionNavigationRegistry({
      activation: activation(),
      frameworkRuntime: {
        hasProvider: () => false,
        supports: () => true,
      },
      contributions: [lower.contribution, higher.contribution],
    });

    await expect(registry.provideDefinition("<?php", 0)).resolves.toBe(true);
    expect(higher.provideDefinition).toHaveBeenCalledOnce();
    expect(lower.createProvider).not.toHaveBeenCalled();
  });

  it("rejects duplicate contribution ids before creating providers", () => {
    const duplicate = contribution({
      handled: false,
      id: "duplicate",
      supported: true,
    });

    expect(() =>
      createPhpFrameworkDefinitionNavigationRegistry({
        activation: activation(),
        frameworkRuntime: {
          hasProvider: () => false,
          supports: () => true,
        },
        contributions: [duplicate.contribution, duplicate.contribution],
      }),
    ).toThrowError(
      'Duplicate PHP framework registration id "duplicate" in PHP framework definition navigation catalog.',
    );
    expect(duplicate.createProvider).not.toHaveBeenCalled();
  });

  it("aborts and drops a pending provider after the same root is reopened", async () => {
    let currentGeneration = 7;
    const result = deferred<boolean>();
    let capturedSignal: AbortSignal | null = null;
    let canCommit: (() => boolean) | null = null;
    const abortProvider = vi.fn();
    const pendingContribution: PhpFrameworkDefinitionNavigationContribution = {
      id: "pending",
      supports: () => true,
      createProvider: () => ({
        abort: abortProvider,
        provideDefinition: async (_source, _offset, _request, scope) => {
          capturedSignal = scope?.signal ?? null;
          canCommit = scope?.canCommit ?? null;
          return result.promise;
        },
      }),
    };
    const registry = createPhpFrameworkDefinitionNavigationRegistry({
      activation: activation({ isCurrent: () => currentGeneration === 7 }),
      frameworkRuntime: {
        hasProvider: () => false,
        supports: () => true,
      },
      contributions: [pendingContribution],
    });
    const pending = registry.provideDefinition("<?php", 0);

    currentGeneration = 8;
    const observedCanCommit = canCommit as (() => boolean) | null;
    expect(observedCanCommit?.()).toBe(false);
    expect(abortProvider).toHaveBeenCalledOnce();
    result.resolve(true);

    await expect(pending).resolves.toBe(false);
    const observedSignal = capturedSignal as AbortSignal | null;
    expect(observedSignal?.aborted).toBe(true);
    expect(observedCanCommit?.()).toBe(false);
    expect(abortProvider).toHaveBeenCalledOnce();
  });

  it("aborts pending providers when the registry is disposed", async () => {
    const result = deferred<boolean>();
    let capturedSignal: AbortSignal | null = null;
    const pendingContribution: PhpFrameworkDefinitionNavigationContribution = {
      id: "pending",
      supports: () => true,
      createProvider: () => ({
        provideDefinition: async (_source, _offset, _request, scope) => {
          capturedSignal = scope?.signal ?? null;
          return result.promise;
        },
      }),
    };
    const registry = createPhpFrameworkDefinitionNavigationRegistry({
      activation: activation(),
      frameworkRuntime: {
        hasProvider: () => false,
        supports: () => true,
      },
      contributions: [pendingContribution],
    });
    const pending = registry.provideDefinition("<?php", 0);

    registry.abort?.();
    result.resolve(true);

    await expect(pending).resolves.toBe(false);
    const observedSignal = capturedSignal as AbortSignal | null;
    expect(observedSignal?.aborted).toBe(true);
  });

  it("aborts instantiated providers once and releases registry ownership", async () => {
    const abortProvider = vi.fn();
    const contribution: PhpFrameworkDefinitionNavigationContribution = {
      id: "owned-provider",
      supports: () => true,
      createProvider: () => ({
        abort: abortProvider,
        provideDefinition: async () => false,
      }),
    };
    const registry = createPhpFrameworkDefinitionNavigationRegistry({
      activation: activation(),
      frameworkRuntime: {
        hasProvider: () => false,
        supports: () => true,
      },
      contributions: [contribution],
    });

    await registry.provideDefinition("<?php", 0);
    registry.abort?.();
    registry.abort?.();

    expect(abortProvider).toHaveBeenCalledOnce();
    await expect(registry.provideDefinition("<?php", 0)).resolves.toBe(false);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}
