import { describe, expect, it } from "vitest";
import { BrowserRemoteAgentMetadataRepository } from "./browserRemoteAgentMetadataRepository";

function fixture(initial: string | null = null) {
  let value = initial;
  const storage = {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
  return {
    repository: new BrowserRemoteAgentMetadataRepository(() => storage),
    storage,
    value: () => value,
  };
}

const id = "remote-thread:server:runner:conversation";

describe("remote presentation metadata persistence", () => {
  it("restores original thread preferences without storing execution or transcript data", () => {
    const { repository, storage } = fixture();
    const records = [
      { threadId: id, title: "Follow up", pinned: true, archived: false, viewedAtEpochMs: 12 },
    ];
    repository.save(records);
    expect(new BrowserRemoteAgentMetadataRepository(() => storage).load()).toEqual(records);
  });

  it.each([
    "broken JSON",
    JSON.stringify([{ threadId: "local-thread-id", pinned: true }]),
    JSON.stringify([{ threadId: id, sessionId: "private" }]),
    JSON.stringify([{ threadId: id, pinned: "true" }]),
    JSON.stringify([{ threadId: id, viewedAtEpochMs: -1 }]),
    JSON.stringify([{ threadId: id }, { threadId: id }]),
    JSON.stringify([{ threadId: "remote-thread:s:r:%00" }]),
    JSON.stringify([{ threadId: "remote-thread:s:r:%broken" }]),
  ])("rejects corrupt or foreign stored preferences: %s", (raw) => {
    expect(fixture(raw).repository.load()).toEqual([]);
  });

  it("preserves the previous snapshot when a save violates identity or byte limits", () => {
    const { repository, value } = fixture();
    repository.save([{ threadId: id, pinned: true }]);
    const previous = value();
    expect(() => repository.save([{ threadId: "local", pinned: true }])).toThrow();
    expect(() => repository.save([{ threadId: id, title: "é".repeat(129) }])).toThrow();
    expect(value()).toBe(previous);
  });

  it("bounds reads and record counts before decoding every entry", () => {
    expect(fixture(" ".repeat(2 * 1024 * 1024 + 1)).repository.load()).toEqual([]);
    expect(() =>
      fixture().repository.save(
        Array.from({ length: 4097 }, (_, index) => ({ threadId: `${id}${index}` })),
      ),
    ).toThrow();
  });

  it("tolerates disabled storage on load and reports failed persistence", () => {
    const repository = new BrowserRemoteAgentMetadataRepository(() => {
      throw new Error("Storage disabled");
    });
    expect(repository.load()).toEqual([]);
    expect(() => repository.save([{ threadId: id }])).toThrow("Storage disabled");
  });
});
