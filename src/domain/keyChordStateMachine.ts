import {
  lookupKeymapShortcutSequence,
  parseShortcutStroke,
  type ShortcutPlatform,
  type ShortcutSequenceLookup,
  type ShortcutStroke,
} from "./shortcutSequence";

export type KeyChordResetReason =
  | "blur"
  | "editor-replaced"
  | "escape"
  | "keymap-replaced"
  | "manual"
  | "repeat"
  | "timeout"
  | "unmount"
  | "wrong-second-stroke";

export type KeyChordState<CommandId extends string = string> =
  | { readonly status: "idle" }
  | {
      readonly expiresAt: number;
      readonly firstStroke: ShortcutStroke;
      readonly pendingExact: readonly CommandId[];
      readonly status: "awaitingSecond";
    };

export type KeyChordResult<CommandId extends string = string> =
  | {
      readonly commandIds: readonly CommandId[];
      readonly sequence: string;
      readonly type: "dispatch";
    }
  | { readonly expiresAt: number; readonly prefix: string; readonly type: "awaitingSecond" }
  | { readonly reason: KeyChordResetReason; readonly type: "cancelled" }
  | { readonly type: "unmatched" };

export type KeyChordLookup<CommandId extends string = string> = (
  sequence: string,
) => ShortcutSequenceLookup<CommandId>;

export interface KeyChordStrokeOptions {
  readonly repeat?: boolean;
}

const IDLE_STATE = Object.freeze({ status: "idle" } as const);

export class KeyChordStateMachine<CommandId extends string = string> {
  #state: KeyChordState<CommandId> = IDLE_STATE;

  public constructor(
    private readonly lookup: KeyChordLookup<CommandId>,
    private readonly timeoutMs: number,
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError("Key chord timeout must be a positive finite number.");
    }
  }

  public get state(): KeyChordState<CommandId> {
    return this.#state;
  }

  public handleStroke(
    input: string | ShortcutStroke,
    now: number,
    options: KeyChordStrokeOptions = {},
  ): KeyChordResult<CommandId> {
    if (options.repeat) {
      this.reset("repeat");
      return { reason: "repeat", type: "cancelled" };
    }

    const stroke = typeof input === "string" ? parseShortcutStroke(input) : input;
    if (!stroke || !Number.isFinite(now)) {
      if (this.#state.status === "awaitingSecond") {
        return this.reset("wrong-second-stroke");
      }
      return { type: "unmatched" };
    }

    if (this.#state.status === "awaitingSecond" && now >= this.#state.expiresAt) {
      const expired = this.expire(now);
      if (expired.type === "dispatch") return expired;
    }

    if (this.#state.status === "awaitingSecond") {
      const sequence = `${this.#state.firstStroke.value} ${stroke.value}`;
      const match = this.lookup(sequence);
      this.#state = IDLE_STATE;
      if (match.exact.length > 0) {
        return { commandIds: Object.freeze([...match.exact]), sequence, type: "dispatch" };
      }
      return { reason: "wrong-second-stroke", type: "cancelled" };
    }

    return this.start(stroke, now);
  }

  public expire(now: number): KeyChordResult<CommandId> {
    if (
      !Number.isFinite(now) ||
      this.#state.status !== "awaitingSecond" ||
      now < this.#state.expiresAt
    ) {
      return { type: "unmatched" };
    }

    const expiredState = this.#state;
    this.#state = IDLE_STATE;
    if (expiredState.pendingExact.length > 0) {
      return {
        commandIds: expiredState.pendingExact,
        sequence: expiredState.firstStroke.value,
        type: "dispatch",
      };
    }
    return { reason: "timeout", type: "cancelled" };
  }

  public reset(reason: KeyChordResetReason = "manual"): KeyChordResult<CommandId> {
    this.#state = IDLE_STATE;
    return { reason, type: "cancelled" };
  }

  private start(stroke: ShortcutStroke, now: number): KeyChordResult<CommandId> {
    const match = this.lookup(stroke.value);
    if (match.prefix.length === 0) {
      if (match.exact.length === 0) return { type: "unmatched" };
      return {
        commandIds: Object.freeze([...match.exact]),
        sequence: stroke.value,
        type: "dispatch",
      };
    }

    const expiresAt = now + this.timeoutMs;
    if (!Number.isFinite(expiresAt)) return { type: "unmatched" };
    this.#state = Object.freeze({
      expiresAt,
      firstStroke: stroke,
      pendingExact: Object.freeze([...match.exact]),
      status: "awaitingSecond",
    });
    return { expiresAt, prefix: stroke.value, type: "awaitingSecond" };
  }
}

export function keyChordLookupFromKeymap<CommandId extends string>(
  keymap: Readonly<Record<CommandId, string>>,
  commandOrder?: readonly CommandId[],
  platform?: ShortcutPlatform,
): KeyChordLookup<CommandId> {
  return (sequence) => lookupKeymapShortcutSequence(keymap, sequence, commandOrder, platform);
}
