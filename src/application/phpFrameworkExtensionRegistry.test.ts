import { describe, expect, it, vi } from "vitest";
import {
  PhpFrameworkScopedRegistry,
  type PhpFrameworkActivationContext,
  type PhpFrameworkOwnershipContext,
  type PhpFrameworkRegistration,
} from "./phpFrameworkExtensionRegistry";

interface TestRegistration extends PhpFrameworkRegistration {
  readonly kind: "completion" | "definition";
  readonly value: string;
}

function activation(
  overrides: Partial<PhpFrameworkActivationContext> = {},
): PhpFrameworkActivationContext {
  return {
    generation: 3,
    isCurrent: () => true,
    ownerKey: "workspace-a",
    rootPath: "/workspace-a",
    ...overrides,
  };
}

function ownership(
  overrides: Partial<PhpFrameworkOwnershipContext> = {},
): PhpFrameworkOwnershipContext {
  return {
    generation: 3,
    ownerKey: "workspace-a",
    rootPath: "/workspace-a",
    ...overrides,
  };
}

function registration(
  id: string,
  priority = 0,
  kind: TestRegistration["kind"] = "completion",
): TestRegistration {
  return { id, kind, priority, value: id };
}

function registry(
  registrations: readonly TestRegistration[] = [],
  activationContext = activation(),
): PhpFrameworkScopedRegistry<TestRegistration> {
  return new PhpFrameworkScopedRegistry({
    activation: activationContext,
    catalogName: "test framework catalog",
    registrations,
    sortKey: ({ id, kind }) => `${kind}\u0000${id}`,
  });
}

describe("PhpFrameworkScopedRegistry", () => {
  it("keeps capability registries operational without registrations", async () => {
    const emptyRegistry = registry();
    const resolver = vi.fn(() => "unused");

    expect(emptyRegistry.registrationsFor(ownership())).toEqual([]);
    await expect(
      emptyRegistry.resolveAll(ownership(), () => true, resolver),
    ).resolves.toEqual([]);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("orders registrations by descending priority then the supplied sort key", () => {
    const scopedRegistry = registry([
      registration("z-last", 10),
      registration("low", -1),
      registration("a-first", 10),
      registration("highest", 20),
    ]);

    expect(
      scopedRegistry.registrationsFor(ownership()).map(({ id }) => id),
    ).toEqual(["highest", "a-first", "z-last", "low"]);
  });

  it("filters registrations without capability-specific switches", async () => {
    const scopedRegistry = registry([
      registration("completion", 0, "completion"),
      registration("definition", 0, "definition"),
    ]);

    await expect(
      scopedRegistry.resolveAll(
        ownership(),
        ({ kind }) => kind === "definition",
        ({ value }) => value,
      ),
    ).resolves.toEqual(["definition"]);
  });

  it("resolves the first handled registration", async () => {
    const scopedRegistry = registry([
      registration("first", 20),
      registration("second", 10),
      registration("third"),
    ]);

    await expect(
      scopedRegistry.resolveFirst(
        ownership(),
        () => true,
        ({ value }) => (value === "second" ? value : null),
        (value) => value !== null,
      ),
    ).resolves.toBe("second");
  });

  it("rejects stale generations before invoking a registration", async () => {
    const scopedRegistry = registry([registration("completion")]);
    const resolver = vi.fn(() => "result");

    await expect(
      scopedRegistry.resolveAll(
        ownership({ generation: 2 }),
        () => true,
        resolver,
      ),
    ).resolves.toEqual([]);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("drops asynchronous results when the activation becomes stale", async () => {
    let current = true;
    const pendingResult = deferred<string>();
    const scopedRegistry = registry(
      [registration("completion")],
      activation({ isCurrent: () => current }),
    );
    const pending = scopedRegistry.resolveAll(
      ownership(),
      () => true,
      () => pendingResult.promise,
    );

    current = false;
    pendingResult.resolve("stale");

    await expect(pending).resolves.toEqual([]);
  });

  it("isolates registrations between owner and workspace roots", async () => {
    const scopedRegistry = registry([registration("completion")]);
    const resolver = vi.fn(({ value }: TestRegistration) => value);

    await expect(
      scopedRegistry.resolveAll(
        ownership({ ownerKey: "workspace-b" }),
        () => true,
        resolver,
      ),
    ).resolves.toEqual([]);
    await expect(
      scopedRegistry.resolveAll(
        ownership({ rootPath: "/workspace-b" }),
        () => true,
        resolver,
      ),
    ).resolves.toEqual([]);
    await expect(
      scopedRegistry.resolveAll(ownership(), () => true, resolver),
    ).resolves.toEqual(["completion"]);
  });

  it("rejects duplicate registration ids deterministically", () => {
    expect(() =>
      registry([
        registration("same", 5, "completion"),
        registration("same", 5, "definition"),
      ]),
    ).toThrowError(
      'Duplicate PHP framework registration id "same" in test framework catalog.',
    );
  });

  it("aborts a pending scope and prevents commits after disposal", async () => {
    const pendingResult = deferred<string>();
    const scopedRegistry = registry([registration("completion")]);
    let capturedSignal: AbortSignal | null = null;
    let canCommit: (() => boolean) | null = null;
    const pending = scopedRegistry.resolveAll(
      ownership(),
      () => true,
      (_registration, scope) => {
        capturedSignal = scope.signal;
        canCommit = scope.canCommit;
        return pendingResult.promise;
      },
    );

    scopedRegistry.abort();
    pendingResult.resolve("stale");

    await expect(pending).resolves.toEqual([]);
    const observedSignal = capturedSignal as AbortSignal | null;
    const observedCanCommit = canCommit as (() => boolean) | null;
    expect(observedSignal?.aborted).toBe(true);
    expect(observedCanCommit?.()).toBe(false);
  });

  it("rejects an old request when the same root reopens with a new generation", async () => {
    let generation = 3;
    const pendingResult = deferred<string>();
    const scopedRegistry = registry(
      [registration("completion")],
      activation({ isCurrent: () => generation === 3 }),
    );
    const pending = scopedRegistry.resolveAll(
      ownership(),
      () => true,
      () => pendingResult.promise,
    );

    generation = 4;
    pendingResult.resolve("old-session-result");

    await expect(pending).resolves.toEqual([]);
    await expect(
      scopedRegistry.resolveAll(
        ownership({ generation: 4 }),
        () => true,
        () => "new-session-result",
      ),
    ).resolves.toEqual([]);
  });

  it("disposes an expired activation exactly once when staleness is detected", () => {
    let current = true;
    const onDispose = vi.fn();
    const scopedRegistry = new PhpFrameworkScopedRegistry({
      activation: activation({ isCurrent: () => current }),
      catalogName: "test framework catalog",
      onDispose,
      registrations: [registration("completion")],
    });

    expect(scopedRegistry.registrationsFor(ownership())).toHaveLength(1);
    current = false;
    expect(scopedRegistry.registrationsFor(ownership())).toEqual([]);
    scopedRegistry.abort();
    expect(scopedRegistry.registrationsFor(ownership())).toEqual([]);

    expect(onDispose).toHaveBeenCalledOnce();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}
