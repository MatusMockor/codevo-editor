import { describe, expect, it } from "vitest";
import {
  isUsableLaravelLogChannelName,
  phpLaravelLogChannelCompletionInsertText,
  phpLaravelLogChannelConfigKey,
  phpLaravelLogChannelNameFromConfigKey,
  phpLaravelLogChannelReferenceContextAt,
} from "./phpLaravelLog";

describe("phpLaravelLog", () => {
  it("detects supported Laravel Log channel strings", () => {
    const samples = [
      ["Log::channel('slack')", "Log::channel"],
      ["Log::driver('slack')", "Log::driver"],
      ["Log::channel(name: 'slack')", "Log::channel"],
      ["Log::driver(driver: 'slack')", "Log::driver"],
    ] as const;

    for (const [expression, call] of samples) {
      const source = `<?php\n\nreturn ${expression};\n`;

      expect(
        phpLaravelLogChannelReferenceContextAt(
          source,
          positionAfter(source, "slack"),
        ),
      ).toMatchObject({
        call,
        channelName: "slack",
        prefix: "slack",
      });
    }
  });

  it("ignores unsupported arguments, interpolation, invalid names, and non-log calls", () => {
    const secondArgument = `<?php\n\nLog::channel(null, 'slack');\n`;
    const interpolated = `<?php\n\nLog::channel("sla$ck");\n`;
    const invalid = `<?php\n\nLog::channel('slack/main');\n`;
    const wrongCall = `<?php\n\nMail::mailer('slack');\n`;

    expect(
      phpLaravelLogChannelReferenceContextAt(
        secondArgument,
        positionAfter(secondArgument, "slack"),
      ),
    ).toBeNull();
    expect(
      phpLaravelLogChannelReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "sla"),
      ),
    ).toBeNull();
    expect(
      phpLaravelLogChannelReferenceContextAt(
        invalid,
        positionAfter(invalid, "slack"),
      ),
    ).toBeNull();
    expect(
      phpLaravelLogChannelReferenceContextAt(
        wrongCall,
        positionAfter(wrongCall, "slack"),
      ),
    ).toBeNull();
  });

  it("maps log channel names to logging config keys", () => {
    expect(phpLaravelLogChannelConfigKey("slack")).toBe(
      "logging.channels.slack",
    );
    expect(phpLaravelLogChannelNameFromConfigKey("logging.channels.daily")).toBe(
      "daily",
    );
    expect(
      phpLaravelLogChannelNameFromConfigKey("logging.channels.slack.driver"),
    ).toBe(null);
    expect(phpLaravelLogChannelNameFromConfigKey("logging.default")).toBe(null);
    expect(isUsableLaravelLogChannelName("slack-alerts")).toBe(true);
    expect(isUsableLaravelLogChannelName("slack/alerts")).toBe(false);
  });

  it("uses whole channel-name insert text", () => {
    expect(phpLaravelLogChannelCompletionInsertText("slack")).toBe("slack");
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
