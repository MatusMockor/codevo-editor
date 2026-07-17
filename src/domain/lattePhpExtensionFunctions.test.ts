import { describe, expect, it } from "vitest";
import {
  LATTE_BUILTIN_FUNCTIONS,
  lattePhpExtensionFunctionsFromSource,
} from "./lattePhpExtensionFunctions";

function offsetOf(source: string, needle: string, start = 0): number {
  const index = source.indexOf(needle, start);

  if (index < 0) {
    throw new Error(`needle not found in source: ${needle}`);
  }

  return index;
}

describe("LATTE_BUILTIN_FUNCTIONS", () => {
  it("lists the documented Latte 3 builtin functions", () => {
    expect(LATTE_BUILTIN_FUNCTIONS).toEqual([
      "clamp",
      "divisibleBy",
      "even",
      "first",
      "group",
      "hasBlock",
      "hasTemplate",
      "last",
      "odd",
      "slice",
    ]);
  });
});

describe("lattePhpExtensionFunctionsFromSource", () => {
  it("extracts string keys from a getFunctions array return", () => {
    const source = [
      "<?php",
      "",
      "final class ProjectLatteExtension extends Latte\\Extension",
      "{",
      "    public function getFunctions(): array",
      "    {",
      "        return [",
      "            'isEven' => [$this, 'isEvenNumber'],",
      "            \"money\" => [MoneyFunctions::class, 'format'],",
      "        ];",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFunctionsFromSource(source)).toEqual([
      {
        callableKind: "instance",
        className: "ProjectLatteExtension",
        methodName: "isEvenNumber",
        name: "isEven",
        offset: offsetOf(source, "isEven"),
        serviceClassName: "ProjectLatteExtension",
      },
      {
        callableKind: "static",
        callableOffset: offsetOf(
          source,
          "format",
          offsetOf(source, "MoneyFunctions"),
        ),
        className: "MoneyFunctions",
        methodName: "format",
        name: "money",
        offset: offsetOf(source, "money"),
        serviceClassName: "MoneyFunctions",
      },
    ]);
  });

  it("ignores getFilters maps and requires an array return type", () => {
    const source = [
      "<?php",
      "",
      "final class ProjectLatteExtension extends Latte\\Extension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        return ['filterOnly' => [$this, 'filterOnly']];",
      "    }",
      "",
      "    public function getFunctions()",
      "    {",
      "        return ['missingType' => [$this, 'format']];",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFunctionsFromSource(source)).toEqual([]);
  });

  it("extracts addFunction registrations with $this callables", () => {
    const source = [
      "<?php",
      "namespace App\\Latte;",
      "",
      "final class TemplateFactory",
      "{",
      "    public function create(Latte\\Engine $latte): void",
      "    {",
      "        $latte->addFunction('money', [$this, 'formatMoney']);",
      "    }",
      "",
      "    public function formatMoney(float $value): string",
      "    {",
      "        return '';",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFunctionsFromSource(source)).toEqual([
      {
        callableKind: "instance",
        callableOffset: offsetOf(
          source,
          "formatMoney",
          offsetOf(source, "function formatMoney"),
        ),
        className: "App\\Latte\\TemplateFactory",
        methodName: "formatMoney",
        name: "money",
        offset: offsetOf(source, "money"),
        serviceClassName: "App\\Latte\\TemplateFactory",
      },
    ]);
  });

  it("extracts addFunction registrations with class-string callables", () => {
    const source = [
      "<?php",
      "",
      "$latte->addFunction('money', [\\App\\Latte\\MoneyFunctions::class, 'format']);",
      "",
    ].join("\n");

    expect(lattePhpExtensionFunctionsFromSource(source)).toEqual([
      {
        callableKind: "static",
        callableOffset: offsetOf(source, "format'"),
        className: "\\App\\Latte\\MoneyFunctions",
        methodName: "format",
        name: "money",
        offset: offsetOf(source, "money"),
        serviceClassName: "App\\Latte\\MoneyFunctions",
      },
    ]);
  });

  it("keeps the call site for closure, arrow, and first-class callables", () => {
    const source = [
      "<?php",
      "",
      "$latte->addFunction('shuffled', function (array $values): array {",
      "    return $values;",
      "});",
      "$latte->addFunction('doubled', fn(int $value): int => $value * 2);",
      "$latte->addFunction('reversed', strrev(...));",
      "",
    ].join("\n");

    expect(lattePhpExtensionFunctionsFromSource(source)).toEqual([
      { name: "shuffled", offset: offsetOf(source, "shuffled") },
      { name: "doubled", offset: offsetOf(source, "doubled") },
      { name: "reversed", offset: offsetOf(source, "reversed") },
    ]);
  });

  it("ignores commented, string-embedded, and dynamic addFunction names", () => {
    const source = [
      "<?php",
      "",
      "// $latte->addFunction('commented', fn() => null);",
      "$example = \"\\$latte->addFunction('embedded', fn() => null);\";",
      "$latte->addFunction($dynamicName, fn() => null);",
      "$latte->addFunction('', fn() => null);",
      "$latte->addFunction('kept', fn() => null);",
      "",
    ].join("\n");

    expect(lattePhpExtensionFunctionsFromSource(source)).toEqual([
      { name: "kept", offset: offsetOf(source, "kept") },
    ]);
  });

  it("combines getFunctions map entries with addFunction call sites", () => {
    const source = [
      "<?php",
      "",
      "final class ProjectLatteExtension extends Latte\\Extension",
      "{",
      "    public function getFunctions(): array",
      "    {",
      "        return [",
      "            'fromMap' => [$this, 'fromMap'],",
      "        ];",
      "    }",
      "",
      "    public function boot(Latte\\Engine $latte): void",
      "    {",
      "        $latte->addFunction('fromCall', fn() => null);",
      "    }",
      "",
      "    public function fromMap(): string",
      "    {",
      "        return '';",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFunctionsFromSource(source)).toEqual([
      {
        callableKind: "instance",
        callableOffset: offsetOf(
          source,
          "fromMap",
          offsetOf(source, "function fromMap"),
        ),
        className: "ProjectLatteExtension",
        methodName: "fromMap",
        name: "fromMap",
        offset: offsetOf(source, "fromMap"),
        serviceClassName: "ProjectLatteExtension",
      },
      { name: "fromCall", offset: offsetOf(source, "fromCall") },
    ]);
  });
});
