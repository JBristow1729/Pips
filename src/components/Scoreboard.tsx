import type { CSSProperties } from "react";
import type { PlayerState } from "../game/types";

type Props = {
  player: PlayerState;
  active?: boolean;
};

export function Scoreboard({ player, active }: Props) {
  const rows = [
    ["Total", player.total],
    ["Held", player.held],
    ["Current", player.current]
  ] as const;

  return (
    <section className={`scoreboard ${active ? "active" : ""}`} aria-label={`${player.name} scorecard`}>
      <div className="scoreboard-heading">
        <h2 className="text-fit" style={fittedTextStyle(player.name)}>{player.name}</h2>
        {active && <span className="turn-marker" aria-label="At the table" />}
      </div>
      <div className="score-lines">
        {rows.map(([label, value]) => (
          <div className="score-line" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function fittedTextStyle(value: string): CSSProperties {
  const visibleLength = value.trim().length;
  const scale = visibleLength > 12 ? Math.max(0.75, 12 / visibleLength) : 1;
  return { "--text-fit-scale": scale } as CSSProperties;
}
