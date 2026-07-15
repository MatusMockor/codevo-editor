import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import {
  phpFrameworkSupportsAuthorizationAbilities,
  phpFrameworkSupportsMiddlewareAliases,
} from "../domain/phpFrameworkProviders";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { canNavigate, type NavigationRequest } from "./navigationRequest";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";

interface OpenNavigationOptions {
  readOnly?: boolean;
  shouldCommit?: () => boolean;
}

interface NamedNavigationTarget {
  path: string;
  position: EditorPosition;
}

type AuthorizationAbilityContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelGateAbilityString" }
>;
type MiddlewareAliasContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelMiddlewareAliasString" }
>;

export interface PhpFrameworkAuthorizationMiddlewareDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  collectAuthorizationAbilityTargets: PhpFrameworkTargets["collectAuthorizationAbilityTargets"];
  collectMiddlewareAliasTargets: PhpFrameworkTargets["collectMiddlewareAliasTargets"];
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
  ): Promise<boolean>;
  setMessage(message: string | null): void;
  workspaceRoot: string | null;
}

export interface PhpFrameworkAuthorizationMiddlewareDefinitionNavigation {
  goToPhpFrameworkAuthorizationAbilityDefinition(
    context: AuthorizationAbilityContext,
    request?: NavigationRequest,
  ): Promise<boolean>;
  goToPhpFrameworkMiddlewareAliasDefinition(
    context: MiddlewareAliasContext,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export function usePhpFrameworkAuthorizationMiddlewareDefinitionNavigation({
  activeDocument,
  collectAuthorizationAbilityTargets,
  collectMiddlewareAliasTargets,
  currentWorkspaceRootRef,
  frameworkRuntime,
  openNavigationTarget,
  setMessage,
  workspaceRoot,
}: PhpFrameworkAuthorizationMiddlewareDefinitionNavigationDependencies): PhpFrameworkAuthorizationMiddlewareDefinitionNavigation {
  const supportsAuthorizationAbilityTargets =
    phpFrameworkSupportsAuthorizationAbilities(frameworkRuntime.providers);
  const supportsMiddlewareAliasTargets = phpFrameworkSupportsMiddlewareAliases(
    frameworkRuntime.providers,
  );
  const openResolvedTarget = useCallback(
    async <Target extends NamedNavigationTarget>({
      gate,
      label,
      missingMessage,
      resolve,
      request,
    }: {
      gate: boolean;
      label(target: Target): string;
      missingMessage: string;
      resolve(): Promise<Target | null>;
      request?: NavigationRequest;
    }): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(
          currentWorkspaceRootRef.current,
          requestedRoot,
        ) && canNavigate(request);

      if (!requestedRoot || !activeDocument || !gate || !canNavigate(request)) {
        return false;
      }

      const target = await resolve();

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        if (!isRequestedRootActive()) {
          return false;
        }

        setMessage(missingMessage);
        return false;
      }

      const opened = await openNavigationTarget(
        target.path,
        target.position,
        label(target),
        { shouldCommit: isRequestedRootActive },
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      return opened;
    },
    [
      activeDocument,
      currentWorkspaceRootRef,
      openNavigationTarget,
      setMessage,
      workspaceRoot,
    ],
  );

  const goToPhpFrameworkAuthorizationAbilityDefinition = useCallback(
    async (
      context: AuthorizationAbilityContext,
      request?: NavigationRequest,
    ): Promise<boolean> =>
      openResolvedTarget({
        gate: supportsAuthorizationAbilityTargets,
        label: (target) => target.name,
        missingMessage: `No Laravel authorization ability ${context.ability} found.`,
        request,
        resolve: async () => {
          if (!activeDocument) {
            return null;
          }

          const abilities = await collectAuthorizationAbilityTargets(
            activeDocument.content,
            activeDocument.path,
          );

          return (
            abilities.find((ability) => ability.name === context.ability) ??
            null
          );
        },
      }),
    [
      activeDocument,
      collectAuthorizationAbilityTargets,
      openResolvedTarget,
      supportsAuthorizationAbilityTargets,
    ],
  );

  const goToPhpFrameworkMiddlewareAliasDefinition = useCallback(
    async (
      context: MiddlewareAliasContext,
      request?: NavigationRequest,
    ): Promise<boolean> =>
      openResolvedTarget({
        gate: supportsMiddlewareAliasTargets,
        label: (target) => target.name,
        missingMessage: `No Laravel middleware alias ${context.alias} found.`,
        request,
        resolve: async () => {
          if (!activeDocument) {
            return null;
          }

          const aliases = await collectMiddlewareAliasTargets(
            activeDocument.content,
            activeDocument.path,
          );

          return aliases.find((alias) => alias.name === context.alias) ?? null;
        },
      }),
    [
      activeDocument,
      collectMiddlewareAliasTargets,
      openResolvedTarget,
      supportsMiddlewareAliasTargets,
    ],
  );

  return {
    goToPhpFrameworkAuthorizationAbilityDefinition,
    goToPhpFrameworkMiddlewareAliasDefinition,
  };
}
