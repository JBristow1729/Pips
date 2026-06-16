import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { createGame, reduceGame } from "../src/game/gameState";
import { defaultCustomization, type DiceCustomization } from "../src/customization/diceCustomization";
import { BET_GOALS, type ClientAction, type GameState, type PlayerId } from "../src/game/types";
import type { ClientMessage, LobbyState, PublicLobby, ServerMessage } from "../src/multiplayer/types";
import { validateUsername } from "../src/storage/options";

type Client = {
  socket: WebSocket;
  id?: PlayerId;
  profileId?: string;
  hash?: string;
  roomId?: string;
  bet?: number;
  username?: string;
  customization?: DiceCustomization;
  watchingCounts?: boolean;
  watchingLobbies?: boolean;
};

type Room = {
  id: string;
  code: string;
  clients: Client[];
  hostId: PlayerId;
  bet: number;
  goal: number;
  public: boolean;
  ready: Partial<Record<PlayerId, boolean>>;
  state?: GameState;
  rematchFrom?: PlayerId;
  turnTimer?: ReturnType<typeof setTimeout>;
  turnDeadline?: number;
};

const port = Number.parseInt(process.env.PORT ?? "1999", 10);
const turnDurationMs = 30_000;
const waiting = new Map<number, Client[]>();
const rooms = new Map<string, Room>();
const onlineProfiles = new Map<string, Client>();
const countWatchers = new Set<Client>();
const lobbyWatchers = new Set<Client>();
const httpServer = createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("Pips multiplayer server is running.\n");
});
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket) => {
  const client: Client = { socket };

  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as ClientMessage;

    if (message.type === "watchWaitingCounts") {
      client.watchingCounts = true;
      countWatchers.add(client);
      sendWaitingCounts(client);
      return;
    }

    if (message.type === "identify") {
      client.profileId = message.profile.id;
      client.username = cleanUsername(message.profile.username);
      client.hash = message.profile.hash;
      onlineProfiles.set(message.profile.id, client);
      return;
    }

    if (message.type === "listLobbies") {
      client.watchingLobbies = true;
      lobbyWatchers.add(client);
      sendPublicLobbies(client);
      return;
    }

    if (message.type === "join") {
      client.watchingCounts = false;
      countWatchers.delete(client);
      client.customization = message.customization;
      client.username = "Player";
      joinQueue(client, message.bet);
      return;
    }

    if (message.type === "createLobby") {
      client.customization = message.customization;
      client.username = cleanUsername(message.username);
      client.profileId = message.profileId ?? client.profileId;
      client.hash = message.hash ?? client.hash;
      if (client.profileId) onlineProfiles.set(client.profileId, client);
      createLobby(client, message.bet, message.goal, message.public);
      return;
    }

    if (message.type === "joinLobby") {
      client.customization = message.customization;
      client.username = cleanUsername(message.username);
      client.profileId = message.profileId ?? client.profileId;
      client.hash = message.hash ?? client.hash;
      if (client.profileId) onlineProfiles.set(client.profileId, client);
      joinLobby(client, message);
      return;
    }

    if (message.type === "acceptInvite") {
      const inviteRoom = rooms.get(message.lobbyId);
      if (!inviteRoom || inviteRoom.state || inviteRoom.clients.length >= 2) {
        send(client, { type: "inviteUnavailable", reason: "full" });
        return;
      }
      client.customization = message.customization;
      client.username = cleanUsername(message.username);
      client.profileId = message.profileId ?? client.profileId;
      client.hash = message.hash ?? client.hash;
      if (client.profileId) onlineProfiles.set(client.profileId, client);
      joinLobby(client, { type: "joinLobby", username: client.username, profileId: client.profileId, hash: client.hash, lobbyId: message.lobbyId, customization: message.customization });
      return;
    }

    const room = client.roomId ? rooms.get(client.roomId) : undefined;
    if (!room || !client.id) {
      send(client, { type: "error", message: "You are not in a game room yet." });
      return;
    }

    if (message.type === "updateLobby") {
      updateLobby(room, client, message);
      return;
    }

    if (message.type === "setReady") {
      if (room.state) return;
      room.ready[client.id] = message.ready;
      broadcastLobby(room);
      maybeStartLobby(room);
      return;
    }

    if (message.type === "leaveLobby") {
      leaveLobby(room, client, false);
      return;
    }

    if (message.type === "inviteFriend") {
      inviteFriend(room, client, message.targetProfileId, message.lobbyId);
      return;
    }

    if (message.type === "rematchRequest") {
      requestRematch(room, client);
      return;
    }

    if (message.type === "rematchCancel") {
      cancelRematch(room, client);
      return;
    }

    if (message.type === "rematchResponse") {
      respondToRematch(room, client, message.accepted);
      return;
    }

    const action = toAction(message, client.id);
    if (!action || !room.state) return;
    room.state = reduceGame(room.state, action);
    broadcast(room, { type: "state", state: room.state });
    afterGameAction(room, action);
  });

  socket.on("close", () => {
    if (client.profileId && onlineProfiles.get(client.profileId) === client) onlineProfiles.delete(client.profileId);
    countWatchers.delete(client);
    lobbyWatchers.delete(client);
    removeFromQueue(client);
    const room = client.roomId ? rooms.get(client.roomId) : undefined;
    if (!room || !client.id) return;
    if (!room.state) {
      leaveLobby(room, client, true);
      return;
    }
    if (room.state.phase !== "gameOver") {
      clearTurnTimer(room);
      room.state = reduceGame(room.state, { type: "forfeit", playerId: client.id });
      broadcast(room, { type: "state", state: room.state });
    }
  });
});

