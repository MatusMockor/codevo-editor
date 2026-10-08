// @vitest-environment jsdom

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_ATTACHMENT_CARRY_UNAVAILABLE_NOTICE,
  carryAgentAttachmentDrafts,
} from "../../application/agentAttachmentCarry";
import {
  gate,
  mountMachine,
  owner,
  settle,
  states,
  type Machine,
} from "../../application/agentAttachmentMachineTestSupport";
import { MAX_AGENT_TURN_ATTACHMENTS } from "../../domain/agentAttachment";
import {
  AGENT_ATTACHMENT_COUNT_REFUSAL,
  AGENT_ATTACHMENT_REMOTE_FOLDER_REFUSAL,
  AgentAttachmentFolderSourceError,
} from "../../domain/agentAttachmentIntake";
import { useAgentAttachmentIntake } from "./useAgentAttachmentIntake";

const LOCAL_ROOT = "/workspace/app";
const OTHER_ROOT = "/workspace/other";
const SERVER_ROOT = "remote:server:runner:project";
const LOCAL_KEY = `new:${LOCAL_ROOT}`;
const OTHER_KEY = `new:${OTHER_ROOT}`;
const SERVER_KEY = `new:${SERVER_ROOT}`;
const UNREADABLE_IMAGE = "Choose a PNG, JPEG, GIF or WebP image.";

type MachineName = "local" | "server";

interface Scene {
  readonly machine: MachineName | null;
  readonly draftKey: string;
  readonly target: string | null;
  readonly serverId: string | null;
  readonly dispatching?: boolean;
  readonly carriedFrom?: { readonly machine: MachineName; readonly draftKey: string };
}

const LOCAL: Scene = { machine: "local", draftKey: LOCAL_KEY, target: LOCAL_ROOT, serverId: null };
const SERVER: Scene = {
  machine: "server",
  draftKey: SERVER_KEY,
  target: SERVER_ROOT,
  serverId: "server",
};
const ON_SERVER: Scene = { ...SERVER, carriedFrom: { machine: "local", draftKey: LOCAL_KEY } };
const BACK_LOCAL: Scene = { ...LOCAL, carriedFrom: { machine: "server", draftKey: SERVER_KEY } };
const HELD: Scene = { machine: "local", draftKey: LOCAL_KEY, target: null, serverId: "server" };
const OTHER_PROJECT: Scene = {
  machine: "local",
  draftKey: OTHER_KEY,
  target: OTHER_ROOT,
  serverId: null,
};
const THREAD: Scene = {
  machine: "local",
  draftKey: "thread-a",
  target: LOCAL_ROOT,
  serverId: null,
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settled) => {
    resolve = settled;
  });
  return { promise, resolve };
}

function clipboardImage(name: string, read: Promise<ArrayBuffer>): File {
  const file = new File([new Uint8Array(4)], name, { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: () => read });
  return file;
}

