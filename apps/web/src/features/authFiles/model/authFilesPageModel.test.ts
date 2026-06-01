import { describe, expect, it } from 'vitest';
import type { AuthFileItem, CodexQuotaState } from '@/types';
import {
  authFileMatchesCodexStatusFilter,
  buildAuthFileCodexInspectionMap,
  getAuthFileCodexInspectionKey,
  getAuthFileCodexStatus,
  getAuthFileSearchValues,
  normalizeAuthFilesCodexStatusFilter,
  stringifySearchValue,
  type AuthFileCodexInspectionSnapshot,
} from './authFilesPageModel';

const t = ((key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? key) as never;

const codexFile = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'codex-main.json',
  type: 'codex',
  authIndex: 'codex-main',
  ...overrides,
});

const codexQuota = (overrides: Partial<CodexQuotaState> = {}): CodexQuotaState => ({
  status: 'success',
  windows: [
    {
      id: 'weekly',
      label: 'Weekly limit',
      usedPercent: 100,
      resetLabel: '06/04 12:00',
      limitWindowSeconds: 604_800,
    },
  ],
  ...overrides,
});

describe('auth file Codex status helpers', () => {
  it('detects weekly-limited Codex quota from the weekly quota window', () => {
    const status = getAuthFileCodexStatus(codexFile(), codexQuota());

    expect(status.isCodex).toBe(true);
    expect(status.isWeeklyLimited).toBe(true);
    expect(authFileMatchesCodexStatusFilter(status, 'weekly_limited')).toBe(true);
    expect(status.badges.map((badge) => badge.kind)).toContain('weekly_limited');
  });

  it('detects disabled Codex files with a known weekly reset label', () => {
    const status = getAuthFileCodexStatus(codexFile({ disabled: true }), codexQuota());

    expect(status.hasDisabledWeeklyReset).toBe(true);
    expect(status.weeklyResetLabel).toBe('06/04 12:00');
    expect(authFileMatchesCodexStatusFilter(status, 'disabled_with_reset')).toBe(true);
    expect(status.badges.find((badge) => badge.kind === 'disabled_with_reset')).toMatchObject({
      labelParams: { reset: '06/04 12:00' },
    });
  });

  it('detects HTTP 401 and reauth needs from the latest inspection result', () => {
    const status = getAuthFileCodexStatus(codexFile(), undefined, {
      fileName: 'codex-main.json',
      authIndex: 'codex-main',
      statusCode: 401,
      action: 'reauth',
      usedPercent: null,
      isQuota: false,
    });

    expect(status.isHttp401).toBe(true);
    expect(status.needsReauth).toBe(true);
    expect(authFileMatchesCodexStatusFilter(status, 'http_401')).toBe(true);
    expect(authFileMatchesCodexStatusFilter(status, 'reauth')).toBe(true);
    expect(status.badges.map((badge) => badge.kind)).toContain('reauth');
  });

  it('does not treat non-quota inspection percentages as weekly quota limits', () => {
    const status = getAuthFileCodexStatus(codexFile(), undefined, {
      fileName: 'codex-main.json',
      authIndex: 'codex-main',
      statusCode: 401,
      action: 'delete',
      usedPercent: 100,
      isQuota: false,
    });

    expect(status.isHttp401).toBe(true);
    expect(status.isWeeklyLimited).toBe(false);
    expect(authFileMatchesCodexStatusFilter(status, 'weekly_limited')).toBe(false);
  });

  it('ignores non-Codex files for Codex-only status filters', () => {
    const status = getAuthFileCodexStatus({ name: 'qwen.json', type: 'qwen' }, codexQuota());

    expect(status.isCodex).toBe(false);
    expect(status.isWeeklyLimited).toBe(false);
    expect(authFileMatchesCodexStatusFilter(status, 'weekly_limited')).toBe(false);
  });

  it('indexes inspection results by file name and auth index', () => {
    const inspection: AuthFileCodexInspectionSnapshot = {
      fileName: 'codex-main.json',
      authIndex: 'codex-main',
      statusCode: 401,
      action: 'delete',
      usedPercent: null,
      isQuota: false,
    };

    const map = buildAuthFileCodexInspectionMap([inspection]);

    expect(map.get(getAuthFileCodexInspectionKey('codex-main.json', 'codex-main'))).toBe(
      inspection
    );
  });

  it('adds derived Codex status labels to searchable values', () => {
    const status = getAuthFileCodexStatus(codexFile(), undefined, {
      fileName: 'codex-main.json',
      authIndex: 'codex-main',
      statusCode: 401,
      action: 'reauth',
      usedPercent: null,
      isQuota: false,
    });

    expect(
      stringifySearchValue(getAuthFileSearchValues(codexFile(), t, undefined, status))
    ).toContain('auth_files.codex_status_badge_reauth');
    expect(normalizeAuthFilesCodexStatusFilter('disabled_with_reset')).toBe('disabled_with_reset');
    expect(normalizeAuthFilesCodexStatusFilter('unknown')).toBeNull();
  });
});
