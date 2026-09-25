import { Check } from "lucide-react";
import { useRef, type CSSProperties, type KeyboardEvent } from "react";
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
      className="settings-palettes"
      onKeyDown={move}
      ref={groupRef}
      role="radiogroup"
    >
      {PALETTE_IDS.map((palette) => {
        const selected = palette === value;
        return (
          <button
            aria-checked={selected}
            aria-label={`${PALETTE_LABELS[palette]} palette`}
            className="settings-palette-card"
            data-value={palette}
            key={palette}
            onClick={() => onChange(palette)}
            role="radio"
            style={paletteCardStyle(palette, scheme)}
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            <span aria-hidden="true" className="settings-palette-card__wire">
              <span className="settings-palette-card__side">
                <i data-strong="true" />
                <i />
                <i />
              </span>
              <span className="settings-palette-card__main">
                <i data-bubble="true" />
                <i />
                <span className="settings-palette-card__composer" />
              </span>
            </span>
            <span className="settings-palette-card__name">
              <span aria-hidden="true" className="settings-palette-card__dot" />
              {PALETTE_LABELS[palette]}
              {selected ? (
                <Check aria-hidden="true" className="settings-palette-card__check" size={14} />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function paletteCardStyle(palette: PaletteId, scheme: ResolvedColorScheme): CSSProperties {
  return {
    "--settings-wire-canvas": surfaceColor(palette, scheme, "canvas"),
    "--settings-wire-side": surfaceColor(palette, scheme, "side"),
    "--settings-wire-raised": surfaceColor(palette, scheme, "raised"),
    "--settings-wire-accent": paletteTokens(palette, scheme).accentFill,
  } as CSSProperties;
}

function nextPalette(key: string, value: PaletteId): PaletteId | null {
  if (key === "Home") return PALETTE_IDS[0];
  if (key === "End") return PALETTE_IDS[PALETTE_IDS.length - 1];

  const step = STEP_BY_KEY[key];

  if (step === undefined) return null;

  const current = PALETTE_IDS.indexOf(value);
  return PALETTE_IDS[(Math.max(current, 0) + step + PALETTE_IDS.length) % PALETTE_IDS.length];
}
