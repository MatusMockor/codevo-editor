import { useCallback } from "react";
import {
  symfonyRouteNavigationTarget,
  symfonyServiceNavigationTarget,
  type SymfonyRoute,
  type SymfonyService,
} from "../domain/symfonyWorkspaceIntelligence";
import type { NavigationRequest } from "./navigationRequest";

interface SymfonyWorkspaceNavigationOptions {
  readonly openPhpClassTarget: (
    className: string,
    label: string,
    request?: NavigationRequest,
  ) => Promise<boolean>;
  readonly openPhpMethodTarget: (
    className: string,
    methodName: string,
    request?: NavigationRequest,
  ) => Promise<boolean>;
}

export function useSymfonyWorkspaceNavigation({
  openPhpClassTarget,
  openPhpMethodTarget,
}: SymfonyWorkspaceNavigationOptions) {
  const openSymfonyRouteController = useCallback(
    (route: SymfonyRoute, shouldCommit: () => boolean): Promise<boolean> => {
      const target = symfonyRouteNavigationTarget(route);

      return target?.kind === "phpMethod"
        ? openPhpMethodTarget(target.className, target.methodName, {
            canNavigate: shouldCommit,
          })
        : Promise.resolve(false);
    },
    [openPhpMethodTarget],
  );

  const openSymfonyService = useCallback(
    (service: SymfonyService, shouldCommit: () => boolean): Promise<boolean> => {
      const target = symfonyServiceNavigationTarget(service);

      return target?.kind === "phpClass"
        ? openPhpClassTarget(target.className, target.className, {
            canNavigate: shouldCommit,
          })
        : Promise.resolve(false);
    },
    [openPhpClassTarget],
  );

  return { openSymfonyRouteController, openSymfonyService };
}
