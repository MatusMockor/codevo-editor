import { describe, expect, it } from "vitest";
import { phpParameterTypeForVariable } from "./phpParameterTypes";

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split("\n");

  return {
    column: (lines[lines.length - 1] ?? "").length + 1,
    lineNumber: lines.length,
  };
}

describe("phpParameterTypeForVariable", () => {
  it("resolves typed parameters in the enclosing method", () => {
    const source = `<?php
final class Controller
{
    public function run(ReportService $service): void
    {
        $service->send();
    }
}`;

    expect(
      phpParameterTypeForVariable(
        source,
        positionAfter(source, "$service->send"),
        "service",
      ),
    ).toBe("ReportService");
  });

  it("handles promoted, nullable, union and nested default parameters", () => {
    const source = `<?php
final class Controller
{
    public function __construct(
        private readonly ?ReportService $service,
        array|BackupService $backup = ['factory' => [1, 2]],
    ) {
        $this->service->send();
        $backup->store();
    }
}`;
    const position = positionAfter(source, "$backup->store");

    expect(phpParameterTypeForVariable(source, position, "service")).toBe(
      "ReportService",
    );
    expect(phpParameterTypeForVariable(source, position, "backup")).toBe(
      "BackupService",
    );
  });

  it("does not leak parameters from a later method", () => {
    const source = `<?php
final class Controller
{
    public function first(): void
    {
        $service->send();
    }

    public function second(ReportService $service): void {}
}`;

    expect(
      phpParameterTypeForVariable(
        source,
        positionAfter(source, "$service->send"),
        "service",
      ),
    ).toBeNull();
  });
});
