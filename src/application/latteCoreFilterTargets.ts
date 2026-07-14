export interface LatteCoreFilterMethodTarget {
  className: string;
  methodName: string;
}

const LATTE_CORE_FILTER_METHOD_TARGETS = new Map<
  string,
  LatteCoreFilterMethodTarget
>([
  [
    "webalize",
    {
      className: "Nette\\Utils\\Strings",
      methodName: "webalize",
    },
  ],
]);

export function latteCoreFilterMethodTarget(
  filterName: string,
): LatteCoreFilterMethodTarget | null {
  return LATTE_CORE_FILTER_METHOD_TARGETS.get(filterName) ?? null;
}
