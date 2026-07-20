import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkPlugin } from "./phpFrameworkPlugin";
import { phpFrameworkPlugins } from "./phpFrameworkPluginCatalog";
import { activePhpFrameworkSemanticAdapter } from "./phpFrameworkSemanticAdapterRegistry";
import {
  emptyPhpModelSourceSemanticsAdapter,
  type PhpModelSourceSemanticsAdapter,
} from "./phpModelSemanticsAdapter";

export function phpFrameworkModelSourceSemanticsAdapter(
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider" | "supports">,
  plugins: readonly PhpFrameworkPlugin[] = phpFrameworkPlugins,
): PhpModelSourceSemanticsAdapter {
  return activePhpFrameworkSemanticAdapter(
    frameworkRuntime,
    plugins.flatMap((plugin) =>
      plugin.semantics?.modelSource ? [plugin.semantics.modelSource] : [],
    ),
    emptyPhpModelSourceSemanticsAdapter,
  );
}
