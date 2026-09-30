import type { ModelFirstSeenRepository } from "../application/modelFirstSeenRepository";
import {
  EMPTY_MODEL_FIRST_SEEN_LEDGER,
  parseModelFirstSeenLedger,
  type ModelFirstSeenLedger,
} from "../domain/modelNewness";
import type { KeyValueStorage } from "./browserSettingsGateway";

export const MODEL_FIRST_SEEN_STORAGE_KEY = "editor.agentModels.firstSeen.v1";
const MAX_STORED_BYTES = 64 * 1024;

export class BrowserModelFirstSeenRepository implements ModelFirstSeenRepository {
  constructor(private readonly storage: KeyValueStorage = localStorage) {}

  read(): ModelFirstSeenLedger {
    try {
      const raw = this.storage.getItem(MODEL_FIRST_SEEN_STORAGE_KEY);
      if (raw === null || raw.length > MAX_STORED_BYTES) return EMPTY_MODEL_FIRST_SEEN_LEDGER;
      return parseModelFirstSeenLedger(JSON.parse(raw));
    } catch {
      return EMPTY_MODEL_FIRST_SEEN_LEDGER;
    }
  }

  write(ledger: ModelFirstSeenLedger): void {
    try {
      this.storage.setItem(MODEL_FIRST_SEEN_STORAGE_KEY, JSON.stringify(ledger));
    } catch {
      return;
    }
  }
}
