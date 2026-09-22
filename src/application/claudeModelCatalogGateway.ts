import type { ClaudeModelManifest } from "../domain/claudeModelCatalog";

/** Application-wide public metadata; never contains workspace or session state. */
export interface ClaudeModelCatalogGateway {
  read(): Promise<ClaudeModelManifest>;
  subscribe?(onUpdate: (catalog: ClaudeModelManifest) => void): Promise<() => void>;
}
