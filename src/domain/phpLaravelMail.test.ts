import { describe, expect, it } from "vitest";
import {
  isUsableLaravelMailMailerName,
  phpLaravelMailMailerCompletionInsertText,
  phpLaravelMailMailerConfigKey,
  phpLaravelMailMailerNameFromConfigKey,
  phpLaravelMailMailerReferenceContextAt,
} from "./phpLaravelMail";

describe("phpLaravelMail", () => {
  it("detects supported Laravel Mail mailer strings", () => {
    const samples = [
      ["Mail::mailer('postmark')", "Mail::mailer"],
      ["Mail::driver('postmark')", "Mail::driver"],
      ["Mail::purge('postmark')", "Mail::purge"],
      ["Mail::setDefaultDriver('postmark')", "Mail::setDefaultDriver"],
      ["Mail::mailer(name: 'postmark')", "Mail::mailer"],
      ["Mail::driver(driver: 'postmark')", "Mail::driver"],
      ["Mail::purge(name: 'postmark')", "Mail::purge"],
      ["Mail::setDefaultDriver(name: 'postmark')", "Mail::setDefaultDriver"],
    ] as const;

    for (const [expression, call] of samples) {
      const source = `<?php\n\nreturn ${expression};\n`;

      expect(
        phpLaravelMailMailerReferenceContextAt(
          source,
          positionAfter(source, "postmark"),
        ),
      ).toMatchObject({
        call,
        mailerName: "postmark",
        prefix: "postmark",
      });
    }
  });

  it("ignores unsupported arguments, interpolation, invalid names, and non-mail calls", () => {
    const secondArgument = `<?php\n\nMail::mailer(null, 'postmark');\n`;
    const interpolated = `<?php\n\nMail::mailer("post$mark");\n`;
    const invalid = `<?php\n\nMail::mailer('postmark/main');\n`;
    const wrongCall = `<?php\n\nCache::store('postmark');\n`;

    expect(
      phpLaravelMailMailerReferenceContextAt(
        secondArgument,
        positionAfter(secondArgument, "postmark"),
      ),
    ).toBeNull();
    expect(
      phpLaravelMailMailerReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "post"),
      ),
    ).toBeNull();
    expect(
      phpLaravelMailMailerReferenceContextAt(
        invalid,
        positionAfter(invalid, "postmark"),
      ),
    ).toBeNull();
    expect(
      phpLaravelMailMailerReferenceContextAt(
        wrongCall,
        positionAfter(wrongCall, "postmark"),
      ),
    ).toBeNull();
  });

  it("maps mailer names to mail config keys", () => {
    expect(phpLaravelMailMailerConfigKey("postmark")).toBe(
      "mail.mailers.postmark",
    );
    expect(phpLaravelMailMailerNameFromConfigKey("mail.mailers.smtp")).toBe(
      "smtp",
    );
    expect(
      phpLaravelMailMailerNameFromConfigKey("mail.mailers.postmark.transport"),
    ).toBe(null);
    expect(phpLaravelMailMailerNameFromConfigKey("mail.default")).toBe(null);
    expect(isUsableLaravelMailMailerName("smtp-us")).toBe(true);
    expect(isUsableLaravelMailMailerName("smtp/us")).toBe(false);
  });

  it("uses whole mailer-name insert text", () => {
    expect(phpLaravelMailMailerCompletionInsertText("postmark")).toBe(
      "postmark",
    );
  });
});

function positionAfter(source: string, token: string) {
  const offset = source.indexOf(token);

  if (offset < 0) {
    throw new Error(`Token not found: ${token}`);
  }

  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset + token.length; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
