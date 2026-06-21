import { describe, expect, it } from "vitest";
import {
  isUsableLaravelPasswordBrokerName,
  phpLaravelPasswordBrokerCompletionInsertText,
  phpLaravelPasswordBrokerConfigKey,
  phpLaravelPasswordBrokerNameFromConfigKey,
  phpLaravelPasswordBrokerReferenceContextAt,
} from "./phpLaravelPassword";

describe("phpLaravelPassword", () => {
  it("detects supported Laravel Password broker strings", () => {
    const samples = [
      ["Password::broker('admins')", "Password::broker"],
      ["Password::setDefaultDriver('admins')", "Password::setDefaultDriver"],
      ["Password::broker(name: 'admins')", "Password::broker"],
      [
        "Password::setDefaultDriver(name: 'admins')",
        "Password::setDefaultDriver",
      ],
    ] as const;

    for (const [expression, call] of samples) {
      const source = `<?php\n\nreturn ${expression};\n`;

      expect(
        phpLaravelPasswordBrokerReferenceContextAt(
          source,
          positionAfter(source, "admins"),
        ),
      ).toMatchObject({
        brokerName: "admins",
        call,
        prefix: "admins",
      });
    }
  });

  it("ignores unsupported arguments, interpolation, invalid names, and non-password calls", () => {
    const secondArgument = `<?php\n\nPassword::broker(null, 'admins');\n`;
    const wrongNamedArgument = `<?php\n\nPassword::broker(broker: 'admins');\n`;
    const sendResetLink = `<?php\n\nPassword::sendResetLink('admins');\n`;
    const interpolated = `<?php\n\nPassword::broker("ad$mins");\n`;
    const invalid = `<?php\n\nPassword::broker('admins/web');\n`;
    const wrongFacade = `<?php\n\nAuth::guard('admins');\n`;
    const memberBroker = `<?php\n\n$passwords->broker('admins');\n`;

    expect(
      phpLaravelPasswordBrokerReferenceContextAt(
        secondArgument,
        positionAfter(secondArgument, "admins"),
      ),
    ).toBeNull();
    expect(
      phpLaravelPasswordBrokerReferenceContextAt(
        wrongNamedArgument,
        positionAfter(wrongNamedArgument, "admins"),
      ),
    ).toBeNull();
    expect(
      phpLaravelPasswordBrokerReferenceContextAt(
        sendResetLink,
        positionAfter(sendResetLink, "admins"),
      ),
    ).toBeNull();
    expect(
      phpLaravelPasswordBrokerReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "ad"),
      ),
    ).toBeNull();
    expect(
      phpLaravelPasswordBrokerReferenceContextAt(
        invalid,
        positionAfter(invalid, "admins"),
      ),
    ).toBeNull();
    expect(
      phpLaravelPasswordBrokerReferenceContextAt(
        wrongFacade,
        positionAfter(wrongFacade, "admins"),
      ),
    ).toBeNull();
    expect(
      phpLaravelPasswordBrokerReferenceContextAt(
        memberBroker,
        positionAfter(memberBroker, "admins"),
      ),
    ).toBeNull();
  });

  it("maps broker names to auth config keys", () => {
    expect(phpLaravelPasswordBrokerConfigKey("admins")).toBe(
      "auth.passwords.admins",
    );
    expect(phpLaravelPasswordBrokerNameFromConfigKey("auth.passwords.users")).toBe(
      "users",
    );
    expect(
      phpLaravelPasswordBrokerNameFromConfigKey("auth.passwords.users.provider"),
    ).toBe(null);
    expect(phpLaravelPasswordBrokerNameFromConfigKey("auth.guards.web")).toBe(
      null,
    );
    expect(isUsableLaravelPasswordBrokerName("admins-web")).toBe(true);
    expect(isUsableLaravelPasswordBrokerName("admins/web")).toBe(false);
  });

  it("uses whole broker-name insert text", () => {
    expect(phpLaravelPasswordBrokerCompletionInsertText("admins")).toBe(
      "admins",
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