describe("attachment intake owned by its draft", () => {
  let machines: Record<MachineName, Machine>;
  let root: Root;
  let intake: ReturnType<typeof useAgentAttachmentIntake> | null;
  let picked: Deferred<ReadonlyArray<string>>;
  let imageReads: Map<string, Deferred<ArrayBuffer>>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    machines = {
      local: mountMachine("local", LOCAL_ROOT),
      server: mountMachine("server", SERVER_ROOT),
    };
    machines.local.owners.set(OTHER_ROOT, owner(OTHER_ROOT));
    root = createRoot(document.createElement("div"));
    intake = null;
    picked = deferred();
    imageReads = new Map();
  });

  afterEach(() => {
    act(() => root.unmount());
    machines.local.unmount();
    machines.server.unmount();
  });

  function imageRead(path: string): Deferred<ArrayBuffer> {
    const pending = imageReads.get(path) ?? deferred<ArrayBuffer>();
    imageReads.set(path, pending);
    return pending;
  }

  function failImageRead(path: string, error: Error): void {
    const promise = Promise.reject<ArrayBuffer>(error);
    promise.catch(() => undefined);
    imageReads.set(path, { promise, resolve: () => undefined });
  }

  function Probe({ scene }: { readonly scene: Scene }) {
    const presented = scene.machine === null ? null : machines[scene.machine].scope(scene.draftKey);
    intake = useAgentAttachmentIntake({
      attachments: presented,
      target: scene.target,
      serverId: scene.serverId,
      promptOwnerKey: scene.draftKey,
      dispatching: scene.dispatching ?? false,
      picker: () => picked.promise,
      readImagePath: (path) => imageRead(path).promise,
    });
    useLayoutEffect(() => {
      const origin = scene.carriedFrom;
      if (origin === undefined || presented === null || scene.target === null) return;
      carryAgentAttachmentDrafts(
        machines[origin.machine].scope(origin.draftKey),
        presented,
        scene.target,
      );
    }, [presented, scene]);
    return null;
  }

  function show(scene: Scene): void {
    act(() => root.render(createElement(Probe, { scene })));
  }

  function hook(): ReturnType<typeof useAgentAttachmentIntake> {
    expect(intake).not.toBeNull();
    return intake as ReturnType<typeof useAgentAttachmentIntake>;
  }

  function localDraft(): ReadonlyArray<string> {
    return states(machines.local.scope(LOCAL_KEY));
  }

  function serverDraft(): ReadonlyArray<string> {
    return states(machines.server.scope(SERVER_KEY));
  }

  function startPaste(names: ReadonlyArray<string>): {
    readonly reads: ReadonlyArray<Deferred<ArrayBuffer>>;
    readonly done: Promise<void>;
  } {
    const reads = names.map(() => deferred<ArrayBuffer>());
    const files = names.map((name, index) => clipboardImage(name, reads[index].promise));
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = hook().paste(files);
    });
    return { reads, done };
  }

  async function finish(pending: {
    readonly reads: ReadonlyArray<Deferred<ArrayBuffer>>;
    readonly done: Promise<void>;
  }): Promise<void> {
    await act(async () => {
      for (const read of pending.reads) read.resolve(new ArrayBuffer(4));
      await pending.done;
    });
  }

  it("lands a clipboard read that was still pending on the machine the draft moved to", async () => {
    show(LOCAL);
    const pending = startPaste(["shot.png"]);

    show(ON_SERVER);
    await finish(pending);
    await settle(() => expect(serverDraft()).toEqual(["shot.png:ready"]));

    expect(localDraft()).toEqual([]);
    expect(machines.local.staged).toEqual([]);
    expect(machines.server.staged).toEqual([
      { workspaceId: `workspace:${SERVER_ROOT}`, attachmentId: "server-1" },
    ]);
  });

  it("lands a pending clipboard read on its own draft while the new machine has no target", async () => {
    show(LOCAL);
    const pending = startPaste(["shot.png"]);

    show(HELD);
    await finish(pending);
    await settle(() => expect(localDraft()).toEqual(["shot.png:ready"]));

    expect(serverDraft()).toEqual([]);
    show(ON_SERVER);
    await settle(() => expect(serverDraft()).toEqual(["shot.png:ready"]));
    expect(localDraft()).toEqual([]);
  });

  it("follows the draft there and back while the clipboard is still being read", async () => {
    show(LOCAL);
    const pending = startPaste(["shot.png"]);

    show(ON_SERVER);
    show(BACK_LOCAL);
    await finish(pending);
    await settle(() => expect(localDraft()).toEqual(["shot.png:ready"]));

    expect(serverDraft()).toEqual([]);
    expect(machines.server.staged).toEqual([]);
  });

  it("carries every pasted file when Run on changes after the first one started staging", async () => {
    show(LOCAL);
    const held = (machines.local.stageGate = gate());
    const pending = startPaste(["one.png", "two.png", "three.png"]);
    await act(async () => {
      for (const read of pending.reads) read.resolve(new ArrayBuffer(4));
    });
    await settle(() => expect(localDraft()).toEqual(["one.png:staging"]));

    show(ON_SERVER);
    await settle(() =>
      expect(serverDraft()).toEqual(["one.png:ready", "two.png:ready", "three.png:ready"]),
    );
    await act(async () => {
      held.open();
      await pending.done;
    });

    expect(localDraft()).toEqual([]);
    expect(machines.local.released).toEqual(["local-1"]);
    expect(serverDraft()).toEqual(["one.png:ready", "two.png:ready", "three.png:ready"]);
  });

  it("reads picked files for the machine the draft is on when the picker returns", async () => {
    show(LOCAL);
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = hook().open();
    });

    show(ON_SERVER);
    await act(async () => {
      picked.resolve(["/Users/dev/shot.png"]);
      imageRead("/Users/dev/shot.png").resolve(new ArrayBuffer(4));
      await opening;
    });
    await settle(() => expect(serverDraft()).toEqual(["shot.png:ready"]));

    expect(localDraft()).toEqual([]);
    expect(machines.server.gateway.inspectAgentAttachmentCandidate).not.toHaveBeenCalled();
  });

  it("keeps a server path read that finishes after the draft returned to this computer", async () => {
    show(SERVER);
    let dropping: Promise<void> = Promise.resolve();
    act(() => {
      dropping = hook().drop(["/Users/dev/one.png", "/Users/dev/two.pdf"]);
    });

    show(BACK_LOCAL);
    await act(async () => {
      imageRead("/Users/dev/one.png").resolve(new ArrayBuffer(4));
      await dropping;
    });
    await settle(() => expect(localDraft()).toEqual(["one.png:ready", "two.pdf:ready"]));

    expect(machines.local.scope(LOCAL_KEY).drafts).toMatchObject([
      { kind: "image" },
      { kind: "reference", path: "/Users/dev/two.pdf" },
    ]);
    expect(serverDraft()).toEqual([]);
    expect(imageReads.has("/Users/dev/two.pdf")).toBe(false);
  });

  it("refuses a folder dropped on a server draft and still attaches the images around it", async () => {
    const folder = "/Users/x/Documents/codevo s.r.o./invoices";
    show(SERVER);
    failImageRead(folder, new AgentAttachmentFolderSourceError());
    imageRead("/Users/dev/one.png").resolve(new ArrayBuffer(4));
    imageRead("/Users/dev/two.png").resolve(new ArrayBuffer(4));

    await act(() => hook().drop(["/Users/dev/one.png", folder, "/Users/dev/two.png"]));
    await settle(() => expect(serverDraft()).toEqual(["one.png:ready", "two.png:ready"]));

    expect(machines.server.scope(SERVER_KEY).refusal).toBe(AGENT_ATTACHMENT_REMOTE_FOLDER_REFUSAL);
    expect([...imageReads.keys()]).toEqual([folder, "/Users/dev/one.png", "/Users/dev/two.png"]);
    expect(localDraft()).toEqual([]);
    expect(machines.server.gateway.inspectAgentAttachmentCandidate).not.toHaveBeenCalled();
  });

  it("reports an unreadable server path through the refusal and keeps reading the rest", async () => {
    show(SERVER);
    failImageRead("/Users/dev/notes.txt", new Error("Choose a PNG, JPEG, GIF or WebP image."));
    imageRead("/Users/dev/two.png").resolve(new ArrayBuffer(4));

    await act(() => hook().drop(["/Users/dev/notes.txt", "/Users/dev/two.png"]));
    await settle(() => expect(serverDraft()).toEqual(["two.png:ready"]));

    expect(machines.server.scope(SERVER_KEY).refusal).toBe(
      "Choose a PNG, JPEG, GIF or WebP image.",
    );
  });

  it("reports every distinct failure of one server drop together and still attaches the rest", async () => {
    const folder = "/Users/x/Documents/codevo s.r.o./invoices";
    show(SERVER);
    failImageRead(folder, new AgentAttachmentFolderSourceError());
    failImageRead("/Users/dev/notes.txt", new Error(UNREADABLE_IMAGE));
    imageRead("/Users/dev/one.png").resolve(new ArrayBuffer(4));

    await act(() => hook().drop([folder, "/Users/dev/notes.txt", "/Users/dev/one.png"]));
    await settle(() => expect(serverDraft()).toEqual(["one.png:ready"]));

    expect(machines.server.scope(SERVER_KEY).refusal).toBe(
      `${AGENT_ATTACHMENT_REMOTE_FOLDER_REFUSAL} ${UNREADABLE_IMAGE}`,
    );
  });

  it("names a repeated server drop failure once and keeps the first three distinct ones", async () => {
    const folders = ["/Users/dev/first", "/Users/dev/second"];
    show(SERVER);
    for (const folder of folders) failImageRead(folder, new AgentAttachmentFolderSourceError());
    failImageRead("/Users/dev/notes.txt", new Error(UNREADABLE_IMAGE));
    failImageRead("/Users/dev/huge.png", new Error("Image is larger than 50 MiB."));
    failImageRead("/Users/dev/gone.png", new Error("The image is no longer there."));

    await act(() =>
      hook().drop([
        folders[0],
        "/Users/dev/notes.txt",
        folders[1],
        "/Users/dev/huge.png",
        "/Users/dev/gone.png",
      ]),
    );

    expect(machines.server.scope(SERVER_KEY).refusal).toBe(
      `${AGENT_ATTACHMENT_REMOTE_FOLDER_REFUSAL} ${UNREADABLE_IMAGE} Image is larger than 50 MiB.`,
    );
    expect(serverDraft()).toEqual([]);
  });

  it("keeps the failures of a server drop to itself once the user navigated away", async () => {
    show(SERVER);
    failImageRead("/Users/dev/notes.txt", new Error(UNREADABLE_IMAGE));
    let dropping: Promise<void> = Promise.resolve();
    act(() => {
      dropping = hook().drop(["/Users/dev/notes.txt", "/Users/dev/one.png"]);
    });
    await act(async () => undefined);
    expect(imageReads.has("/Users/dev/one.png")).toBe(true);

    show(OTHER_PROJECT);
    await act(async () => {
      imageRead("/Users/dev/one.png").resolve(new ArrayBuffer(4));
      await dropping;
    });

    expect(machines.server.scope(SERVER_KEY).refusal).toBeNull();
    expect(machines.local.scope(OTHER_KEY).refusal).toBeNull();
    expect(serverDraft()).toEqual([]);
    expect(states(machines.local.scope(OTHER_KEY))).toEqual([]);
  });

  it("attaches a folder dropped on this computer's draft as a folder", async () => {
    const folder = "/Users/x/Documents/codevo s.r.o./invoices";
    vi.mocked(machines.local.gateway.inspectAgentAttachmentCandidate).mockResolvedValue({
      bytes: 0,
      isRegularFile: false,
      isDirectory: true,
      extensionMime: null,
    });
    show(LOCAL);

    await act(() => hook().drop([folder]));
    await settle(() => expect(localDraft()).toEqual(["invoices:ready"]));

    expect(machines.local.scope(LOCAL_KEY).drafts).toMatchObject([
      { kind: "reference", entry: "directory", name: "invoices", path: folder, notice: null },
    ]);
    expect(machines.local.scope(LOCAL_KEY).refusal).toBeNull();
    expect(imageReads.size).toBe(0);
  });

  it.each([
    ["another project", OTHER_PROJECT],
    ["a thread", THREAD],
  ])("drops a pending clipboard read once the user navigated to %s", async (_label, scene) => {
    show(LOCAL);
    const pending = startPaste(["shot.png"]);

    show(scene);
    show(LOCAL);
    await finish(pending);

    expect(localDraft()).toEqual([]);
    expect(states(machines.local.scope(scene.draftKey))).toEqual([]);
    expect(machines.local.staged).toEqual([]);
    expect(machines.local.scope(LOCAL_KEY).refusal).toBeNull();
  });

  it("drops a pending picker result once the user navigated to another project", async () => {
    show(LOCAL);
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = hook().open();
    });

    show(OTHER_PROJECT);
    await act(async () => {
      picked.resolve(["/Users/dev/spec.pdf"]);
      await opening;
    });

    expect(localDraft()).toEqual([]);
    expect(states(machines.local.scope(OTHER_KEY))).toEqual([]);
    expect(machines.local.gateway.inspectAgentAttachmentCandidate).not.toHaveBeenCalled();
  });

  it("drops a pending clipboard read when the project owner generation is replaced", async () => {
    show(LOCAL);
    const pending = startPaste(["shot.png"]);

    machines.local.owners.set(LOCAL_ROOT, owner(LOCAL_ROOT, 2));
    show(LOCAL);
    await finish(pending);

    expect(localDraft()).toEqual([]);
    expect(machines.local.staged).toEqual([]);
  });

  it("drops a pending clipboard read when the draft is cleared, a send starts or the composer unmounts", async () => {
    show(LOCAL);
    const cleared = startPaste(["cleared.png"]);
    act(() => machines.local.scope(LOCAL_KEY).clear());
    await finish(cleared);

    const sending = startPaste(["sending.png"]);
    show({ ...LOCAL, dispatching: true });
    show(LOCAL);
    await finish(sending);

    const unmounted = startPaste(["unmounted.png"]);
    expect(machines.local.scope(LOCAL_KEY).pendingIntake).toBe(true);
    act(() => root.unmount());
    expect(machines.local.scope(LOCAL_KEY).pendingIntake).toBe(false);
    await finish(unmounted);
    root = createRoot(document.createElement("div"));

    expect(localDraft()).toEqual([]);
    expect(machines.local.staged).toEqual([]);
  });

  it("refuses visibly when the pending read arrives at a draft that is already full", async () => {
    show(LOCAL);
    const pending = startPaste(["late.png"]);
    show(ON_SERVER);
    const full = Array.from({ length: MAX_AGENT_TURN_ATTACHMENTS }, (_, index) => ({
      kind: "bytes" as const,
      name: `server-${index}.png`,
      mime: "image/png",
      bytes: new ArrayBuffer(4),
    }));
    await act(() => machines.server.scope(SERVER_KEY).add(SERVER_ROOT, full));

    await finish(pending);

    expect(serverDraft()).toHaveLength(MAX_AGENT_TURN_ATTACHMENTS);
    expect(machines.server.scope(SERVER_KEY).refusal).toBe(AGENT_ATTACHMENT_COUNT_REFUSAL);
  });

  it("says so when the new machine cannot take a pending read", async () => {
    show(LOCAL);
    const pending = startPaste(["shot.png"]);
    machines.server.owners.clear();

    show(ON_SERVER);
    await finish(pending);

    expect(serverDraft()).toEqual([]);
    expect(localDraft()).toEqual([]);
    expect(machines.server.scope(SERVER_KEY).refusal).toBe(
      AGENT_ATTACHMENT_CARRY_UNAVAILABLE_NOTICE,
    );
  });

  it("bounds the number of reads a draft may have pending and refuses the next one visibly", async () => {
    show(LOCAL);
    const pending = Array.from({ length: 16 }, (_, index) => startPaste([`shot-${index}.png`]));
    expect(machines.local.scope(LOCAL_KEY).refusal).toBeNull();

    const refused = startPaste(["overflow.png"]);
    expect(machines.local.scope(LOCAL_KEY).refusal).not.toBeNull();
    await finish(refused);
    await act(async () => {
      for (const paste of pending.slice(1)) paste.reads[0]?.resolve(new ArrayBuffer(0));
      await Promise.all(pending.slice(1).map((paste) => paste.done));
    });
    await finish(pending[0] ?? refused);
    await settle(() => expect(localDraft()).toContain("shot-0.png:ready"));

    expect(localDraft()).not.toContain("overflow.png:ready");
  });
});
