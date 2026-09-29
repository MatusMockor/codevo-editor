import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CodexModelCatalogGateway } from "../application/codexModelCatalogGateway";
import { parseCodexModelCatalog, type CodexModelCatalog } from "../domain/codexModelCatalog";

export const GET_CODEX_MODEL_CATALOG_IPC_COMMAND = "get_codex_model_catalog" as const;
export const CODEX_MODEL_CATALOG_UPDATED_EVENT = "codex-model-catalog-updated" as const;

export class TauriCodexModelCatalogGateway implements CodexModelCatalogGateway {
  async read() {
    return parseCodexModelCatalog(await invoke<unknown>(GET_CODEX_MODEL_CATALOG_IPC_COMMAND));
  }

  subscribe(onUpdate: (catalog: CodexModelCatalog) => void): Promise<() => void> {
    return listen<unknown>(CODEX_MODEL_CATALOG_UPDATED_EVENT, ({ payload }) => {
      try {
        onUpdate(parseCodexModelCatalog(payload));
      } catch {
        // Untrusted events cannot replace the last validated snapshot.
      }
    });
  }
}
