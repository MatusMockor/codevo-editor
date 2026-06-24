import { describe, expect, it } from "vitest";

import {
  phpLaravelDispatchTargetAt,
  phpLaravelEventListenerMap,
} from "./phpLaravelDispatch";

function offsetOf(source: string, needle: string, delta = 0): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`needle not found: ${needle}`);
  }

  return index + delta;
}

describe("phpLaravelDispatchTargetAt — Job dispatch", () => {
  it("detects a static SomeJob::dispatch(...) call as an ambiguous dispatch", () => {
    // A bare static ::dispatch is ambiguous between Job and Event (both use the
    // Dispatchable trait). The integration layer resolves it: an event when the
    // class is in the EventServiceProvider $listen map, otherwise a job handle.
    const source = `<?php
ProcessPodcast::dispatch($podcast);
`;
    const target = phpLaravelDispatchTargetAt(
      source,
      offsetOf(source, "ProcessPodcast", 2),
    );

    expect(target).toEqual({ className: "ProcessPodcast", kind: "dispatch" });
  });

  it("detects a static dispatch call when the cursor is on the dispatch method", () => {
    const source = `<?php
ProcessPodcast::dispatch($podcast);
`;
    const target = phpLaravelDispatchTargetAt(
      source,
      offsetOf(source, "::dispatch", 4),
    );

    expect(target).toEqual({ className: "ProcessPodcast", kind: "dispatch" });
  });

  it("detects the dispatch(new SomeJob(...)) helper and extracts the job class", () => {
    const source = `<?php
dispatch(new ProcessPodcast($podcast));
`;
    const target = phpLaravelDispatchTargetAt(
      source,
      offsetOf(source, "ProcessPodcast", 2),
    );

    expect(target).toEqual({ className: "ProcessPodcast", kind: "job" });
  });

  it("detects the dispatch helper when the cursor is on the dispatch identifier", () => {
    const source = `<?php
dispatch(new ProcessPodcast($podcast));
`;
    const target = phpLaravelDispatchTargetAt(
      source,
      offsetOf(source, "dispatch(", 1),
    );

    expect(target).toEqual({ className: "ProcessPodcast", kind: "job" });
  });

  it("detects SomeJob::dispatchSync / dispatchAfterResponse variants", () => {
    const source = `<?php
ProcessPodcast::dispatchSync($podcast);
`;
    const target = phpLaravelDispatchTargetAt(
      source,
      offsetOf(source, "ProcessPodcast", 2),
    );

    expect(target).toEqual({ className: "ProcessPodcast", kind: "job" });
  });

  it("preserves a namespaced job class reference", () => {
    const source = `<?php
Jobs\\ProcessPodcast::dispatchSync($podcast);
`;
    const target = phpLaravelDispatchTargetAt(
      source,
      offsetOf(source, "ProcessPodcast", 2),
    );

    expect(target).toEqual({
      className: "Jobs\\ProcessPodcast",
      kind: "job",
    });
  });

  it("ignores a static call to a non-dispatch method", () => {
    const source = `<?php
ProcessPodcast::handle($podcast);
`;
    const target = phpLaravelDispatchTargetAt(
      source,
      offsetOf(source, "ProcessPodcast", 2),
    );

    expect(target).toBeNull();
  });

  it("ignores dispatch helper without a new-expression argument", () => {
    const source = `<?php
dispatch($job);
`;
    const target = phpLaravelDispatchTargetAt(
      source,
      offsetOf(source, "dispatch", 1),
    );

    expect(target).toBeNull();
  });
});

