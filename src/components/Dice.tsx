import type { Die } from "../game/types";

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
  onClick: () => void;
};

export function Dice({ die, disabled, rolling, compact = false, onClick }: Props) {
  const pips = pipMap[die.value];
  return (
    <button
      className={`die ${compact ? "die-compact" : ""} ${die.selected ? "selected" : ""} ${rolling ? "rolling" : ""}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={`Die ${die.value}${die.selected ? " selected" : ""}`}
    >
      {Array.from({ length: 9 }, (_, index) => (
        <span key={index} className={pips.includes(index) ? "pip visible" : "pip"} />
      ))}
    </button>
  );
}
