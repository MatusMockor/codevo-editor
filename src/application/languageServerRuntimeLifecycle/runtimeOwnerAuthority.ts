import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import {
  createLegacyWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../../domain/workspaceRuntimeOwner";
import { runtimeStatusRootPath } from "./runtimeStatusPolicy";

export interface LanguageServerRuntimeStatusFence {
  authority: "command" | "snapshot";
  commandSequence: number;
  subscriptionSequence: number;
}

export function useRuntimeOwnerAuthority(
  workspaceRoot: string | null,
  workspaceRuntimeOwner?: WorkspaceRuntimeOwner | null,
) {
  const currentRuntimeOwner = useMemo(() => {
    if (workspaceRuntimeOwner) {
      return workspaceRuntimeOwner;
    }

    if (!workspaceRoot) {
      return null;
    }

    return createLegacyWorkspaceRuntimeOwner(workspaceRoot);
  }, [workspaceRoot, workspaceRuntimeOwner]);
  const currentRuntimeOwnerRef = useRef(currentRuntimeOwner);
  currentRuntimeOwnerRef.current = currentRuntimeOwner;
  const ownerRevisionByKeyRef = useRef<Record<string, number>>({});
  const languageServerRuntimeStatusSequenceByOwnerRef = useRef<Record<string, number>>({});
  const languageServerRuntimeCommandSequenceByOwnerRef = useRef<Record<string, number>>({});
  const previousRuntimeOwnerRef = useRef(currentRuntimeOwner);
  const retainedRuntimeAliasesByOwnerRef = useRef<
    Record<string, { revision: number; rootPaths: string[] }>
  >({});
  const admittedRuntimeOwnersByRootRef = useRef<
    Array<{
      owner: WorkspaceRuntimeOwner;
      revision: number;
      rootPath: string;
    }>
  >([]);
  const [ownerRevisionVersion, setOwnerRevisionVersion] = useState(0);

  useEffect(() => {
    const previousOwner = previousRuntimeOwnerRef.current;
    previousRuntimeOwnerRef.current = currentRuntimeOwner;

    if (!workspaceRuntimeOwner || !currentRuntimeOwner) {
      return;
    }

    const currentOwnerRevision = ownerRevisionByKeyRef.current[currentRuntimeOwner.ownerKey] ?? 0;

    for (const admittedOwner of admittedRuntimeOwnersByRootRef.current) {
      if (admittedOwner.owner.ownerKey !== currentRuntimeOwner.ownerKey) {
        continue;
      }

      admittedOwner.owner = currentRuntimeOwner;
      admittedOwner.revision = currentOwnerRevision;
    }

    const admittedExecutionRoot = admittedRuntimeOwnersByRootRef.current.find(({ rootPath }) =>
      workspaceRootKeysEqual(rootPath, currentRuntimeOwner.executionRoot),
    );

    if (admittedExecutionRoot) {
      admittedExecutionRoot.owner = currentRuntimeOwner;
      admittedExecutionRoot.revision = currentOwnerRevision;
    }

    if (!admittedExecutionRoot) {
      admittedRuntimeOwnersByRootRef.current.push({
        owner: currentRuntimeOwner,
        revision: currentOwnerRevision,
        rootPath: currentRuntimeOwner.executionRoot,
      });
    }

    if (!previousOwner) {
      return;
    }

    if (previousOwner.ownerKey !== currentRuntimeOwner.ownerKey) {
      return;
    }

    if (workspaceRootKeysEqual(previousOwner.executionRoot, currentRuntimeOwner.executionRoot)) {
      return;
    }

    const revision = ownerRevisionByKeyRef.current[currentRuntimeOwner.ownerKey] ?? 0;
    const retainedAliases = retainedRuntimeAliasesByOwnerRef.current[currentRuntimeOwner.ownerKey];
    const rootPaths = retainedAliases?.revision === revision ? retainedAliases.rootPaths : [];

    if (
      rootPaths.some((rootPath) => workspaceRootKeysEqual(rootPath, previousOwner.executionRoot))
    ) {
      return;
    }

    retainedRuntimeAliasesByOwnerRef.current[currentRuntimeOwner.ownerKey] = {
      revision,
      rootPaths: [...rootPaths, previousOwner.executionRoot],
    };
  }, [currentRuntimeOwner, ownerRevisionVersion, workspaceRuntimeOwner]);

  const admittedRuntimeOwnerForRoot = useCallback(
    (rootPath: string): WorkspaceRuntimeOwner | undefined => {
      if (!workspaceRuntimeOwner) {
        return undefined;
      }

      return admittedRuntimeOwnersByRootRef.current.find((admittedOwner) =>
        workspaceRootKeysEqual(admittedOwner.rootPath, rootPath),
      )?.owner;
    },
    [workspaceRuntimeOwner],
  );

  const runtimeOwnerForRoot = useCallback(
    (rootPath: string, owner?: WorkspaceRuntimeOwner) => {
      if (owner) {
        return owner;
      }

      if (
        currentRuntimeOwnerRef.current &&
        workspaceRootKeysEqual(currentRuntimeOwnerRef.current.executionRoot, rootPath)
      ) {
        return currentRuntimeOwnerRef.current;
      }

      return createLegacyWorkspaceRuntimeOwner(rootPath);
    },
    [currentRuntimeOwnerRef],
  );

  const isCurrentRuntimeOwner = useCallback(
    (owner: WorkspaceRuntimeOwner) => currentRuntimeOwnerRef.current?.ownerKey === owner.ownerKey,
    [currentRuntimeOwnerRef],
  );

  const latestRuntimeOwner = useCallback(
    (owner: WorkspaceRuntimeOwner) => {
      if (currentRuntimeOwnerRef.current?.ownerKey === owner.ownerKey) {
        return currentRuntimeOwnerRef.current;
      }

      return owner;
    },
    [currentRuntimeOwnerRef],
  );

  const ownerRevision = useCallback(
    (owner: WorkspaceRuntimeOwner) => ownerRevisionByKeyRef.current[owner.ownerKey] ?? 0,
    [ownerRevisionByKeyRef],
  );

  const isOwnerRevisionCurrent = useCallback(
    (owner: WorkspaceRuntimeOwner, revision: number) => ownerRevision(owner) === revision,
    [ownerRevision],
  );

  const languageServerRuntimeStatusSequence = useCallback(
    (owner: WorkspaceRuntimeOwner) =>
      languageServerRuntimeStatusSequenceByOwnerRef.current[owner.ownerKey] ?? 0,
    [languageServerRuntimeStatusSequenceByOwnerRef],
  );

  const advanceLanguageServerRuntimeStatusSequence = useCallback(
    (owner: WorkspaceRuntimeOwner) => {
      languageServerRuntimeStatusSequenceByOwnerRef.current[owner.ownerKey] =
        languageServerRuntimeStatusSequence(owner) + 1;
    },
    [languageServerRuntimeStatusSequence, languageServerRuntimeStatusSequenceByOwnerRef],
  );

  const languageServerRuntimeCommandSequence = useCallback(
    (owner: WorkspaceRuntimeOwner) =>
      languageServerRuntimeCommandSequenceByOwnerRef.current[owner.ownerKey] ?? 0,
    [languageServerRuntimeCommandSequenceByOwnerRef],
  );

  const advanceLanguageServerRuntimeCommandSequence = useCallback(
    (owner: WorkspaceRuntimeOwner) => {
      const sequence = languageServerRuntimeCommandSequence(owner) + 1;
      languageServerRuntimeCommandSequenceByOwnerRef.current[owner.ownerKey] = sequence;
      return sequence;
    },
    [languageServerRuntimeCommandSequence, languageServerRuntimeCommandSequenceByOwnerRef],
  );

  const isLanguageServerRuntimeStatusSequenceCurrent = useCallback(
    (owner: WorkspaceRuntimeOwner, sequence: number) =>
      languageServerRuntimeStatusSequence(owner) === sequence,
    [languageServerRuntimeStatusSequence],
  );

  const isLanguageServerRuntimeStatusFenceCurrent = useCallback(
    (owner: WorkspaceRuntimeOwner, fence: LanguageServerRuntimeStatusFence) =>
      isLanguageServerRuntimeStatusSequenceCurrent(owner, fence.subscriptionSequence) &&
      languageServerRuntimeCommandSequence(owner) === fence.commandSequence,
    [isLanguageServerRuntimeStatusSequenceCurrent, languageServerRuntimeCommandSequence],
  );

  const acceptLanguageServerRuntimeCommandFence = useCallback(
    (owner: WorkspaceRuntimeOwner, fence: LanguageServerRuntimeStatusFence) => {
      if (!isLanguageServerRuntimeStatusFenceCurrent(owner, fence)) {
        return false;
      }

      advanceLanguageServerRuntimeCommandSequence(owner);
      return true;
    },
    [advanceLanguageServerRuntimeCommandSequence, isLanguageServerRuntimeStatusFenceCurrent],
  );

  const isAdmittedRuntimeOwnerForRoot = useCallback(
    (rootPath: string, owner: WorkspaceRuntimeOwner, revision: number): boolean => {
      const currentOwner = currentRuntimeOwnerRef.current;

      if (
        currentOwner &&
        workspaceRootKeysEqual(currentOwner.executionRoot, rootPath) &&
        currentOwner.ownerKey !== owner.ownerKey
      ) {
        return false;
      }

      const admittedOwner = admittedRuntimeOwnersByRootRef.current.find((candidate) =>
        workspaceRootKeysEqual(candidate.rootPath, rootPath),
      );

      if (!admittedOwner) {
        return false;
      }

      return (
        admittedOwner.owner.ownerKey === owner.ownerKey &&
        admittedOwner.revision === revision &&
        isOwnerRevisionCurrent(owner, revision)
      );
    },
    [isOwnerRevisionCurrent],
  );

  const retainedRuntimeStatusForOwner = useCallback(
    (
      status: LanguageServerRuntimeStatus,
      owner: WorkspaceRuntimeOwner,
      revision: number,
    ): LanguageServerRuntimeStatus | null => {
      if (!isOwnerRevisionCurrent(owner, revision)) {
        return null;
      }

      const currentOwner = currentRuntimeOwnerRef.current;

      if (!currentOwner || currentOwner.ownerKey !== owner.ownerKey) {
        return null;
      }

      const statusRootPath = runtimeStatusRootPath(status, owner.executionRoot);

      if (!statusRootPath) {
        return null;
      }

      const isExecutionRoot = workspaceRootKeysEqual(statusRootPath, owner.executionRoot);
      const retainedAliases = retainedRuntimeAliasesByOwnerRef.current[owner.ownerKey];
      const isRetainedAlias =
        retainedAliases?.revision === revision &&
        retainedAliases.rootPaths.some((rootPath) =>
          workspaceRootKeysEqual(rootPath, statusRootPath),
        );

      if (!isExecutionRoot && !isRetainedAlias) {
        return null;
      }

      return {
        ...status,
        rootPath: currentOwner.executionRoot,
      };
    },
    [isOwnerRevisionCurrent],
  );

  return {
    acceptLanguageServerRuntimeCommandFence,
    admittedRuntimeOwnerForRoot,
    admittedRuntimeOwnersByRootRef,
    advanceLanguageServerRuntimeCommandSequence,
    advanceLanguageServerRuntimeStatusSequence,
    currentRuntimeOwner,
    currentRuntimeOwnerRef,
    isAdmittedRuntimeOwnerForRoot,
    isCurrentRuntimeOwner,
    isLanguageServerRuntimeStatusFenceCurrent,
    isLanguageServerRuntimeStatusSequenceCurrent,
    isOwnerRevisionCurrent,
    languageServerRuntimeCommandSequence,
    languageServerRuntimeStatusSequence,
    latestRuntimeOwner,
    ownerRevision,
    ownerRevisionByKeyRef,
    ownerRevisionVersion,
    retainedRuntimeStatusForOwner,
    runtimeOwnerForRoot,
    setOwnerRevisionVersion,
  };
}
