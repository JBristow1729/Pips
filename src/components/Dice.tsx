import type { Die, DieValue } from "../game/types";
import type { CSSProperties } from "react";
import { defaultCustomization, getColorOption, type DiceCustomization } from "../customization/diceCustomization";

const pipMap: Record<DieValue, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

const cubeFaces: Array<{ side: string; value: DieValue }> = [
  { side: "front", value: 1 },
  { side: "back", value: 6 },
  { side: "right", value: 2 },
  { side: "left", value: 5 },
  { side: "top", value: 3 },
  { side: "bottom", value: 4 }
];

type Props = {
  die: Die;
  disabled: boolean;
  rolling: boolean;
  rollMotion?: {
    axisX: string;
    axisY: string;
    axisZ: string;
    turns: string;
    duration: string;
  };
  compact?: boolean;
  customization?: DiceCustomization;
  interactive?: boolean;
  onClick: () => void;
};

export function Dice({
  die,
  disabled,
  rolling,
  rollMotion,
  compact = false,
  customization = defaultCustomization,
  interactive = true,
  onClick
}: Props) {
  const body = getColorOption(customization.body);
  const pip = getColorOption(customization.pipColor);
  const className = `die pip-shape-${customization.pipShape} ${compact ? "die-compact" : ""} ${die.selected ? "selected" : ""} ${rolling ? "rolling" : ""}`;
  const style = {
    "--die-body": body.value,
    "--die-shadow": body.shadow,
    "--pip-color": pip.value,
    "--pip-shadow": pip.shadow,
    "--roll-axis-x": rollMotion?.axisX ?? "1",
    "--roll-axis-y": rollMotion?.axisY ?? "0.72",
    "--roll-axis-z": rollMotion?.axisZ ?? "0.38",
    "--roll-turns": rollMotion?.turns ?? "1260deg",
    "--roll-duration": rollMotion?.duration ?? "1.1s"
  } as CSSProperties;
  const pipNodes = createPipNodes(die.value);
  const contents = rolling ? (
    <span className="die-cube" aria-hidden="true">
      {cubeFaces.map((face) => (
        <span key={face.side} className={`die-face die-face-${face.side}`}>
          {createPipNodes(face.value)}
        </span>
      ))}
    </span>
  ) : (
    pipNodes
  );

  if (!interactive) {
    return (
      <div className={className} style={style} role="img" aria-label={`Die ${die.value}`}>
        {contents}
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
      aria-label={rolling ? "Rolling die" : `Die ${die.value}${die.selected ? " selected" : ""}`}
      aria-pressed={compact ? undefined : die.selected}
    >
      {contents}
    </button>
  );
}

function createPipNodes(value: DieValue) {
  const pips = pipMap[value];
  return Array.from({ length: 9 }, (_, index) => (
    <span key={index} className={pips.includes(index) ? "pip visible" : "pip"} />
  ));
}
