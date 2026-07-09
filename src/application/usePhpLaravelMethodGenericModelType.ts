import { useCallback, type MutableRefObject } from "react";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { phpMethodReturnExpressions } from "../domain/phpTypeAnalysis";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export type PhpLaravelCarrierKind = "builder" | "collection";

export interface PhpClassMemberReadResult {
  content: string;
  members: PhpMethodCompletion[];
}

export interface PhpLaravelGenericModelTypeHelpers {
  builderCollectionModelTypeFromExpression: (
    source: string,
    expression: string,
  ) => string | null;
  builderModelTypeCandidate: (
    source: string,
    typeName: string | null,
  ) => string | null;
  builderModelTypeFromExpression: (
    source: string,
    expression: string,
  ) => string | null;
  collectionModelTypeCandidate: (
    source: string,
    typeName: string | null,
  ) => string | null;
  repositoryConventionModelTypeFromCarrierReturnType: (
    source: string,
    repositoryClassName: string,
    returnType: string,
    carrierKind: PhpLaravelCarrierKind,
  ) => string | null;
}

export interface UsePhpLaravelMethodGenericModelTypeOptions {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime?: PhpFrameworkRuntimeContext;
  helpers: PhpLaravelGenericModelTypeHelpers;
  isLaravelFrameworkActive?: boolean;
  readPhpClassMembersFromPath: (
    path: string,
    className: string,
  ) => Promise<PhpClassMemberReadResult>;
  resolvePhpClassReference: (source: string, className: string) => string | null;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export function usePhpLaravelMethodGenericModelType({
  currentWorkspaceRootRef,
  frameworkRuntime,
  helpers,
  isLaravelFrameworkActive: legacyIsLaravelFrameworkActive = false,
  readPhpClassMembersFromPath,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpLaravelMethodGenericModelTypeOptions) {
  const isLaravelFrameworkActive =
    frameworkRuntime?.isLaravel ?? legacyIsLaravelFrameworkActive;

  const resolvePhpLaravelMethodGenericModelType = useCallback(
    async (
      carrierKind: PhpLaravelCarrierKind,
      className: string,
      methodName: string,
    ): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !isLaravelFrameworkActive ||
        !requestedRoot ||
        !workspaceDescriptor?.php ||
        !isRequestedRootActive()
      ) {
        return null;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return null;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return null;
        }

        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return null;
          }

          const method = members.find(
            (candidate) =>
              candidate.kind !== "property" &&
              candidate.name.toLowerCase() === methodName.toLowerCase(),
          );
          const modelTypeCandidate =
            carrierKind === "builder"
              ? helpers.builderModelTypeCandidate(
                  content,
                  method?.returnType ?? null,
                )
              : helpers.collectionModelTypeCandidate(
                  content,
                  method?.returnType ?? null,
                );
          const modelType = modelTypeCandidate
            ? resolvePhpClassReference(content, modelTypeCandidate)
            : null;

          if (modelType) {
            return modelType;
          }

          if (method) {
            const expressionModelType = phpMethodReturnExpressions(
              content,
              method.name,
            )
              .map((expression) =>
                carrierKind === "builder"
                  ? helpers.builderModelTypeFromExpression(content, expression)
                  : helpers.builderCollectionModelTypeFromExpression(
                      content,
                      expression,
                    ),
              )
              .find((candidate): candidate is string => Boolean(candidate));

            if (expressionModelType) {
              return expressionModelType;
            }
          }

          const conventionModelType =
            method?.returnType
              ? helpers.repositoryConventionModelTypeFromCarrierReturnType(
                  content,
                  normalizedClassName,
                  method.returnType,
                  carrierKind,
                )
              : null;

          if (conventionModelType) {
            return conventionModelType;
          }
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }

          continue;
        }
      }

      if (!isRequestedRootActive()) {
        return null;
      }

      return null;
    },
    [
      currentWorkspaceRootRef,
      helpers,
      isLaravelFrameworkActive,
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  return { resolvePhpLaravelMethodGenericModelType };
}