describe("phpLaravelDispatchTargetAt — Event dispatch", () => {
  it("detects the event(new SomeEvent(...)) helper and extracts the event class", () => {
    const source = `<?php
event(new OrderShipped($order));
`;
    const target = phpLaravelDispatchTargetAt(
      source,
      offsetOf(source, "OrderShipped", 2),
    );

    expect(target).toEqual({ className: "OrderShipped", kind: "event" });
  });

  it("detects the event helper when the cursor is on the event identifier", () => {
    const source = `<?php
event(new OrderShipped($order));
`;
    const target = phpLaravelDispatchTargetAt(
      source,
      offsetOf(source, "event(", 1),
    );

    expect(target).toEqual({ className: "OrderShipped", kind: "event" });
  });

  it("detects a static SomeEvent::dispatch(...) call as an event", () => {
    const source = `<?php
OrderShipped::dispatch($order);
`;
    const target = phpLaravelDispatchTargetAt(
      source,
      offsetOf(source, "OrderShipped", 2),
    );

    // A bare static ::dispatch is ambiguous between Job and Event. The
    // integration layer resolves it: it is an event only when the class appears
    // in the EventServiceProvider $listen map. The detector reports it as a
    // dispatch with class so the integration can try both.
    expect(target).toEqual({ className: "OrderShipped", kind: "dispatch" });
  });

  it("detects Event::dispatch(new SomeEvent(...)) facade calls", () => {
    const source = `<?php
Event::dispatch(new OrderShipped($order));
`;
    const target = phpLaravelDispatchTargetAt(
      source,
      offsetOf(source, "OrderShipped", 2),
    );

    expect(target).toEqual({ className: "OrderShipped", kind: "event" });
  });

  it("ignores an unrelated function call argument", () => {
    const source = `<?php
report(new OrderShipped($order));
`;
    const target = phpLaravelDispatchTargetAt(
      source,
      offsetOf(source, "OrderShipped", 2),
    );

    expect(target).toBeNull();
  });
});

describe("phpLaravelEventListenerMap", () => {
  it("parses a single event mapped to a single listener", () => {
    const source = `<?php

namespace App\\Providers;

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        OrderShipped::class => [
            SendShipmentNotification::class,
        ],
    ];
}
`;
    const map = phpLaravelEventListenerMap(source);

    expect(map.get("OrderShipped")).toEqual(["SendShipmentNotification"]);
  });

  it("parses multiple listeners for one event preserving order", () => {
    const source = `<?php

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        OrderShipped::class => [
            SendShipmentNotification::class,
            UpdateInventory::class,
            NotifyWarehouse::class,
        ],
    ];
}
`;
    const map = phpLaravelEventListenerMap(source);

    expect(map.get("OrderShipped")).toEqual([
      "SendShipmentNotification",
      "UpdateInventory",
      "NotifyWarehouse",
    ]);
  });

  it("parses multiple events", () => {
    const source = `<?php

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        OrderShipped::class => [
            SendShipmentNotification::class,
        ],
        UserRegistered::class => [
            SendWelcomeEmail::class,
        ],
    ];
}
`;
    const map = phpLaravelEventListenerMap(source);

    expect(map.get("OrderShipped")).toEqual(["SendShipmentNotification"]);
    expect(map.get("UserRegistered")).toEqual(["SendWelcomeEmail"]);
  });

  it("preserves fully-qualified event and listener class references", () => {
    const source = `<?php

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        \\App\\Events\\OrderShipped::class => [
            \\App\\Listeners\\SendShipmentNotification::class,
        ],
    ];
}
`;
    const map = phpLaravelEventListenerMap(source);

    expect(map.get("App\\Events\\OrderShipped")).toEqual([
      "App\\Listeners\\SendShipmentNotification",
    ]);
  });

  it("returns an empty map when there is no $listen property", () => {
    const source = `<?php

class EventServiceProvider extends ServiceProvider
{
    protected $subscribe = [];
}
`;
    const map = phpLaravelEventListenerMap(source);

    expect(map.size).toBe(0);
  });

  it("parses an array() listener list", () => {
    const source = `<?php

class EventServiceProvider extends ServiceProvider
{
    protected $listen = array(
        OrderShipped::class => array(
            SendShipmentNotification::class,
            UpdateInventory::class,
        ),
    );
}
`;
    const map = phpLaravelEventListenerMap(source);

    expect(map.get("OrderShipped")).toEqual([
      "SendShipmentNotification",
      "UpdateInventory",
    ]);
  });

  it("ignores comments inside the listen map", () => {
    const source = `<?php

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        // legacy, important => mapping
        OrderShipped::class => [
            SendShipmentNotification::class, // primary, urgent listener
            UpdateInventory::class,
        ],
    ];
}
`;
    const map = phpLaravelEventListenerMap(source);

    expect(map.get("OrderShipped")).toEqual([
      "SendShipmentNotification",
      "UpdateInventory",
    ]);
  });

  it("ignores non-::class array entries conservatively", () => {
    const source = `<?php

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        'order.shipped' => [
            'someListenerString',
        ],
    ];
}
`;
    const map = phpLaravelEventListenerMap(source);

    expect(map.size).toBe(0);
  });
});
