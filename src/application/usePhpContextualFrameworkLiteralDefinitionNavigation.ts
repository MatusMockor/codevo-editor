import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpFrameworkConfigMissingTargetMessage,
  phpFrameworkEnvMissingTargetMessage,
  phpFrameworkRouteMissingTargetMessage,
  phpFrameworkTranslationMissingTargetMessage,
  phpFrameworkViewMissingTargetMessage,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  resolvePhpFrameworkContextualLiteralDefinitionTarget,
  type PhpContextualFrameworkLiteralDefinitionRequest,
  type PhpFrameworkLiteralNavigationDependencies,
} from "./phpFrameworkLiteralDefinitionResolverRegistry";

export type {
  PhpContextualFrameworkLiteralDefinitionRequest,
} from "./phpFrameworkLiteralDefinitionResolverRegistry";

interface OpenNavigationOptions {
  readOnly?: boolean;
}

export interface PhpContextualFrameworkLiteralDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkLiteralNavigationDependencies: PhpFrameworkLiteralNavigationDependencies;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
  ): Promise<boolean>;
  providers: readonly PhpFrameworkProvider[];
  setMessage(message: string | null): void;
  supportsStringLiterals: boolean;
  workspaceRoot: string | null;
}

export interface PhpContextualFrameworkLiteralDefinitionNavigation {
  goToPhpFrameworkLiteralDefinition(
    request: PhpContextualFrameworkLiteralDefinitionRequest,
  ): Promise<boolean>;
}

export function usePhpContextualFrameworkLiteralDefinitionNavigation({
  activeDocument,
  currentWorkspaceRootRef,
  frameworkLiteralNavigationDependencies,
  openNavigationTarget,
  providers,
  setMessage,
  supportsStringLiterals,
  workspaceRoot,
}: PhpContextualFrameworkLiteralDefinitionNavigationDependencies): PhpContextualFrameworkLiteralDefinitionNavigation {
  const goToPhpFrameworkLiteralDefinition = useCallback(
    async (
      request: PhpContextualFrameworkLiteralDefinitionRequest,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !requestedRoot ||
        !activeDocument ||
        activeDocument.language !== "php" ||
        !supportsStringLiterals
      ) {
        return false;
      }

      const target = await resolvePhpFrameworkContextualLiteralDefinitionTarget(
        request,
        activeDocument,
        providers,
        frameworkLiteralNavigationDependencies,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (target === undefined) {
        return false;
      }

      if (!target) {
        const missingMessage = phpFrameworkMissingLiteralTargetMessage(
          request,
          providers,
        );

        if (missingMessage) {
          setMessage(missingMessage);
        }

        return false;
      }

      if (
        request.kind === "validationTable" &&
        workspaceRelativePath(requestedRoot, target.path) === null
      ) {
        return false;
      }

      const opened = await openNavigationTarget(
        target.path,
        target.position,
        target.label,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      return opened;
    },
    [
      activeDocument,
      currentWorkspaceRootRef,
      frameworkLiteralNavigationDependencies,
      openNavigationTarget,
      providers,
      setMessage,
      supportsStringLiterals,
      workspaceRoot,
    ],
  );

  return { goToPhpFrameworkLiteralDefinition };
}

function phpFrameworkMissingLiteralTargetMessage(
  request: PhpContextualFrameworkLiteralDefinitionRequest,
  providers: readonly PhpFrameworkProvider[],
): string | null {
  switch (request.kind) {
    case "authGuard":
      return `No Laravel auth guard ${request.guardName} found.`;

    case "broadcastConnection":
      return `No Laravel broadcast connection ${request.connectionName} found.`;

    case "cacheStore":
      return `No Laravel cache store ${request.storeName} found.`;

    case "config":
      return phpFrameworkConfigMissingTargetMessage(request.key, providers);

    case "databaseConnection":
      return `No Laravel database connection ${request.connectionName} found.`;

    case "env":
      return phpFrameworkEnvMissingTargetMessage(request.name, providers);

    case "logChannel":
      return `No Laravel log channel ${request.channelName} found.`;

    case "mailMailer":
      return `No Laravel mailer ${request.mailerName} found.`;

    case "passwordBroker":
      return `No Laravel password broker ${request.brokerName} found.`;

    case "queueConnection":
      return `No Laravel queue connection ${request.connectionName} found.`;

    case "redisConnection":
      return `No Laravel redis connection ${request.connectionName} found.`;

    case "route":
      return phpFrameworkRouteMissingTargetMessage(request.name, providers);

    case "storageDisk":
      return `No Laravel storage disk ${request.diskName} found.`;

    case "translation":
      return phpFrameworkTranslationMissingTargetMessage(
        request.key,
        providers,
      );

    case "view":
      return phpFrameworkViewMissingTargetMessage(request.name, providers);

    case "validationTable":
      return null;
  }
}
