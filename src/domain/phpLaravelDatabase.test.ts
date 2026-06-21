import { describe, expect, it } from "vitest";
import {
  isUsableLaravelDatabaseConnectionName,
  phpLaravelDatabaseConnectionCompletionInsertText,
  phpLaravelDatabaseConnectionConfigKey,
  phpLaravelDatabaseConnectionNameFromConfigKey,
  phpLaravelDatabaseConnectionReferenceContextAt,
} from "./phpLaravelDatabase";

describe("phpLaravelDatabase", () => {
  it("detects supported Laravel database connection strings", () => {
    const samples = [
      ["DB::connection('mysql')", "DB::connection"],
      ["DB::reconnect('mysql')", "DB::reconnect"],
      ["DB::disconnect('mysql')", "DB::disconnect"],
      ["DB::purge('mysql')", "DB::purge"],
      ["Schema::connection('sqlite')", "Schema::connection"],
      ["db()->connection('mysql')", "db()->connection"],
      ["DB::connection(name: 'mysql')", "DB::connection"],
      ["Schema::connection(connection: 'sqlite')", "Schema::connection"],
    ] as const;

    for (const [expression, call] of samples) {
      const source = `<?php\n\nreturn ${expression};\n`;
      const connectionName = expression.includes("sqlite") ? "sqlite" : "mysql";

      expect(
        phpLaravelDatabaseConnectionReferenceContextAt(
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

  it("ignores unsupported arguments, interpolation, invalid names, and non-database calls", () => {
    const secondArgument = `<?php\n\nDB::connection(null, 'mysql');\n`;
    const interpolated = `<?php\n\nDB::connection("my$sql");\n`;
    const invalid = `<?php\n\nDB::connection('mysql/read');\n`;
    const wrongCall = `<?php\n\nCache::store('mysql');\n`;

    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        secondArgument,
        positionAfter(secondArgument, "mysql"),
      ),
    ).toBeNull();
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "my"),
      ),
    ).toBeNull();
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        invalid,
        positionAfter(invalid, "mysql"),
      ),
    ).toBeNull();
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        wrongCall,
        positionAfter(wrongCall, "mysql"),
      ),
    ).toBeNull();
  });

  it("maps database connection names to database config keys", () => {
    expect(phpLaravelDatabaseConnectionConfigKey("mysql")).toBe(
      "database.connections.mysql",
    );
    expect(
      phpLaravelDatabaseConnectionNameFromConfigKey(
        "database.connections.sqlite",
      ),
    ).toBe("sqlite");
    expect(
      phpLaravelDatabaseConnectionNameFromConfigKey(
        "database.connections.mysql.driver",
      ),
    ).toBe(null);
    expect(phpLaravelDatabaseConnectionNameFromConfigKey("database.default")).toBe(
      null,
    );
    expect(isUsableLaravelDatabaseConnectionName("mysql-read")).toBe(true);
    expect(isUsableLaravelDatabaseConnectionName("mysql/read")).toBe(false);
  });

  it("uses whole connection-name insert text", () => {
    expect(phpLaravelDatabaseConnectionCompletionInsertText("mysql")).toBe(
      "mysql",
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
