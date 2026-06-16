import GoTrue, { type User } from "gotrue-js";

export type IdentitySession = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  user?: {
    id: string;
    email: string;
  };
};

const sessionKey = "pips-identity-session";
const genericLoginError = "Login failed. Ensure your password is correct and your e-mail has been verified.";

const auth = new GoTrue({
  APIUrl: "/.netlify/identity",
  setCookie: false
});

export function readIdentitySession(): IdentitySession | null {
  try {
    const raw = localStorage.getItem(sessionKey);
    return raw ? (JSON.parse(raw) as IdentitySession) : null;
  } catch {
    return null;
  }
}

export function writeIdentitySession(session: IdentitySession | null) {
  if (!session) {
    localStorage.removeItem(sessionKey);
    return;
  }
  localStorage.setItem(sessionKey, JSON.stringify(session));
}

export async function signUpWithIdentity(email: string, password: string) {
  await auth.signup(email, password);
}

export async function logInWithIdentity(email: string, password: string) {
  let user: User;
  try {
    user = await auth.login(email, password, true);
  } catch {
    throw new Error(genericLoginError);
  }
  const session = sessionFromUser(user);
  writeIdentitySession(session);
  return session;
}

export async function requestPasswordReset(email: string) {
  await auth.requestPasswordRecovery(email);
}

export async function confirmIdentityEmail(token: string) {
  const user = await auth.confirm(token, true);
  const session = sessionFromUser(user);
  writeIdentitySession(session);
  return session;
}

export function readIdentityRedirectToken() {
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  return {
    confirmationToken: hashParams.get("confirmation_token") ?? params.get("confirmation_token"),
    recoveryToken: hashParams.get("recovery_token") ?? params.get("recovery_token"),
    accessToken: hashParams.get("access_token") ?? params.get("access_token")
  };
}

export function clearIdentityRedirectToken() {
  if (!window.location.hash && !window.location.search) return;
  window.history.replaceState({}, document.title, window.location.pathname);
}

export function logOutIdentity() {
  writeIdentitySession(null);
}

function sessionFromUser(user: User): IdentitySession {
  const token = user.tokenDetails();
  if (!token) throw new Error(genericLoginError);
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_in: token.expires_in,
    token_type: token.token_type,
    user: {
      id: user.id,
      email: user.email
    }
  };
}
