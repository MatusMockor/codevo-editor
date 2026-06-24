import { describe, expect, it, vi } from "vitest";
import {
  DiagnosticsCoalescer,
  type DiagnosticsFlushScheduler,
} from "./diagnosticsCoalescer";
import type { LanguageServerDiagnosticEvent } from "./languageServerDiagnostics";

function diagnosticEvent(
  overrides: Partial<LanguageServerDiagnosticEvent> = {},
): LanguageServerDiagnosticEvent {
  return {
    diagnostics: [],
    rootPath: "/workspace-a",
    sessionId: 1,
    uri: "file:///workspace-a/app/Models/User.php",
    version: 1,
    ...overrides,
  };
}

/**
 * Manual scheduler: collects the requested flush callback so the test can fire
 * the "frame" deterministically, mirroring how production schedules one flush
 * per animation frame.
 */
function manualScheduler(): {
  scheduler: DiagnosticsFlushScheduler;
  pending: () => boolean;
  fire: () => void;
  cancelled: () => number;
} {
  let callback: (() => void) | null = null;
  let cancelCount = 0;

  return {
    cancelled: () => cancelCount,
    fire: () => {
      const next = callback;
      callback = null;
      next?.();
    },
    pending: () => callback !== null,
    scheduler: {
      cancel: () => {
        callback = null;
        cancelCount += 1;
      },
      schedule: (flush) => {
        callback = flush;
        return 1;
      },
    },
  };
}

