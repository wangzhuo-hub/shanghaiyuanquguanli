export interface ChangeLogEntry {
  id: string;
  operatorName: string;
  changedAt: string;
  action: string;
  targetSummary?: string;
  detail?: string;
  snapshot?: string;
}

const OPERATOR_KEY = 'kingdee_operator_name';
const LOG_KEY = 'kingdee_change_log_v1';
const MAX_ENTRIES = 50;

export function getOperatorName(): string {
  try {
    return localStorage.getItem(OPERATOR_KEY) || '';
  } catch {
    return '';
  }
}

export function setOperatorName(name: string): void {
  try {
    localStorage.setItem(OPERATOR_KEY, (name || '').trim());
  } catch {}
}

export function getChangeLog(): ChangeLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as ChangeLogEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveChangeLog(list: ChangeLogEntry[]): void {
  try {
    const trimmed = list.slice(0, MAX_ENTRIES);
    localStorage.setItem(LOG_KEY, JSON.stringify(trimmed));
  } catch {}
}

/**
 * 记录一次应用变更（操作人、时间、变更内容、可选快照）
 */
export function recordChange(options: {
  action: string;
  targetSummary?: string;
  detail?: string;
  snapshot?: any;
}): void {
  const operatorName = getOperatorName() || '未设置操作人';
  const entry: ChangeLogEntry = {
    id: `cl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    operatorName,
    changedAt: new Date().toISOString(),
    action: options.action,
    targetSummary: options.targetSummary,
    detail: options.detail,
    snapshot: options.snapshot ? JSON.stringify(options.snapshot) : undefined,
  };
  const list = getChangeLog();
  list.unshift(entry);
  saveChangeLog(list);
}

/**
 * 删除指定变更记录（撤回后移除原条目）
 */
export function deleteChangeLogEntry(id: string): void {
  const list = getChangeLog().filter(e => e.id !== id);
  saveChangeLog(list);
}

/**
 * 获取指定变更记录的快照数据（解析 JSON）
 */
export function getSnapshot(entry: ChangeLogEntry): any | null {
  if (!entry.snapshot) return null;
  try {
    return JSON.parse(entry.snapshot);
  } catch {
    return null;
  }
}
