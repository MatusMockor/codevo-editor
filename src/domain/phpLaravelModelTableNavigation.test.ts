import { describe, expect, it } from "vitest";
import { phpLaravelModelSourcesForTableName } from "./phpFrameworkLaravel";

const explicitUser = {
  className: "App\\Models\\Account",
  path: "/workspace/app/Models/Account.php",
  source: `<?php
namespace App\\Models;
class Account extends Model
{
    protected $table = 'users';
}
`,
};

const conventionalUser = {
  className: "App\\Models\\User",
  path: "/workspace/app/Models/User.php",
  source: `<?php
namespace App\\Models;
class User extends Model {}
`,
};

describe("phpLaravelModelSourcesForTableName", () => {
  it("returns a model with an explicit table declaration", () => {
    expect(phpLaravelModelSourcesForTableName("users", [explicitUser])).toEqual([
      explicitUser,
    ]);
  });

  it("returns a model matching the Laravel table convention", () => {
    expect(
      phpLaravelModelSourcesForTableName("users", [conventionalUser]),
    ).toEqual([conventionalUser]);
  });

  it("returns only explicit matches when convention matches also exist", () => {
    expect(
      phpLaravelModelSourcesForTableName("users", [
        conventionalUser,
        explicitUser,
      ]),
    ).toEqual([explicitUser]);
  });

  it("returns no models when the table is unmatched", () => {
    expect(
      phpLaravelModelSourcesForTableName("posts", [
        conventionalUser,
        explicitUser,
      ]),
    ).toEqual([]);
  });

  it("returns every model explicitly declaring the same table", () => {
    const secondExplicitUser = {
      ...explicitUser,
      className: "App\\Models\\LegacyUser",
      path: "/workspace/app/Models/LegacyUser.php",
      source: explicitUser.source.replace("Account", "LegacyUser"),
    };

    expect(
      phpLaravelModelSourcesForTableName("users", [
        explicitUser,
        conventionalUser,
        secondExplicitUser,
      ]),
    ).toEqual([explicitUser, secondExplicitUser]);
  });
});
