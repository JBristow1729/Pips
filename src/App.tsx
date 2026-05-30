import { useEffect, useMemo, useRef, useState } from "react";
import { Dice } from "./components/Dice";
import { Dialog } from "./components/Dialog";
import { MenuButton } from "./components/MenuButton";
import { Scoreboard } from "./components/Scoreboard";
import { playRoll, playTap, setMuted } from "./audio/sounds";
import { chooseAiDice, shouldAiBank } from "./game/ai";
import { createGame, reduceGame } from "./game/gameState";
import { BET_GOALS, type GameState, type Mode, type PlayerId } from "./game/types";
import type { Die, DieValue } from "./game/types";
import { connectMultiplayer, type MultiplayerConnection } from "./multiplayer/client";
import { changeWallet, readWallet } from "./storage/wallet";

type Screen = "main" | "bet" | "matchmaking" | "game";
type RollVisual = {
  dice: Die[];
  faces: DieValue[];
};

const foundPhrases = [
  "On the tavern floor!",
  "In your trouser pocket!",
  "In someone else's trouser pocket!",
  "At the bottom of your tankard!",
  "Under a suspiciously sticky table!"
];

const rollAnimationChains: DieValue[][] = [
  [5, 1, 5, 3, 2, 6, 4, 2, 3, 1],
  [6, 2, 4, 3, 6, 1, 5, 4, 3, 1],
  [2, 3, 1, 4, 5, 1, 4, 1, 6, 3],
  [4, 6, 2, 5, 3, 1, 6, 2, 5, 4],
  [1, 3, 6, 5, 2, 4, 1, 6, 3, 5],
  [3, 5, 2, 6, 1, 4, 5, 2, 6, 1]
];

