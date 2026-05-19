import type { TFunction } from 'i18next';
import { requestCodexUsagePayload } from '@/services/api';
import type { CodexUsagePayload } from '@/types';
import type {
  MonitoringAccountRow,
  MonitoringEventRow,
} from '@/features/monitoring/hooks/useMonitoringData';
import type { AccountSortKey } from '@/features/monitoring/accountOverviewState';
import type {
  AccountQuotaEntry,
  AccountQuotaWindow,
} from '@/features/monitoring/components/accountOverviewPresentation';
import type { MonitoringAccountQuotaTarget } from '@/features/monitoring/accountOverviewQuotaTargets';
import { formatStatusWindowLabel } from '@/features/monitoring/model/statusWindow';
import { buildCodexQuotaWindowInfos, normalizePlanType } from '@/utils/quota';
import type { ModelPrice } from '@/utils/usage';

export type StatusFilter = 'all' | 'success' | 'failed';

export type FocusSnapshot = {
  searchInput: string;
  selectedAccount: string;
  selectedProvider: string;
  selectedModel: string;
  selectedChannel: string;
  selectedApiKeyHash: string;
  selectedStatus: StatusFilter;
};

export type PriceDraft = {
  prompt: string;
  completion: string;
  cache: string;
};

export type RealtimeLogRow = MonitoringEventRow & {
  requestCount: number;
  successRate: number;
  streamKey: string;
  recentPattern: boolean[];
};

export type AccountOverviewColumn = {
  key: string;
  label: string;
  sortKey?: AccountSortKey;
};

export type PaginationState<T> = {
  currentPage: number;
  totalPages: number;
  pageItems: T[];
  startItem: number;
  endItem: number;
};

const padDateUnit = (value: number) => String(value).padStart(2, '0');

export const formatDateTimeLocalValue = (date: Date) =>
  `${date.getFullYear()}-${padDateUnit(date.getMonth() + 1)}-${padDateUnit(date.getDate())}T${padDateUnit(date.getHours())}:${padDateUnit(date.getMinutes())}`;

export const getTodayStartInputValue = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return formatDateTimeLocalValue(date);
};

export const getCurrentInputValue = () => formatDateTimeLocalValue(new Date());

export const parseDateTimeLocalValue = (value: string) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const ensureSelectedOption = <T extends { value: string; label: string }>(
  options: T[],
  value: string,
  label = value
): T[] => {
  if (!value || value === 'all' || options.some((option) => option.value === value)) {
    return options;
  }
  return [...options, { value, label } as T];
};

export const isUsageImportFile = (file: File) => {
  const normalizedName = file.name.toLowerCase();
  const normalizedType = file.type.toLowerCase();
  return (
    /\.(json|jsonl|ndjson|txt)$/.test(normalizedName) ||
    normalizedType === 'application/json' ||
    normalizedType === 'application/x-ndjson' ||
    normalizedType === 'text/plain'
  );
};

export const buildPaginationState = <T,>(
  items: readonly T[],
  page: number,
  pageSize: number
): PaginationState<T> => {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, items.length);

  return {
    currentPage,
    totalPages,
    pageItems: items.slice(startIndex, endIndex),
    startItem: items.length > 0 ? startIndex + 1 : 0,
    endItem: endIndex,
  };
};

export const createPriceDraft = (price?: ModelPrice): PriceDraft => ({
  prompt: price ? String(price.prompt) : '',
  completion: price ? String(price.completion) : '',
  cache: price ? String(price.cache) : '',
});

export const parsePriceValue = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export const buildAccountOptionLabel = (row: MonitoringAccountRow) => {
  if (!row.displayAccount || row.displayAccount === row.account) {
    return row.account;
  }
  return `${row.displayAccount} / ${row.account}`;
};

export const buildAccountQuotaWindows = (
  payload: CodexUsagePayload,
  t: TFunction
): AccountQuotaWindow[] =>
  buildCodexQuotaWindowInfos(payload).map((window) => {
    const clampedUsed =
      window.usedPercent === null ? null : Math.max(0, Math.min(100, window.usedPercent));
    const remainingPercent = clampedUsed === null ? null : Math.max(0, 100 - clampedUsed);
    let usageLabel: string | null = null;

    if (
      window.limitWindowSeconds !== null &&
      window.limitWindowSeconds > 0 &&
      clampedUsed !== null
    ) {
      const totalHours = window.limitWindowSeconds / 3600;
      const usedHours = (totalHours * clampedUsed) / 100;
      const formatHours = (value: number) =>
        Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
      usageLabel = t('codex_quota.window_usage', {
        used: formatHours(usedHours),
        total: formatHours(totalHours),
      });
    }

    return {
      id: window.id,
      label: t(window.labelKey, window.labelParams),
      remainingPercent,
      resetLabel: window.resetLabel,
      usageLabel,
    };
  });

export const requestAccountQuota = async (
  target: MonitoringAccountQuotaTarget,
  t: TFunction
): Promise<AccountQuotaEntry> => {
  const payload = await requestCodexUsagePayload(
    {
      authIndex: target.authIndex,
      accountId: target.accountId,
    },
    { emptyMessage: t('codex_quota.empty_windows') }
  );

  return {
    key: target.key,
    authLabel: target.authLabel,
    fileName: target.fileName,
    planType: normalizePlanType(payload.plan_type ?? payload.planType) ?? target.planType,
    windows: buildAccountQuotaWindows(payload, t),
  };
};

export const buildRealtimeLogRows = (rows: MonitoringEventRow[]): RealtimeLogRow[] => {
  const sortedAsc = [...rows].sort(
    (left, right) => left.timestampMs - right.timestampMs || left.id.localeCompare(right.id)
  );
  const metricsByStream = new Map<string, { total: number; success: number; pattern: boolean[] }>();

  const enriched = sortedAsc.map((row) => {
    const streamKey = [row.account, row.provider, row.model, row.channel].join('::');
    const previous = metricsByStream.get(streamKey) ?? { total: 0, success: 0, pattern: [] };
    const nextPattern = [...previous.pattern, !row.failed].slice(-10);
    const next = {
      total: previous.total + (row.statsIncluded ? 1 : 0),
      success: previous.success + (row.statsIncluded && !row.failed ? 1 : 0),
      pattern: nextPattern,
    };
    metricsByStream.set(streamKey, next);

    return {
      ...row,
      streamKey,
      requestCount: next.total,
      successRate: next.total > 0 ? next.success / next.total : 1,
      recentPattern: nextPattern,
    } satisfies RealtimeLogRow;
  });

  return enriched.sort(
    (left, right) =>
      right.timestampMs - left.timestampMs ||
      right.requestCount - left.requestCount ||
      right.id.localeCompare(left.id)
  );
};

export const formatAccountOverviewScopeText = (
  bounds: { startMs: number; endMs: number } | null,
  locale: string,
  t: TFunction
) => {
  if (!bounds) {
    return t('monitoring.account_overview_scope_current_filters');
  }

  const rangeLabel =
    Number.isFinite(bounds.startMs) && Number.isFinite(bounds.endMs)
      ? formatStatusWindowLabel(bounds.startMs, bounds.endMs, locale)
      : t('monitoring.range_all');

  return t('monitoring.account_overview_scope_range', { range: rangeLabel });
};
