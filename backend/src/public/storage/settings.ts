import type { SqlDatabase } from '../../storage/sql.js';

/** The names of the run-time switches. Each is a value in `public_settings`; absent means "as the environment says". */
export type SettingKey = 'free_tier_enabled' | 'signups_enabled' | 'maintenance_message';

/**
 * Switches an administrator can flip while the server runs, shared by every instance through the database. They are
 * read on the request that depends on them, so that a change is instant.
 */
export class PublicSettings {
  constructor(
    private readonly database: SqlDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: SettingKey): string | null {
    const row = this.database.prepare('SELECT value FROM public_settings WHERE key = ?').get(key);
    return row ? String(row.value) : null;
  }

  set(key: SettingKey, value: string): void {
    this.database
      .prepare(
        `INSERT INTO public_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      )
      .run(key, value, this.now());
  }

  clear(key: SettingKey): void {
    this.database.prepare('DELETE FROM public_settings WHERE key = ?').run(key);
  }

  /** A switch kept as `on` or `off`; `fallback` when it was never set. */
  flag(key: SettingKey, fallback: boolean): boolean {
    const value = this.get(key);
    return value === null ? fallback : value === 'on';
  }

  setFlag(key: SettingKey, on: boolean): void {
    this.set(key, on ? 'on' : 'off');
  }
}
