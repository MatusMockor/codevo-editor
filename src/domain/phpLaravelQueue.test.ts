import { describe, expect, it } from "vitest";
import {
  isUsableLaravelQueueConnectionName,
  phpLaravelQueueConnectionCompletionInsertText,
  phpLaravelQueueConnectionConfigKey,
  phpLaravelQueueConnectionNameFromConfigKey,
  phpLaravelQueueConnectionReferenceContextAt,
} from "./phpLaravelQueue";

describe("phpLaravelQueue", () => {
  it("detects supported Laravel queue connection strings", () => {
    const samples = [
      ["Queue::connection('redis')", "Queue::connection", "redis"],
      ["Queue::connection(name: 'redis')", "Queue::connection", "redis"],
      ["Queue::connected('redis')", "Queue::connected", "redis"],
      ["ProcessPodcast::dispatch()->onConnection('sqs')", "onConnection", "sqs"],
      ["Bus::chain([])->onConnection('redis')", "onConnection", "redis"],
      ["Bus::chain([])->allOnConnection('redis')", "allOnConnection", "redis"],
      ["$this->onConnection('redis')", "onConnection", "redis"],
      [
        "Queue::route(ProcessPodcast::class, connection: 'redis')",
        "Queue::route",
        "redis",
      ],
      [
        "Queue::route(ProcessPodcast::class, 'emails', 'redis')",
        "Queue::route",
        "redis",
      ],
    ] as const;

    for (const [expression, call, connectionName] of samples) {
      const source = `<?php\n\nreturn ${expression};\n`;

      expect(
        phpLaravelQueueConnectionReferenceContextAt(
          source,
          positionAfter(source, connectionName),
        ),
      ).toMatchObject({
        call,
        connectionName,
        prefix: connectionName,
      });
    }
  });

  it("ignores unsupported arguments, interpolation, invalid names, and non-queue calls", () => {
    const secondArgument = `<?php\n\nQueue::connection(null, 'redis');\n`;
    const routeFirstArgument = `<?php\n\nQueue::route('redis');\n`;
    const interpolated = `<?php\n\nQueue::connection("red$is");\n`;
    const invalid = `<?php\n\nQueue::connection('redis/main');\n`;
    const wrongCall = `<?php\n\nCache::store('redis');\n`;

    expect(
      phpLaravelQueueConnectionReferenceContextAt(
        secondArgument,
        positionAfter(secondArgument, "redis"),
      ),
    ).toBeNull();
    expect(
      phpLaravelQueueConnectionReferenceContextAt(
        routeFirstArgument,
        positionAfter(routeFirstArgument, "redis"),
      ),
    ).toBeNull();
    expect(
      phpLaravelQueueConnectionReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "red"),
      ),
    ).toBeNull();
    expect(
      phpLaravelQueueConnectionReferenceContextAt(
        invalid,
        positionAfter(invalid, "redis"),
      ),
    ).toBeNull();
    expect(
      phpLaravelQueueConnectionReferenceContextAt(
        wrongCall,
        positionAfter(wrongCall, "redis"),
      ),
    ).toBeNull();
  });

  it("maps queue connection names to queue config keys", () => {
    expect(phpLaravelQueueConnectionConfigKey("redis")).toBe(
      "queue.connections.redis",
    );
    expect(
      phpLaravelQueueConnectionNameFromConfigKey("queue.connections.database"),
    ).toBe("database");
    expect(
      phpLaravelQueueConnectionNameFromConfigKey("queue.connections.redis.driver"),
    ).toBe(null);
    expect(phpLaravelQueueConnectionNameFromConfigKey("queue.default")).toBe(
      null,
    );
    expect(isUsableLaravelQueueConnectionName("redis-high")).toBe(true);
    expect(isUsableLaravelQueueConnectionName("redis/high")).toBe(false);
  });

  it("uses whole connection-name insert text", () => {
    expect(phpLaravelQueueConnectionCompletionInsertText("redis")).toBe(
      "redis",
    );
  });
});

function positionAfter(source: string, token: string) {
  const offset = source.indexOf(token);

  if (offset < 0) {
    throw new Error(`Token not found: ${token}`);
  }

  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset + token.length; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
