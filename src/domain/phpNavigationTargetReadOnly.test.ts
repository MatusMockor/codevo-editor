import { describe, expect, it } from "vitest";
import { shouldOpenPhpNavigationTargetReadOnly } from "./phpNavigationTargetReadOnly";

describe("shouldOpenPhpNavigationTargetReadOnly", () => {
  it.each([
    ["/workspace", "/workspace/vendor/acme/package/src/Service.php"],
    ["/workspace", "/workspace/packages/example/vendor/acme/Foo.php"],
    ["/workspace/", "/workspace/vendor/acme/Foo.PHP/"],
    ["C:\\workspace\\", "C:\\workspace\\vendor\\acme\\Foo.php"],
  ])("opens PHP dependency targets read-only", (rootPath, path) => {
    expect(shouldOpenPhpNavigationTargetReadOnly(rootPath, path)).toBe(true);
  });

  it("opens out-of-workspace PHP targets read-only", () => {
    expect(
      shouldOpenPhpNavigationTargetReadOnly(
        "/workspace",
        "/phpactor/stubs/Core/Core.php",
      ),
    ).toBe(true);
  });

  it.each([
    ["/workspace", "/workspace/myvendor/acme/Foo.php"],
    ["/workspace", "/workspace/Vendor/acme/Foo.php"],
    ["/workspace", "/workspace/app/Models/User.php"],
    ["/workspace", "/workspace/vendor/acme/index.ts"],
    ["/workspace", "/outside/index.js"],
  ])("keeps non-dependency or non-PHP targets editable", (rootPath, path) => {
    expect(shouldOpenPhpNavigationTargetReadOnly(rootPath, path)).toBe(false);
  });
});
