import type { PlayerState } from "../game/types";

type Props = {
  player: PlayerState;
  active?: boolean;
};

export function Scoreboard({ player, active }: Props) {
  return (
    <section className={`scoreboard ${active ? "active" : ""}`}>
      <h2>{player.name}</h2>
      <p>Total: {player.total}</p>
      <p>Held: {player.held}</p>
      <p>Current: {player.current}</p>
    </section>
  );
}