describe("DiagnosticsCoalescer", () => {
  it("collapses a burst of events into a single flush", () => {
    const sink = vi.fn();
    const { scheduler, fire, pending } = manualScheduler();
    const coalescer = new DiagnosticsCoalescer(sink, scheduler);

    coalescer.enqueue(diagnosticEvent({ uri: "file:///a", version: 1 }));
    coalescer.enqueue(diagnosticEvent({ uri: "file:///b", version: 1 }));
    coalescer.enqueue(diagnosticEvent({ uri: "file:///c", version: 1 }));

    expect(sink).not.toHaveBeenCalled();
    expect(pending()).toBe(true);

    fire();

    expect(sink).toHaveBeenCalledTimes(3);
    expect(sink.mock.calls.map(([event]) => event.uri)).toEqual([
      "file:///a",
      "file:///b",
      "file:///c",
    ]);
  });

  it("keeps only the latest event per uri before flushing", () => {
    const sink = vi.fn();
    const { scheduler, fire } = manualScheduler();
    const coalescer = new DiagnosticsCoalescer(sink, scheduler);

    coalescer.enqueue(diagnosticEvent({ uri: "file:///a", version: 1 }));
    coalescer.enqueue(diagnosticEvent({ uri: "file:///a", version: 2 }));
    coalescer.enqueue(diagnosticEvent({ uri: "file:///a", version: 5 }));

    fire();

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].version).toBe(5);
  });

  it("does not replace a buffered event with an older version", () => {
    const sink = vi.fn();
    const { scheduler, fire } = manualScheduler();
    const coalescer = new DiagnosticsCoalescer(sink, scheduler);

    coalescer.enqueue(diagnosticEvent({ uri: "file:///a", version: 5 }));
    coalescer.enqueue(diagnosticEvent({ uri: "file:///a", version: 2 }));

    fire();

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].version).toBe(5);
  });

  it("always replaces a buffered event when the new version is null", () => {
    const sink = vi.fn();
    const { scheduler, fire } = manualScheduler();
    const coalescer = new DiagnosticsCoalescer(sink, scheduler);

    coalescer.enqueue(diagnosticEvent({ uri: "file:///a", version: 5 }));
    coalescer.enqueue(
      diagnosticEvent({ diagnostics: [], uri: "file:///a", version: null }),
    );

    fire();

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].version).toBeNull();
  });

  it("does not overwrite a buffered null clear with a later numeric event", () => {
    const sink = vi.fn();
    const { scheduler, fire } = manualScheduler();
    const coalescer = new DiagnosticsCoalescer(sink, scheduler);

    // A null-versioned clear is the latest publication for this uri. A numeric
    // event arriving afterwards in the same burst must not resurrect markers by
    // overwriting the buffered clear.
    coalescer.enqueue(diagnosticEvent({ uri: "file:///a", version: 5 }));
    coalescer.enqueue(
      diagnosticEvent({ diagnostics: [], uri: "file:///a", version: null }),
    );
    coalescer.enqueue(
      diagnosticEvent({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "stale",
            severity: "error",
            source: "phpactor",
          },
        ],
        uri: "file:///a",
        version: 3,
      }),
    );

    fire();

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].version).toBeNull();
    expect(sink.mock.calls[0][0].diagnostics).toHaveLength(0);
  });

  it("replaces a buffered null clear with a newer null publication", () => {
    const sink = vi.fn();
    const { scheduler, fire } = manualScheduler();
    const coalescer = new DiagnosticsCoalescer(sink, scheduler);

    coalescer.enqueue(
      diagnosticEvent({ diagnostics: [], uri: "file:///a", version: null }),
    );
    coalescer.enqueue(
      diagnosticEvent({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "fresh",
            severity: "error",
            source: "phpactor",
          },
        ],
        uri: "file:///a",
        version: null,
      }),
    );

    fire();

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].diagnostics[0]?.message).toBe("fresh");
  });

  it("keys the buffer by root and uri so different roots never collide", () => {
    const sink = vi.fn();
    const { scheduler, fire } = manualScheduler();
    const coalescer = new DiagnosticsCoalescer(sink, scheduler);

    coalescer.enqueue(
      diagnosticEvent({ rootPath: "/workspace-a", uri: "file:///shared" }),
    );
    coalescer.enqueue(
      diagnosticEvent({ rootPath: "/workspace-b", uri: "file:///shared" }),
    );

    fire();

    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls.map(([event]) => event.rootPath).sort()).toEqual([
      "/workspace-a",
      "/workspace-b",
    ]);
  });

  it("drops buffered events for a root that is discarded before flush", () => {
    const sink = vi.fn();
    const { scheduler, fire } = manualScheduler();
    const coalescer = new DiagnosticsCoalescer(sink, scheduler);

    coalescer.enqueue(
      diagnosticEvent({ rootPath: "/workspace-a", uri: "file:///a" }),
    );
    coalescer.enqueue(
      diagnosticEvent({ rootPath: "/workspace-b", uri: "file:///b" }),
    );

    coalescer.dropRoot("/workspace-a");
    fire();

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].rootPath).toBe("/workspace-b");
  });

  it("re-arms the scheduler for events arriving after a flush", () => {
    const sink = vi.fn();
    const { scheduler, fire, pending } = manualScheduler();
    const coalescer = new DiagnosticsCoalescer(sink, scheduler);

    coalescer.enqueue(diagnosticEvent({ uri: "file:///a" }));
    fire();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(pending()).toBe(false);

    coalescer.enqueue(diagnosticEvent({ uri: "file:///b" }));
    expect(pending()).toBe(true);
    fire();
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("only schedules once per pending frame regardless of burst size", () => {
    const sink = vi.fn();
    const schedule = vi.fn(() => 1);
    const scheduler: DiagnosticsFlushScheduler = {
      cancel: vi.fn(),
      schedule,
    };
    const coalescer = new DiagnosticsCoalescer(sink, scheduler);

    coalescer.enqueue(diagnosticEvent({ uri: "file:///a" }));
    coalescer.enqueue(diagnosticEvent({ uri: "file:///b" }));
    coalescer.enqueue(diagnosticEvent({ uri: "file:///c" }));

    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending flush and clears the buffer on dispose", () => {
    const sink = vi.fn();
    const { scheduler, fire, cancelled } = manualScheduler();
    const coalescer = new DiagnosticsCoalescer(sink, scheduler);

    coalescer.enqueue(diagnosticEvent({ uri: "file:///a" }));
    coalescer.dispose();

    expect(cancelled()).toBe(1);

    fire();
    expect(sink).not.toHaveBeenCalled();
  });

  it("ignores events without a root path", () => {
    const sink = vi.fn();
    const { scheduler, fire, pending } = manualScheduler();
    const coalescer = new DiagnosticsCoalescer(sink, scheduler);

    coalescer.enqueue(diagnosticEvent({ rootPath: "" }));

    expect(pending()).toBe(false);
    fire();
    expect(sink).not.toHaveBeenCalled();
  });
});
