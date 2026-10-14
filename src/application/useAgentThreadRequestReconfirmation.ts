import { useEffect } from "react";
import type { AgentRuntimeRequest } from "../domain/agentRuntimeRequest";
import type {
  AgentThreadRequestDeliveries,
  AgentThreadRequestDeliveryLedger,
  AgentThreadRequestDeliveryRecord,
} from "./agentThreadRequestDeliveryLedger";
import {
  deliveryAfterReconfirmation,
  type AgentThreadRequestCardRelease,
} from "./agentThreadRequestDeliveryTransitions";
import type { AgentThreadRequestResponder } from "./agentThreadRequestResponders";
import type { RemoteAgentThreadRequestConfirmation } from "./remoteAgentThreadRequestFeed";

export const AGENT_THREAD_REQUEST_RECONFIRM_MS = 5_000;

export interface AgentThreadRequestReconfirmationInput {
  readonly ledger: AgentThreadRequestDeliveryLedger;
  readonly ownerKey: string | null;
  readonly deliveries: AgentThreadRequestDeliveries;
  readonly open: readonly AgentRuntimeRequest[];
  readonly responder: AgentThreadRequestResponder | null;
  readonly reachable: boolean;
  readonly keyOf: (request: AgentRuntimeRequest) => string;
  readonly settle: (key: string, attempt: object, release: AgentThreadRequestCardRelease) => void;
}

interface Due {
  readonly key: string;
  readonly record: AgentThreadRequestDeliveryRecord;
  readonly request: AgentRuntimeRequest;
}

const UNCONFIRMED: RemoteAgentThreadRequestConfirmation = "unconfirmed";

export function useAgentThreadRequestReconfirmation({
  ledger,
  ownerKey,
  deliveries,
  open,
  responder,
  reachable,
  keyOf,
  settle,
}: AgentThreadRequestReconfirmationInput): void {
  useEffect(() => {
    if (ownerKey === null || responder === null || !reachable) return undefined;
    const due = abandoned(deliveries, open, keyOf);
    if (due.length === 0) return undefined;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const confirm = async ({ key, record, request }: Due): Promise<void> => {
      const result = await responder.reconfirm(request).catch(() => UNCONFIRMED);
      if (!live) return;
      const decided = deliveryAfterReconfirmation(result, record);
      if (decided === null || !ledger.write(ownerKey, key, decided.next, record.attempt)) return;
      settle(key, record.attempt, decided.release);
    };
    const round = (): void => {
      void Promise.all(due.map(confirm)).then(() => {
        if (live) timer = setTimeout(round, AGENT_THREAD_REQUEST_RECONFIRM_MS);
      });
    };
    timer = setTimeout(round, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [deliveries, keyOf, ledger, open, ownerKey, reachable, responder, settle]);
}

function abandoned(
  deliveries: AgentThreadRequestDeliveries,
  open: readonly AgentRuntimeRequest[],
  keyOf: (request: AgentRuntimeRequest) => string,
): readonly Due[] {
  const due: Due[] = [];
  for (const request of open) {
    const key = keyOf(request);
    const record = deliveries.get(key);
    if (record?.kind === "checking" && record.abandoned) due.push({ key, record, request });
  }
  return due;
}
