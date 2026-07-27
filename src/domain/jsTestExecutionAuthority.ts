export const MAX_JS_TEST_PACKAGE_ROOT_BYTES = 4_096;

export interface JsTestExecutionAuthority {
  readonly packageRootRelativePath: string;
}

export function validatedJsTestExecutionAuthority(
  authority: JsTestExecutionAuthority,
): JsTestExecutionAuthority {
  if (!authority || typeof authority !== "object") {
    throw new TypeError("JavaScript test execution authority must be an object.");
  }
  const packageRootRelativePath = validatedJsTestPackageRootRelativePath(
    authority.packageRootRelativePath,
  );
  return Object.freeze({ packageRootRelativePath });
}

export function validatedJsTestPackageRootRelativePath(value: string): string {
  if (typeof value !== "string" || !isWellFormedUnicode(value)) {
    throw new TypeError("JavaScript test package root must be a valid UTF-8 path.");
  }
  const normalized = value.trim().split("\\").join("/");
  if (
    new TextEncoder().encode(normalized).byteLength > MAX_JS_TEST_PACKAGE_ROOT_BYTES ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "." || segment === "..") ||
    (normalized !== "" && normalized.split("/").some((segment) => segment === ""))
  ) {
    throw new TypeError("JavaScript test package root must be a workspace-confined relative path.");
  }
  return normalized;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}
