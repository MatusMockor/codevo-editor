import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAgentThread, serializeAgentThread } from "./agentThreadWire";

describe("remote file local persistence boundary", () => {
  it("rejects a remote file instead of silently losing its remote identity", () => {
    const thread = parseAgentThread(
      JSON.parse(
        readFileSync(
          new URL("./fixtures/agent-thread-with-attachments.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    const remoteThread = {
      ...thread,
      turns: thread.turns.map((turn) => ({
        ...turn,
        attachments: [
          {
            kind: "file" as const,
            attachmentId: "112233445566778899001122334455aa",
            name: "pasted-text.txt",
            bytes: 4096,
            remote: {
              serverId: "server",
              attachmentId: "7389088c-29b8-4cec-9a15-e825e1fb2f66",
            },
          },
        ],
      })),
    };
    expect(() => serializeAgentThread(remoteThread)).toThrow(/Remote files/);
    expect(() => serializeAgentThread(thread)).not.toThrow();
  });
});
