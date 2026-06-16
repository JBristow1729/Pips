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
  const response = await fetch("/.netlify/identity/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error(await identityError(response, "Could not create that account."));
}

export async function logInWithIdentity(email: string, password: string) {
  const body = new URLSearchParams({
    grant_type: "password",
    username: email,
    password
  });
  const response = await fetch("/.netlify/identity/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) throw new Error(await identityError(response, "Could not log in."));
  const session = (await response.json()) as IdentitySession;
  writeIdentitySession(session);
  return session;
}

export async function requestPasswordReset(email: string) {
  const response = await fetch("/.netlify/identity/recover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email })
  });
  if (!response.ok) throw new Error(await identityError(response, "Could not send password reset email."));
}

export function logOutIdentity() {
  writeIdentitySession(null);
}

async function identityError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { msg?: string; error?: string; error_description?: string };
    return body.error_description ?? body.msg ?? body.error ?? fallback;
  } catch {
    return fallback;
  }
}
