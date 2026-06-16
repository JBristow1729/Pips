import type { GameState, PlayerId } from "../game/types";
import type { DiceCustomization } from "../customization/diceCustomization";

export type LobbyPlayer = {
  id: PlayerId;
  profileId?: string;
  username: string;
  hash?: string;
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
  | { type: "matched"; playerId: PlayerId; state: GameState; opponentProfileId?: string }
  | { type: "state"; state: GameState }
  | { type: "turnTimer"; playerId: PlayerId; endsAt: number; durationMs: number }
  | { type: "inviteChallenge"; from: { id?: string; username: string; hash?: string }; lobbyId: string }
  | { type: "inviteUnavailable"; reason: "offline" | "in-game" | "full" }
  | { type: "inviteSent" }
  | { type: "inviteDeclined"; from: { username: string } }
  | { type: "opponentLeft" }
  | { type: "profileStatuses"; statuses: Record<string, { online: boolean; inGame: boolean }> }
  | { type: "rematchWaiting" }
  | { type: "rematchChallenge"; bet: number }
  | { type: "rematchStarted"; state: GameState }
  | { type: "rematchDeclined" }
  | { type: "rematchCancelled"; by: PlayerId }
  | { type: "error"; message: string };

export type ClientMessage =
  | { type: "identify"; profile: { id: string; username: string; hash: string } }
  | { type: "join"; bet: number; goal: number; customization?: DiceCustomization }
  | { type: "createLobby"; username: string; profileId?: string; hash?: string; bet: number; goal: number; public: boolean; customization?: DiceCustomization }
  | { type: "joinLobby"; username: string; profileId?: string; hash?: string; code?: string; lobbyId?: string; customization?: DiceCustomization }
  | { type: "inviteFriend"; targetProfileId: string; lobbyId: string }
  | { type: "acceptInvite"; lobbyId: string; username: string; profileId?: string; hash?: string; customization?: DiceCustomization }
  | { type: "declineInvite"; lobbyId: string }
  | { type: "watchProfiles"; profileIds: string[] }
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
