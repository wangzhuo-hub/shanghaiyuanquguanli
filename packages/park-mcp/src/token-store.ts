import { randomBytes } from 'node:crypto';
import type { AppSession } from './session.js';
import { createEmptySession } from './session.js';

export interface TokenEntry {
  token: string;
  session: AppSession;
  email: string;
  createdAt: number;
  expiresAt: number;
}

const store = new Map<string, TokenEntry>();

const TTL_MS = Number(process.env.MCP_TOKEN_TTL_MS || 8 * 60 * 60 * 1000);

export function issueToken(email: string, session: AppSession): TokenEntry {
  purgeExpired();
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const entry: TokenEntry = {
    token,
    session: {
      dashboard: session.dashboard,
      facility: session.facility,
      property: session.property,
    },
    email,
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  store.set(token, entry);
  return entry;
}

export function getTokenEntry(token: string | undefined): TokenEntry | null {
  if (!token) return null;
  purgeExpired();
  const entry = store.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(token);
    return null;
  }
  return entry;
}

export function revokeToken(token: string): boolean {
  return store.delete(token);
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
}

export function cloneSessionForToken(entry: TokenEntry): AppSession {
  const s = createEmptySession();
  s.dashboard = entry.session.dashboard;
  s.facility = entry.session.facility;
  s.property = entry.session.property;
  return s;
}
