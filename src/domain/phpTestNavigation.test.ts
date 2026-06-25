import { describe, expect, it } from "vitest";
import type { Psr4Root } from "./workspace";
import {
  isPhpTestRelativePath,
  phpTestNavigationTargets,
} from "./phpTestNavigation";

function psr4(namespace: string, paths: string[], dev = false): Psr4Root {
  return { dev, namespace, paths };
}

const APP_ROOT = psr4("App\\", ["app/"]);
const TESTS_DEV_ROOT = psr4("Tests\\", ["tests/"], true);
const ROOTS = [APP_ROOT, TESTS_DEV_ROOT];

describe("isPhpTestRelativePath", () => {
  it("treats a file under the tests root as a test", () => {
    expect(
      isPhpTestRelativePath("tests/Unit/Services/InvoiceServiceTest.php", ROOTS),
    ).toBe(true);
  });

  it("treats a *Test.php file outside the tests root as a test", () => {
    expect(isPhpTestRelativePath("app/Services/FooTest.php", ROOTS)).toBe(true);
  });

  it("treats a production class as a subject (not a test)", () => {
    expect(
      isPhpTestRelativePath("app/Services/InvoiceService.php", ROOTS),
    ).toBe(false);
  });
});

describe("phpTestNavigationTargets src -> test", () => {
  it("offers both Unit and Feature candidates mirroring the sub-namespace", () => {
    const result = phpTestNavigationTargets({
      psr4Roots: ROOTS,
      relativePath: "app/Services/InvoiceService.php",
    });

    expect(result?.direction).toBe("toTest");
    expect(result?.candidates).toEqual([
      "tests/Unit/Services/InvoiceServiceTest.php",
      "tests/Feature/Services/InvoiceServiceTest.php",
    ]);
  });

  it("maps a class directly under the source root to the tests root", () => {
    const result = phpTestNavigationTargets({
      psr4Roots: ROOTS,
      relativePath: "app/Kernel.php",
    });

    expect(result?.candidates).toEqual([
      "tests/Unit/KernelTest.php",
      "tests/Feature/KernelTest.php",
    ]);
  });

  it("uses a plain tests directory when no Tests dev root exists", () => {
    const result = phpTestNavigationTargets({
      psr4Roots: [APP_ROOT],
      relativePath: "app/Services/InvoiceService.php",
    });

    expect(result?.candidates).toEqual([
      "tests/Unit/Services/InvoiceServiceTest.php",
      "tests/Feature/Services/InvoiceServiceTest.php",
    ]);
  });

  it("returns null when the source path is not under any source root", () => {
    expect(
      phpTestNavigationTargets({
        psr4Roots: ROOTS,
        relativePath: "vendor/acme/lib/Widget.php",
      }),
    ).toBeNull();
  });
});

describe("phpTestNavigationTargets test -> subject", () => {
  it("maps a Unit test back to its production class", () => {
    const result = phpTestNavigationTargets({
      psr4Roots: ROOTS,
      relativePath: "tests/Unit/Services/InvoiceServiceTest.php",
    });

    expect(result?.direction).toBe("toSubject");
    expect(result?.candidates).toEqual(["app/Services/InvoiceService.php"]);
  });

  it("maps a Feature test back to its production class", () => {
    const result = phpTestNavigationTargets({
      psr4Roots: ROOTS,
      relativePath: "tests/Feature/Http/Controllers/UserControllerTest.php",
    });

    expect(result?.candidates).toEqual([
      "app/Http/Controllers/UserController.php",
    ]);
  });

  it("maps a test directly under the tests suite root back to the source root", () => {
    const result = phpTestNavigationTargets({
      psr4Roots: ROOTS,
      relativePath: "tests/Unit/KernelTest.php",
    });

    expect(result?.candidates).toEqual(["app/Kernel.php"]);
  });

  it("handles a test placed directly under tests/ without a suite segment", () => {
    const result = phpTestNavigationTargets({
      psr4Roots: ROOTS,
      relativePath: "tests/InvoiceServiceTest.php",
    });

    expect(result?.candidates).toEqual(["app/InvoiceService.php"]);
  });

  it("returns null for a test whose name lacks the Test suffix", () => {
    expect(
      phpTestNavigationTargets({
        psr4Roots: ROOTS,
        relativePath: "tests/Unit/TestCase.php",
      }),
    ).toBeNull();
  });
});
