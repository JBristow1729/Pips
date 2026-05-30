export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;
export type Mode = "singleplayer" | "multiplayer";
export type PlayerId = "p1" | "p2";

export type PlayerState = {
  id: PlayerId;
  name: string;
  total: number;
  held: number;
  current: number;
};

export type GamePhase = "ready" | "rolling" | "selecting" | "bust" | "gameOver";

export type Die = {
  id: string;
  value: DieValue;
  selected: boolean;
};

export type GameState = {
  mode: Mode;
  bet: number;
  goal: number;
  players: Record<PlayerId, PlayerState>;
  activePlayer: PlayerId;
  dice: Die[];
  phase: GamePhase;
  message: string;
  winner?: PlayerId;
  resolved: boolean;
};

export type ClientAction =
  | { type: "roll"; playerId: PlayerId }
  | { type: "toggleDie"; playerId: PlayerId; dieId: string }
  | { type: "hold"; playerId: PlayerId }
  | { type: "bank"; playerId: PlayerId }
  | { type: "forfeit"; playerId: PlayerId };

export const BET_GOALS: Record<number, number> = {
  0: 1500,
  10: 2000,
  20: 3000,
  30: 4000
};
