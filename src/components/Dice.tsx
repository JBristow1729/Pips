import type { Die } from "../game/types";
import type { CSSProperties } from "react";
import { defaultCustomization, getColorOption, type DiceCustomization } from "../customization/diceCustomization";

const pipMap: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

type Props = {
  die: Die;
  disabled: boolean;
  rolling: boolean;
  compact?: boolean;
  customization?: DiceCustomization;
  interactive?: boolean;
  onClick: () => void;
};

export function Dice({ die, disabled, rolling, compact = false, customization = defaultCustomization, interactive = true, onClick }: Props) {
  const pips = pipMap[die.value];
  const body = getColorOption(customization.body);
  const pip = getColorOption(customization.pipColor);
  const className = `die pip-shape-${customization.pipShape} ${compact ? "die-compact" : ""} ${die.selected ? "selected" : ""} ${rolling ? "rolling" : ""}`;
  const style = {
    "--die-body": body.value,
    "--die-shadow": body.shadow,
    "--pip-color": pip.value,
    "--pip-shadow": pip.shadow
  } as CSSProperties;
  const pipNodes = Array.from({ length: 9 }, (_, index) => (
    <span key={index} className={pips.includes(index) ? "pip visible" : "pip"} />
  ));

  if (!interactive) {
    return (
      <div className={className} style={style} role="img" aria-label={`Die ${die.value}`}>
        {pipNodes}
      </div>
    );
  }

  return (
    <button
      className={className}
      style={style}
      disabled={disabled}
      onClick={onClick}
      type="button"
      aria-label={`Die ${die.value}${die.selected ? " selected" : ""}`}
      aria-pressed={compact ? undefined : die.selected}
    >
      {pipNodes}
    </button>
  );
}
