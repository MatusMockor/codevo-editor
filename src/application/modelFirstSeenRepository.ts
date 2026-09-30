import type { ModelFirstSeenLedger } from "../domain/modelNewness";

export interface ModelFirstSeenRepository {
  read(): ModelFirstSeenLedger;
  write(ledger: ModelFirstSeenLedger): void;
}
