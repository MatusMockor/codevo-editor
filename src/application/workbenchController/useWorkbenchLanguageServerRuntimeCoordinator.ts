import { useJavaScriptTypeScriptFileStructure } from "../useJavaScriptTypeScriptFileStructure";
import { useJavaScriptTypeScriptLanguageServerSettings } from "../useJavaScriptTypeScriptLanguageServerSettings";
import { useLanguageServerRuntimeLifecycle } from "../useLanguageServerRuntimeLifecycle";
import {
  useWorkbenchLanguageRuntimeOwnership,
  type WorkbenchLanguageRuntimeOwnershipDependencies,
} from "./useWorkbenchLanguageRuntimeCoordinator";

type RuntimeLifecycleDependencies = Parameters<typeof useLanguageServerRuntimeLifecycle>[0];
type RuntimeOwnershipDependencies = Omit<
  WorkbenchLanguageRuntimeOwnershipDependencies,
  | "isLegacyJavaScriptTypeScriptLanguageServerSessionActiveForRoot"
  | "isLegacyLanguageServerSessionActiveForRoot"
  | "refreshJavaScriptTypeScriptLanguageServerPlan"
  | "stopJavaScriptTypeScriptLanguageServerRuntime"
  | "stopLanguageServerRuntime"
>;
type JavaScriptTypeScriptSettingsDependencies = Omit<
  Parameters<typeof useJavaScriptTypeScriptLanguageServerSettings>[0],
  "isJavaScriptTypeScriptLanguageServerSessionActiveForRoot"
>;
type FileStructureDependencies = Omit<
  Parameters<typeof useJavaScriptTypeScriptFileStructure>[0],
  "isLanguageServerSessionActiveForRoot"
>;

export interface WorkbenchLanguageServerRuntimeCoordinatorDependencies {
  readonly fileStructure: FileStructureDependencies;
  readonly lifecycle: RuntimeLifecycleDependencies;
  readonly ownership: RuntimeOwnershipDependencies;
  readonly settings: JavaScriptTypeScriptSettingsDependencies;
}

export type WorkbenchLanguageServerRuntimeCoordinator = Readonly<
  ReturnType<typeof useLanguageServerRuntimeLifecycle> &
    ReturnType<typeof useWorkbenchLanguageRuntimeOwnership> &
    ReturnType<typeof useJavaScriptTypeScriptLanguageServerSettings> &
    ReturnType<typeof useJavaScriptTypeScriptFileStructure>
>;

export interface WorkbenchLanguageRuntimeOwnershipCoordinatorDependencies {
  readonly lifecycle: RuntimeLifecycleDependencies;
  readonly ownership: RuntimeOwnershipDependencies;
}

export function useWorkbenchLanguageRuntimeOwnershipCoordinator({
  lifecycle,
  ownership,
}: WorkbenchLanguageRuntimeOwnershipCoordinatorDependencies) {
  const runtimeLifecycle = useLanguageServerRuntimeLifecycle(lifecycle);
  const runtimeOwnership = useWorkbenchLanguageRuntimeOwnership({
    ...ownership,
    isLegacyJavaScriptTypeScriptLanguageServerSessionActiveForRoot:
      runtimeLifecycle.isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    isLegacyLanguageServerSessionActiveForRoot:
      runtimeLifecycle.isLanguageServerSessionActiveForRoot,
    refreshJavaScriptTypeScriptLanguageServerPlan:
      runtimeLifecycle.refreshJavaScriptTypeScriptLanguageServerPlan,
    stopJavaScriptTypeScriptLanguageServerRuntime:
      runtimeLifecycle.stopJavaScriptTypeScriptLanguageServerRuntime,
    stopLanguageServerRuntime: runtimeLifecycle.stopLanguageServerRuntime,
  });
  return { ...runtimeLifecycle, ...runtimeOwnership } as const;
}

export interface WorkbenchJavaScriptTypeScriptRuntimeSurfacesCoordinatorDependencies {
  readonly fileStructure: FileStructureDependencies;
  readonly isSessionActive: ReturnType<
    typeof useWorkbenchLanguageRuntimeOwnership
  >["isJavaScriptTypeScriptLanguageServerSessionActiveForRoot"];
  readonly settings: JavaScriptTypeScriptSettingsDependencies;
}

export function useWorkbenchJavaScriptTypeScriptRuntimeSurfacesCoordinator({
  fileStructure,
  isSessionActive,
  settings,
}: WorkbenchJavaScriptTypeScriptRuntimeSurfacesCoordinatorDependencies) {
  const javaScriptTypeScriptSettings = useJavaScriptTypeScriptLanguageServerSettings({
    ...settings,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: isSessionActive,
  });
  const fileStructureState = useJavaScriptTypeScriptFileStructure({
    ...fileStructure,
    isLanguageServerSessionActiveForRoot: isSessionActive,
  });
  return { ...javaScriptTypeScriptSettings, ...fileStructureState } as const;
}

export function useWorkbenchLanguageServerRuntimeCoordinator({
  fileStructure,
  lifecycle,
  ownership,
  settings,
}: WorkbenchLanguageServerRuntimeCoordinatorDependencies): WorkbenchLanguageServerRuntimeCoordinator {
  const runtime = useWorkbenchLanguageRuntimeOwnershipCoordinator({ lifecycle, ownership });
  const surfaces = useWorkbenchJavaScriptTypeScriptRuntimeSurfacesCoordinator({
    fileStructure,
    isSessionActive: runtime.isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    settings,
  });

  return {
    ...runtime,
    ...surfaces,
  };
}
