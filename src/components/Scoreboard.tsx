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
    <section className={`scoreboard ${active ? "active" : ""}`}>
      <h2>{player.name}</h2>
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
