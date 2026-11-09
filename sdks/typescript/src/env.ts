/**
 * Environment lookup that prefers AXONIO_* and falls back to the older
 * CLAWDB_* names, so existing setups keep working after the rename.
 * `readEnv('API_KEY')` reads AXONIO_API_KEY, then CLAWDB_API_KEY.
 */
export function readEnv(name: string): string | undefined {
  if (typeof process === 'undefined' || process.env == null) {
    return undefined;
  }
  return process.env[`AXONIO_${name}`] ?? process.env[`CLAWDB_${name}`];
}
