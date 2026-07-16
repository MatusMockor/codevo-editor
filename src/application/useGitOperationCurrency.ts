import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

type GitReservationKind = "mutation" | "publication";

export interface GitRepositoryOperationReservation {
  kind: GitReservationKind;
  ownerGeneration: number;
  repositoryGenerations: Record<string, number>;
  publicationGenerations: Record<string, number>;
  publishableRepositories: Record<string, boolean>;
  tracksPendingOperation: boolean;
  released: boolean;
}

export interface GitReadReservation {
  key: string;
  ownerGeneration: number;
  generation: number;
}

export type GitMutationExecution<T> =
  | { executed: false }
  | { executed: true; value: T };

export interface GitOperationCurrency {
  operationLoading: boolean;
  reserveOperation: (
    repositoryRoots: string[],
  ) => GitRepositoryOperationReservation;
  reservePublication: (
    repositoryRoots: string[],
  ) => GitRepositoryOperationReservation;
  isOperationCurrent: (
    reservation: GitRepositoryOperationReservation,
    repositoryRoot: string,
  ) => boolean;
  isRepositoryCurrent: (
    reservation: GitRepositoryOperationReservation,
    repositoryRoot: string,
  ) => boolean;
  runRepositoryMutation: <T>(
    reservation: GitRepositoryOperationReservation,
    repositoryRoot: string,
    operation: () => Promise<T>,
  ) => Promise<GitMutationExecution<T>>;
  releaseOperation: (reservation: GitRepositoryOperationReservation) => void;
  reserveRead: (
    repositoryRoot: string,
    path: string,
    staged: boolean,
  ) => GitReadReservation;
  isReadCurrent: (reservation: GitReadReservation) => boolean;
}

/**
 * Coordinates Git work for one workspace owner. Mutation ownership is reserved
 * at request time, while publication order advances only after a physical side
 * effect settles. Per-repository queues serialize conflicting gateway calls
 * without blocking independent nested repositories.
 */
