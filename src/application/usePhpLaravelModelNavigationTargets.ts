import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpLaravelDynamicWhereAttributeTargetFromSource,
  phpLaravelModelAccessorTargetFromSource,
  phpLaravelModelAttributeTargetFromSource,
} from "../domain/phpFrameworkLaravel";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { canNavigate, type NavigationRequest } from "./navigationRequest";

interface OpenNavigationOptions {
  readOnly?: boolean;
  shouldCommit?: () => boolean;
}

export interface PhpLaravelModelNavigationTargetsDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
  ): Promise<boolean>;
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassSourcePaths(className: string): Promise<readonly string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface PhpLaravelModelNavigationTargets {
  openPhpLaravelDynamicWhereTarget(
    className: string,
    methodName: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  openPhpLaravelModelAttributeTarget(
    className: string,
    attributeName: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export function usePhpLaravelModelNavigationTargets({
  currentWorkspaceRootRef,
  frameworkRuntime,
  openNavigationTarget,
  readNavigationFileContent,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: PhpLaravelModelNavigationTargetsDependencies): PhpLaravelModelNavigationTargets {
  const canOpenLaravelModelSourceTargets =
    frameworkRuntime.providers.length > 0 &&
    frameworkRuntime.supports("eloquentModelSemantics");

  const openPhpLaravelDynamicWhereTarget = useCallback(
    async (
      className: string,
      methodName: string,
      request?: NavigationRequest,
    ): Promise<boolean> =>
      openLaravelModelSourceTarget({
        className,
        canOpenLaravelModelSourceTargets,
        currentWorkspaceRootRef,
        openNavigationTarget,
        readNavigationFileContent,
        request,
        resolvePhpClassSourcePaths,
        resolveTarget: (source) =>
          phpLaravelDynamicWhereAttributeTargetFromSource(source, methodName),
        workspaceDescriptor,
        workspaceRoot,
      }),
    [
      canOpenLaravelModelSourceTargets,
      currentWorkspaceRootRef,
      openNavigationTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const openPhpLaravelModelAttributeTarget = useCallback(
    async (
      className: string,
      attributeName: string,
      request?: NavigationRequest,
    ): Promise<boolean> =>
      openLaravelModelSourceTarget({
        className,
        canOpenLaravelModelSourceTargets,
        currentWorkspaceRootRef,
        openNavigationTarget,
        readNavigationFileContent,
        request,
        resolvePhpClassSourcePaths,
        resolveTarget: (source) =>
          phpLaravelModelAttributeTargetFromSource(source, attributeName) ??
          phpLaravelModelAccessorTargetFromSource(source, attributeName),
        workspaceDescriptor,
        workspaceRoot,
      }),
    [
      canOpenLaravelModelSourceTargets,
      currentWorkspaceRootRef,
      openNavigationTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  return {
    openPhpLaravelDynamicWhereTarget,
    openPhpLaravelModelAttributeTarget,
  };
}

interface LaravelModelSourceTarget {
  attributeName: string;
  position: EditorPosition;
}

interface OpenLaravelModelSourceTargetInput {
  className: string;
  canOpenLaravelModelSourceTargets: boolean;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
  ): Promise<boolean>;
  readNavigationFileContent(path: string): Promise<string>;
  request?: NavigationRequest;
  resolvePhpClassSourcePaths(className: string): Promise<readonly string[]>;
  resolveTarget(source: string): LaravelModelSourceTarget | null;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

async function openLaravelModelSourceTarget({
  className,
  canOpenLaravelModelSourceTargets,
  currentWorkspaceRootRef,
  openNavigationTarget,
  readNavigationFileContent,
  request,
  resolvePhpClassSourcePaths,
  resolveTarget,
  workspaceDescriptor,
  workspaceRoot,
}: OpenLaravelModelSourceTargetInput): Promise<boolean> {
  const requestedRoot = workspaceRoot;
  const requestedDescriptor = workspaceDescriptor;
  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
  const isNavigationActive = () =>
    isRequestedRootActive() && canNavigate(request);

  if (
    !canOpenLaravelModelSourceTargets ||
    !requestedRoot ||
    !requestedDescriptor?.php
  ) {
    return false;
  }

  const normalizedClassName = className.trim().replace(/^\\+/, "");

  if (!normalizedClassName) {
    return false;
  }

  for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
    if (!isNavigationActive()) {
      return false;
    }

    try {
      const content = await readNavigationFileContent(path);

      if (!isNavigationActive()) {
        return false;
      }

      const target = resolveTarget(content);

      if (!target) {
        continue;
      }

      if (!isNavigationActive()) {
        return false;
      }

      const opened = await openNavigationTarget(
        path,
        target.position,
        target.attributeName,
        { shouldCommit: isNavigationActive },
      );

      return isNavigationActive() && opened;
    } catch {
      if (!isNavigationActive()) {
        return false;
      }

      continue;
    }
  }

  return false;
}
