const WALLET_KEY = "tavern-dice-wallet";

export function readWallet(): number {
  const saved = Number.parseInt(localStorage.getItem(WALLET_KEY) ?? "100", 10);
  return Number.isFinite(saved) ? Math.max(0, saved) : 100;
}

export function writeWallet(gold: number) {
  localStorage.setItem(WALLET_KEY, String(Math.max(0, Math.floor(gold))));
}

export function changeWallet(delta: number): number {
  const next = Math.max(0, readWallet() + delta);
  writeWallet(next);
  return next;
}