export function useGitOperationCurrency(
  workspaceRoot: string | null,
): GitOperationCurrency {
  const ownerRef = useRef({
    generation: 0,
    key: normalizedWorkspaceRootKey(workspaceRoot),
  });
  const mutationGenerationsRef = useRef<Record<string, number>>({});
  const publicationGenerationsRef = useRef<Record<string, number>>({});
  const pendingMutationsByRepositoryRef = useRef<Record<string, number>>({});
  const activeMutationsByOwnerRef = useRef<
    Record<number, Record<string, number>>
  >({});
  const mutationTailsRef = useRef<Record<string, Promise<void>>>({});
  const readGenerationsRef = useRef<Record<string, number>>({});
  const pendingOperationCountRef = useRef(0);
  const [, renderLoadingChange] = useReducer((generation: number) => generation + 1, 0);
  const ownerKey = normalizedWorkspaceRootKey(workspaceRoot);

  if (ownerRef.current.key !== ownerKey) {
    ownerRef.current = {
      generation: ownerRef.current.generation + 1,
      key: ownerKey,
    };
    mutationGenerationsRef.current = {};
    publicationGenerationsRef.current = {};
    pendingMutationsByRepositoryRef.current = {};
    readGenerationsRef.current = {};
    pendingOperationCountRef.current = 0;
  }

  const operationLoading = pendingOperationCountRef.current > 0;

  const reserveOperation = useCallback(
    (repositoryRoots: string[]): GitRepositoryOperationReservation => {
      const repositoryGenerations: Record<string, number> = {};
      const publicationGenerations: Record<string, number> = {};
      const publishableRepositories: Record<string, boolean> = {};
      const uniqueKeys = new Set(
        repositoryRoots.map((root) => normalizedWorkspaceRootKey(root)),
      );

      for (const key of uniqueKeys) {
        const generation = (mutationGenerationsRef.current[key] ?? 0) + 1;
        const publicationGeneration =
          (publicationGenerationsRef.current[key] ?? 0) + 1;
        mutationGenerationsRef.current[key] = generation;
        publicationGenerationsRef.current[key] = publicationGeneration;
        repositoryGenerations[key] = generation;
        publicationGenerations[key] = publicationGeneration;
        publishableRepositories[key] = true;
        pendingMutationsByRepositoryRef.current[key] =
          (pendingMutationsByRepositoryRef.current[key] ?? 0) + 1;
      }

      pendingOperationCountRef.current += 1;
      renderLoadingChange();

      return {
        kind: "mutation",
        ownerGeneration: ownerRef.current.generation,
        repositoryGenerations,
        publicationGenerations,
        publishableRepositories,
        tracksPendingOperation: true,
        released: false,
      };
    },
    [],
  );

  const reservePublication = useCallback(
    (repositoryRoots: string[]): GitRepositoryOperationReservation => {
      const publicationGenerations: Record<string, number> = {};
      const publishableRepositories: Record<string, boolean> = {};

      const uniqueKeys = new Set(
        repositoryRoots.map((root) => normalizedWorkspaceRootKey(root)),
      );

      for (const key of uniqueKeys) {
        const activeMutations =
          activeMutationsByOwnerRef.current[ownerRef.current.generation];
        if ((activeMutations?.[key] ?? 0) > 0) {
          publicationGenerations[key] =
            publicationGenerationsRef.current[key] ?? 0;
          publishableRepositories[key] = false;
          continue;
        }

        const generation = (publicationGenerationsRef.current[key] ?? 0) + 1;
        publicationGenerationsRef.current[key] = generation;
        publicationGenerations[key] = generation;
        publishableRepositories[key] = true;
      }

      return {
        kind: "publication",
        ownerGeneration: ownerRef.current.generation,
        repositoryGenerations: {},
        publicationGenerations,
        publishableRepositories,
        tracksPendingOperation: false,
        released: false,
      };
    },
    [],
  );

  const isOperationCurrent = useCallback(
    (
      reservation: GitRepositoryOperationReservation,
      repositoryRoot: string,
    ): boolean => {
      if (reservation.kind !== "mutation") {
        return false;
      }

      const key = normalizedWorkspaceRootKey(repositoryRoot);

      return (
        ownerRef.current.generation === reservation.ownerGeneration &&
        mutationGenerationsRef.current[key] ===
          reservation.repositoryGenerations[key] &&
        publicationGenerationsRef.current[key] ===
          reservation.publicationGenerations[key]
      );
    },
    [],
  );

  const isRepositoryCurrent = useCallback(
    (
      reservation: GitRepositoryOperationReservation,
      repositoryRoot: string,
    ): boolean => {
      const key = normalizedWorkspaceRootKey(repositoryRoot);

      if (
        ownerRef.current.generation !== reservation.ownerGeneration ||
        !reservation.publishableRepositories[key]
      ) {
        return false;
      }

      if (
        publicationGenerationsRef.current[key] !==
        reservation.publicationGenerations[key]
      ) {
        return false;
      }

      if (reservation.kind === "publication") {
        return true;
      }

      return mutationGenerationsRef.current[key] ===
        reservation.repositoryGenerations[key];
    },
    [],
  );

  const runRepositoryMutation = useCallback(
    async <T,>(
      reservation: GitRepositoryOperationReservation,
      repositoryRoot: string,
      operation: () => Promise<T>,
    ): Promise<GitMutationExecution<T>> => {
      const key = normalizedWorkspaceRootKey(repositoryRoot);
      const previous = mutationTailsRef.current[key];
      let unlock!: () => void;
      const ownLock = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const tail = previous ? previous.then(() => ownLock) : ownLock;
      mutationTailsRef.current[key] = tail;

      if (previous) {
        await previous;
      }

      try {
        if (
          ownerRef.current.generation !== reservation.ownerGeneration ||
          mutationGenerationsRef.current[key] !==
            reservation.repositoryGenerations[key] ||
          publicationGenerationsRef.current[key] !==
            reservation.publicationGenerations[key]
        ) {
          return { executed: false };
        }

        const ownerActiveMutations =
          activeMutationsByOwnerRef.current[reservation.ownerGeneration] ?? {};
        activeMutationsByOwnerRef.current[reservation.ownerGeneration] =
          ownerActiveMutations;
        ownerActiveMutations[key] = (ownerActiveMutations[key] ?? 0) + 1;

        try {
          const value = await operation();
          return { executed: true, value };
        } finally {
          const ownerActiveMutations =
            activeMutationsByOwnerRef.current[reservation.ownerGeneration];
          const activeCount = Math.max(
            0,
            (ownerActiveMutations?.[key] ?? 0) - 1,
          );
          if (activeCount === 0) {
            delete ownerActiveMutations?.[key];
          }
          if (activeCount > 0) {
            ownerActiveMutations[key] = activeCount;
          }
          if (
            ownerActiveMutations &&
            Object.keys(ownerActiveMutations).length === 0
          ) {
            delete activeMutationsByOwnerRef.current[
              reservation.ownerGeneration
            ];
          }

          if (
            ownerRef.current.generation === reservation.ownerGeneration &&
            mutationGenerationsRef.current[key] ===
              reservation.repositoryGenerations[key] &&
            publicationGenerationsRef.current[key] ===
              reservation.publicationGenerations[key]
          ) {
            const publicationGeneration =
              (publicationGenerationsRef.current[key] ?? 0) + 1;
            publicationGenerationsRef.current[key] = publicationGeneration;
            reservation.publicationGenerations[key] = publicationGeneration;
            reservation.publishableRepositories[key] = true;
          }
        }
      } finally {
        unlock();

        if (mutationTailsRef.current[key] === tail) {
          delete mutationTailsRef.current[key];
        }
      }
    },
    [],
  );

  const releaseOperation = useCallback(
    (reservation: GitRepositoryOperationReservation) => {
      if (!reservation.tracksPendingOperation || reservation.released) {
        return;
      }

      reservation.released = true;

      if (ownerRef.current.generation !== reservation.ownerGeneration) {
        return;
      }

      for (const key of Object.keys(reservation.repositoryGenerations)) {
        const next = Math.max(
          0,
          (pendingMutationsByRepositoryRef.current[key] ?? 0) - 1,
        );

        if (next === 0) {
          delete pendingMutationsByRepositoryRef.current[key];
          continue;
        }

        pendingMutationsByRepositoryRef.current[key] = next;
      }

      pendingOperationCountRef.current = Math.max(
        0,
        pendingOperationCountRef.current - 1,
      );

      renderLoadingChange();
    },
    [],
  );

  const reserveRead = useCallback(
    (repositoryRoot: string, path: string, staged: boolean) => {
      const key = `${normalizedWorkspaceRootKey(repositoryRoot)}\0${path}\0${staged ? "staged" : "worktree"}`;
      const generation = (readGenerationsRef.current[key] ?? 0) + 1;
      readGenerationsRef.current[key] = generation;

      return {
        key,
        ownerGeneration: ownerRef.current.generation,
        generation,
      };
    },
    [],
  );

  const isReadCurrent = useCallback(
    (reservation: GitReadReservation): boolean =>
      ownerRef.current.generation === reservation.ownerGeneration &&
      readGenerationsRef.current[reservation.key] === reservation.generation,
    [],
  );

  useEffect(() => {
    return () => {
      ownerRef.current.generation += 1;
      mutationGenerationsRef.current = {};
      publicationGenerationsRef.current = {};
      pendingMutationsByRepositoryRef.current = {};
      readGenerationsRef.current = {};
      pendingOperationCountRef.current = 0;
    };
  }, []);

  return useMemo(
    () => ({
      operationLoading,
      reserveOperation,
      reservePublication,
      isOperationCurrent,
      isRepositoryCurrent,
      runRepositoryMutation,
      releaseOperation,
      reserveRead,
      isReadCurrent,
    }),
    [
      operationLoading,
      reserveOperation,
      reservePublication,
      isOperationCurrent,
      isRepositoryCurrent,
      runRepositoryMutation,
      releaseOperation,
      reserveRead,
      isReadCurrent,
    ],
  );
}