function GoldDisplay({ gold }: { gold: number }) {
  return (
    <div className="gold-display" aria-label={`${gold} gold`}>
      <span className="coin" />
      <strong>{gold}g</strong>
    </div>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>("main");
  const [mode, setMode] = useState<Mode>("singleplayer");
  const [bet, setBet] = useState(0);
  const [gold, setGold] = useState(() => readWallet());
  const [game, setGame] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<PlayerId>("p1");
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [foundGold, setFoundGold] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [isRolling, setIsRolling] = useState(false);
  const [rollVisual, setRollVisual] = useState<RollVisual | null>(null);
  const [multiplayerError, setMultiplayerError] = useState("");
  const connectionRef = useRef<MultiplayerConnection | null>(null);
  const resolvedGameRef = useRef(false);
  const playerIdRef = useRef<PlayerId>("p1");
  const aiTimersRef = useRef<number[]>([]);
  const aiBusyRef = useRef(false);
  const goal = BET_GOALS[bet];
  const canAfford = gold >= bet;
  const isMultiplayer = mode === "multiplayer";
  const isMyTurn = game?.activePlayer === playerId;
  const controlsEnabled = Boolean(game && game.phase !== "gameOver" && !isRolling && (!isMultiplayer || isMyTurn));
  const selectedScoreValid = Boolean(game && game.players[game.activePlayer].current > 0);
  const animationTimersRef = useRef<number[]>([]);

  useEffect(() => {
    if (screen === "main" && gold === 0 && !foundGold) {
      const phrase = foundPhrases[Math.floor(Math.random() * foundPhrases.length)];
      const next = changeWallet(10);
      setGold(next);
      setFoundGold(phrase);
    }
  }, [screen, gold, foundGold]);

  useEffect(() => {
    setMuted(muted);
  }, [muted]);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  useEffect(() => {
    return () => {
      clearAnimationTimers();
      clearAiTimers();
    };
  }, []);

  useEffect(() => {
    if (!game || isRolling || game.mode !== "singleplayer" || game.phase === "gameOver" || game.activePlayer !== "p2") {
      clearAiTimers();
      aiBusyRef.current = false;
      return;
    }
    if (aiBusyRef.current) return;
    const sendAi = (delay: number, fn: () => void) => {
      aiTimersRef.current.push(window.setTimeout(fn, delay));
    };

    if (game.phase === "ready") {
      aiBusyRef.current = true;
      sendAi(700, () => {
        setGame((current) => {
          if (!current) return current;
          animateToState(reduceGame(current, { type: "roll", playerId: "p2" }));
          return current;
        });
        aiBusyRef.current = false;
      });
    }

    if (game.phase === "selecting" && game.players.p2.current === 0) {
      aiBusyRef.current = true;
      const choices = chooseAiDice(game);
      const used = new Set<string>();
      let delay = 450;
      for (const value of choices) {
        const die = game.dice.find((candidate) => !used.has(candidate.id) && !candidate.selected && candidate.value === value);
        if (die) {
          used.add(die.id);
          sendAi(delay, () => {
            playTap();
            setGame((current) => current && reduceGame(current, { type: "toggleDie", playerId: "p2", dieId: die.id }));
          });
          delay += 350;
        }
      }
      sendAi(delay + 300, () => {
        setGame((current) => {
          if (!current) return current;
          return reduceGame(current, { type: shouldAiBank(current) ? "bank" : "hold", playerId: "p2" });
        });
        aiBusyRef.current = false;
      });
    }
  }, [game, isRolling]);

  useEffect(() => {
    if (!game || game.phase !== "bust" || isRolling) return;
    const timer = window.setTimeout(() => {
      setGame((current) => current && reduceGame(current, { type: "finishBust", playerId: current.activePlayer }));
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [game, isRolling]);

  useEffect(() => {
    if (!game || game.phase !== "gameOver" || resolvedGameRef.current) return;
    resolvedGameRef.current = true;
    if (bet > 0) {
      const delta = game.winner === playerIdRef.current ? bet : -bet;
      setGold(changeWallet(delta));
    }
  }, [game, bet]);

  const startSingleplayer = () => {
    resolvedGameRef.current = false;
    setPlayerId("p1");
    setGame(createGame("singleplayer", bet, goal));
    setScreen("game");
  };

  const startMultiplayer = () => {
    setMultiplayerError("");
    setScreen("matchmaking");
    connectionRef.current?.close();
    connectionRef.current = connectMultiplayer(
      bet,
      goal,
      (message) => {
        if (message.type === "matched") {
          setPlayerId(message.playerId);
          playerIdRef.current = message.playerId;
          setGame(localizeNames(message.state, message.playerId));
          setScreen("game");
        }
        if (message.type === "state") {
          const localized = localizeNames(message.state, playerIdRef.current);
          setGame((current) => {
            if (shouldAnimateIncomingRoll(current, localized)) {
              animateToState(localized);
              return current;
            }
            return localized;
          });
        }
        if (message.type === "error") setMultiplayerError(message.message);
      },
      setMultiplayerError
    );
  };

  const sendAction = (type: "roll" | "hold" | "bank" | "forfeit", dieId?: string) => {
    if (!game) return;
    if (game.mode === "multiplayer") {
      connectionRef.current?.send(dieId ? { type: "toggleDie", dieId } : { type });
      return;
    }
    setGame(reduceGame(game, dieId ? { type: "toggleDie", playerId, dieId } : { type, playerId }));
  };

  const roll = () => {
    if (!game || game.phase !== "ready" || !controlsEnabled) return;
    if (game.mode === "multiplayer") {
      connectionRef.current?.send({ type: "roll" });
      return;
    }
    animateToState(reduceGame(game, { type: "roll", playerId }));
  };

  const animateToState = (finalState: GameState) => {
    clearAnimationTimers();
    const chains = finalState.dice.map(() => rollAnimationChains[Math.floor(Math.random() * rollAnimationChains.length)]);
    let frame = 0;
    setIsRolling(true);
    setRollVisual({
      dice: finalState.dice.map((die) => ({ ...die, selected: false })),
      faces: chains.map((chain) => chain[0])
    });
    playRoll();
    const interval = window.setInterval(() => {
      frame += 1;
      setRollVisual({
        dice: finalState.dice.map((die) => ({ ...die, selected: false })),
        faces: chains.map((chain, index) => chain[(frame + index) % chain.length])
      });
    }, 95);
    const done = window.setTimeout(() => {
      window.clearInterval(interval);
      setRollVisual(null);
      setIsRolling(false);
      setGame(finalState);
    }, 1250);
    animationTimersRef.current = [interval, done];
  };

  const clearAnimationTimers = () => {
    animationTimersRef.current.forEach(window.clearTimeout);
    animationTimersRef.current = [];
  };

  const clearAiTimers = () => {
    aiTimersRef.current.forEach(window.clearTimeout);
    aiTimersRef.current = [];
  };

  const leaveGame = () => {
    setLeaveDialog(false);
    if (game?.mode === "multiplayer") connectionRef.current?.send({ type: "forfeit" });
    if (game && bet > 0 && game.phase !== "gameOver") setGold(changeWallet(-bet));
    returnMain();
  };

  const returnMain = () => {
    connectionRef.current?.close();
    connectionRef.current = null;
    setGame(null);
    setRollVisual(null);
    setIsRolling(false);
    clearAiTimers();
    aiBusyRef.current = false;
    setScreen("main");
    setGold(readWallet());
  };

  const content = useMemo(() => {
    if (screen === "main") {
      return (
        <main className="menu-screen">
          <div className="top-bar">
            <h1>Tavern Dice</h1>
            <GoldDisplay gold={gold} />
          </div>
          <nav className="main-actions">
            <MenuButton onClick={() => selectMode("singleplayer")}>Singleplayer</MenuButton>
            <MenuButton onClick={() => selectMode("multiplayer")}>Multiplayer</MenuButton>
          </nav>
        </main>
      );
    }

    if (screen === "bet") {
      return (
        <main className="menu-screen">
          <div className="top-bar">
            <h1>Tavern Dice</h1>
            <GoldDisplay gold={gold} />
          </div>
          <section className="bet-panel">
            <h2>Select your bet</h2>
            <p>{mode === "singleplayer" ? "Click Play to start Singleplayer" : "Click Play to enter Multiplayer matchmaking"}</p>
            <div className="bet-options">
              {[0, 10, 20, 30].map((amount) => (
                <button key={amount} className={`bet-option ${bet === amount ? "selected" : ""}`} onClick={() => setBet(amount)}>
                  {amount}g
                </button>
              ))}
            </div>
            <div className="goal-plaque">Goal: {goal}</div>
            <MenuButton disabled={!canAfford} onClick={mode === "singleplayer" ? startSingleplayer : startMultiplayer}>
              Play
            </MenuButton>
          </section>
          <MenuButton variant="small" className="back-button" onClick={() => setScreen("main")} aria-label="Back">
            Back
          </MenuButton>
        </main>
      );
    }

    if (screen === "matchmaking") {
      return (
        <main className="menu-screen centered">
          <GoldDisplay gold={gold} />
          <section className="wait-panel">
            <h2>Waiting for another player with the same bet...</h2>
            <p>Bet: {bet}g</p>
            <p>Goal: {goal}</p>
            {multiplayerError && <p className="error">{multiplayerError}</p>}
          </section>
          <MenuButton variant="small" className="back-button" onClick={returnMain}>
            Cancel
          </MenuButton>
        </main>
      );
    }

    if (game) {
      const renderedDice = rollVisual
        ? rollVisual.dice.map((die, index) => ({ ...die, value: rollVisual.faces[index] ?? die.value }))
        : game.dice;
      return (
        <main className="game-screen">
          <GoldDisplay gold={gold} />
          <div className="score-row">
            <Scoreboard player={game.players.p1} active={game.activePlayer === "p1"} />
            <section className="goal-board">Goal: {game.goal}</section>
            <Scoreboard player={game.players.p2} active={game.activePlayer === "p2"} />
          </div>
          <div className={`center-message ${game.phase === "gameOver" ? "winner" : ""}`}>{game.message}</div>
          <div className="dice-tray">
            {renderedDice.map((die) => (
              <Dice
                key={die.id}
                die={die}
                rolling={isRolling}
                disabled={!controlsEnabled || game.phase !== "selecting"}
                onClick={() => {
                  playTap();
                  sendAction("roll", die.id);
                }}
              />
            ))}
          </div>
          {game.phase === "gameOver" ? (
            <MenuButton onClick={returnMain}>Main Menu</MenuButton>
          ) : (
            <div className="game-actions">
              <MenuButton disabled={!controlsEnabled || game.phase !== "ready"} onClick={roll}>
                Roll
              </MenuButton>
              <MenuButton disabled={!controlsEnabled || !selectedScoreValid} onClick={() => sendAction("hold")}>
                Hold
              </MenuButton>
              <MenuButton disabled={!controlsEnabled || !selectedScoreValid} onClick={() => sendAction("bank")}>
                Bank
              </MenuButton>
            </div>
          )}
          <MenuButton variant="small" className="back-button" onClick={() => setLeaveDialog(true)}>
            Back
          </MenuButton>
        </main>
      );
    }

    return null;
  }, [screen, gold, mode, bet, goal, canAfford, game, controlsEnabled, selectedScoreValid, multiplayerError, playerId, isRolling, rollVisual]);

  function selectMode(nextMode: Mode) {
    setMode(nextMode);
    setScreen("bet");
  }

  return (
    <div className="app">
      {content}
      <button className="mute-toggle" onClick={() => setMutedState((value) => !value)} aria-label="Toggle mute">
        {muted ? "Sound Off" : "Sound On"}
      </button>
      {foundGold && (
        <Dialog title="You found 10g..." onNo={() => setFoundGold(null)} noLabel="Nice">
          <p>{foundGold}</p>
        </Dialog>
      )}
      {leaveDialog && (
        <Dialog title="Are you sure you want to leave and forfeit your bet?" onYes={leaveGame} onNo={() => setLeaveDialog(false)} />
      )}
    </div>
  );
}

function localizeNames(state: GameState, self: PlayerId): GameState {
  const opponent = self === "p1" ? "p2" : "p1";
  const players = {
    ...state.players,
    [self]: { ...state.players[self], name: "You" },
    [opponent]: { ...state.players[opponent], name: "Opponent" }
  };
  return {
    ...state,
    players,
    message: localizeMessage(state, self)
  };
}

function shouldAnimateIncomingRoll(current: GameState | null, incoming: GameState) {
  if (!current) return false;
  const incomingIsRollResult = incoming.phase === "selecting" || incoming.phase === "bust";
  return current.phase === "ready" && incomingIsRollResult && current.activePlayer === incoming.activePlayer;
}

function localizeMessage(state: GameState, self: PlayerId) {
  const activeIsSelf = state.activePlayer === self;
  if (state.phase === "ready") return activeIsSelf ? "Your turn" : "Opponent's turn";
  if (state.phase === "selecting") return activeIsSelf ? "You rolled" : "Opponent rolled";
  if (state.phase === "bust") return activeIsSelf ? "BUST" : "Opponent busted";
  if (state.phase === "gameOver") {
    if (state.winner === self) return "You win!";
    if (state.winner) return "Opponent wins!";
  }
  return state.message;
}
