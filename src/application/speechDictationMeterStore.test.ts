import { describe, expect, it, vi } from "vitest";
import {
  SILENT_SPEECH_DICTATION_METER,
  createSpeechDictationMeterStore,
} from "./speechDictationMeterStore";

describe("speech dictation meter store", () => {
  it("keeps a stable snapshot until the meter changes", () => {
    const store = createSpeechDictationMeterStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.getSnapshot()).toBe(SILENT_SPEECH_DICTATION_METER);
    store.publish({ level: 0, elapsedMs: 0 });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(SILENT_SPEECH_DICTATION_METER);
    const meter = { level: 0.4, elapsedMs: 120 };
    store.publish(meter);
    store.publish({ level: 0.4, elapsedMs: 120 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(meter);
    store.reset();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toBe(SILENT_SPEECH_DICTATION_METER);
    unsubscribe();
    store.publish({ level: 1, elapsedMs: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it("isolates a listener that fails", () => {
    const store = createSpeechDictationMeterStore();
    const sealed: readonly number[] = Object.freeze([]);
    const healthy = vi.fn();
    store.subscribe(() => void (sealed as number[]).push(1));
    store.subscribe(healthy);
    store.publish({ level: 0.3, elapsedMs: 10 });
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ level: 0.3, elapsedMs: 10 });
  });
  it("tolerates a listener that unsubscribes while notified", () => {
    const store = createSpeechDictationMeterStore();
    const second = vi.fn();
    const unsubscribeFirst = store.subscribe(() => unsubscribeFirst());
    store.subscribe(second);
    store.publish({ level: 0.1, elapsedMs: 1 });
    store.publish({ level: 0.2, elapsedMs: 2 });
    expect(second).toHaveBeenCalledTimes(2);
  });
});
