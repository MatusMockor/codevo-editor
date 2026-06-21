import { describe, expect, it } from "vitest";
import {
  isUsableLaravelBroadcastConnectionName,
  phpLaravelBroadcastConnectionCompletionInsertText,
  phpLaravelBroadcastConnectionConfigKey,
  phpLaravelBroadcastConnectionNameFromConfigKey,
  phpLaravelBroadcastConnectionReferenceContextAt,
} from "./phpLaravelBroadcasting";

describe("phpLaravelBroadcasting", () => {
  it("detects supported Laravel Broadcast connection strings", () => {
    const samples = [
      ["Broadcast::connection('pusher')", "Broadcast::connection"],
      ["Broadcast::driver('pusher')", "Broadcast::driver"],
      ["Broadcast::purge('pusher')", "Broadcast::purge"],
      ["Broadcast::setDefaultDriver('pusher')", "Broadcast::setDefaultDriver"],
      ["broadcast(new OrderUpdated())->via('pusher')", "via"],
      ["broadcast_if($ok, new OrderUpdated())->via('pusher')", "via"],
      ["broadcast_unless($skip, new OrderUpdated())->via('pusher')", "via"],
      ["Broadcast::event(new OrderUpdated())->via('pusher')", "via"],
      ["Broadcast::on('orders.1')->via('pusher')", "via"],
      ["Broadcast::private('orders.1')->via('pusher')", "via"],
      ["Broadcast::presence('orders.1')->via('pusher')", "via"],
      ["$this->broadcastVia('pusher')", "broadcastVia"],
      ["self::broadcastVia('pusher')", "broadcastVia"],
      ["Broadcast::connection(connection: 'pusher')", "Broadcast::connection"],
      ["Broadcast::driver(driver: 'pusher')", "Broadcast::driver"],
      ["Broadcast::purge(name: 'pusher')", "Broadcast::purge"],
      ["broadcast(new OrderUpdated())->via(connection: 'pusher')", "via"],
      [
        "Broadcast::setDefaultDriver(name: 'pusher')",
        "Broadcast::setDefaultDriver",
      ],
    ] as const;

    for (const [expression, call] of samples) {
      const source = `<?php\n\nreturn ${expression};\n`;

      expect(
        phpLaravelBroadcastConnectionReferenceContextAt(
          source,
          positionAfter(source, "pusher"),
        ),
      ).toMatchObject({
        call,
        connectionName: "pusher",
        prefix: "pusher",
      });
    }
  });

  it("detects Laravel broadcastVia connection array strings", () => {
    const source = `<?php

$this->broadcastVia(['pusher', 'reverb']);
$this->broadcastVia(connection: ['pusher']);
`;

    expect(
      phpLaravelBroadcastConnectionReferenceContextAt(
        source,
        positionAfter(source, "pusher"),
      ),
    ).toMatchObject({
      call: "broadcastVia",
      connectionName: "pusher",
      prefix: "pusher",
    });
    expect(
      phpLaravelBroadcastConnectionReferenceContextAt(
        source,
        positionAfter(source, "reverb"),
      ),
    ).toMatchObject({
      call: "broadcastVia",
      connectionName: "reverb",
      prefix: "reverb",
    });
  });

  it("ignores unsupported arguments, interpolation, invalid names, and non-broadcast calls", () => {
    const secondArgument = `<?php\n\nBroadcast::connection(null, 'pusher');\n`;
    const interpolated = `<?php\n\nBroadcast::connection("push$er");\n`;
    const invalid = `<?php\n\nBroadcast::connection('pusher/main');\n`;
    const wrongCall = `<?php\n\nQueue::connection('pusher');\n`;
    const unrelatedVia = `<?php\n\nHttp::withOptions([])->via('pusher');\n`;
    const broadcastOn = `<?php\n\nBroadcast::on('pusher');\n`;
    const arrayKey = `<?php\n\n$this->broadcastVia(['pusher' => true]);\n`;
    const arrayWrongArg = `<?php\n\n$this->broadcastVia(name: ['pusher']);\n`;

    expect(
      phpLaravelBroadcastConnectionReferenceContextAt(
        secondArgument,
        positionAfter(secondArgument, "pusher"),
      ),
    ).toBeNull();
    expect(
      phpLaravelBroadcastConnectionReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "push"),
      ),
    ).toBeNull();
    expect(
      phpLaravelBroadcastConnectionReferenceContextAt(
        invalid,
        positionAfter(invalid, "pusher"),
      ),
    ).toBeNull();
    expect(
      phpLaravelBroadcastConnectionReferenceContextAt(
        wrongCall,
        positionAfter(wrongCall, "pusher"),
      ),
    ).toBeNull();
    expect(
      phpLaravelBroadcastConnectionReferenceContextAt(
        unrelatedVia,
        positionAfter(unrelatedVia, "pusher"),
      ),
    ).toBeNull();
    expect(
      phpLaravelBroadcastConnectionReferenceContextAt(
        broadcastOn,
        positionAfter(broadcastOn, "pusher"),
      ),
    ).toBeNull();
    expect(
      phpLaravelBroadcastConnectionReferenceContextAt(
        arrayKey,
        positionAfter(arrayKey, "pusher"),
      ),
    ).toBeNull();
    expect(
      phpLaravelBroadcastConnectionReferenceContextAt(
        arrayWrongArg,
        positionAfter(arrayWrongArg, "pusher"),
      ),
    ).toBeNull();
  });

  it("maps broadcast connection names to broadcasting config keys", () => {
    expect(phpLaravelBroadcastConnectionConfigKey("pusher")).toBe(
      "broadcasting.connections.pusher",
    );
    expect(
      phpLaravelBroadcastConnectionNameFromConfigKey(
        "broadcasting.connections.reverb",
      ),
    ).toBe("reverb");
    expect(
      phpLaravelBroadcastConnectionNameFromConfigKey(
        "broadcasting.connections.pusher.driver",
      ),
    ).toBe(null);
    expect(
      phpLaravelBroadcastConnectionNameFromConfigKey("broadcasting.default"),
    ).toBe(null);
    expect(isUsableLaravelBroadcastConnectionName("pusher-eu")).toBe(true);
    expect(isUsableLaravelBroadcastConnectionName("pusher/eu")).toBe(false);
  });

  it("uses whole connection-name insert text", () => {
    expect(phpLaravelBroadcastConnectionCompletionInsertText("pusher")).toBe(
      "pusher",
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
