let context: AudioContext | null = null;
let muted = false;
const diceDiceClip = "/audio/dice/DiceDice.mp3";
const diceDiceRattleClip = "/audio/dice/DiceDiceRattle.mp3";
const diceTrayRattleClip = "/audio/dice/DiceTrayRattle.mp3";

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

export function playRoll(diceCount = 6) {
  if (muted) return;
  const count = Math.max(1, Math.min(6, Math.floor(diceCount)));
  const diceCollisionCount = Math.floor(Math.random() * (count + 1));

  for (let index = 0; index < count; index += 1) {
    window.setTimeout(() => playDiceClip(diceTrayRattleClip, 0.2, 0.09), index * (42 + Math.random() * 24));
  }

  for (let index = 0; index < diceCollisionCount; index += 1) {
    const clip = Math.random() < 0.45 ? diceDiceRattleClip : diceDiceClip;
    window.setTimeout(() => playDiceClip(clip, 0.28, 0.1), 65 + index * (58 + Math.random() * 42));
  }
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
