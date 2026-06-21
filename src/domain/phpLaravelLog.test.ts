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
      ["#[Log('slack')]\nclass LoggerConsumer {}", "#[Log]"],
      [
        "#[\\Illuminate\\Container\\Attributes\\Log(channel: 'slack')]\nclass LoggerConsumer {}",
        "#[Log]",
      ],
    ] as const;

    for (const [expression, call] of samples) {
      const imports = expression.startsWith("#[Log(")
        ? "use Illuminate\\Container\\Attributes\\Log;\n\n"
        : "";
      const source = `<?php\n\n${imports}return ${expression};\n`;

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

    const aliasedAttribute = `<?php

use Illuminate\\Container\\Attributes\\Log as LogChannel;

#[LogChannel('slack')]
class LoggerConsumer {}
`;

    expect(
      phpLaravelLogChannelReferenceContextAt(
        aliasedAttribute,
        positionAfter(aliasedAttribute, "slack"),
      ),
    ).toMatchObject({
      call: "#[Log]",
      channelName: "slack",
      prefix: "slack",
    });
  });

  it("detects Laravel Log stack channel array strings", () => {
    const source = `<?php

Log::stack(['single', 'slack']);
Log::stack(channels: ['daily']);
`;

    expect(
      phpLaravelLogChannelReferenceContextAt(
        source,
        positionAfter(source, "single"),
      ),
    ).toMatchObject({
      call: "Log::stack",
      channelName: "single",
      prefix: "single",
    });
    expect(
      phpLaravelLogChannelReferenceContextAt(
        source,
        positionAfter(source, "slack"),
      ),
    ).toMatchObject({
      call: "Log::stack",
      channelName: "slack",
      prefix: "slack",
    });
    expect(
      phpLaravelLogChannelReferenceContextAt(
        source,
        positionAfter(source, "daily"),
      ),
    ).toMatchObject({
      call: "Log::stack",
      channelName: "daily",
      prefix: "daily",
    });
  });

  it("ignores unsupported arguments, interpolation, invalid names, and non-log calls", () => {
    const secondArgument = `<?php\n\nLog::channel(null, 'slack');\n`;
    const interpolated = `<?php\n\nLog::channel("sla$ck");\n`;
    const invalid = `<?php\n\nLog::channel('slack/main');\n`;
    const wrongCall = `<?php\n\nMail::mailer('slack');\n`;
    const stackName = `<?php\n\nLog::stack(['single'], 'slack');\n`;
    const stackNamedChannel = `<?php\n\nLog::stack(['single'], channel: 'slack');\n`;
    const stackKey = `<?php\n\nLog::stack(['slack' => true]);\n`;
    const stackWrongNamedArg = `<?php\n\nLog::stack(name: ['slack']);\n`;
    const wrongAttributeArgument = `<?php\n\nuse Illuminate\\Container\\Attributes\\Log;\n\n#[Log(name: 'slack')]\nclass LoggerConsumer {}\n`;
    const nestedAttributeCall = `<?php\n\n#[Example(Log('slack'))]\nclass LoggerConsumer {}\n`;
    const foreignAttribute = `<?php\n\nuse App\\Attributes\\Log;\n\n#[Log('slack')]\nclass LoggerConsumer {}\n`;

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
    expect(
      phpLaravelLogChannelReferenceContextAt(
        stackName,
        positionAfter(stackName, "slack"),
      ),
    ).toBeNull();
    expect(
      phpLaravelLogChannelReferenceContextAt(
        stackNamedChannel,
        positionAfter(stackNamedChannel, "slack"),
      ),
    ).toBeNull();
    expect(
      phpLaravelLogChannelReferenceContextAt(
        stackKey,
        positionAfter(stackKey, "slack"),
      ),
    ).toBeNull();
    expect(
      phpLaravelLogChannelReferenceContextAt(
        stackWrongNamedArg,
        positionAfter(stackWrongNamedArg, "slack"),
      ),
    ).toBeNull();
    expect(
      phpLaravelLogChannelReferenceContextAt(
        wrongAttributeArgument,
        positionAfter(wrongAttributeArgument, "slack"),
      ),
    ).toBeNull();
    expect(
      phpLaravelLogChannelReferenceContextAt(
        nestedAttributeCall,
        positionAfter(nestedAttributeCall, "slack"),
      ),
    ).toBeNull();
    expect(
      phpLaravelLogChannelReferenceContextAt(
        foreignAttribute,
        positionAfter(foreignAttribute, "slack"),
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
