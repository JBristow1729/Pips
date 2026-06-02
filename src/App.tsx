import { useEffect, useMemo, useRef, useState } from "react";
import { Dice } from "./components/Dice";
import { CustomiseDialog } from "./components/CustomiseDialog";
import { Dialog } from "./components/Dialog";
import { MenuButton } from "./components/MenuButton";
import { Scoreboard } from "./components/Scoreboard";
import { playRoll, playTap, playWarning, setMuted } from "./audio/sounds";
import { chooseAiDice, shouldAiBank } from "./game/ai";
import { createGame, reduceGame } from "./game/gameState";
import { scoreDice } from "./game/scoring";
import { BET_GOALS, type GameState, type Mode, type PlayerId } from "./game/types";
import type { Die, DieValue } from "./game/types";
import { connectMultiplayerLobby, type MultiplayerConnection } from "./multiplayer/client";
import type { LobbyState, PublicLobby, ServerMessage } from "./multiplayer/types";
import { createRandomCustomization, readCustomizationInventory, writeCustomizationInventory, type DiceCustomizationInventory } from "./customization/diceCustomization";
import { isDefaultUsername, readOptions, validateUsername, writeOptions, type PlayerOptions } from "./storage/options";
import { changeWallet, readWallet } from "./storage/wallet";

type Screen = "main" | "bet" | "multiplayer" | "host" | "join" | "game";
type RollMotion = {
  axisX: string;
  axisY: string;
  axisZ: string;
  turns: string;
  duration: string;
};
type RollVisual = {
  dice: Die[];
  motions: RollMotion[];
  started: boolean[];
  stopped: boolean[];
};
type RematchDialog = "waiting" | "challenge" | "cancelled" | null;
type TurnTimer = { playerId: PlayerId; endsAt: number; durationMs: number };

const rollBaseDuration = 1.3;
const rollStartStagger = 0.1;
const rollStopStagger = 0.1;

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
      <span className="coin" aria-hidden="true" />
      <span className="gold-label">Purse</span>
      <strong>{gold}g</strong>
    </div>
  );
}

function RuleDice({ values }: { values: DieValue[] }) {
  return (
    <div className="rule-dice">
      {values.map((value, index) => (
        <Dice
          key={`${value}-${index}`}
          die={{ id: `${value}-${index}`, value, selected: false }}
          disabled
          rolling={false}
          compact
          onClick={() => undefined}
        />
      ))}
    </div>
  );
}

function RulesDialog({ onClose }: { onClose: () => void }) {
  const rows: Array<{ dice: DieValue[]; name: string; score: string }> = [
    { dice: [1], name: "One", score: "100" },
    { dice: [5], name: "Five", score: "50" },
    { dice: [3, 3, 3], name: "3 of a Kind", score: "100 x dice value" },
    { dice: [3, 3, 3, 3], name: "4 of a Kind", score: "200 x dice value" },
    { dice: [3, 3, 3, 3, 3], name: "5 of a Kind", score: "400 x dice value" },
    { dice: [3, 3, 3, 3, 3, 3], name: "6 of a Kind", score: "800 x dice value" },
    { dice: [1, 2, 3, 4, 5], name: "Low Straight", score: "500" },
    { dice: [2, 3, 4, 5, 6], name: "High Straight", score: "750" },
    { dice: [1, 2, 3, 4, 5, 6], name: "Full Straight", score: "1500" }
  ];

  return (
    <div className="dialog-backdrop">
      <section className="rules-dialog" role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <div className="panel-kicker">House Notice</div>
        <h2 id="rules-title">Scoring Rules</h2>
        <div className="rules-list">
          {rows.map((row) => (
            <div className="rule-row" key={`${row.name}-${row.score}`}>
              <RuleDice values={row.dice} />
              <span>{row.name}</span>
              <strong>{row.score}</strong>
            </div>
          ))}
        </div>
        <MenuButton onClick={onClose}>OK</MenuButton>
      </section>
    </div>
  );
}

