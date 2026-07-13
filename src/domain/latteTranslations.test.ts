import { describe, expect, it } from "vitest";
import { latteTranslationReferenceAt } from "./latteTranslations";

describe("latteTranslationReferenceAt", () => {
  it("detects a Nette underscore translate macro string", () => {
    const source = "{_'users.component.user_tokens.header'}";
    const offset = source.indexOf("user_tokens") + "user_tokens".length;

    expect(latteTranslationReferenceAt(source, offset)).toEqual({
      key: "users.component.user_tokens.header",
      prefix: "users.component.user_tokens",
      replaceEnd: source.indexOf("'}"),
      replaceStart: source.indexOf("'") + 1,
    });
  });

  it("detects the long translate macro string", () => {
    const source = '{translate "users.component.user_tokens.header"}';
    const offset = source.indexOf("users.component") + "users.component".length;

    expect(latteTranslationReferenceAt(source, offset)).toMatchObject({
      key: "users.component.user_tokens.header",
      prefix: "users.component",
    });
  });

  it("ignores masked comments and dynamic keys", () => {
    expect(
      latteTranslationReferenceAt(
        "{* {_'users.component.user_tokens.header'} *}",
        7,
      ),
    ).toBeNull();
    expect(latteTranslationReferenceAt("{_$dynamic}", 3)).toBeNull();
  });
});
