import { describe, expect, it } from "vitest";
import { createGame } from "./gameState";

describe("createGame", () => {
  it("uses the requested starting player", () => {
    const game = createGame("multiplayer", 0, 1500, ["Host", "Guest"], undefined, "p2");

    expect(game.activePlayer).toBe("p2");
    expect(game.message).toBe("Guest's turn");
  });
});
