import { useRef, type KeyboardEvent } from "react";
import {
  PALETTE_IDS,
  PALETTE_LABELS,
  type PaletteId,
  type ResolvedColorScheme,
} from "../../../domain/appearance";
import { paletteTokens, surfaceColor } from "../../../domain/appearancePalettes";

const STEP_BY_KEY: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export interface AppearancePaletteSwatchesProps {
  readonly scheme: ResolvedColorScheme;
  readonly value: PaletteId;
  onChange(palette: PaletteId): void;
}

export function AppearancePaletteSwatches({
  onChange,
  scheme,
  value,
}: AppearancePaletteSwatchesProps) {
  const groupRef = useRef<HTMLDivElement | null>(null);

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = nextPalette(event.key, value);

    if (next === null) return;

    event.preventDefault();
    onChange(next);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
  };

  return (
    <div
      aria-label="Palette"
      className="settings-swatches"
      onKeyDown={move}
      ref={groupRef}
      role="radiogroup"
    >
      {PALETTE_IDS.map((palette) => {
        return (
          <button
            aria-checked={palette === value}
            aria-label={PALETTE_LABELS[palette]}
            className="settings-swatch"
            data-value={palette}
            key={palette}
            onClick={() => onChange(palette)}
            role="radio"
            style={{ background: surfaceColor(palette, scheme, "canvas") }}
            tabIndex={palette === value ? 0 : -1}
            title={PALETTE_LABELS[palette]}
            type="button"
          >
            <span
              aria-hidden="true"
              className="settings-swatch__sidebar"
              style={{ background: surfaceColor(palette, scheme, "side") }}
            />
            <span
              aria-hidden="true"
              className="settings-swatch__accent"
              style={{ background: paletteTokens(palette, scheme).accentFill }}
            />
          </button>
        );
      })}
    </div>
  );
}

function nextPalette(key: string, value: PaletteId): PaletteId | null {
  if (key === "Home") return PALETTE_IDS[0];
  if (key === "End") return PALETTE_IDS[PALETTE_IDS.length - 1];

  const step = STEP_BY_KEY[key];

  if (step === undefined) return null;

  const current = PALETTE_IDS.indexOf(value);
  return PALETTE_IDS[(Math.max(current, 0) + step + PALETTE_IDS.length) % PALETTE_IDS.length];
}
