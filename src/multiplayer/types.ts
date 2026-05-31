import type { GameState, PlayerId } from "../game/types";
import type { DiceCustomization } from "../customization/diceCustomization";

export type ServerMessage =
  | { type: "waiting"; bet: number }
  | { type: "waitingCounts"; counts: Record<number, number> }
  | { type: "matched"; playerId: PlayerId; state: GameState }
  | { type: "state"; state: GameState }
  | { type: "rematchWaiting" }
  | { type: "rematchChallenge"; bet: number }
  | { type: "rematchStarted"; state: GameState }
  | { type: "rematchDeclined" }
  | { type: "rematchCancelled"; by: PlayerId }
  | { type: "error"; message: string };

export type ClientMessage =
  | { type: "join"; bet: number; goal: number; customization?: DiceCustomization }
  | { type: "watchWaitingCounts" }
  | { type: "roll" }
  | { type: "toggleDie"; dieId: string }
  | { type: "hold" }
  | { type: "bank" }
  | { type: "forfeit" }
  | { type: "rematchRequest" }
  | { type: "rematchCancel" }
  | { type: "rematchResponse"; accepted: boolean };
