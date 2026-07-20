import {
  byRegistrationOrder,
  orderPhpFrameworkRegistrationsByPriority,
} from "./phpFrameworkRegistrationOrdering";

type MaybePromise<T> = T | Promise<T>;

export interface PhpFrameworkActivationContext {
  readonly generation: number;
  readonly ownerKey: string;
  readonly rootPath: string;
  isCurrent(): boolean;
}

export interface PhpFrameworkExecutionScope extends PhpFrameworkOwnershipContext {
  readonly signal: AbortSignal;
  canCommit(): boolean;
}

export type PhpFrameworkOwnershipContext = Pick<
  PhpFrameworkActivationContext,
  "generation" | "ownerKey" | "rootPath"
>;

export interface PhpFrameworkRegistration {
  readonly id: string;
  readonly priority?: number;
}

export function assertUniquePhpFrameworkRegistrationIds(
  registrations: readonly PhpFrameworkRegistration[],
  catalogName: string,
): void {
  const ids = new Set<string>();

  for (const registration of registrations) {
    if (ids.has(registration.id)) {
      throw new Error(
        `Duplicate PHP framework registration id "${registration.id}" in ${catalogName}.`,
      );
    }

    ids.add(registration.id);
  }
}

export class PhpFrameworkActivationScope {
  private readonly abortController = new AbortController();

  constructor(
    private readonly activation: PhpFrameworkActivationContext,
    private readonly onDispose: () => void = () => undefined,
  ) {}

  executionScope(
    ownership: PhpFrameworkOwnershipContext,
  ): PhpFrameworkExecutionScope | null {
    if (!this.accepts(ownership)) {
      return null;
    }

    return {
      ...ownership,
      signal: this.abortController.signal,
      canCommit: () => this.accepts(ownership),
    };
  }

  accepts(ownership: PhpFrameworkOwnershipContext): boolean {
    if (this.abortController.signal.aborted) {
      return false;
    }

    if (!this.activation.isCurrent()) {
      this.abort();
      return false;
    }

    if (ownership.ownerKey !== this.activation.ownerKey) {
      return false;
    }

    if (ownership.rootPath !== this.activation.rootPath) {
      return false;
    }

    return ownership.generation === this.activation.generation;
  }

  abort(): void {
    if (this.abortController.signal.aborted) {
      return;
    }

    this.abortController.abort();
    this.onDispose();
  }
}

export type PhpFrameworkScopedRegistrationResolver<
  TRegistration extends PhpFrameworkRegistration,
  TResult,
> = (
  registration: TRegistration,
  scope: PhpFrameworkExecutionScope,
) => MaybePromise<TResult>;

interface PhpFrameworkScopedRegistryOptions<
  TRegistration extends PhpFrameworkRegistration,
> {
  readonly activation: PhpFrameworkActivationContext;
  readonly catalogName: string;
  readonly onDispose?: () => void;
  readonly registrations?: readonly TRegistration[];
  readonly sortKey?: (registration: TRegistration) => string;
}

/**
 * Owns the shared lifecycle policy for asynchronous framework contributions.
 * Capability-specific registries should only adapt their request/result shape.
 */
export class PhpFrameworkScopedRegistry<
  TRegistration extends PhpFrameworkRegistration,
> {
  private readonly activationScope: PhpFrameworkActivationScope;
  private readonly registrations: readonly TRegistration[];

  constructor({
    activation,
    catalogName,
    onDispose,
    registrations = [],
    sortKey = ({ id }) => id,
  }: PhpFrameworkScopedRegistryOptions<TRegistration>) {
    this.activationScope = new PhpFrameworkActivationScope(
      activation,
      onDispose,
    );
    this.registrations = normalizedRegistrations(
      registrations,
      catalogName,
      sortKey,
    );
  }

  abort(): void {
    this.activationScope.abort();
  }

  registrationsFor(
    ownership: PhpFrameworkOwnershipContext,
    predicate: (registration: TRegistration) => boolean = () => true,
  ): readonly TRegistration[] {
    if (!this.activationScope.accepts(ownership)) {
      return [];
    }

    return this.registrations.filter(predicate);
  }

  async resolveAll<TResult>(
    ownership: PhpFrameworkOwnershipContext,
    predicate: (registration: TRegistration) => boolean,
    resolver: PhpFrameworkScopedRegistrationResolver<TRegistration, TResult>,
  ): Promise<readonly TResult[]> {
    const results: TResult[] = [];

    for (const registration of this.registrationsFor(ownership, predicate)) {
      const result = await this.resolveRegistration(
        registration,
        ownership,
        resolver,
      );

      if (!result.accepted) {
        return [];
      }

      results.push(result.value);
    }

    return results;
  }

  async resolveFirst<TResult>(
    ownership: PhpFrameworkOwnershipContext,
    predicate: (registration: TRegistration) => boolean,
    resolver: PhpFrameworkScopedRegistrationResolver<TRegistration, TResult>,
    isHandled: (result: TResult) => boolean,
  ): Promise<TResult | null> {
    for (const registration of this.registrationsFor(ownership, predicate)) {
      const result = await this.resolveRegistration(
        registration,
        ownership,
        resolver,
      );

      if (!result.accepted) {
        return null;
      }

      if (isHandled(result.value)) {
        return result.value;
      }
    }

    return null;
  }

  private async resolveRegistration<TResult>(
    registration: TRegistration,
    ownership: PhpFrameworkOwnershipContext,
    resolver: PhpFrameworkScopedRegistrationResolver<TRegistration, TResult>,
  ): Promise<
    | { readonly accepted: false }
    | { readonly accepted: true; readonly value: TResult }
  > {
    const scope = this.activationScope.executionScope(ownership);

    if (!scope) {
      return { accepted: false };
    }

    let value: TResult;

    try {
      value = await resolver(registration, scope);
    } catch (error) {
      if (!scope.canCommit() || isAbortError(error)) {
        return { accepted: false };
      }

      throw error;
    }

    if (!scope.canCommit()) {
      return { accepted: false };
    }

    return { accepted: true, value };
  }
}

function normalizedRegistrations<
  TRegistration extends PhpFrameworkRegistration,
>(
  registrations: readonly TRegistration[],
  catalogName: string,
  sortKey: (registration: TRegistration) => string,
): readonly TRegistration[] {
  assertUniquePhpFrameworkRegistrationIds(registrations, catalogName);

  return orderPhpFrameworkRegistrationsByPriority(
    registrations,
    (left, right) => {
      const keyDifference = sortKey(left.registration).localeCompare(
        sortKey(right.registration),
      );

      if (keyDifference !== 0) {
        return keyDifference;
      }

      return byRegistrationOrder(left, right);
    },
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
