// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import {
  createAgentViewCommandBridge,
  type AgentViewCommandHandlers,
} from "../../application/agentViewCommandBridge";
import {
  CommandRegistry,
  executeCommand,
  type CommandContext,
} from "../../application/commandRegistry";
import { workbenchAgentCommands } from "../../application/workbenchAgentCommands";
import { dispatchWorkbenchShortcutCommand } from "../../application/workbenchShortcutCommandDispatcher";
import { defaultKeymapSettings } from "../../domain/keymap";
import {
  disposeDictationComposers,
  mountDictationComposer,
  type DictationComposerHarness,
} from "./dictation/agentComposerDictationTestSupport";

afterEach(disposeDictationComposers);

async function dictate(composer: DictationComposerHarness, transcript: string): Promise<void> {
  const call = composer.ipc.calls.length;
  await composer.record();
  composer.utter();
  composer.clickMicrophone();
  await composer.resolve(call, transcript);
}

function selection(composer: DictationComposerHarness): readonly [number, number] {
  return [composer.prompt().selectionStart, composer.prompt().selectionEnd];
}

describe("AgentComposer dictation transcript insertion", () => {
  it("inserts at the caret with a separating space on both sides", async () => {
    const composer = mountDictationComposer();
    act(() => composer.prompt().focus());
    composer.type("Fix bug");
    composer.setCaret(3);

    await dictate(composer, "the login");

    expect(composer.prompt().value).toBe("Fix the login bug");
    expect(selection(composer)).toEqual([13, 13]);
    expect(agentComposerDraftStore.readDraft("thread-a")).toBe("Fix the login bug");
  });

  it("appends to the end of the draft without a trailing space", async () => {
    const composer = mountDictationComposer();
    composer.type("Fix the");
    composer.setCaret(7);

    await dictate(composer, "login bug");

    expect(composer.prompt().value).toBe("Fix the login bug");
    expect(selection(composer)).toEqual([17, 17]);
  });

  it("does not add a space before punctuation or after existing whitespace", async () => {
    const composer = mountDictationComposer();
    composer.type("Fix the bug");
    composer.setCaret(11);
    await dictate(composer, ", then deploy.");
    expect(composer.prompt().value).toBe("Fix the bug, then deploy.");

    composer.type("Line one\n");
    composer.setCaret(9);
    await dictate(composer, "line two");
    expect(composer.prompt().value).toBe("Line one\nline two");
  });

  it("replaces the selected text", async () => {
    const composer = mountDictationComposer();
    composer.type("Fix the old bug now");
    composer.setCaret(8, 15);

    await dictate(composer, "login issue");

    expect(composer.prompt().value).toBe("Fix the login issue now");
    expect(selection(composer)).toEqual([19, 19]);
  });

  it("inserts consecutive segments in order while recording continues", async () => {
    const composer = mountDictationComposer();
    await composer.record();
    composer.utter();
    composer.utter();
    expect(composer.ipc.calls).toHaveLength(1);

    await composer.resolve(0, "first part");
    expect(composer.state()).toBe("recording");
    expect(composer.prompt().value).toBe("first part");
    expect(composer.ipc.calls).toHaveLength(2);

    await composer.resolve(1, "second part");
    expect(composer.prompt().value).toBe("first part second part");
    expect(selection(composer)).toEqual([22, 22]);
    expect(composer.state()).toBe("recording");
  });

  it("inserts at the caret the user moved to while the segment was transcribed", async () => {
    const composer = mountDictationComposer();
    act(() => composer.prompt().focus());
    await composer.record();
    composer.utter();
    composer.clickMicrophone();
    expect(composer.state()).toBe("finishing");

    composer.type("Typed meanwhile. Tail");
    composer.setCaret(16);
    await composer.resolve(0, "Spoken words.");

    expect(composer.prompt().value).toBe("Typed meanwhile. Spoken words. Tail");
    expect(selection(composer)).toEqual([30, 30]);
    expect(composer.state()).toBe("idle");
  });

  it("keeps slash-command handling working for dictated text", async () => {
    const composer = mountDictationComposer();
    act(() => composer.prompt().focus());

    await dictate(composer, "/settings");

    expect(composer.prompt().value).toBe("/settings");
    expect(composer.button("Send follow-up")?.disabled).toBe(false);
    expect(composer.submit).not.toHaveBeenCalled();
  });

  it("keeps the send button state in step with a dictated draft", async () => {
    const composer = mountDictationComposer();
    expect(composer.button("Send follow-up")?.disabled).toBe(true);

    await dictate(composer, "Run the tests");

    expect(composer.button("Send follow-up")?.disabled).toBe(false);
    expect(composer.submit).not.toHaveBeenCalled();
  });
});

