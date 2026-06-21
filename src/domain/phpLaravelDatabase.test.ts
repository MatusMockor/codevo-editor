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
      [
        "class User extends \\Illuminate\\Database\\Eloquent\\Model { public ?string $connection = 'sqlite'; }",
        "Model::$connection",
      ],
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

  it("detects Laravel Eloquent model connection properties", () => {
    const importedModel = `<?php

use Illuminate\\Database\\Eloquent\\Model;

class User extends Model
{
    protected $connection = 'mysql';
}
`;
    const aliasedModel = `<?php

use Illuminate\\Database\\Eloquent\\Model as EloquentModel;

class User extends EloquentModel
{
    public string|null $connection = 'mysql';
}
`;
    const fullyQualifiedModel = `<?php

class User extends \\Illuminate\\Database\\Eloquent\\Model
{
    public null|string $connection = 'sqlite';
}
`;

    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        importedModel,
        positionAfter(importedModel, "mysql"),
      ),
    ).toMatchObject({
      call: "Model::$connection",
      connectionName: "mysql",
      prefix: "mysql",
    });
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        aliasedModel,
        positionAfter(aliasedModel, "mysql"),
      ),
    ).toMatchObject({
      call: "Model::$connection",
      connectionName: "mysql",
      prefix: "mysql",
    });
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        fullyQualifiedModel,
        positionAfter(fullyQualifiedModel, "sqlite"),
      ),
    ).toMatchObject({
      call: "Model::$connection",
      connectionName: "sqlite",
      prefix: "sqlite",
    });
  });

  it("ignores unsupported arguments, interpolation, invalid names, and non-database calls", () => {
    const secondArgument = `<?php\n\nDB::connection(null, 'mysql');\n`;
    const interpolated = `<?php\n\nDB::connection("my$sql");\n`;
    const invalid = `<?php\n\nDB::connection('mysql/read');\n`;
    const wrongCall = `<?php\n\nCache::store('mysql');\n`;
    const nonModelProperty = `<?php\n\nclass Connector { protected $connection = 'mysql'; }\n`;
    const localModelClass = `<?php\n\nclass Model {}\nclass Connector extends Model { protected $connection = 'mysql'; }\n`;
    const unimportedModel = `<?php\n\nclass User extends Model { protected $connection = 'mysql'; }\n`;
    const privateModelProperty = `<?php\n\nclass User extends Model { private $connection = 'mysql'; }\n`;
    const staticModelProperty = `<?php\n\nuse Illuminate\\Database\\Eloquent\\Model;\nclass User extends Model { protected static $connection = 'mysql'; }\n`;
    const arbitraryTypedProperty = `<?php\n\nuse Illuminate\\Database\\Eloquent\\Model;\nclass User extends Model { protected ConnectionName $connection = 'mysql'; }\n`;
    const localVariable = `<?php\n\nuse Illuminate\\Database\\Eloquent\\Model;\nclass User extends Model { public function run() { public $connection = 'mysql'; } }\n`;
    const globalAfterModel = `<?php\n\nuse Illuminate\\Database\\Eloquent\\Model;\nclass User extends Model {}\nprotected $connection = 'mysql';\n`;
    const fakeClassInComment = `<?php\n\nuse Illuminate\\Database\\Eloquent\\Model;\n// class User extends Model {\nprotected $connection = 'mysql';\n`;

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
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        nonModelProperty,
        positionAfter(nonModelProperty, "mysql"),
      ),
    ).toBeNull();
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        localModelClass,
        positionAfter(localModelClass, "mysql"),
      ),
    ).toBeNull();
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        unimportedModel,
        positionAfter(unimportedModel, "mysql"),
      ),
    ).toBeNull();
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        privateModelProperty,
        positionAfter(privateModelProperty, "mysql"),
      ),
    ).toBeNull();
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        staticModelProperty,
        positionAfter(staticModelProperty, "mysql"),
      ),
    ).toBeNull();
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        arbitraryTypedProperty,
        positionAfter(arbitraryTypedProperty, "mysql"),
      ),
    ).toBeNull();
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        localVariable,
        positionAfter(localVariable, "mysql"),
      ),
    ).toBeNull();
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        globalAfterModel,
        positionAfter(globalAfterModel, "mysql"),
      ),
    ).toBeNull();
    expect(
      phpLaravelDatabaseConnectionReferenceContextAt(
        fakeClassInComment,
        positionAfter(fakeClassInComment, "mysql"),
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
