import type { GameState, PlayerId } from "../game/types";
import type { DiceCustomization } from "../customization/diceCustomization";

export type LobbyPlayer = {
  id: PlayerId;
  username: string;
  ready: boolean;
  isHost: boolean;
};

export type LobbyState = {
  id: string;
  code: string;
  bet: number;
  goal: number;
  public: boolean;
  players: LobbyPlayer[];
};

export type PublicLobby = {
  id: string;
  code: string;
  host: string;
  bet: number;
  goal: number;
};

export type ServerMessage =
  | { type: "waiting"; bet: number }
  | { type: "waitingCounts"; counts: Record<number, number> }
  | { type: "publicLobbies"; lobbies: PublicLobby[] }
  | { type: "lobby"; lobby: LobbyState; playerId: PlayerId }
  | { type: "matched"; playerId: PlayerId; state: GameState }
  | { type: "state"; state: GameState }
  | { type: "turnTimer"; playerId: PlayerId; endsAt: number; durationMs: number }
  | { type: "rematchWaiting" }
  | { type: "rematchChallenge"; bet: number }
  | { type: "rematchStarted"; state: GameState }
  | { type: "rematchDeclined" }
  | { type: "rematchCancelled"; by: PlayerId }
  | { type: "error"; message: string };

export type ClientMessage =
  | { type: "join"; bet: number; goal: number; customization?: DiceCustomization }
  | { type: "createLobby"; username: string; bet: number; goal: number; public: boolean; customization?: DiceCustomization }
  | { type: "joinLobby"; username: string; code?: string; lobbyId?: string; customization?: DiceCustomization }
  | { type: "updateLobby"; bet?: number; goal?: number; public?: boolean }
  | { type: "setReady"; ready: boolean }
  | { type: "leaveLobby" }
  | { type: "listLobbies" }
  | { type: "watchWaitingCounts" }
  | { type: "roll" }
  | { type: "toggleDie"; dieId: string }
  | { type: "hold" }
  | { type: "bank" }
  | { type: "forfeit" }
  | { type: "rematchRequest" }
  | { type: "rematchCancel" }
  | { type: "rematchResponse"; accepted: boolean };
