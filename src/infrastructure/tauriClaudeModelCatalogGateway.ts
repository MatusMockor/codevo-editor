import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ClaudeModelCatalogGateway } from "../application/claudeModelCatalogGateway";
import { parseClaudeModelManifest, type ClaudeModelManifest } from "../domain/claudeModelCatalog";

export class TauriClaudeModelCatalogGateway implements ClaudeModelCatalogGateway {
  async read() {
    return parseClaudeModelManifest(await invoke<unknown>("get_claude_model_manifest"));
  }

  subscribe(onUpdate: (catalog: ClaudeModelManifest) => void): Promise<() => void> {
    return listen<unknown>("claude-model-manifest-updated", ({ payload }) => {
      try {
        onUpdate(parseClaudeModelManifest(payload));
      } catch {
        // Untrusted events cannot replace the last validated snapshot.
      }
    });
  }
}
