import { describe, expect, it } from "vitest";
import {
  artisanMakeCommand,
  artisanMakeGenerators,
  sanitizeArtisanMakeName,
} from "./artisanMakeCommand";

describe("artisanMakeCommand", () => {
  it.each([
    "Admin User",
    "Admin'User",
    'Admin"User',
    "`whoami`",
    "$(whoami)",
    "User;whoami",
    "User|whoami",
    "..",
    "-User",
    "Usér",
    "",
  ])("rejects an unsafe name: %s", (name) => {
    expect(sanitizeArtisanMakeName(name)).toBeNull();
  });

  it.each(["Admin/User", "App\\Models\\User", "User", "_User2"])(
    "accepts a safe name: %s",
    (name) => {
      expect(sanitizeArtisanMakeName(name)).toBe(name);
    },
  );

  it("exposes the Laravel 11 core generator set", () => {
    expect(artisanMakeGenerators.map(({ type }) => type)).toEqual([
      "model",
      "controller",
      "migration",
      "request",
      "middleware",
      "seeder",
      "factory",
      "policy",
      "command",
      "event",
      "listener",
      "job",
      "mail",
      "notification",
      "observer",
      "provider",
      "rule",
      "test",
    ]);
  });

  it("assembles an exact shell-quoted command", () => {
    expect(artisanMakeCommand("controller", "Admin/UserController")).toBe(
      "php artisan make:controller 'Admin/UserController' --no-interaction",
    );
    expect(artisanMakeCommand("model", "App\\Models\\User")).toBe(
      "php artisan make:model 'App\\Models\\User' --no-interaction",
    );
  });

  it("refuses to assemble a command from an unsafe name", () => {
    expect(artisanMakeCommand("model", "User;whoami")).toBeNull();
  });
});
