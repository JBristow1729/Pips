let context: AudioContext | null = null;
let muted = false;

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

export function playRoll() {
  if (muted) return;
  for (let index = 0; index < 8; index += 1) {
    window.setTimeout(() => tone(120 + Math.random() * 180, 0.04, "square", 0.025), index * 55);
  }
}

export function setMuted(value: boolean) {
  muted = value;
}

export function isMuted() {
  return muted;
}
