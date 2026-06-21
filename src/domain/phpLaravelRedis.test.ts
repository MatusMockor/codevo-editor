import { describe, expect, it } from "vitest";
import {
  isUsableLaravelRedisConnectionName,
  phpLaravelRedisConnectionCompletionInsertText,
  phpLaravelRedisConnectionConfigKey,
  phpLaravelRedisConnectionNameFromConfigKey,
  phpLaravelRedisConnectionReferenceContextAt,
} from "./phpLaravelRedis";

describe("phpLaravelRedis", () => {
  it("detects supported Laravel Redis connection strings", () => {
    const samples = [
      ["Redis::connection('cache')", "Redis::connection"],
      ["Redis::connection(name: 'cache')", "Redis::connection"],
    ] as const;

    for (const [expression, call] of samples) {
      const source = `<?php\n\nreturn ${expression};\n`;

      expect(
        phpLaravelRedisConnectionReferenceContextAt(
          source,
          positionAfter(source, "cache"),
        ),
      ).toMatchObject({
        call,
        connectionName: "cache",
        prefix: "cache",
      });
    }
  });

  it("ignores unsupported arguments, interpolation, invalid names, and non-Redis calls", () => {
    const secondArgument = `<?php\n\nRedis::connection(null, 'cache');\n`;
    const wrongNamedArgument = `<?php\n\nRedis::connection(connection: 'cache');\n`;
    const wrongMethod = `<?php\n\nRedis::client('cache');\n`;
    const interpolated = `<?php\n\nRedis::connection("ca$che");\n`;
    const invalid = `<?php\n\nRedis::connection('cache/main');\n`;
    const wrongFacade = `<?php\n\nDB::connection('cache');\n`;

    expect(
      phpLaravelRedisConnectionReferenceContextAt(
        secondArgument,
        positionAfter(secondArgument, "cache"),
      ),
    ).toBeNull();
    expect(
      phpLaravelRedisConnectionReferenceContextAt(
        wrongNamedArgument,
        positionAfter(wrongNamedArgument, "cache"),
      ),
    ).toBeNull();
    expect(
      phpLaravelRedisConnectionReferenceContextAt(
        wrongMethod,
        positionAfter(wrongMethod, "cache"),
      ),
    ).toBeNull();
    expect(
      phpLaravelRedisConnectionReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "ca"),
      ),
    ).toBeNull();
    expect(
      phpLaravelRedisConnectionReferenceContextAt(
        invalid,
        positionAfter(invalid, "cache"),
      ),
    ).toBeNull();
    expect(
      phpLaravelRedisConnectionReferenceContextAt(
        wrongFacade,
        positionAfter(wrongFacade, "cache"),
      ),
    ).toBeNull();
  });

  it("maps Redis connection names to database config keys", () => {
    expect(phpLaravelRedisConnectionConfigKey("cache")).toBe(
      "database.redis.cache",
    );
    expect(
      phpLaravelRedisConnectionNameFromConfigKey("database.redis.default"),
    ).toBe("default");
    expect(
      phpLaravelRedisConnectionNameFromConfigKey("database.redis.cache.host"),
    ).toBe(null);
    expect(phpLaravelRedisConnectionNameFromConfigKey("database.redis.client")).toBe(
      null,
    );
    expect(
      phpLaravelRedisConnectionNameFromConfigKey("database.redis.options"),
    ).toBe(null);
    expect(
      phpLaravelRedisConnectionNameFromConfigKey("database.redis.cluster"),
    ).toBe(null);
    expect(
      phpLaravelRedisConnectionNameFromConfigKey("database.redis.clusters"),
    ).toBe(null);
    expect(
      phpLaravelRedisConnectionNameFromConfigKey("database.connections.mysql"),
    ).toBe(null);
    expect(isUsableLaravelRedisConnectionName("cache-store")).toBe(true);
    expect(isUsableLaravelRedisConnectionName("cache/store")).toBe(false);
  });

  it("uses whole connection-name insert text", () => {
    expect(phpLaravelRedisConnectionCompletionInsertText("cache")).toBe(
      "cache",
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
