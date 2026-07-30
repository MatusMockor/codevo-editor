import { describe, expect, it, vi } from "vitest";
import type { IdentifiedLanguageServerRequest } from "../domain/languageServerFeatures";
import {
  createDocumentSaveParticipantRequestPool,
  DOCUMENT_SAVE_PARTICIPANT_INTERRUPTED,
} from "./documentSaveParticipantRequestCoordinator";

function pendingRequest<T>(requestId: number, sessionId = 7): IdentifiedLanguageServerRequest<T> {
  return Object.assign(new Promise<T>(() => undefined), { requestId, sessionId });
}

describe("DocumentSaveParticipantRequestPool", () => {
  it("evicts the oldest request deterministically at capacity and cancels its exact identity", async () => {
    const cancelRequest = vi.fn(async () => undefined);
    const pool = createDocumentSaveParticipantRequestPool(2_500, 2);
    const first = pool.begin("owner-a\u0000/root\u0000/a.ts", "/root\u0000/a.ts", () => true);
    const second = pool.begin("owner-a\u0000/root\u0000/b.ts", "/root\u0000/b.ts", () => true);
    const firstRequest = pendingRequest<unknown>(41);
    const secondRequest = pendingRequest<unknown>(42);
    first.observeBackendRequest("/root", firstRequest, cancelRequest);
    second.observeBackendRequest("/root", secondRequest, cancelRequest);
    void first.waitFor(firstRequest);
    void second.waitFor(secondRequest);

    const third = pool.begin("owner-a\u0000/root\u0000/c.ts", "/root\u0000/c.ts", () => true);

    expect(third.isCurrent()).toBe(false);
    expect(cancelRequest).not.toHaveBeenCalled();
    expect(first.isCurrent()).toBe(true);
    expect(second.isCurrent()).toBe(true);

    pool.dispose();
    expect(cancelRequest).toHaveBeenNthCalledWith(1, "/root", 7, 41);
    expect(cancelRequest).toHaveBeenNthCalledWith(2, "/root", 7, 42);
    expect(cancelRequest).toHaveBeenCalledTimes(2);
  });

  it("supersedes only the matching owner/root/document key", async () => {
    const cancelRequest = vi.fn(async () => undefined);
    const pool = createDocumentSaveParticipantRequestPool();
    const stale = pool.begin("owner-a\u0000/root\u0000/a.ts", "/root\u0000/a.ts", () => true);
    const independent = pool.begin("owner-a\u0000/root\u0000/b.ts", "/root\u0000/b.ts", () => true);
    const staleRequest = pendingRequest<unknown>(51);
    stale.observeBackendRequest("/root", staleRequest, cancelRequest);
    void stale.waitFor(staleRequest);

    const latest = pool.begin("owner-b\u0000/root\u0000/a.ts", "/root\u0000/a.ts", () => true);

    await expect(stale.waitFor(staleRequest)).resolves.toBe(DOCUMENT_SAVE_PARTICIPANT_INTERRUPTED);
    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith("/root", 7, 51);
    expect(independent.isCurrent()).toBe(true);
    expect(latest.isCurrent()).toBe(true);
    pool.dispose();
  });
});
