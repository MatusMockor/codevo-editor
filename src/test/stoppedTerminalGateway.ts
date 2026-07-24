import { vi } from "vitest";
import type { TerminalGateway } from "../domain/terminal";

export function createStoppedTerminalGateway(): TerminalGateway {
  return {
    acknowledgeStart: vi.fn(async () => undefined),
    listProfiles: vi.fn(async () => []),
    resize: vi.fn(async () => undefined),
    start: vi.fn(async () => ({ kind: "stopped" as const, sessionId: 1 })),
    stop: vi.fn(async (sessionId: number) => ({ kind: "stopped" as const, sessionId })),
    stopAll: vi.fn(async () => undefined),
    stopRoot: vi.fn(async () => undefined),
    subscribeOutput: vi.fn(async () => () => undefined),
    writeInput: vi.fn(async () => undefined),
  };
}
