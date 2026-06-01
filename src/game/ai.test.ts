import { describe, expect, it } from "vitest";
import { chooseAiDice, shouldAiBank } from "./ai";
import { createDice, createGame } from "./gameState";
import type { DieValue, GameState } from "./types";

function aiSelectionState(bet: number, dice: DieValue[]): GameState {
  return {
    ...createGame("singleplayer", bet, 1500),
    activePlayer: "p2",
    phase: "selecting",
    dice: createDice(dice.length, dice)
  };
}

describe("chooseAiDice", () => {
  it("lets easy AI take the obvious immediate singles", () => {
    expect(chooseAiDice(aiSelectionState(0, [1, 1, 3, 5, 5, 6])).sort()).toEqual([1, 1, 5, 5]);
  });

  it("lets expert AI preserve dice when only singles are available", () => {
    expect(chooseAiDice(aiSelectionState(30, [1, 1, 3, 5, 5, 6]))).toEqual([1]);
  });

  it("avoids low-value triple 2s at stronger difficulties", () => {
    expect(chooseAiDice(aiSelectionState(30, [2, 2, 2, 1, 3, 4]))).toEqual([1]);
  });

  it("still takes obviously strong scoring hands", () => {
    expect(chooseAiDice(aiSelectionState(30, [1, 1, 1, 1, 3, 5])).sort()).toEqual([1, 1, 1, 1, 5]);
  });
});

describe("shouldAiBank", () => {
  it("keeps rolling hot dice unless the turn wins the game", () => {
    const state = aiSelectionState(30, [1, 2, 3, 4, 5, 6]);
    expect(shouldAiBank({
      ...state,
      dice: state.dice.map((die) => ({ ...die, selected: true })),
      players: {
        ...state.players,
        p2: { ...state.players.p2, current: 1500 }
      }
    })).toBe(true);

    const notWinning = aiSelectionState(30, [1, 2, 3, 4, 5, 6]);
    expect(shouldAiBank({
      ...notWinning,
      goal: 4000,
      dice: notWinning.dice.map((die) => ({ ...die, selected: true })),
      players: {
        ...notWinning.players,
        p2: { ...notWinning.players.p2, current: 1500 }
      }
    })).toBe(false);
  });

  it("takes maximum risk when the player is about to win", () => {
    const state = aiSelectionState(30, [1, 2, 3, 4]);
    expect(shouldAiBank({
      ...state,
      goal: 1500,
      dice: state.dice.map((die, index) => ({ ...die, selected: index === 0 })),
      players: {
        ...state.players,
        p1: { ...state.players.p1, total: 1450 },
        p2: { ...state.players.p2, total: 500, current: 100 }
      }
    })).toBe(false);
  });

  it("accounts for held turn score when deciding whether the AI is still behind", () => {
    const state = aiSelectionState(30, [1, 2]);
    expect(shouldAiBank({
      ...state,
      goal: 2000,
      dice: state.dice.map((die, index) => ({ ...die, selected: index === 0 })),
      players: {
        ...state.players,
        p1: { ...state.players.p1, total: 1950 },
        p2: { ...state.players.p2, total: 0, held: 1850, current: 50 }
      }
    })).toBe(true);
  });
});
