import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  activePhpFrameworkSemanticAdapter,
  type PhpFrameworkSemanticAdapterContribution,
} from "./phpFrameworkSemanticAdapterRegistry";

export type PhpFrameworkMethodCompletionAdapterContribution<TAdapter> =
  PhpFrameworkSemanticAdapterContribution<TAdapter>;

export function activePhpFrameworkMethodCompletionAdapter<TAdapter>(
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">,
  genericAdapter: TAdapter,
  contributions: readonly PhpFrameworkMethodCompletionAdapterContribution<TAdapter>[],
): TAdapter {
  return activePhpFrameworkSemanticAdapter(
    frameworkRuntime,
    contributions,
    genericAdapter,
  );
}
