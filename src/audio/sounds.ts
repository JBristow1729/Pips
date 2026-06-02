let context: AudioContext | null = null;
let muted = false;
const diceDiceClip = "/audio/dice/DiceDice.mp3";
const diceDiceRattleClip = "/audio/dice/DiceDiceRattle.mp3";
const diceTrayClip = "/audio/dice/DiceTray.mp3";
const diceTrayRattleClip = "/audio/dice/DiceTrayRattle.mp3";
type RollSoundOptions = {
  rollWindowMs?: number;
  startStaggerMs?: number;
};

function getContext() {
  context ??= new AudioContext();
  return context;
}

function tone(frequency: number, duration: number, type: OscillatorType, volume = 0.05) {
  if (muted) return;
  const ctx = getContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.value = volume;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  oscillator.stop(ctx.currentTime + duration);
}

export function playTap() {
  tone(420, 0.06, "triangle", 0.04);
}

export function playRoll(diceCount = 6, options: RollSoundOptions = {}) {
  if (muted) return;
  const count = Math.max(1, Math.min(6, Math.floor(diceCount)));
  const rollWindowMs = Math.max(250, options.rollWindowMs ?? 1500);
  const startStaggerMs = Math.max(0, options.startStaggerMs ?? 100);

  for (let index = 0; index < count; index += 1) {
    window.setTimeout(() => playDiceClip(diceTrayRattleClip, 0.2, 0.09), index * startStaggerMs);
  }

  scheduleRandomDiceClips(diceDiceClip, randomClipCount(count), rollWindowMs, 0.26, 0.1);
  scheduleRandomDiceClips(diceDiceRattleClip, randomClipCount(count), rollWindowMs, 0.25, 0.1);
  scheduleRandomDiceClips(diceTrayClip, randomClipCount(count), rollWindowMs, 0.22, 0.08);
}

export function playWarning() {
  tone(760, 0.08, "sawtooth", 0.045);
  window.setTimeout(() => tone(520, 0.08, "sawtooth", 0.035), 90);
}

export function setMuted(value: boolean) {
  muted = value;
}

export function isMuted() {
  return muted;
}

function playDiceClip(clip: string, baseVolume: number, volumeVariance: number) {
  if (muted) return;
  const audio = new Audio(clip);
  audio.volume = baseVolume + Math.random() * volumeVariance;
  audio.playbackRate = 0.94 + Math.random() * 0.12;
  void audio.play().catch(() => undefined);
}

function scheduleRandomDiceClips(clip: string, count: number, rollWindowMs: number, baseVolume: number, volumeVariance: number) {
  for (let index = 0; index < count; index += 1) {
    const delay = Math.random() * rollWindowMs;
    window.setTimeout(() => playDiceClip(clip, baseVolume, volumeVariance), delay);
  }
}

function randomClipCount(max: number) {
  return Math.floor(Math.random() * (max + 1));
}
