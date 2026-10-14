export const MAX_AGENT_THREAD_REQUEST_DELIVERIES = 256;

export type AgentThreadRequestDeliveryRecord =
  | {
      readonly kind: "sending" | "awaiting" | "closed";
      readonly version: number;
      readonly attempt: object;
    }
  | {
      readonly kind: "checking";
      readonly version: number;
      readonly attempt: object;
      readonly abandoned: boolean;
    }
  | {
      readonly kind: "refused";
      readonly version: number;
      readonly attempt: object;
      readonly error: string | null;
    };

export type AgentThreadRequestDeliveries = ReadonlyMap<string, AgentThreadRequestDeliveryRecord>;

interface OwnerView {
  readonly revision: number;
  readonly deliveries: AgentThreadRequestDeliveries;
}

const NO_DELIVERIES: AgentThreadRequestDeliveries = new Map();

export class AgentThreadRequestDeliveryLedger {
  private readonly entries = new Map<string, AgentThreadRequestDeliveryRecord>();
  private readonly listeners = new Set<() => void>();
  private readonly views = new Map<string, OwnerView>();
  private revision = 0;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  deliveriesOf(owner: string | null): AgentThreadRequestDeliveries {
    if (owner === null) return NO_DELIVERIES;
    const cached = this.views.get(owner);
    if (cached !== undefined && cached.revision === this.revision) return cached.deliveries;
    const deliveries = new Map<string, AgentThreadRequestDeliveryRecord>();
    for (const [entry, record] of this.entries) {
      const [entryOwner, key] = JSON.parse(entry) as [string, string];
      if (entryOwner === owner) deliveries.set(key, record);
    }
    const shown = deliveries.size === 0 ? NO_DELIVERIES : deliveries;
    this.views.set(owner, { revision: this.revision, deliveries: shown });
    return shown;
  }

  record(owner: string, key: string): AgentThreadRequestDeliveryRecord | undefined {
    return this.entries.get(entryKey(owner, key));
  }

  write(
    owner: string,
    key: string,
    next: AgentThreadRequestDeliveryRecord | null,
    attempt: object | null = null,
  ): boolean {
    const entry = entryKey(owner, key);
    const current = this.entries.get(entry);
    if (attempt !== null && current?.attempt !== attempt) return false;
    if (current === next || (current === undefined && next === null)) return true;
    this.entries.delete(entry);
    if (next !== null) this.entries.set(entry, next);
    this.evict();
    this.revision += 1;
    this.views.clear();
    for (const listener of [...this.listeners]) listener();
    return true;
  }

  private evict(): void {
    const excess = this.entries.size - MAX_AGENT_THREAD_REQUEST_DELIVERIES;
    if (excess <= 0) return;
    const settled = [...this.entries].filter(([, record]) => !inFlight(record));
    const candidates = settled.length >= excess ? settled : [...this.entries];
    for (const [entry] of candidates.slice(0, excess)) this.entries.delete(entry);
  }
}

export function agentThreadRequestDeliveryInFlight(
  record: AgentThreadRequestDeliveryRecord | undefined,
): boolean {
  return record !== undefined && inFlight(record);
}

function inFlight(record: AgentThreadRequestDeliveryRecord): boolean {
  return record.kind === "sending" || record.kind === "awaiting" || record.kind === "checking";
}

function entryKey(owner: string, key: string): string {
  return JSON.stringify([owner, key]);
}
