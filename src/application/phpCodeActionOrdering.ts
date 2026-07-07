import type { PhpCodeActionDescriptor } from "./phpCodeActionTypes";

/**
 * Orders aggregated PHP code actions so the most-likely action for the cursor /
 * selection leads the list (PhpStorm Alt+Enter "most likely first").
 */
export function orderPhpCodeActions(
  actions: PhpCodeActionDescriptor[],
): PhpCodeActionDescriptor[] {
  return actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => {
      const byFamily =
        phpCodeActionFamilyRank(left.action) -
        phpCodeActionFamilyRank(right.action);

      if (byFamily !== 0) {
        return byFamily;
      }

      const byPreferred =
        Number(right.action.isPreferred ?? false) -
        Number(left.action.isPreferred ?? false);

      if (byPreferred !== 0) {
        return byPreferred;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.action);
}

function phpCodeActionFamilyRank(action: PhpCodeActionDescriptor): number {
  const kind = action.kind ?? "quickfix";

  if (kind.startsWith("quickfix")) {
    return 0;
  }

  if (kind.startsWith("refactor.extract")) {
    return 1;
  }

  if (kind.startsWith("refactor.inline")) {
    return 2;
  }

  if (kind.startsWith("refactor")) {
    return 3;
  }

  if (kind.startsWith("source")) {
    return 4;
  }

  return 5;
}
