import type { PhpFrameworkProviderCore } from "./phpFrameworkProviderCore";

declare const phpFrameworkFeatureValue: unique symbol;

/** Open, typed identifier owned by the adapter that defines a feature. */
export interface PhpFrameworkFeatureKey<Value, Id extends string = string> {
  readonly id: Id;
  readonly [phpFrameworkFeatureValue]?: Value;
}

export interface PhpFrameworkFeatureRegistration<
  Value,
  Id extends string = string,
> {
  readonly key: PhpFrameworkFeatureKey<Value, Id>;
  readonly value: Value;
}

/** Immutable provider-owned feature snapshot. */
export interface PhpFrameworkFeatureBag {
  readonly ownerId: string;
  get<Value, Id extends string>(
    key: PhpFrameworkFeatureKey<Value, Id>,
  ): Value | undefined;
  has<Value, Id extends string>(key: PhpFrameworkFeatureKey<Value, Id>): boolean;
}

/** Neutral provider/feature snapshot passed to plugin-owned predicates. */
export interface PhpFrameworkPluginProject {
  readonly features: PhpFrameworkFeatureBag;
  readonly provider: PhpFrameworkProviderCore;
}

interface StoredPhpFrameworkFeature {
  readonly key: Readonly<{ id: string }>;
  readonly value: unknown;
}

export function definePhpFrameworkFeature<
  Value,
  const Id extends string = string,
>(id: Id): PhpFrameworkFeatureKey<Value, Id> {
  if (!id) {
    throw new Error("PHP framework feature id must not be empty.");
  }

  return Object.freeze({ id });
}

export function registerPhpFrameworkFeature<Value, const Id extends string>(
  key: PhpFrameworkFeatureKey<Value, Id>,
  value: Value,
): PhpFrameworkFeatureRegistration<Value, Id> {
  return Object.freeze({ key, value });
}

export function createPhpFrameworkFeatureBag(
  owner: PhpFrameworkProviderCore,
  registrations: readonly PhpFrameworkFeatureRegistration<unknown, string>[],
): PhpFrameworkFeatureBag {
  if (!owner.id) {
    throw new Error("PHP framework feature owner id must not be empty.");
  }

  const featuresById = new Map<string, StoredPhpFrameworkFeature>();

  for (const registration of registrations) {
    if (featuresById.has(registration.key.id)) {
      throw new Error(
        `Duplicate PHP framework feature id "${registration.key.id}" for owner "${owner.id}".`,
      );
    }

    featuresById.set(registration.key.id, {
      key: registration.key,
      value: cloneAndFreezePhpFrameworkSnapshot(registration.value),
    });
  }

  return Object.freeze({
    ownerId: owner.id,
    get<Value, Id extends string>(key: PhpFrameworkFeatureKey<Value, Id>) {
      const feature = featuresById.get(key.id);

      if (!feature || feature.key !== key) {
        return undefined;
      }

      // The registration API ties this value to this exact key. Runtime id and
      // key-identity checks keep the single internal type-erasure boundary safe.
      return feature.value as Value;
    },
    has<Value, Id extends string>(key: PhpFrameworkFeatureKey<Value, Id>) {
      const feature = featuresById.get(key.id);
      return feature?.key === key;
    },
  });
}

export function isPhpFrameworkFeatureBag(
  value: object,
): value is PhpFrameworkFeatureBag {
  return (
    "ownerId" in value &&
    typeof value.ownerId === "string" &&
    "get" in value &&
    typeof value.get === "function" &&
    "has" in value &&
    typeof value.has === "function"
  );
}

export function cloneAndFreezePhpFrameworkSnapshot<T>(value: T): T;
export function cloneAndFreezePhpFrameworkSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneAndFreezePhpFrameworkSnapshot));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const clone = Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      cloneAndFreezePhpFrameworkSnapshot(nestedValue),
    ]),
  );

  return Object.freeze(clone);
}
