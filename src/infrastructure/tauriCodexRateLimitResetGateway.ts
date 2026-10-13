import { invoke } from "@tauri-apps/api/core";
import type { CodexRateLimitResetGateway } from "../application/codexRateLimitResetGateway";
import {
  parseCodexRateLimitResetConsumeRequest,
  parseCodexRateLimitResetPreparation,
  parseCodexRateLimitResetPrepareRequest,
  parseCodexRateLimitResetReadRequest,
  parseCodexRateLimitResetReceipt,
  parseCodexRateLimitResetSnapshot,
  type CodexRateLimitResetConsumeRequest,
  type CodexRateLimitResetPrepareRequest,
  type CodexRateLimitResetReadRequest,
} from "../domain/codexRateLimitResets";

export class TauriCodexRateLimitResetGateway implements CodexRateLimitResetGateway {
  async read(request: CodexRateLimitResetReadRequest) {
    return parseCodexRateLimitResetSnapshot(
      await invoke<unknown>("read_codex_limit_resets", {
        request: parseCodexRateLimitResetReadRequest(request),
      }),
    );
  }

  async prepare(request: CodexRateLimitResetPrepareRequest) {
    return parseCodexRateLimitResetPreparation(
      await invoke<unknown>("prepare_codex_limit_reset", {
        request: parseCodexRateLimitResetPrepareRequest(request),
      }),
    );
  }

  async consume(request: CodexRateLimitResetConsumeRequest) {
    return parseCodexRateLimitResetReceipt(
      await invoke<unknown>("consume_codex_limit_reset", {
        request: parseCodexRateLimitResetConsumeRequest(request),
      }),
    );
  }
}
