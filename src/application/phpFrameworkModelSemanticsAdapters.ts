import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { activePhpFrameworkSemanticAdapter } from "./phpFrameworkSemanticAdapterRegistry";
import { createPhpLaravelModelSemanticsSourceAdapter } from "./phpLaravelModelSemanticsSourceAdapter";
import {
  emptyPhpModelSourceSemanticsAdapter,
  type PhpModelSourceSemanticsAdapter,
} from "./phpModelSemanticsAdapter";

export function phpFrameworkModelSourceSemanticsAdapter(
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider" | "supports">,
): PhpModelSourceSemanticsAdapter {
  return activePhpFrameworkSemanticAdapter(
    frameworkRuntime,
    [
      {
        capability: "eloquentModelSemantics",
        createAdapter: createPhpLaravelModelSemanticsSourceAdapter,
      },
    ],
    emptyPhpModelSourceSemanticsAdapter,
  );
}
