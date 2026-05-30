import { rollHasScoreableDice, scoreDice } from "./scoring";
import type { ClientAction, Die, DieValue, GameState, Mode, PlayerId } from "./types";

export function randomDie(): DieValue {
  return (Math.floor(Math.random() * 6) + 1) as DieValue;
}

export function otherPlayer(playerId: PlayerId): PlayerId {
  return playerId === "p1" ? "p2" : "p1";
}

function turnMessage(name: string) {
  return name === "You" ? "Your turn" : `${name}'s turn`;
}

function keepsRollingMessage(name: string) {
  return name === "You" ? "You keep rolling" : `${name} keeps rolling`;
}

function winMessage(name: string) {
  return name === "You" ? "You win!" : `${name} wins!`;
}

export function createDice(count: number, values?: DieValue[]): Die[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
    value: values?.[index] ?? randomDie(),
    selected: false
  }));
}

export function createGame(mode: Mode, bet: number, goal: number, names = ["You", "Computer"]): GameState {
  return {
    mode,
    bet,
    goal,
    activePlayer: "p1",
    phase: "ready",
    message: turnMessage(names[0]),
    dice: createDice(6, [1, 1, 1, 5, 2, 3]),
    players: {
      p1: { id: "p1", name: names[0], total: 0, held: 0, current: 0 },
      p2: { id: "p2", name: names[1], total: 0, held: 0, current: 0 }
    },
    resolved: false
  };
}

function selectedValues(state: GameState): DieValue[] {
  return state.dice.filter((die) => die.selected).map((die) => die.value);
}

function updateCurrent(state: GameState): GameState {
  const result = scoreDice(selectedValues(state));
  return {
    ...state,
    players: {
      ...state.players,
      [state.activePlayer]: {
        ...state.players[state.activePlayer],
        current: result.valid ? result.score : 0
      }
    }
  };
}

function passTurn(state: GameState, message?: string): GameState {
  const next = otherPlayer(state.activePlayer);
  const defaultMessage = turnMessage(state.players[next].name);
  return {
    ...state,
    activePlayer: next,
    dice: createDice(6),
    phase: "ready",
    message: message ?? defaultMessage,
    players: {
      ...state.players,
      [state.activePlayer]: { ...state.players[state.activePlayer], held: 0, current: 0 }
    }
  };
}

export function reduceGame(state: GameState, action: ClientAction, forcedRoll?: DieValue[]): GameState {
  if (state.phase === "gameOver") return state;
  if (action.playerId !== state.activePlayer && action.type !== "forfeit") return state;

  if (action.type === "roll") {
    if (state.phase !== "ready") return state;
    const dice = createDice(state.dice.length || 6, forcedRoll);
    if (!rollHasScoreableDice(dice.map((die) => die.value))) {
      return {
        ...state,
        dice,
        phase: "bust" as const,
        message: "BUST",
        players: {
          ...state.players,
          [state.activePlayer]: { ...state.players[state.activePlayer], held: 0, current: 0 }
        }
      };
    }
    return {
      ...state,
      dice,
      phase: "selecting",
      message: `${state.players[state.activePlayer].name} rolled`
    };
  }

  if (action.type === "finishBust") {
    if (state.phase !== "bust") return state;
    return passTurn(state);
  }

  if (action.type === "toggleDie") {
    if (state.phase !== "selecting") return state;
    return updateCurrent({
      ...state,
      dice: state.dice.map((die) => (die.id === action.dieId ? { ...die, selected: !die.selected } : die))
    });
  }

  if (action.type === "hold") {
    if (state.phase !== "selecting" || state.players[state.activePlayer].current <= 0) return state;
    const remaining = state.dice.filter((die) => !die.selected);
    const nextDice = remaining.length === 0 ? createDice(6) : remaining.map((die) => ({ ...die, selected: false }));
    return {
      ...state,
      dice: nextDice,
      phase: "ready",
      message: keepsRollingMessage(state.players[state.activePlayer].name),
      players: {
        ...state.players,
        [state.activePlayer]: {
          ...state.players[state.activePlayer],
          held: state.players[state.activePlayer].held + state.players[state.activePlayer].current,
          current: 0
        }
      }
    };
  }

  if (action.type === "bank") {
    if (state.phase !== "selecting" || state.players[state.activePlayer].current <= 0) return state;
    const gain = state.players[state.activePlayer].held + state.players[state.activePlayer].current;
    const total = state.players[state.activePlayer].total + gain;
    const players = {
      ...state.players,
      [state.activePlayer]: {
        ...state.players[state.activePlayer],
        total,
        held: 0,
        current: 0
      }
    };
    if (total >= state.goal) {
      return {
        ...state,
        players,
        phase: "gameOver",
        winner: state.activePlayer,
        message: winMessage(state.players[state.activePlayer].name)
      };
    }
    return passTurn({ ...state, players }, `${state.players[otherPlayer(state.activePlayer)].name}'s turn`);
  }

  if (action.type === "forfeit") {
    const winner = otherPlayer(action.playerId);
    return {
      ...state,
      phase: "gameOver",
      winner,
      message: `${state.players[action.playerId].name} forfeited`
    };
  }

  return state;
}