describe("AgentComposer dictation ownership", () => {
  it("cancels on a thread switch and never lands a late transcript in another draft", async () => {
    const composer = mountDictationComposer({ draftKey: "thread-a" });
    composer.type("Draft A");
    await composer.record();
    composer.utter();
    expect(composer.ipc.calls).toHaveLength(1);

    composer.render({ draftKey: "thread-b" });

    expect(composer.state()).toBe("idle");
    expect(composer.audio?.microphoneLive()).toBe(false);
    expect(composer.prompt().value).toBe("");
    composer.type("Draft B");

    composer.render({ draftKey: "thread-a" });
    expect(composer.prompt().value).toBe("Draft A");
    await composer.resolve(0, "late words from the first visit");

    expect(composer.prompt().value).toBe("Draft A");
    expect(agentComposerDraftStore.readDraft("thread-a")).toBe("Draft A");
    expect(agentComposerDraftStore.readDraft("thread-b")).toBe("Draft B");
    expect(composer.state()).toBe("idle");
    expect(composer.notice()).toBeNull();
  });

  it("drops a transcript that resolves while another thread is shown", async () => {
    const composer = mountDictationComposer({ draftKey: "thread-a" });
    await composer.record();
    composer.utter();
    composer.clickMicrophone();
    expect(composer.state()).toBe("finishing");

    composer.render({ draftKey: "thread-b" });
    await composer.resolve(0, "words for thread A");

    expect(composer.prompt().value).toBe("");
    expect(agentComposerDraftStore.readDraft("thread-b")).toBe("");
    expect(agentComposerDraftStore.readDraft("thread-a")).toBe("");
    expect(composer.button("Send follow-up")?.getAttribute("title")).not.toContain("transcript");
  });

  it("starts a fresh session after returning to the first thread", async () => {
    const composer = mountDictationComposer({ draftKey: "thread-a" });
    await composer.record();
    composer.utter();
    composer.render({ draftKey: "thread-b" });
    composer.render({ draftKey: "thread-a" });

    await composer.record();
    composer.utter();
    composer.clickMicrophone();
    await composer.resolve(0, "stale");
    expect(composer.prompt().value).toBe("");
    await composer.resolve(1, "fresh");

    expect(composer.prompt().value).toBe("fresh");
  });

  it("releases the microphone when the composer unmounts", async () => {
    const composer = mountDictationComposer();
    await composer.record();
    expect(composer.audio?.microphoneLive()).toBe(true);

    disposeDictationComposers();

    expect(composer.audio?.microphoneLive()).toBe(false);
  });
});

