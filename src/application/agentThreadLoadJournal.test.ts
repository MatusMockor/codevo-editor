import { describe, expect, it } from "vitest";
import { MAX_AGENT_THREADS_PER_ROOT } from "../domain/agentThread";
import { AgentThreadLoadJournal } from "./agentThreadLoadJournal";

describe("pending agent history removal journals", () => {
  it("isolates roots and never lets an old load settlement remove its replacement", () => {
    const journal = new AgentThreadLoadJournal();
    const oldA = journal.begin("/a");
    journal.recordRemoval("/a", "old");
    const b = journal.begin("/b");
    const newA = journal.begin("/a");
    journal.settle(oldA);
    journal.recordRemoval("/a", "new");
    expect(oldA.abandoned).toBe(true);
    expect(oldA.removedThreadIds.size).toBe(0);
    expect([...newA.removedThreadIds]).toEqual(["new"]);
    expect(b.removedThreadIds.size).toBe(0);
    journal.settle(newA);
    journal.recordRemoval("/a", "after-settlement");
    expect([...newA.removedThreadIds]).toEqual(["new"]);
  });

  it("bounds distinct removals and exposes overflow instead of losing evidence", () => {
    const journal = new AgentThreadLoadJournal();
    const lease = journal.begin("/a");
    for (let index = 0; index < MAX_AGENT_THREADS_PER_ROOT; index += 1)
      journal.recordRemoval("/a", `thread-${index}`);
    journal.recordRemoval("/a", "thread-0");
    expect(lease.overflowed).toBe(false);
    journal.recordRemoval("/a", "overflow");
    expect(lease.overflowed).toBe(true);
    expect(lease.removedThreadIds.size).toBe(MAX_AGENT_THREADS_PER_ROOT);
    journal.clear();
    expect(lease.abandoned).toBe(true);
    expect(lease.removedThreadIds.size).toBe(0);
  });
});
