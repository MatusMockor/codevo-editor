import { describe, expect, it } from "vitest";
import type { Psr4Root } from "./workspace";
import {
  phpTestClassPlan,
  renderPhpTestSkeleton,
  type PhpTestClassPlan,
} from "./phpTestGen";

function psr4(
  namespace: string,
  paths: string[],
  dev = false,
): Psr4Root {
  return { dev, namespace, paths };
}

const APP_ROOT = psr4("App\\", ["app/"]);
const TESTS_DEV_ROOT = psr4("Tests\\", ["tests/"], true);

describe("phpTestClassPlan", () => {
  it("derives a Tests\\Unit plan that preserves the sub-namespace for a Laravel project", () => {
    const plan = phpTestClassPlan({
      source: "<?php\n\nnamespace App\\Services;\n\nclass InvoiceService\n{\n    public function calculate(): int\n    {\n        return 0;\n    }\n}\n",
      psr4Roots: [APP_ROOT, TESTS_DEV_ROOT],
    });

    expect(plan).not.toBeNull();
    expect(plan?.testClassName).toBe("InvoiceServiceTest");
    expect(plan?.testNamespace).toBe("Tests\\Unit\\Services");
    expect(plan?.relativePath).toBe("tests/Unit/Services/InvoiceServiceTest.php");
    expect(plan?.baseClassFqn).toBe("Tests\\TestCase");
    expect(plan?.methodNames).toEqual(["calculate"]);
  });

  it("uses the root tests/Unit directory for a class directly under the source namespace", () => {
    const plan = phpTestClassPlan({
      source: "<?php\n\nnamespace App;\n\nclass Kernel\n{\n    public function handle(): void {}\n}\n",
      psr4Roots: [APP_ROOT, TESTS_DEV_ROOT],
    });

    expect(plan?.testNamespace).toBe("Tests\\Unit");
    expect(plan?.relativePath).toBe("tests/Unit/KernelTest.php");
  });

  it("falls back to PHPUnit's TestCase and a synthesized Tests\\Unit namespace when no Tests dev root exists", () => {
    const plan = phpTestClassPlan({
      source: "<?php\n\nnamespace App\\Services;\n\nclass InvoiceService\n{\n    public function calculate(): int\n    {\n        return 0;\n    }\n}\n",
      psr4Roots: [APP_ROOT],
    });

    expect(plan?.testNamespace).toBe("Tests\\Unit\\Services");
    expect(plan?.relativePath).toBe("tests/Unit/Services/InvoiceServiceTest.php");
    expect(plan?.baseClassFqn).toBe("PHPUnit\\Framework\\TestCase");
  });

  it("only includes public, non-static, non-magic methods", () => {
    const source = [
      "<?php",
      "",
      "namespace App\\Services;",
      "",
      "class InvoiceService",
      "{",
      "    public function __construct() {}",
      "    public function calculate(): int { return 0; }",
      "    public static function make(): self { return new self(); }",
      "    protected function helper(): void {}",
      "    private function secret(): void {}",
      "    public function refund(): bool { return true; }",
      "}",
      "",
    ].join("\n");

    const plan = phpTestClassPlan({ source, psr4Roots: [APP_ROOT] });

    expect(plan?.methodNames).toEqual(["calculate", "refund"]);
  });

  it("returns null when the source is not a class", () => {
    expect(
      phpTestClassPlan({
        source: "<?php\n\nnamespace App\\Contracts;\n\ninterface InvoiceContract {}\n",
        psr4Roots: [APP_ROOT],
      }),
    ).toBeNull();
  });

  it("returns null when the class has no public instance methods", () => {
    const source = [
      "<?php",
      "",
      "namespace App\\Services;",
      "",
      "class InvoiceService",
      "{",
      "    private function secret(): void {}",
      "}",
      "",
    ].join("\n");

    expect(phpTestClassPlan({ source, psr4Roots: [APP_ROOT] })).toBeNull();
  });

  it("returns null when no PSR-4 root matches the source FQN", () => {
    expect(
      phpTestClassPlan({
        source: "<?php\n\nnamespace Acme\\Lib;\n\nclass Widget\n{\n    public function run(): void {}\n}\n",
        psr4Roots: [APP_ROOT],
      }),
    ).toBeNull();
  });
});

describe("renderPhpTestSkeleton", () => {
  function laravelPlan(): PhpTestClassPlan {
    return {
      baseClassFqn: "Tests\\TestCase",
      methodNames: ["calculate", "refund"],
      relativePath: "tests/Unit/Services/InvoiceServiceTest.php",
      sourceClassName: "InvoiceService",
      testClassName: "InvoiceServiceTest",
      testNamespace: "Tests\\Unit\\Services",
    };
  }

  it("renders a valid PHPUnit skeleton extending Tests\\TestCase", () => {
    const rendered = renderPhpTestSkeleton(laravelPlan());

    expect(rendered).toContain("<?php");
    expect(rendered).toContain("declare(strict_types=1);");
    expect(rendered).toContain("namespace Tests\\Unit\\Services;");
    expect(rendered).toContain("use Tests\\TestCase;");
    expect(rendered).toContain(
      "class InvoiceServiceTest extends TestCase",
    );
    expect(rendered).toContain(
      "    public function testCalculate(): void\n    {\n        $this->markTestIncomplete();\n    }",
    );
    expect(rendered).toContain("public function testRefund(): void");
    expect(rendered.endsWith("}\n")).toBe(true);
  });

  it("imports PHPUnit's TestCase when that is the base class", () => {
    const rendered = renderPhpTestSkeleton({
      ...laravelPlan(),
      baseClassFqn: "PHPUnit\\Framework\\TestCase",
    });

    expect(rendered).toContain("use PHPUnit\\Framework\\TestCase;");
    expect(rendered).toContain("extends TestCase");
  });
});
