import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  activePhpFrameworkIdentifierNavigationAdapters,
  type PhpFrameworkIdentifierNavigationActivationAdapter,
  type PhpFrameworkIdentifierNavigationAdapters,
} from "./phpFrameworkIdentifierNavigationAdapters";

export interface PhpFrameworkIdentifierNavigationAdapterDependencies {
  activationAdapters: readonly PhpFrameworkIdentifierNavigationActivationAdapter[];
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
}

export function createPhpFrameworkIdentifierNavigationAdapters({
  activationAdapters,
  frameworkRuntime,
}: PhpFrameworkIdentifierNavigationAdapterDependencies): PhpFrameworkIdentifierNavigationAdapters {
  return activePhpFrameworkIdentifierNavigationAdapters(
    frameworkRuntime,
    activationAdapters,
  );
}