function joinQueue(client: Client, bet: number) {
  const normalizedBet = normalizeBet(bet);
  client.bet = normalizedBet;
  const queue = waiting.get(normalizedBet) ?? [];
  queue.push(client);
  waiting.set(normalizedBet, queue);
  send(client, { type: "waiting", bet: normalizedBet });
  broadcastWaitingCounts();

  if (queue.length >= 2) {
    const players = queue.splice(0, 2);
    createMatchedRoom(normalizedBet, players[0], players[1]);
    broadcastWaitingCounts();
  }
}

function createMatchedRoom(bet: number, first: Client, second: Client) {
  const room = makeRoom(first, bet, BET_GOALS[bet] ?? 1500, false);
  second.id = "p2";
  second.roomId = room.id;
  second.username = uniqueUsername(room, second.username ?? "Player");
  room.clients.push(second);
  room.ready = { p1: true, p2: true };
  rooms.set(room.id, room);
  startLobbyGame(room);
}

function createLobby(client: Client, bet: number, goal: number, isPublic: boolean) {
  const room = makeRoom(client, bet, goal, isPublic);
  rooms.set(room.id, room);
  broadcastLobby(room);
  broadcastPublicLobbies();
}

function makeRoom(host: Client, bet: number, goal: number, isPublic: boolean): Room {
  const id = `room-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  host.id = "p1";
  host.roomId = id;
  host.bet = normalizeBet(bet);
  return {
    id,
    code: uniqueCode(),
    clients: [host],
    hostId: "p1",
    bet: normalizeBet(bet),
    goal: BET_GOALS[normalizeBet(bet)] ?? goal,
    public: isPublic,
    ready: { p1: false }
  };
}

function joinLobby(client: Client, message: Extract<ClientMessage, { type: "joinLobby" }>) {
  const code = message.code?.toUpperCase();
  const room = [...rooms.values()].find((candidate) => {
    if (candidate.state || candidate.clients.length >= 2) return false;
    if (message.lobbyId) return candidate.id === message.lobbyId;
    return Boolean(code && candidate.code === code);
  });

  if (!room) {
    send(client, { type: "error", message: "No lobby exists for that code." });
    return;
  }

  client.id = room.clients.some((candidate) => candidate.id === "p1") ? "p2" : "p1";
  client.roomId = room.id;
  client.bet = room.bet;
  client.username = uniqueUsername(room, client.username ?? "Player");
  room.clients.push(client);
  room.ready[client.id] = false;
  broadcastLobby(room);
  broadcastPublicLobbies();
}

function updateLobby(room: Room, client: Client, message: Extract<ClientMessage, { type: "updateLobby" }>) {
  if (room.state || client.id !== room.hostId) return;
  const nextBet = message.bet === undefined ? room.bet : normalizeBet(message.bet);
  room.bet = nextBet;
  room.goal = BET_GOALS[nextBet] ?? room.goal;
  room.public = message.public ?? room.public;
  room.ready = Object.fromEntries(room.clients.map((candidate) => [candidate.id, false])) as Partial<Record<PlayerId, boolean>>;
  broadcastLobby(room);
  broadcastPublicLobbies();
}

function leaveLobby(room: Room, client: Client, silent: boolean) {
  if (!client.id) return;
  room.clients = room.clients.filter((candidate) => candidate !== client);
  delete room.ready[client.id];
  client.roomId = undefined;
  client.id = undefined;

  if (room.clients.length === 0) {
    rooms.delete(room.id);
    clearTurnTimer(room);
    broadcastPublicLobbies();
    return;
  }

  if (room.hostId === "p1" && !room.clients.some((candidate) => candidate.id === "p1")) promoteHost(room);
  if (room.hostId === "p2" && !room.clients.some((candidate) => candidate.id === "p2")) promoteHost(room);
  room.ready = Object.fromEntries(room.clients.map((candidate) => [candidate.id, false])) as Partial<Record<PlayerId, boolean>>;
  if (!silent) send(client, { type: "error", message: "You left the lobby." });
  broadcastLobby(room);
  broadcastPublicLobbies();
}

function promoteHost(room: Room) {
  const nextHost = room.clients[0];
  if (nextHost?.id) room.hostId = nextHost.id;
}

function maybeStartLobby(room: Room) {
  if (room.clients.length !== 2) return;
  if (!room.clients.every((client) => client.id && room.ready[client.id])) return;
  startLobbyGame(room);
}

function startLobbyGame(room: Room) {
  room.state = createGame("multiplayer", room.bet, room.goal, [playerName(room, "p1"), playerName(room, "p2")], {
    p1: room.clients.find((client) => client.id === "p1")?.customization ?? defaultCustomization,
    p2: room.clients.find((client) => client.id === "p2")?.customization ?? defaultCustomization
  }, randomStartingPlayer());
  broadcastPublicLobbies();
  for (const client of room.clients) {
    if (client.id) {
      const opponent = room.clients.find((candidate) => candidate !== client);
      send(client, { type: "matched", playerId: client.id, state: room.state, opponentProfileId: opponent?.profileId });
    }
  }
  armTurnTimer(room);
}

function afterGameAction(room: Room, action: ClientAction) {
  if (!room.state) return;
  if (room.state.phase === "gameOver") {
    clearTurnTimer(room);
    return;
  }
  if (action.type === "roll" && room.state.phase === "bust") {
    clearTurnTimer(room);
    const bustedPlayer = room.state.activePlayer;
    setTimeout(() => {
      const latest = rooms.get(room.id);
      if (!latest?.state || latest.state.phase !== "bust" || latest.state.activePlayer !== bustedPlayer) return;
      latest.state = reduceGame(latest.state, { type: "finishBust", playerId: bustedPlayer });
      broadcast(latest, { type: "state", state: latest.state });
      armTurnTimer(latest);
    }, 4200);
    return;
  }
  if (action.type === "hold" || action.type === "bank" || action.type === "finishBust") {
    armTurnTimer(room);
  }
}

function armTurnTimer(room: Room) {
  if (!room.state || room.state.phase === "gameOver" || room.state.phase === "bust") return;
  clearTurnTimer(room);
  const playerId = room.state.activePlayer;
  room.turnDeadline = Date.now() + turnDurationMs;
  room.turnTimer = setTimeout(() => {
    const latest = rooms.get(room.id);
    if (!latest?.state || latest.state.phase === "gameOver" || latest.state.activePlayer !== playerId) return;
    latest.state = reduceGame(latest.state, { type: "forfeit", playerId });
    clearTurnTimer(latest);
    broadcast(latest, { type: "state", state: latest.state });
  }, turnDurationMs);
  broadcast(room, { type: "turnTimer", playerId, endsAt: room.turnDeadline, durationMs: turnDurationMs });
}

function clearTurnTimer(room: Room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = undefined;
  room.turnDeadline = undefined;
}

function requestRematch(room: Room, client: Client) {
  if (!room.state || room.state.phase !== "gameOver" || !client.id) return;
  if (room.rematchFrom && room.rematchFrom !== client.id) {
    startRematch(room);
    return;
  }

  room.rematchFrom = client.id;
  send(client, { type: "rematchWaiting" });
  const opponent = room.clients.find((candidate) => candidate !== client);
  if (opponent) send(opponent, { type: "rematchChallenge", bet: room.state.bet });
}

function cancelRematch(room: Room, client: Client) {
  if (!room.state || room.state.phase !== "gameOver" || !client.id || room.rematchFrom !== client.id) return;
  room.rematchFrom = undefined;
  broadcast(room, { type: "rematchCancelled", by: client.id });
}

function respondToRematch(room: Room, client: Client, accepted: boolean) {
  if (!room.rematchFrom) return;
  if (client.id === room.rematchFrom) return;
  if (!accepted) {
    room.rematchFrom = undefined;
    broadcast(room, { type: "rematchDeclined" });
    clearTurnTimer(room);
    rooms.delete(room.id);
    return;
  }

  startRematch(room);
}

function startRematch(room: Room) {
  if (!room.state) return;
  room.rematchFrom = undefined;
  room.state = createGame("multiplayer", room.state.bet, BET_GOALS[room.state.bet] ?? 1500, [playerName(room, "p1"), playerName(room, "p2")], {
    p1: room.clients.find((client) => client.id === "p1")?.customization ?? defaultCustomization,
    p2: room.clients.find((client) => client.id === "p2")?.customization ?? defaultCustomization
  }, randomStartingPlayer());
  broadcast(room, { type: "rematchStarted", state: room.state });
  armTurnTimer(room);
}

function inviteFriend(room: Room, client: Client, targetProfileId: string, lobbyId: string) {
  if (room.id !== lobbyId || room.state || room.clients.length >= 2) {
    send(client, { type: "inviteUnavailable", reason: "full" });
    return;
  }
  const target = onlineProfiles.get(targetProfileId);
  if (!target) {
    send(client, { type: "inviteUnavailable", reason: "offline" });
    return;
  }
  const targetRoom = target.roomId ? rooms.get(target.roomId) : undefined;
  if (targetRoom?.state && targetRoom.state.phase !== "gameOver") {
    send(client, { type: "inviteUnavailable", reason: "in-game" });
    return;
  }
  if (client.profileId === targetProfileId) return;
  send(target, {
    type: "inviteChallenge",
    from: { id: client.profileId, username: client.username ?? "Player", hash: client.hash },
    lobbyId: room.id
  });
  send(client, { type: "inviteSent" });
}

function randomStartingPlayer(): PlayerId {
  return Math.random() < 0.5 ? "p1" : "p2";
}

function toAction(message: ClientMessage, playerId: PlayerId): ClientAction | null {
  if (message.type === "roll") return { type: "roll", playerId };
  if (message.type === "toggleDie") return { type: "toggleDie", playerId, dieId: message.dieId };
  if (message.type === "hold") return { type: "hold", playerId };
  if (message.type === "bank") return { type: "bank", playerId };
  if (message.type === "forfeit") return { type: "forfeit", playerId };
  return null;
}

function lobbyState(room: Room): LobbyState {
  return {
    id: room.id,
    code: room.code,
    bet: room.bet,
    goal: room.goal,
    public: room.public,
    players: room.clients
      .filter((client): client is Client & { id: PlayerId } => Boolean(client.id))
      .map((client) => ({
        id: client.id,
        profileId: client.profileId,
        username: client.username ?? "Player",
        hash: client.hash,
        ready: Boolean(room.ready[client.id]),
        isHost: client.id === room.hostId
      }))
  };
}

function publicLobbies(): PublicLobby[] {
  return [...rooms.values()]
    .filter((room) => room.public && !room.state && room.clients.length === 1)
    .map((room) => ({
      id: room.id,
      code: room.code,
      host: room.clients[0]?.username ?? "Player",
      bet: room.bet,
      goal: room.goal
    }));
}

function broadcastLobby(room: Room) {
  for (const client of room.clients) {
    if (client.id) send(client, { type: "lobby", lobby: lobbyState(room), playerId: client.id });
  }
}

function broadcast(room: Room, message: ServerMessage) {
  for (const client of room.clients) send(client, message);
}

function send(client: Client, message: ServerMessage) {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(message));
  }
}

function waitingCounts(): Record<number, number> {
  return Object.fromEntries([0, 10, 20, 30].map((bet) => [bet, waiting.get(bet)?.length ?? 0]));
}

function sendWaitingCounts(client: Client) {
  send(client, { type: "waitingCounts", counts: waitingCounts() });
}

function broadcastWaitingCounts() {
  for (const client of countWatchers) sendWaitingCounts(client);
}

function sendPublicLobbies(client: Client) {
  send(client, { type: "publicLobbies", lobbies: publicLobbies() });
}

function broadcastPublicLobbies() {
  for (const client of lobbyWatchers) sendPublicLobbies(client);
}

function removeFromQueue(client: Client) {
  if (client.bet === undefined) return;
  const queue = waiting.get(client.bet);
  if (!queue) return;
  waiting.set(client.bet, queue.filter((candidate) => candidate !== client));
  broadcastWaitingCounts();
}

function normalizeBet(bet: number) {
  return [0, 10, 20, 30].includes(bet) ? bet : 0;
}

function cleanUsername(username: string) {
  const cleaned = username.trim().slice(0, 16);
  return !validateUsername(cleaned) ? cleaned : "Player";
}

function uniqueUsername(room: Room, username: string) {
  const existing = new Set(room.clients.map((client) => (client.username ?? "Player").toLowerCase()));
  if (!existing.has(username.toLowerCase())) return username;
  let suffix = 2;
  let candidate = `${username} (${suffix})`;
  while (existing.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${username} (${suffix})`;
  }
  return candidate;
}

function playerName(room: Room, playerId: PlayerId) {
  return room.clients.find((client) => client.id === playerId)?.username ?? (playerId === "p1" ? "Player 1" : "Player 2");
}

function uniqueCode() {
  let code = randomCode();
  while ([...rooms.values()].some((room) => room.code === code)) code = randomCode();
  return code;
}

function randomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
}

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Pips multiplayer server listening on ws://localhost:${port}`);
});
