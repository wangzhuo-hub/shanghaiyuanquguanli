import fs from 'node:fs/promises';
import path from 'node:path';
import { PACKAGE_ROOT } from '../config.js';

const AUDIT_PATH = process.env.MCP_AUDIT_LOG
  ? path.resolve(process.env.MCP_AUDIT_LOG)
  : path.join(PACKAGE_ROOT, 'logs', 'audit.jsonl');

let auditReady = false;

async function ensureAuditDir(): Promise<void> {
  if (auditReady) return;
  await fs.mkdir(path.dirname(AUDIT_PATH), { recursive: true });
  auditReady = true;
}

export interface AuditEntry {
  tool: string;
  action: string;
  actor?: string;
  project_id?: string;
  collection?: string;
  record_id?: string;
  ok: boolean;
  detail?: unknown;
}

export async function auditLog(entry: AuditEntry): Promise<void> {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry,
  });
  try {
    await ensureAuditDir();
    await fs.appendFile(AUDIT_PATH, `${line}\n`, 'utf8');
  } catch (e) {
    console.error('[park-mcp] audit write failed:', e instanceof Error ? e.message : e);
  }
  console.error(`[park-mcp:audit] ${entry.tool} ${entry.action} ok=${entry.ok} actor=${entry.actor || '-'}`);
}
