import { useEffect, useMemo, useRef, useState } from "react";
import { Dice } from "./components/Dice";
import { Dialog } from "./components/Dialog";
import { MenuButton } from "./components/MenuButton";
import { Scoreboard } from "./components/Scoreboard";
import { playRoll, playTap, setMuted } from "./audio/sounds";
import { chooseAiDice, shouldAiBank } from "./game/ai";
import { createGame, reduceGame } from "./game/gameState";
import { BET_GOALS, type GameState, type Mode, type PlayerId } from "./game/types";
import { connectMultiplayer, type MultiplayerConnection } from "./multiplayer/client";
import { changeWallet, readWallet, writeWallet } from "./storage/wallet";

type Screen = "main" | "bet" | "matchmaking" | "game";

const foundPhrases = [
  "On the tavern floor!",
  "In your trouser pocket!",
  "In someone else's trouser pocket!",
  "At the bottom of your tankard!",
  "Under a suspiciously sticky table!"
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
  const [multiplayerError, setMultiplayerError] = useState("");
  const connectionRef = useRef<MultiplayerConnection | null>(null);
  const resolvedGameRef = useRef(false);
  const playerIdRef = useRef<PlayerId>("p1");
  const goal = BET_GOALS[bet];
  const canAfford = gold >= bet;
  const isMultiplayer = mode === "multiplayer";
  const isMyTurn = game?.activePlayer === playerId;
  const controlsEnabled = Boolean(game && game.phase !== "gameOver" && !isRolling && (!isMultiplayer || isMyTurn));
  const selectedScoreValid = Boolean(game && game.players[game.activePlayer].current > 0);

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
    if (!game || game.mode !== "singleplayer" || game.phase === "gameOver" || game.activePlayer !== "p2") return;
    const timers: number[] = [];
    const sendAi = (delay: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, delay));
    };

    if (game.phase === "ready") {
      sendAi(700, () => {
        triggerRollSound();
        setGame((current) => current && reduceGame(current, { type: "roll", playerId: "p2" }));
      });
    }

    if (game.phase === "selecting" && game.players.p2.current === 0) {
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
      });
    }

    return () => timers.forEach(window.clearTimeout);
  }, [game]);

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
        if (message.type === "state") setGame(localizeNames(message.state, playerIdRef.current));
        if (message.type === "error") setMultiplayerError(message.message);
      },
      setMultiplayerError
    );
  };

  const sendAction = (type: "roll" | "hold" | "bank" | "forfeit", dieId?: string) => {
    if (!game) return;
    if (game.mode === "multiplayer") {
      connectionRef.current?.send(dieId ? { type: "toggleDie", dieId } : { type });
      if (type === "roll") triggerRollSound();
      return;
    }
    if (type === "roll") triggerRollSound();
    setGame(reduceGame(game, dieId ? { type: "toggleDie", playerId, dieId } : { type, playerId }));
  };

  const triggerRollSound = () => {
    setIsRolling(true);
    playRoll();
    window.setTimeout(() => setIsRolling(false), 1100);
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
            {game.dice.map((die) => (
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
              <MenuButton disabled={!controlsEnabled || game.phase !== "ready"} onClick={() => sendAction("roll")}>
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
  }, [screen, gold, mode, bet, goal, canAfford, game, controlsEnabled, selectedScoreValid, multiplayerError, playerId, isRolling]);

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
  return {
    ...state,
    players: {
      ...state.players,
      [self]: { ...state.players[self], name: "You" },
      [opponent]: { ...state.players[opponent], name: "Opponent" }
    }
  };
}
