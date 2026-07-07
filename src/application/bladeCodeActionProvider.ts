import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

export interface BladeCodeActionProviderDependencies {
  createMissingBladeViewCodeAction: (
    source: string,
    range: PhpCodeActionRange,
    language: "blade" | "php",
    isRequestedRootActive: () => boolean,
  ) => Promise<PhpCodeActionDescriptor | null>;
  currentWorkspaceRootRef: { readonly current: string | null };
  workspaceRoot: string | null;
}

export async function provideBladeCodeActions(
  source: string,
  range: PhpCodeActionRange = { end: 0, start: 0 },
  dependencies: BladeCodeActionProviderDependencies,
): Promise<PhpCodeActionDescriptor[]> {
  const {
    createMissingBladeViewCodeAction,
    currentWorkspaceRootRef,
    workspaceRoot,
  } = dependencies;
  const requestedRoot = workspaceRoot;
  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

  if (!requestedRoot) {
    return [];
  }

  const action = await createMissingBladeViewCodeAction(
    source,
    range,
    "blade",
    isRequestedRootActive,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  return action ? [action] : [];
}
