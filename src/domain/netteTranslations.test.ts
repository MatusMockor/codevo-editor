import { describe, expect, it } from "vitest";
import {
  netteTranslationDomainFromPath,
  netteTranslationKeysFromSource,
  netteTranslationTargetFromSource,
} from "./netteTranslations";

describe("netteTranslations", () => {
  it("infers the translation domain from the filename before locale", () => {
    expect(
      netteTranslationDomainFromPath(
        "app/modules/usersModule/lang/users.cs_CZ.neon",
      ),
    ).toBe("users");
    expect(netteTranslationDomainFromPath("lang/admin.users.en.neon")).toBe(
      "admin.users",
    );
    expect(netteTranslationDomainFromPath("lang/users.neon")).toBeNull();
  });

  it("extracts nested ebox-like NEON translation leaves with offsets", () => {
    const source = `# users translations
title: "Users" # heading
grid:
  columns:
    name: Jméno
    email: "E-mail"
  actions:
    edit: Upravit
    delete: 'Smazat'
forms:
  user:
    submit: Uložit
`;

    expect(
      netteTranslationKeysFromSource(
        source,
        "app/modules/usersModule/lang/users.cs_CZ.neon",
      ),
    ).toEqual([
      {
        key: "users.forms.user.submit",
        offset: source.indexOf("submit"),
        position: { column: 5, lineNumber: 12 },
      },
      {
        key: "users.grid.actions.delete",
        offset: source.indexOf("delete"),
        position: { column: 5, lineNumber: 9 },
      },
      {
        key: "users.grid.actions.edit",
        offset: source.indexOf("edit"),
        position: { column: 5, lineNumber: 8 },
      },
      {
        key: "users.grid.columns.email",
        offset: source.indexOf("email"),
        position: { column: 5, lineNumber: 6 },
      },
      {
        key: "users.grid.columns.name",
        offset: source.indexOf("name"),
        position: { column: 5, lineNumber: 5 },
      },
      {
        key: "users.title",
        offset: source.indexOf("title"),
        position: { column: 1, lineNumber: 2 },
      },
    ]);
  });

  it("keeps comments and complex values out of extracted keys", () => {
    const source = `# ignored: value
root:
  # ignoredNested: value
  visible: "hash # stays inside string"
  commented: # this opens a nested map, not a leaf
    child: Value
  inlineMap: { child: Value }
  inlineList: [Value]
  method: translate(foo)
`;

    expect(
      netteTranslationKeysFromSource(source, "lang/users.cs_CZ.neon"),
    ).toEqual([
      {
        key: "users.root.commented.child",
        offset: source.indexOf("child"),
        position: { column: 5, lineNumber: 6 },
      },
      {
        key: "users.root.visible",
        offset: source.indexOf("visible"),
        position: { column: 3, lineNumber: 4 },
      },
    ]);
  });

  it("supports quoted key segments and target lookup", () => {
    const source = `menu:
  "user-profile": Profil uživatele
`;

    expect(
      netteTranslationTargetFromSource(
        source,
        "lang/users.cs_CZ.neon",
        "users.menu.user-profile",
      ),
    ).toEqual({
      key: "users.menu.user-profile",
      offset: source.indexOf("user-profile"),
      position: { column: 4, lineNumber: 2 },
    });
  });
});
