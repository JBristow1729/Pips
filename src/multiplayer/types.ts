import type { GameState, PlayerId } from "../game/types";

export type ServerMessage =
  | { type: "waiting"; bet: number }
  | { type: "matched"; playerId: PlayerId; state: GameState }
  | { type: "state"; state: GameState }
  | { type: "error"; message: string };

export type ClientMessage =
  | { type: "join"; bet: number; goal: number }
  | { type: "roll" }
  | { type: "toggleDie"; dieId: string }
  | { type: "hold" }
  | { type: "bank" }
  | { type: "forfeit" };
