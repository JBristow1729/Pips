import type { ClientMessage, ServerMessage } from "./types";
import type { DiceCustomization } from "../customization/diceCustomization";

export type MultiplayerConnection = {
  send: (message: ClientMessage) => void;
  close: () => void;
};

export function watchMultiplayerWaitingCounts(
  onCounts: (counts: Record<number, number>) => void,
  onError: (message: string) => void
): MultiplayerConnection {
  const url = getMultiplayerUrl();
  if (!url) {
    return {
      send() {
        return undefined;
      },
      close() {
        return undefined;
      }
    };
  }
  const socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "watchWaitingCounts" } satisfies ClientMessage));
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data) as ServerMessage;
    if (message.type === "waitingCounts") onCounts(message.counts);
  });

  socket.addEventListener("error", () => {
    onError("Could not load multiplayer waiting counts.");
  });

  return {
    send(message) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    close() {
      socket.close();
    }
  };
}

export function connectMultiplayer(
  bet: number,
  goal: number,
  customization: DiceCustomization,
  onMessage: (message: ServerMessage) => void,
  onError: (message: string) => void
): MultiplayerConnection {
  const url = getMultiplayerUrl();
  if (!url) {
    onError("Multiplayer backend is not configured for this deployment.");
    return {
      send() {
        return undefined;
      },
      close() {
        return undefined;
      }
    };
  }
  const socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "join", bet, goal, customization } satisfies ClientMessage));
  });

  socket.addEventListener("message", (event) => {
    onMessage(JSON.parse(event.data) as ServerMessage);
  });

  socket.addEventListener("error", () => {
    onError("Could not connect to multiplayer backend.");
  });

  return {
    send(message) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    close() {
      socket.close();
    }
  };
}

function getMultiplayerUrl() {
  if (import.meta.env.VITE_MULTIPLAYER_URL) return import.meta.env.VITE_MULTIPLAYER_URL;
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  if (isLocal) return `ws://${host}:1999`;
  return "";
}
