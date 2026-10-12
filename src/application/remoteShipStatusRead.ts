import { isTransientRunnerBusyError } from "../domain/remoteRunnerErrors";
import { attempt, type Attempt } from "./agentProjectAuthority";

export const REMOTE_SHIP_STATUS_BUSY_RETRY_DELAYS_MS: readonly number[] = Object.freeze([
  1_000, 3_000, 9_000,
]);

export type RemoteShipStatusRead<TValue> =
  { readonly kind: "settled"; readonly result: Attempt<TValue> } | { readonly kind: "superseded" };

export interface RemoteShipStatusReadOptions<TValue> {
  readonly read: () => Promise<TValue>;
  readonly isCurrent: () => boolean;
  readonly pause: (delayMs: number) => Promise<void>;
}

export interface RemoteShipStatusPauses {
  pause(threadId: string, delayMs: number): Promise<void>;
  cancel(threadId: string): void;
  cancelAll(): void;
}

const SUPERSEDED = Object.freeze({ kind: "superseded" } as const);

export async function readRemoteShipStatus<TValue>(
  options: RemoteShipStatusReadOptions<TValue>,
): Promise<RemoteShipStatusRead<TValue>> {
  for (let refusals = 0; ; refusals += 1) {
    const result = await attempt(options.read);
    if (!options.isCurrent()) return SUPERSEDED;
    const delay = REMOTE_SHIP_STATUS_BUSY_RETRY_DELAYS_MS[refusals];
    if (result.ok || delay === undefined || !isTransientRunnerBusyError(result.error))
      return { kind: "settled", result };
    await options.pause(delay);
    if (!options.isCurrent()) return SUPERSEDED;
  }
}

export function createRemoteShipStatusPauses(): RemoteShipStatusPauses {
  const pending = new Map<string, () => void>();
  const cancel = (threadId: string): void => pending.get(threadId)?.();
  return {
    pause: (threadId, delayMs) =>
      new Promise<void>((resolve) => {
        cancel(threadId);
        const finish = (): void => {
          clearTimeout(timer);
          if (pending.get(threadId) === finish) pending.delete(threadId);
          resolve();
        };
        const timer = setTimeout(finish, delayMs);
        pending.set(threadId, finish);
      }),
    cancel,
    cancelAll: () => {
      for (const finish of [...pending.values()]) finish();
    },
  };
}
