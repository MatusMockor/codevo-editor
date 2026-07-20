import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { activePhpFrameworkMethodCompletionAdapter } from "./phpFrameworkMethodCompletionAdapterRegistry";
import {
  genericPhpMethodCompletionSemantics,
  type PhpFrameworkMethodCompletionSemanticsAdapter,
} from "./phpFrameworkMethodCompletionSemantics";
import type {
  PhpFrameworkPlugin,
  PhpFrameworkPluginMethodCompletionSemanticsDependencies,
} from "./phpFrameworkPlugin";
import { phpFrameworkPlugins } from "./phpFrameworkPluginCatalog";

export interface PhpFrameworkMethodCompletionSemanticsAdapterDependencies
  extends PhpFrameworkPluginMethodCompletionSemanticsDependencies {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider" | "supports">;
}

export function createPhpFrameworkMethodCompletionSemanticsAdapters(
  {
    frameworkRuntime,
    ...dependencies
  }: PhpFrameworkMethodCompletionSemanticsAdapterDependencies,
  plugins: readonly PhpFrameworkPlugin[] = phpFrameworkPlugins,
): PhpFrameworkMethodCompletionSemanticsAdapter {
  return activePhpFrameworkMethodCompletionAdapter(
    frameworkRuntime,
    genericPhpMethodCompletionSemantics,
    plugins.flatMap((plugin) =>
      plugin.semantics?.methodCompletion
        ? [plugin.semantics.methodCompletion(dependencies)]
        : [],
    ),
  );
}
