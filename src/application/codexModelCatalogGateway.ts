import type { CodexModelCatalog } from "../domain/codexModelCatalog";

/** Application-wide public metadata; never contains workspace or session state. */
export interface CodexModelCatalogGateway {
  read(): Promise<CodexModelCatalog>;
  subscribe?(onUpdate: (catalog: CodexModelCatalog) => void): Promise<() => void>;
}
