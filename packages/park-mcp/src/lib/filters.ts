export function escapeFilter(value: string): string {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isValidPeriod(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}
