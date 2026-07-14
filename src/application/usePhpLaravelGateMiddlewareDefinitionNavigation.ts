import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";

interface OpenNavigationOptions {
  readOnly?: boolean;
}

interface NamedNavigationTarget {
  path: string;
  position: EditorPosition;
}

type LaravelGateAbilityContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelGateAbilityString" }
>;
type LaravelMiddlewareAliasContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelMiddlewareAliasString" }
>;

export interface PhpLaravelGateMiddlewareDefinitionNavigationDependencies {
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

export interface PhpLaravelGateMiddlewareDefinitionNavigation {
  goToPhpLaravelGateAbilityDefinition(
    context: LaravelGateAbilityContext,
  ): Promise<boolean>;
  goToPhpLaravelMiddlewareAliasDefinition(
    context: LaravelMiddlewareAliasContext,
  ): Promise<boolean>;
}

export function usePhpLaravelGateMiddlewareDefinitionNavigation({
  activeDocument,
  collectAuthorizationAbilityTargets,
  collectMiddlewareAliasTargets,
  currentWorkspaceRootRef,
  frameworkRuntime,
  openNavigationTarget,
  setMessage,
  workspaceRoot,
}: PhpLaravelGateMiddlewareDefinitionNavigationDependencies): PhpLaravelGateMiddlewareDefinitionNavigation {
  const supportsLaravelOnlyTargets = frameworkRuntime.hasProvider("laravel");
  const openResolvedTarget = useCallback(
    async <Target extends NamedNavigationTarget>({
      gate = supportsLaravelOnlyTargets,
      label,
      missingMessage,
      resolve,
    }: {
      gate?: boolean;
      label(target: Target): string;
      missingMessage: string;
      resolve(): Promise<Target | null>;
    }): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !gate) {
        return false;
      }

      const target = await resolve();

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(missingMessage);
        return false;
      }

      return openNavigationTarget(target.path, target.position, label(target));
    },
    [
      activeDocument,
      currentWorkspaceRootRef,
      openNavigationTarget,
      setMessage,
      supportsLaravelOnlyTargets,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelGateAbilityDefinition = useCallback(
    async (context: LaravelGateAbilityContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.name,
        missingMessage: `No Laravel authorization ability ${context.ability} found.`,
        resolve: async () => {
          if (!activeDocument) {
            return null;
          }

          const abilities = await collectAuthorizationAbilityTargets(
            activeDocument.content,
            activeDocument.path,
          );

          return abilities.find((ability) => ability.name === context.ability) ?? null;
        },
      }),
    [activeDocument, collectAuthorizationAbilityTargets, openResolvedTarget],
  );

  const goToPhpLaravelMiddlewareAliasDefinition = useCallback(
    async (context: LaravelMiddlewareAliasContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.name,
        missingMessage: `No Laravel middleware alias ${context.alias} found.`,
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
    [activeDocument, collectMiddlewareAliasTargets, openResolvedTarget],
  );

  return {
    goToPhpLaravelGateAbilityDefinition,
    goToPhpLaravelMiddlewareAliasDefinition,
  };
}
