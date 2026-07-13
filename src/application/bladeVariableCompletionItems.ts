import type {
  BladeCompletionItem,
  BladeViewVariable,
} from "./bladeIntelligenceContracts";

export const BLADE_BUILT_IN_VARIABLES: readonly BladeViewVariable[] = [
  {
    detail: "Laravel Blade variable",
    name: "$errors",
    typeHint: "ViewErrorBag",
    valueExpression: null,
    valueOffset: null,
  },
  {
    detail: "Laravel Blade variable",
    name: "$loop",
    typeHint: "Loop",
    valueExpression: null,
    valueOffset: null,
  },
] as const;

export function bladeVariableCompletionItems(
  variables: readonly BladeViewVariable[],
  prefix: string,
  range: { replaceEnd: number; replaceStart: number },
): BladeCompletionItem[] {
  return variables
    .filter((variable) =>
      variable.name.toLowerCase().startsWith(`$${prefix.toLowerCase()}`),
    )
    .slice(0, 100)
    .map((variable) => ({
      detail: variable.typeHint
        ? `${variable.detail} · ${variable.typeHint}`
        : variable.detail,
      insertText: variable.name,
      kind: "variable",
      label: variable.name,
      replaceEnd: range.replaceEnd,
      replaceStart: range.replaceStart,
    }));
}
