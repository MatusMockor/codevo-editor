import { describe, expect, it } from "vitest";
import {
  phpNetteDatabaseTypeKind,
  phpNetteDatabaseTypesFromSource,
  phpNetteLiteralTableArgument,
  phpNetteRepositoryTraitClassNames,
  phpNetteSiblingDatabaseType,
} from "./phpNetteDatabaseTypes";

describe("phpNetteDatabaseTypes", () => {
  const repositorySource = `<?php
namespace Crm\\UsersModule\\Repository;
use Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UsersActiveRow;
use Efabrica\\Crm\\ActiveRowTypes\\Repository\\UsersRepositoryTrait;
use Efabrica\\Crm\\ActiveRowTypes\\Selection\\UsersSelection;
use Nette\\Database\\Table\\ActiveRow;
use Nette\\Database\\Table\\Selection;
class UsersRepository { use UsersRepositoryTrait; protected string $tableName = 'users'; }
`;

  it("selects matching generated types instead of generic Nette imports", () => {
    expect(
      phpNetteDatabaseTypesFromSource(
        repositorySource,
        "Crm\\UsersModule\\Repository\\UsersRepository",
      ),
    ).toEqual({
      activeRowType:
        "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UsersActiveRow",
      selectionType:
        "Efabrica\\Crm\\ActiveRowTypes\\Selection\\UsersSelection",
    });
  });

  it("discovers only a repository-matching generated trait", () => {
    expect(
      phpNetteRepositoryTraitClassNames(
        repositorySource,
        "Crm\\UsersModule\\Repository\\UsersRepository",
      ),
    ).toEqual([
      "Efabrica\\Crm\\ActiveRowTypes\\Repository\\UsersRepositoryTrait",
    ]);
  });

  it("ignores generated repository traits that the class does not use", () => {
    const source = `<?php
use Generated\\Repository\\AuditRepositoryTrait;
final class UsersRepository { protected string $tableName = 'users'; }`;

    expect(
      phpNetteRepositoryTraitClassNames(source, "App\\UsersRepository"),
    ).toEqual([]);
    expect(
      phpNetteDatabaseTypesFromSource(source, "App\\UsersRepository"),
    ).toBeNull();
  });

  it("derives relation row and selection siblings from literal tables", () => {
    const usersRow =
      "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UsersActiveRow";

    expect(
      phpNetteSiblingDatabaseType(usersRow, "activeRow", "user_statuses"),
    ).toBe(
      "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UserStatusesActiveRow",
    );
    expect(
      phpNetteSiblingDatabaseType(usersRow, "selection", "user_meta"),
    ).toBe(
      "Efabrica\\Crm\\ActiveRowTypes\\Selection\\UserMetaSelection",
    );
    expect(phpNetteLiteralTableArgument("$user->ref('user_statuses')")).toBe(
      "user_statuses",
    );
    expect(phpNetteLiteralTableArgument("$user->ref($table)")).toBeNull();
    expect(
      phpNetteLiteralTableArgument(
        "$user->ref('users')->related('orders')",
      ),
    ).toBe("orders");
    expect(
      phpNetteLiteralTableArgument(
        "$user->ref('users')->related($table)",
      ),
    ).toBeNull();
  });

  it("parses only the structural outer relation call", () => {
    expect(
      phpNetteLiteralTableArgument(
        "$user->ref('users')->related('user_roles.user_id')",
      ),
    ).toBe("user_roles");
    expect(
      phpNetteLiteralTableArgument(
        "$user->related($repository->ref('user_statuses'))",
      ),
    ).toBeNull();
    expect(
      phpNetteLiteralTableArgument(
        "decorate($user->related('user_statuses'))",
      ),
    ).toBeNull();
    expect(
      phpNetteLiteralTableArgument("$user->ref('users.id')"),
    ).toBeNull();
  });

  it("ignores comments while parsing the outer literal argument", () => {
    expect(
      phpNetteLiteralTableArgument(
        "$row->related(/* misleading: ) */ 'orders')",
      ),
    ).toBe("orders");
    expect(
      phpNetteLiteralTableArgument(
        "$row->related(// misleading: (,\n'order_items.order_id')",
      ),
    ).toBe("order_items");
    expect(
      phpNetteLiteralTableArgument(
        "$row->related(/* ( */ $repository->ref('orders'))",
      ),
    ).toBeNull();
  });

  it("normalizes nullable and false carriers with one generated object type", () => {
    const carrier =
      "false|\\Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UsersActiveRow|null";

    expect(phpNetteDatabaseTypeKind(carrier)).toBe("activeRow");
    expect(
      phpNetteSiblingDatabaseType(carrier, "selection", "user_roles"),
    ).toBe(
      "Efabrica\\Crm\\ActiveRowTypes\\Selection\\UserRolesSelection",
    );
    expect(
      phpNetteDatabaseTypeKind(
        "App\\UsersActiveRow|App\\AdminsActiveRow|null",
      ),
    ).toBeNull();
  });

  it("handles generated family markers case-insensitively", () => {
    expect(
      phpNetteDatabaseTypeKind(
        "efabrica\\crm\\activerowtypes\\activerow\\usersactiverow",
      ),
    ).toBe("activeRow");
    expect(
      phpNetteDatabaseTypeKind("Crm\\UsersModule\\USERSREPOSITORY"),
    ).toBe("repository");
  });

  it("deduplicates equivalent family FQNs and preserves canonical casing", () => {
    const carrier = [
      "efabrica\\crm\\ActiveRowTypes\\ActiveRow\\UsersActiveRow",
      "\\Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UsersActiveRow",
      "false",
      "NULL",
    ].join("|");

    expect(phpNetteDatabaseTypeKind(carrier)).toBe("activeRow");
    expect(
      phpNetteSiblingDatabaseType(carrier, "selection", "orders"),
    ).toBe(
      "Efabrica\\Crm\\ActiveRowTypes\\Selection\\OrdersSelection",
    );
  });

  it("does not classify unrelated application classes", () => {
    expect(phpNetteDatabaseTypeKind("App\\UsersRepositoryService")).toBeNull();
    expect(
      phpNetteDatabaseTypesFromSource(
        "<?php use Nette\\Database\\Table\\ActiveRow;",
        "App\\UsersRepository",
      ),
    ).toBeNull();
  });
});
