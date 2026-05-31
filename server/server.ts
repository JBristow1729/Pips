import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { createGame, reduceGame } from "../src/game/gameState";
import { defaultCustomization, type DiceCustomization } from "../src/customization/diceCustomization";
import { BET_GOALS, type ClientAction, type GameState, type PlayerId } from "../src/game/types";
import type { ClientMessage, ServerMessage } from "../src/multiplayer/types";

type Client = {
  socket: WebSocket;
  id?: PlayerId;
  roomId?: string;
  bet?: number;
  customization?: DiceCustomization;
};

type Room = {
  id: string;
  clients: Client[];
  state: GameState;
};

const port = Number.parseInt(process.env.PORT ?? "1999", 10);
const waiting = new Map<number, Client[]>();
const rooms = new Map<string, Room>();
const httpServer = createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("Tavern Dice multiplayer server is running.\n");
});
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket) => {
  const client: Client = { socket };

  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as ClientMessage;
    if (message.type === "join") {
      client.customization = message.customization;
      joinQueue(client, message.bet);
      return;
    }

    const room = client.roomId ? rooms.get(client.roomId) : undefined;
    if (!room || !client.id) {
      send(client, { type: "error", message: "You are not in a game room yet." });
      return;
    }

    const action = toAction(message, client.id);
    if (!action) return;
    room.state = reduceGame(room.state, action);
    broadcast(room, { type: "state", state: room.state });
    if (action.type === "roll" && room.state.phase === "bust") {
      const bustedPlayer = room.state.activePlayer;
      setTimeout(() => {
        const latest = rooms.get(room.id);
        if (!latest || latest.state.phase !== "bust" || latest.state.activePlayer !== bustedPlayer) return;
        latest.state = reduceGame(latest.state, { type: "finishBust", playerId: bustedPlayer });
        broadcast(latest, { type: "state", state: latest.state });
      }, 4200);
    }
  });

  socket.on("close", () => {
    removeFromQueue(client);
    const room = client.roomId ? rooms.get(client.roomId) : undefined;
    if (room && client.id && room.state.phase !== "gameOver") {
      room.state = reduceGame(room.state, { type: "forfeit", playerId: client.id });
      broadcast(room, { type: "state", state: room.state });
    }
  });
});

function joinQueue(client: Client, bet: number) {
  const normalizedBet = [0, 10, 20, 30].includes(bet) ? bet : 0;
  client.bet = normalizedBet;
  const queue = waiting.get(normalizedBet) ?? [];
  queue.push(client);
  waiting.set(normalizedBet, queue);
  send(client, { type: "waiting", bet: normalizedBet });

  if (queue.length >= 2) {
    const players = queue.splice(0, 2);
    createRoom(normalizedBet, players[0], players[1]);
  }
}

function createRoom(bet: number, first: Client, second: Client) {
  const id = `room-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  first.id = "p1";
  second.id = "p2";
  first.roomId = id;
  second.roomId = id;
  const state = createGame("multiplayer", bet, BET_GOALS[bet] ?? 1500, ["Player 1", "Player 2"], {
    p1: first.customization ?? defaultCustomization,
    p2: second.customization ?? defaultCustomization
  });
  const room = { id, clients: [first, second], state };
  rooms.set(id, room);
  send(first, { type: "matched", playerId: "p1", state });
  send(second, { type: "matched", playerId: "p2", state });
}

function removeFromQueue(client: Client) {
  if (client.bet === undefined) return;
  const queue = waiting.get(client.bet);
  if (!queue) return;
  waiting.set(client.bet, queue.filter((candidate) => candidate !== client));
}

function toAction(message: ClientMessage, playerId: PlayerId): ClientAction | null {
  if (message.type === "roll") return { type: "roll", playerId };
  if (message.type === "toggleDie") return { type: "toggleDie", playerId, dieId: message.dieId };
  if (message.type === "hold") return { type: "hold", playerId };
  if (message.type === "bank") return { type: "bank", playerId };
  if (message.type === "forfeit") return { type: "forfeit", playerId };
  return null;
}

function broadcast(room: Room, message: ServerMessage) {
  for (const client of room.clients) send(client, message);
}

function send(client: Client, message: ServerMessage) {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(message));
  }
}

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Tavern Dice multiplayer server listening on ws://localhost:${port}`);
});