describe("AgentComposer dictation shortcut", () => {
  const context: CommandContext = {
    activeDocumentDirty: false,
    hasActiveDocument: false,
    hasWorkspace: true,
  };
  const viewHandlers: AgentViewCommandHandlers = {
    surfaceBlocked: () => false,
    newThread: () => undefined,
    previousThread: () => undefined,
    nextThread: () => undefined,
    jumpToThread: () => undefined,
    searchThreads: () => undefined,
    findInThread: () => undefined,
    threadSelected: () => true,
  };

  function workbench() {
    const bridge = createAgentViewCommandBridge();
    bridge.bind(viewHandlers);
    const registry = new CommandRegistry();
    for (const command of workbenchAgentCommands({ viewCommands: bridge })) {
      registry.register(command);
    }
    const keymap = defaultKeymapSettings();
    const chord = keymap["agent.toggleDictation"];
    const ran: string[] = [];
    const press = (): boolean => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "v",
        code: "KeyV",
        altKey: true,
        ctrlKey: chord.includes("Ctrl"),
        metaKey: chord.includes("Cmd"),
      });
      let handled = false;
      act(() => {
        handled = dispatchWorkbenchShortcutCommand({
          commandContext: context,
          commandRegistry: registry,
          event,
          keymap,
          runCommand: (id, commandContext = context) => {
            const outcome = executeCommand(registry, id, commandContext);
            if (outcome === "executed") ran.push(id);
            return outcome;
          },
        });
      });
      return handled;
    };
    return { bridge, registry, chord, press, ran };
  }

  it("toggles dictation in the composer through the keymap chord", async () => {
    const { bridge, registry, chord, press, ran } = workbench();
    const composer = mountDictationComposer({ commands: bridge });
    act(() => composer.outsideButton().focus());

    expect(chord).toMatch(/^(Cmd|Ctrl)\+Alt\+V$/);
    expect(registry.get("agent.toggleDictation")?.isEnabled(context)).toBe(true);
    expect(press()).toBe(true);
    await composer.settle();

    expect(ran).toEqual(["agent.toggleDictation"]);
    expect(composer.state()).toBe("recording");
    expect(document.activeElement).toBe(composer.prompt());

    composer.utter();
    expect(press()).toBe(true);
    expect(composer.state()).toBe("finishing");
    expect(registry.get("agent.toggleDictation")?.isEnabled(context)).toBe(false);

    await composer.resolve(0, "via shortcut");
    expect(composer.prompt().value).toBe("via shortcut");
    expect(composer.submit).not.toHaveBeenCalled();
    expect(registry.get("agent.toggleDictation")?.isEnabled(context)).toBe(true);
  });

  it("explains through the keymap chord why dictation cannot start while the microphone is hidden", () => {
    const reason = "Dictation needs a connected server with speech transcription.";
    const { bridge, registry, press, ran } = workbench();
    const composer = mountDictationComposer({ commands: bridge, serverIds: [] });
    act(() => composer.prompt().focus());

    expect(composer.microphone()).toBeNull();
    expect(registry.get("agent.toggleDictation")?.isEnabled(context)).toBe(true);
    expect(press()).toBe(true);

    expect(ran).toEqual(["agent.toggleDictation"]);
    expect(composer.state()).toBe("unavailable");
    expect(composer.audio?.getUserMedia).not.toHaveBeenCalled();
    expect(composer.noticeKind()).toBe("unavailable");
    expect(composer.notice()).toBe(reason);
    expect(composer.status()).toBe(reason);
    expect(composer.microphone()).toBeNull();
    expect(document.activeElement).toBe(composer.prompt());

    act(() => composer.button("Dismiss dictation message")?.click());
    expect(composer.notice()).toBeNull();

    composer.render({ serverIds: ["server-a"] });
    expect(composer.notice()).toBeNull();
    expect(composer.microphone()?.getAttribute("aria-label")).toBe("Start dictation");
  });

  it("explains through the keymap chord that this build cannot capture the microphone", () => {
    const { bridge, press } = workbench();
    const composer = mountDictationComposer({ commands: bridge, audio: false });

    expect(composer.microphone()).toBeNull();
    expect(press()).toBe(true);

    expect(composer.notice()).toBe("Microphone capture is not available in this build.");
    expect(composer.microphone()).toBeNull();
  });

  it("releases the command when the composer unmounts", () => {
    const { bridge, registry } = workbench();
    mountDictationComposer({ commands: bridge });
    expect(registry.get("agent.toggleDictation")?.isEnabled(context)).toBe(true);

    disposeDictationComposers();

    expect(bridge.dictationAvailable()).toBe(false);
    expect(registry.get("agent.toggleDictation")?.isEnabled(context)).toBe(false);
  });

  it("does not bind a command when the workbench provides no dictation ports", () => {
    const { bridge } = workbench();
    const toggled = vi.fn();
    bridge.bindDictation({ available: () => false, toggle: toggled });
    mountDictationComposer({ commands: bridge, provided: false });

    bridge.run("agent.toggleDictation");

    expect(bridge.dictationAvailable()).toBe(false);
    expect(toggled).not.toHaveBeenCalled();
  });
});
