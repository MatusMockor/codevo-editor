import type {
  CodexRateLimitResetConsumeRequest,
  CodexRateLimitResetOutcome,
  CodexRateLimitResetPrepareRequest,
  CodexRateLimitResetReadRequest,
  CodexRateLimitResetSnapshot,
} from "../domain/codexRateLimitResets";

export interface CodexRateLimitResetGateway {
  read(request: CodexRateLimitResetReadRequest): Promise<CodexRateLimitResetSnapshot>;
  prepare(
    request: CodexRateLimitResetPrepareRequest,
  ): Promise<{ readonly confirmationToken: string }>;
  consume(
    request: CodexRateLimitResetConsumeRequest,
  ): Promise<{ readonly outcome: CodexRateLimitResetOutcome }>;
}
