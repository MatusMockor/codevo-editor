import { phpLaravelCollectionModelTypeCandidate } from "./phpFrameworkLaravel";

/**
 * Methods exposed by Laravel's higher-order collection proxy
 * (`Illuminate\Support\Traits\EnumeratesValues::$proxies`) whose proxied
 * member operates on a single ELEMENT of the collection.
 *
 * Accessing one of these as a *property* (e.g. `$users->map`) yields a
 * `HigherOrderCollectionProxy` whose subsequent property / method access is
 * forwarded to each element of the collection. The control-flow proxies
 * (`when`, `unless`, `until`) are intentionally excluded because their callback
 * receives the collection itself rather than an element, so resolving them to
 * the element type would be incorrect.
 */
const laravelHigherOrderCollectionProxyElementMethods = new Set([
  "average",
  "avg",
  "contains",
  "doesntcontain",
  "each",
  "every",
  "filter",
  "first",
  "flatmap",
  "groupby",
  "keyby",
  "last",
  "map",
  "max",
  "min",
  "partition",
  "percentage",
  "reject",
  "skipuntil",
  "skipwhile",
  "some",
  "sortby",
  "sortbydesc",
  "sum",
  "takeuntil",
  "takewhile",
  "unique",
]);

export function isLaravelHigherOrderCollectionProxyMethod(
  methodName: string,
): boolean {
  return laravelHigherOrderCollectionProxyElementMethods.has(
    methodName.trim().toLowerCase(),
  );
}

/**
 * Resolves the ELEMENT type behind a Laravel higher-order collection proxy.
 *
 * Given a receiver that is a `Collection<T>` and a member name that matches a
 * higher-order proxy method, returns the element type `T` so that the following
 * `->property` / `->method()` access is resolved against the element type.
 *
 * Returns `null` when the receiver is not a collection or the member is not a
 * higher-order proxy method (conservative: never invents a type).
 */
export function phpLaravelHigherOrderCollectionProxyElementType(
  source: string,
  memberName: string,
  receiverType: string | null,
): string | null {
  if (!receiverType) {
    return null;
  }

  if (!isLaravelHigherOrderCollectionProxyMethod(memberName)) {
    return null;
  }

  return phpLaravelCollectionModelTypeCandidate(source, receiverType);
}