function OptionsDialog({ options, onApply, onClose }: { options: PlayerOptions; onApply: (options: PlayerOptions) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(options);
  const usernameError = validateUsername(draft.username);
  const updateUsername = (value: string) => {
    setDraft((current) => ({ ...current, username: value }));
  };
  const updateSfx = (value: boolean) => {
    setDraft((current) => ({ ...current, sfx: value }));
  };

  return (
    <div className="dialog-backdrop">
      <section className="options-dialog" role="dialog" aria-modal="true" aria-labelledby="options-title">
        <div className="customise-heading">
          <div>
            <div className="panel-kicker">Table Rules</div>
            <h2 id="options-title">Options</h2>
          </div>
        </div>
        <div className="options-list">
          <label className="option-field">
            <span>Username</span>
            <input
              value={draft.username}
              maxLength={16}
              onChange={(event) => updateUsername(event.currentTarget.value)}
              aria-invalid={Boolean(usernameError)}
            />
            {usernameError && <small>{usernameError}</small>}
          </label>
          <label className="option-check disabled">
            <input type="checkbox" checked={false} disabled readOnly />
            <span>Music</span>
          </label>
          <label className="option-check">
            <input
              type="checkbox"
              checked={draft.sfx}
              onChange={(event) => updateSfx(event.currentTarget.checked)}
            />
            <span>SFX</span>
          </label>
        </div>
        <div className="customise-actions">
          <MenuButton variant="small" onClick={onClose}>
            Cancel
          </MenuButton>
          <MenuButton variant="small" disabled={Boolean(usernameError)} onClick={() => onApply({ ...draft, username: draft.username.trim(), music: false })}>
            Apply
          </MenuButton>
        </div>
      </section>
    </div>
  );
}

function TurnTimerPanel({ secondsLeft }: { secondsLeft: number }) {
  return (
    <div className={`turn-timer ${secondsLeft <= 5 ? "urgent" : ""}`} aria-live="polite">
      <span className="timer-glass" aria-hidden="true" />
      <strong key={secondsLeft}>{secondsLeft}s</strong>
    </div>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>("main");
  const [bet, setBet] = useState(0);
  const [gold, setGold] = useState(() => readWallet());
  const [game, setGame] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<PlayerId>("p1");
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [defaultNameWarning, setDefaultNameWarning] = useState(false);
  const [options, setOptions] = useState<PlayerOptions>(() => readOptions());
  const [customizationInventory, setCustomizationInventory] = useState<DiceCustomizationInventory>(() => readCustomizationInventory());
  const [foundGold, setFoundGold] = useState<string | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [rollVisual, setRollVisual] = useState<RollVisual | null>(null);
  const [multiplayerError, setMultiplayerError] = useState("");
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [publicLobbies, setPublicLobbies] = useState<PublicLobby[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [privateJoinFailed, setPrivateJoinFailed] = useState(false);
  const [turnTimer, setTurnTimer] = useState<TurnTimer | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [lastWarningSecond, setLastWarningSecond] = useState<number | null>(null);
  const [rematchDialog, setRematchDialog] = useState<RematchDialog>(null);
  const [rematchPurseError, setRematchPurseError] = useState(false);
  const connectionRef = useRef<MultiplayerConnection | null>(null);
  const resolvedGameRef = useRef(false);
  const playerIdRef = useRef<PlayerId>("p1");
  const aiTimersRef = useRef<number[]>([]);
  const aiBusyRef = useRef(false);
  const goal = BET_GOALS[bet];
  const canAfford = gold >= bet;
  const nextGameGold =
    game?.phase === "gameOver" && game.bet > 0 && !resolvedGameRef.current
      ? gold + (game.winner === playerId ? game.bet : -game.bet)
      : gold;
  const canAffordRematch = nextGameGold >= (game?.bet ?? bet);
  const isMyTurn = game?.activePlayer === playerId;
  const timerSecondsLeft = turnTimer ? Math.min(Math.floor(turnTimer.durationMs / 1000), Math.max(0, Math.ceil((turnTimer.endsAt - timerNow) / 1000))) : 0;
  const canControlTurn = Boolean(
    game &&
      game.phase !== "gameOver" &&
      (game.mode === "singleplayer" ? game.activePlayer === "p1" : game.activePlayer === playerId)
  );
  const controlsEnabled = Boolean(canControlTurn && !isRolling);
  const selectedScoreValid = Boolean(game && selectedScoreFromDice(game) > 0);
  const hasRolledThisTurn = Boolean(
    game &&
      (game.phase !== "ready" ||
        game.players[game.activePlayer].held > 0 ||
        game.players[game.activePlayer].current > 0 ||
        game.dice.length < 6)
  );
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
    setMuted(!options.sfx);
  }, [options.sfx]);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  useEffect(() => {
    return () => {
      clearAnimationTimers();
      clearAiTimers();
      connectionRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (screen !== "join") return;
    const timer = window.setInterval(() => connectionRef.current?.send({ type: "listLobbies" }), 10_000);
    return () => window.clearInterval(timer);
  }, [screen]);

  useEffect(() => {
    const timer = window.setInterval(() => setTimerNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!turnTimer || !isMyTurn || timerSecondsLeft > 5 || timerSecondsLeft <= 0 || lastWarningSecond === timerSecondsLeft) return;
    setLastWarningSecond(timerSecondsLeft);
    playWarning();
  }, [turnTimer, isMyTurn, timerSecondsLeft, lastWarningSecond]);

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
    if (game.mode === "multiplayer") return;
    const timer = window.setTimeout(() => {
      setGame((current) => current && reduceGame(current, { type: "finishBust", playerId: current.activePlayer }));
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [game, isRolling]);

  useEffect(() => {
    if (!game || game.phase !== "gameOver" || resolvedGameRef.current) return;
    resolvedGameRef.current = true;
    if (game.bet > 0) {
      const delta = game.winner === playerIdRef.current ? game.bet : -game.bet;
      setGold(changeWallet(delta));
    }
  }, [game]);

  const startSingleplayer = () => {
    if (gold < bet) return;
    resolvedGameRef.current = false;
    setPlayerId("p1");
    setGame(createGame("singleplayer", bet, goal, ["You", "Computer"], { p1: customizationInventory.equipped, p2: createRandomCustomization() }));
    setScreen("game");
  };

  const openLobbyConnection = () => {
    setMultiplayerError("");
    connectionRef.current?.close();
    connectionRef.current = connectMultiplayerLobby(handleMultiplayerMessage, setMultiplayerError);
    return connectionRef.current;
  };

  const hostGame = () => {
    const connection = openLobbyConnection();
    setLobby(null);
    setScreen("host");
    connection.send({ type: "createLobby", username: options.username, bet, goal, public: false, customization: customizationInventory.equipped });
  };

  const openJoinMenu = () => {
    const connection = openLobbyConnection();
    setLobby(null);
    setPublicLobbies([]);
    setJoinCode("");
    setScreen("join");
    connection.send({ type: "listLobbies" });
  };

  const handleMultiplayerMessage = (message: ServerMessage) => {
    if (message.type === "publicLobbies") setPublicLobbies(message.lobbies);
    if (message.type === "lobby") {
      setLobby(message.lobby);
      setPlayerId(message.playerId);
      playerIdRef.current = message.playerId;
      setScreen("host");
    }
    if (message.type === "matched") {
      resolvedGameRef.current = false;
      setTurnTimer(null);
      setPlayerId(message.playerId);
      playerIdRef.current = message.playerId;
      setBet(message.state.bet);
      setGame(localizeNames(message.state, message.playerId));
      setScreen("game");
    }
    if (message.type === "turnTimer") {
      setTurnTimer(message);
      setLastWarningSecond(null);
      setTimerNow(Date.now());
    }
    if (message.type === "state") {
      const localized = localizeNames(message.state, playerIdRef.current);
      if (localized.phase === "gameOver") setTurnTimer(null);
      setGame((current) => {
        if (shouldAnimateIncomingRoll(current, localized)) {
          animateToState(localized);
          return current;
        }
        return localized;
      });
    }
    if (message.type === "rematchWaiting") setRematchDialog("waiting");
    if (message.type === "rematchChallenge") setRematchDialog("challenge");
    if (message.type === "rematchStarted") {
      resolvedGameRef.current = false;
      setRematchDialog(null);
      setRollVisual(null);
      setIsRolling(false);
      setTurnTimer(null);
      setBet(message.state.bet);
      setGame(localizeNames(message.state, playerIdRef.current));
      setScreen("game");
    }
    if (message.type === "rematchDeclined") {
      setRematchDialog(null);
      returnMain();
    }
    if (message.type === "rematchCancelled") {
      setRematchDialog(message.by === playerIdRef.current ? null : "cancelled");
    }
    if (message.type === "error") {
      if (message.message.includes("No lobby")) setPrivateJoinFailed(true);
      setMultiplayerError(message.message);
    }
  };

  const sendAction = (type: "roll" | "hold" | "bank" | "forfeit", dieId?: string) => {
    if (!game) return;
    if (type !== "forfeit" && !canControlTurn) return;
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

  const holdAndReroll = () => {
    if (!game || game.phase !== "selecting" || !controlsEnabled || !selectedScoreValid) return;
    if (game.mode === "multiplayer") {
      connectionRef.current?.send({ type: "hold" });
      connectionRef.current?.send({ type: "roll" });
      return;
    }
    const heldState = reduceGame(game, { type: "hold", playerId });
    animateToState(reduceGame(heldState, { type: "roll", playerId }));
  };

  const animateToState = (finalState: GameState) => {
    clearAnimationTimers();
    const motions = finalState.dice.map((_, index) => createRollMotion(index));
    setIsRolling(true);
    setRollVisual({
      dice: finalState.dice.map((die) => ({ ...die, selected: false })),
      motions,
      started: finalState.dice.map((_, index) => index === 0),
      stopped: finalState.dice.map(() => false)
    });
    playRoll(finalState.dice.length, {
      rollWindowMs: rollStopMs(Math.max(0, finalState.dice.length - 1)),
      startStaggerMs: rollStartStagger * 1000
    });
    const startTimers = finalState.dice.slice(1).map((_, offset) =>
      window.setTimeout(() => {
        setRollVisual((current) => {
          if (!current) return current;
          const started = [...current.started];
          started[offset + 1] = true;
          return { ...current, started };
        });
      }, rollStartMs(offset + 1))
    );
    const stopTimers = finalState.dice.map((_, index) =>
      window.setTimeout(() => {
        setRollVisual((current) => {
          if (!current) return current;
          const stopped = [...current.stopped];
          stopped[index] = true;
          return { ...current, stopped };
        });
      }, rollStopMs(index))
    );
    const done = window.setTimeout(() => {
      setRollVisual(null);
      setIsRolling(false);
      setGame(finalState);
    }, rollCompleteMs(finalState.dice.length));
    animationTimersRef.current = [...startTimers, ...stopTimers, done];
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
    setRematchDialog(null);
    setRematchPurseError(false);
    connectionRef.current?.close();
    connectionRef.current = null;
    setLobby(null);
    setPublicLobbies([]);
    setTurnTimer(null);
    setGame(null);
    setRollVisual(null);
    setIsRolling(false);
    clearAiTimers();
    aiBusyRef.current = false;
    setScreen("main");
    setGold(readWallet());
  };

  const requestRematch = () => {
    if (!game) return;
    if (!canAffordRematch) {
      setRematchPurseError(true);
      return;
    }
    if (game.mode === "singleplayer") {
      startSingleplayer();
      return;
    }
    connectionRef.current?.send({ type: "rematchRequest" });
  };

  const cancelRematch = () => {
    connectionRef.current?.send({ type: "rematchCancel" });
    setRematchDialog(null);
  };

  const answerRematch = (accepted: boolean) => {
    if (accepted && !canAffordRematch) {
      setRematchDialog(null);
      setRematchPurseError(true);
      return;
    }
    connectionRef.current?.send({ type: "rematchResponse", accepted });
    if (accepted) setRematchDialog(null);
  };

  const spendGold = (amount: number) => {
    if (readWallet() < amount) return false;
    setGold(changeWallet(-amount));
    return true;
  };

  const saveCustomizationInventory = (inventory: DiceCustomizationInventory) => {
    writeCustomizationInventory(inventory);
    setCustomizationInventory(inventory);
  };

  const applyCustomizationInventory = (inventory: DiceCustomizationInventory) => {
    saveCustomizationInventory(inventory);
    setCustomiseOpen(false);
  };

  const applyOptions = (nextOptions: PlayerOptions) => {
    writeOptions(nextOptions);
    setOptions(nextOptions);
    setOptionsOpen(false);
  };

  const updateLobbyConfig = (nextBet: number, nextPublic = lobby?.public ?? false) => {
    connectionRef.current?.send({ type: "updateLobby", bet: nextBet, goal: BET_GOALS[nextBet], public: nextPublic });
  };

  const joinPrivateLobby = () => {
    if (joinCode.length !== 4) return;
    connectionRef.current?.send({ type: "joinLobby", username: options.username, code: joinCode, customization: customizationInventory.equipped });
  };

  const joinPublicLobby = (lobbyId: string) => {
    connectionRef.current?.send({ type: "joinLobby", username: options.username, lobbyId, customization: customizationInventory.equipped });
  };

  const leaveLobby = () => {
    connectionRef.current?.send({ type: "leaveLobby" });
    connectionRef.current?.close();
    connectionRef.current = null;
    setLobby(null);
    setScreen("multiplayer");
  };

  const backToMultiplayerMenu = () => {
    connectionRef.current?.close();
    connectionRef.current = null;
    setLobby(null);
    setPublicLobbies([]);
    setMultiplayerError("");
    setScreen("multiplayer");
  };

  const content = useMemo(() => {
    if (screen === "main") {
      return (
        <main className="menu-screen menu-home">
          <div className="hero-panel">
            <h1>Tavern Dice</h1>
          </div>
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <nav className="main-actions" aria-label="Game modes">
            <MenuButton onClick={() => selectMode("singleplayer")}>Singleplayer</MenuButton>
            <MenuButton onClick={() => selectMode("multiplayer")}>Multiplayer</MenuButton>
            <MenuButton onClick={() => setCustomiseOpen(true)}>Customise</MenuButton>
            <MenuButton onClick={() => setOptionsOpen(true)}>Options</MenuButton>
          </nav>
        </main>
      );
    }

    if (screen === "bet") {
      return (
        <main className="menu-screen menu-bet">
          <div className="hero-panel compact">
            <h1>Tavern Dice</h1>
          </div>
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <section className="bet-panel">
            <div className="panel-kicker">Stakes</div>
            <h2>Select your bet</h2>
            <div className="bet-slider-wrap">
              <label htmlFor="bet-slider">Select Bet</label>
              <div className="bet-slider-shell">
                <input
                  id="bet-slider"
                  className="bet-slider"
                  type="range"
                  min="0"
                  max="30"
                  step="10"
                  value={bet}
                  onChange={(event) => setBet(Number(event.currentTarget.value))}
                />
                <output className="bet-bubble" style={getBetBubbleStyle(bet)}>
                  {bet}g
                </output>
              </div>
            </div>
            <p className="waiting-count waiting-count-empty" aria-hidden="true">No players awaiting match</p>
            <div className="bet-footer">
              <div className="goal-plaque">Goal: {goal}</div>
              <MenuButton disabled={!canAfford} onClick={startSingleplayer}>
                Play
              </MenuButton>
            </div>
          </section>
          <MenuButton variant="small" className="back-button" onClick={() => setScreen("main")} aria-label="Back">
            Back
          </MenuButton>
        </main>
      );
    }

    if (screen === "multiplayer") {
      return (
        <main className="menu-screen menu-multiplayer">
          <div className="hero-panel">
            <h1>Tavern Dice</h1>
          </div>
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <nav className="main-actions multiplayer-choice-actions" aria-label="Multiplayer options">
            <MenuButton onClick={hostGame}>Host Game</MenuButton>
            <MenuButton onClick={openJoinMenu}>Join Game</MenuButton>
            {multiplayerError && <p className="error">{multiplayerError}</p>}
          </nav>
          <MenuButton variant="small" className="back-button" onClick={returnMain}>
            Back
          </MenuButton>
        </main>
      );
    }

    if (screen === "host" && lobby) {
      const self = lobby.players.find((candidate) => candidate.id === playerId);
      const isHost = Boolean(self?.isHost);
      return (
        <main className="menu-screen centered menu-lobby">
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <section className="lobby-panel">
            <div className="lobby-code" aria-label={`Lobby code ${lobby.code}`}>{lobby.code}</div>
            <div className="lobby-grid">
              <section className="lobby-players" aria-label="Lobby players">
                <div className="section-label">Players</div>
                {["p1", "p2"].map((slot) => {
                  const player = lobby.players.find((candidate) => candidate.id === slot);
                  return (
                    <div className={`lobby-player-card ${player?.ready ? "ready" : ""}`} key={slot}>
                      <strong>{player?.username ?? "Awaiting player"}</strong>
                      <span>{player ? `${player.isHost ? "Host - " : ""}${player.ready ? "Ready" : "Not Ready"}` : "Open seat"}</span>
                    </div>
                  );
                })}
              </section>
              <section className={`lobby-config ${!isHost ? "locked" : ""}`} aria-label="Lobby settings">
                <div className="section-label">Stakes</div>
                <h2>Select your bet</h2>
                <div className="bet-slider-wrap">
                  <label htmlFor="lobby-bet-slider">Select Bet</label>
                  <div className="bet-slider-shell">
                    <input
                      id="lobby-bet-slider"
                      className="bet-slider"
                      type="range"
                      min="0"
                      max="30"
                      step="10"
                      value={lobby.bet}
                      disabled={!isHost}
                      onChange={(event) => updateLobbyConfig(Number(event.currentTarget.value))}
                    />
                    <output className="bet-bubble" style={getBetBubbleStyle(lobby.bet)}>
                      {lobby.bet}g
                    </output>
                  </div>
                </div>
                <label className="option-check public-toggle">
                  <input
                    type="checkbox"
                    checked={lobby.public}
                    disabled={!isHost}
                    onChange={(event) => updateLobbyConfig(lobby.bet, event.currentTarget.checked)}
                  />
                  <span>Public</span>
                </label>
                <div className="goal-plaque">Goal: {lobby.goal}</div>
              </section>
            </div>
            <div className="lobby-actions">
              <MenuButton variant="small" onClick={leaveLobby}>Leave</MenuButton>
              <MenuButton variant="small" onClick={() => connectionRef.current?.send({ type: "setReady", ready: !self?.ready })}>
                {self?.ready ? "Not Ready" : "Ready"}
              </MenuButton>
            </div>
          </section>
        </main>
      );
    }

    if (screen === "host") {
      return (
        <main className="menu-screen centered menu-lobby">
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <section className="wait-panel host-loading-panel">
            <div className="loading-sigil" aria-hidden="true" />
            <div className="panel-kicker">Noticeboard</div>
            <h2>Preparing a Table...</h2>
            {multiplayerError && <p className="error">{multiplayerError}</p>}
            <MenuButton variant="small" onClick={backToMultiplayerMenu}>
              Cancel
            </MenuButton>
          </section>
        </main>
      );
    }

    if (screen === "join") {
      return (
        <main className="menu-screen centered menu-lobby">
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <section className="join-panel">
            <div className="private-join-header">
              <span className="section-label">Private</span>
              <label className="code-entry" aria-label="Private lobby code">
                <input
                  value={joinCode}
                  maxLength={4}
                  autoFocus
                  onChange={(event) => setJoinCode(event.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
                  autoComplete="off"
                />
                {[0, 1, 2, 3].map((index) => <span key={index}>{joinCode[index] ?? ""}</span>)}
              </label>
              <MenuButton variant="small" disabled={joinCode.length !== 4} onClick={joinPrivateLobby}>Join</MenuButton>
            </div>
            <div className="public-list-heading">
              <span className="section-label">Public</span>
              <MenuButton variant="small" onClick={() => connectionRef.current?.send({ type: "listLobbies" })}>Refresh</MenuButton>
            </div>
            <div className="public-lobby-list">
              {publicLobbies.length === 0 && <p className="empty-lobbies">No public games are waiting.</p>}
              {publicLobbies.map((publicLobby) => (
                <article className="public-lobby-card" key={publicLobby.id}>
                  <strong className="public-lobby-host">{publicLobby.host}</strong>
                  <div className="public-lobby-meta">
                    <span>{publicLobby.bet}g</span>
                    <span>Goal {publicLobby.goal}</span>
                  </div>
                  <MenuButton variant="small" onClick={() => joinPublicLobby(publicLobby.id)}>Join</MenuButton>
                </article>
              ))}
            </div>
            {multiplayerError && <p className="error">{multiplayerError}</p>}
          </section>
          <MenuButton variant="small" className="back-button" onClick={backToMultiplayerMenu}>
            Back
          </MenuButton>
        </main>
      );
    }

    if (game) {
      const renderedDice = rollVisual ? rollVisual.dice : game.dice;
      return (
        <main className="game-screen">
          <header className="game-topbar">
            <div className="game-topbar-actions">
              <MenuButton variant="small" className="rules-button" onClick={() => setRulesOpen(true)}>
                Rules
              </MenuButton>
              <MenuButton variant="small" className="back-button" onClick={() => setLeaveDialog(true)}>
                Leave
              </MenuButton>
            </div>
            <GoldDisplay gold={gold} />
          </header>
          <section className="game-layout" aria-label="Game table">
            <aside className="players-panel" aria-label="Players">
              <Scoreboard player={game.players.p1} active={game.activePlayer === "p1"} />
              <Scoreboard player={game.players.p2} active={game.activePlayer === "p2"} />
            </aside>
            <section className="table-panel">
              <div className="table-status">
                <div className="goal-board">Goal: {game.goal}</div>
                <div className={`center-message ${game.phase === "gameOver" ? "winner" : ""}`} role="status" aria-live="polite">
                  {game.message}
                </div>
                {game.mode === "multiplayer" && turnTimer && game.phase !== "gameOver" && (
                  <TurnTimerPanel secondsLeft={timerSecondsLeft} />
                )}
              </div>
              <div className={`dice-tray dice-count-${renderedDice.length} ${isRolling ? "dice-tray-rolling" : ""}`} aria-label="Dice tray">
                {renderedDice.map((die, index) => (
                  <Dice
                    key={die.id}
                    die={die}
                    rolling={Boolean(isRolling && rollVisual?.started[index] && !rollVisual?.stopped[index])}
                    rollMotion={rollVisual?.motions[index]}
                    disabled={!controlsEnabled || game.phase !== "selecting"}
                    customization={game.players[game.activePlayer].diceCustomization}
                    onClick={() => {
                      playTap();
                      sendAction("roll", die.id);
                    }}
                  />
                ))}
              </div>
              {game.phase === "gameOver" ? (
                <div className="game-actions game-over-actions" aria-label="Game over actions">
                  <MenuButton onClick={requestRematch}>
                    Rematch
                  </MenuButton>
                  <MenuButton onClick={returnMain}>Main Menu</MenuButton>
                </div>
              ) : (
                <div className="game-actions" aria-label="Turn actions">
                  {hasRolledThisTurn ? (
                    <>
                      <MenuButton disabled={!controlsEnabled || !selectedScoreValid} onClick={holdAndReroll}>
                        <span className="action-label-full">Hold and Reroll</span>
                        <span className="action-label-compact">Hold</span>
                      </MenuButton>
                      <MenuButton disabled={!controlsEnabled || !selectedScoreValid} onClick={() => sendAction("bank")}>
                        <span className="action-label-full">Bank and Pass</span>
                        <span className="action-label-compact">Bank</span>
                      </MenuButton>
                    </>
                  ) : (
                    <MenuButton disabled={!controlsEnabled || game.phase !== "ready"} onClick={roll}>
                      Roll
                    </MenuButton>
                  )}
                </div>
              )}
            </section>
          </section>
        </main>
      );
    }

    return null;
  }, [screen, gold, bet, goal, canAfford, canAffordRematch, game, controlsEnabled, selectedScoreValid, hasRolledThisTurn, multiplayerError, playerId, isRolling, rollVisual, customizationInventory, options, lobby, publicLobbies, joinCode, turnTimer, timerSecondsLeft]);

  function selectMode(nextMode: Mode) {
    if (nextMode === "multiplayer" && isDefaultUsername(options.username)) {
      setDefaultNameWarning(true);
      return;
    }
    setScreen(nextMode === "singleplayer" ? "bet" : "multiplayer");
  }

  return (
    <div className="app">
      {content}
      {foundGold && (
        <Dialog title="You found 10g..." onNo={() => setFoundGold(null)} noLabel="OK">
          <p>{foundGold}</p>
        </Dialog>
      )}
      {leaveDialog && (
        <Dialog title="Are you sure you want to leave and forfeit your bet?" onYes={leaveGame} onNo={() => setLeaveDialog(false)} />
      )}
      {rematchDialog === "waiting" && <Dialog title="Waiting for the other player..." onNo={cancelRematch} noLabel="Cancel" />}
      {rematchDialog === "challenge" && (
        <Dialog
          title="You have been challenged to a rematch, do you accept?"
          onYes={() => answerRematch(true)}
          onNo={() => answerRematch(false)}
        >
          {!canAffordRematch && <p>You need {game?.bet ?? bet}g to accept this rematch.</p>}
        </Dialog>
      )}
      {rematchPurseError && (
        <Dialog
          title="You do not have enough gold for this rematch."
          onNo={() => {
            setRematchPurseError(false);
            returnMain();
          }}
          noLabel="OK"
        />
      )}
      {rematchDialog === "cancelled" && (
        <Dialog title="That rematch invitation was cancelled." onNo={returnMain} noLabel="OK" />
      )}
      {rulesOpen && <RulesDialog onClose={() => setRulesOpen(false)} />}
      {defaultNameWarning && (
        <Dialog
          title="Choose a username before multiplayer."
          onNo={() => {
            setDefaultNameWarning(false);
            setScreen("main");
            setOptionsOpen(true);
          }}
          noLabel="OK"
        >
          <p>Your profile is still using the default name.</p>
        </Dialog>
      )}
      {optionsOpen && <OptionsDialog options={options} onApply={applyOptions} onClose={() => setOptionsOpen(false)} />}
      {privateJoinFailed && (
        <Dialog
          title="No private game exists for that code."
          onNo={() => {
            setPrivateJoinFailed(false);
            setMultiplayerError("");
            setScreen("multiplayer");
          }}
          noLabel="OK"
        />
      )}
      {customiseOpen && (
        <CustomiseDialog
          gold={gold}
          inventory={customizationInventory}
          onApply={applyCustomizationInventory}
          onPurchase={saveCustomizationInventory}
          onSpendGold={spendGold}
          onClose={() => setCustomiseOpen(false)}
        />
      )}
    </div>
  );
}

function localizeNames(state: GameState, self: PlayerId): GameState {
  const opponent = self === "p1" ? "p2" : "p1";
  const players = {
    ...state.players,
    [self]: { ...state.players[self], name: "You" },
    [opponent]: { ...state.players[opponent] }
  };
  return {
    ...state,
    players,
    message: localizeMessage(state, self)
  };
}

function selectedScoreFromDice(state: GameState) {
  if (state.phase !== "selecting") return 0;
  return scoreDice(state.dice.filter((die) => die.selected).map((die) => die.value)).score;
}

function shouldAnimateIncomingRoll(current: GameState | null, incoming: GameState) {
  if (!current) return false;
  const incomingIsRollResult = incoming.phase === "selecting" || incoming.phase === "bust";
  return current.phase === "ready" && incomingIsRollResult && current.activePlayer === incoming.activePlayer;
}

function localizeMessage(state: GameState, self: PlayerId) {
  const activeIsSelf = state.activePlayer === self;
  const opponent = self === "p1" ? "p2" : "p1";
  const opponentName = state.players[opponent].name;
  if (state.phase === "ready") return activeIsSelf ? "Your turn" : `${opponentName}'s turn`;
  if (state.phase === "selecting") return activeIsSelf ? "You rolled" : `${opponentName} rolled`;
  if (state.phase === "bust") return activeIsSelf ? "BUST" : `${opponentName} busted`;
  if (state.phase === "gameOver") {
    if (state.winner === self) return "You win!";
    if (state.winner) return `${state.players[state.winner].name} wins!`;
  }
  return state.message;
}

function getBetBubbleStyle(bet: number) {
  const ratio = bet / 30;
  return { left: `calc(16px + ${ratio * 100}% - ${ratio * 32}px)` };
}

function formatWaitingCount(count: number) {
  if (count === 0) return "No players awaiting match";
  if (count === 1) return "1 Player awaiting match";
  return `${count} Players awaiting match`;
}

function createRollMotion(index: number): RollMotion {
  const axis = randomRollAxis();
  const direction = Math.random() < 0.5 ? -1 : 1;
  const rotations = 3 + Math.floor(Math.random() * 3);
  const wobble = Math.floor(Math.random() * 120) - 60;
  const turns = direction * (rotations * 360 + wobble);
  return {
    axisX: axis.x.toFixed(2),
    axisY: axis.y.toFixed(2),
    axisZ: axis.z.toFixed(2),
    turns: `${turns}deg`,
    duration: `${rollDurationSeconds(index).toFixed(1)}s`
  };
}

function randomRollAxis() {
  const raw = {
    x: randomAxisComponent(),
    y: randomAxisComponent(),
    z: randomAxisComponent()
  };
  const length = Math.hypot(raw.x, raw.y, raw.z) || 1;
  return {
    x: raw.x / length,
    y: raw.y / length,
    z: raw.z / length
  };
}

function randomAxisComponent() {
  const magnitude = 0.35 + Math.random() * 0.75;
  return Math.random() < 0.5 ? -magnitude : magnitude;
}

function rollStopMs(index: number) {
  return Math.ceil((rollBaseDuration + Math.max(0, index) * rollStopStagger) * 1000);
}

function rollCompleteMs(diceCount: number) {
  return rollStopMs(Math.max(0, diceCount - 1)) + 80;
}

function rollDurationSeconds(index: number) {
  return rollStopMs(index) / 1000 - rollStartMs(index) / 1000;
}

function rollStartMs(index: number) {
  return Math.ceil(rollStartStagger * Math.max(0, index) * 1000);
}
