import type { ClientMessage, ServerMessage } from "./types";

export type MultiplayerConnection = {
  send: (message: ClientMessage) => void;
  close: () => void;
};

export function connectMultiplayer(
  bet: number,
  goal: number,
  onMessage: (message: ServerMessage) => void,
  onError: (message: string) => void
): MultiplayerConnection {
  const url = import.meta.env.VITE_MULTIPLAYER_URL || "ws://localhost:1999";
  const socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "join", bet, goal } satisfies ClientMessage));
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
