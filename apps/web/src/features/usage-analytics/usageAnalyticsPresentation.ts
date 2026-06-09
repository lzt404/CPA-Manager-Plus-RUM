import type { TFunction } from 'i18next';
import {
  computeCacheHitRate,
  formatMetricValue,
  type UsageSummaryDelta,
  type UsageSummaryMetrics,
  type UsageTimelinePoint,
} from './usageAnalyticsModel';

export type UsageSummaryCardIcon =
  | 'anomaly'
  | 'cache'
  | 'calls'
  | 'cost'
  | 'credential'
  | 'failure'
  | 'input'
  | 'key'
  | 'latency'
  | 'model'
  | 'output'
  | 'success'
  | 'tokens'
  | 'trend';

export type UsageSummaryCardAccent =
  | 'amber'
  | 'blue'
  | 'cyan'
  | 'green'
  | 'indigo'
  | 'red'
  | 'teal'
  | 'violet';

export type UsageSummaryCardTone = 'bad' | 'good' | 'warn';

export type UsageSummaryCard = {
  accent?: UsageSummaryCardAccent;
  fullLabel?: string;
  icon?: UsageSummaryCardIcon;
  label: string;
  meta: string;
  tone?: UsageSummaryCardTone;
  value: string;
  valueTitle?: string;
  variant?: 'primary' | 'secondary';
};

type CommonSummaryContext = {
  locale: string;
  t: TFunction;
};

type OverviewSummaryCardsInput = CommonSummaryContext & {
  anomalyCount: number;
  reasoningTokens: number;
  summary: UsageSummaryMetrics;
  summaryDelta: UsageSummaryDelta;
};

type TrendSummaryCardsInput = CommonSummaryContext & {
  summaryDelta: UsageSummaryDelta;
  timeline: UsageTimelinePoint[];
};

type EntitySummaryCardsInput = CommonSummaryContext & {
  activeCount: number;
  activeLabel: string;
  activeMeta: string;
  activeIcon: UsageSummaryCardIcon;
  activeAccent: UsageSummaryCardAccent;
  anomalyCount?: number;
  anomalyLabel?: string;
  summary: UsageSummaryMetrics;
};

type HeatmapSummaryCardsInput = CommonSummaryContext & {
  summary: UsageSummaryMetrics;
};

const formatCompactNumber = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
};

const formatFullNumber = (value: number, locale: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0
  );

const formatPercent = (value: number) =>
  `${((Number.isFinite(value) ? value : 0) * 100).toFixed(1)}%`;

const formatDelta = (value: number) => {
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
};

const formatSecondValue = (seconds: number) => {
  const fixed = seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0$/, '$1');
};

export const formatUsageDurationMs = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '-';

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return '-';
  if (parsed < 1000) return `${Math.round(parsed)}ms`;

  return `${formatSecondValue(parsed / 1000)}s`;
};

const getMaxTimelinePoint = (
  timeline: UsageTimelinePoint[],
  valueOf: (point: UsageTimelinePoint) => number
) =>
  timeline.reduce<UsageTimelinePoint | null>((current, point) => {
    if (!current) return point;
    return valueOf(point) > valueOf(current) ? point : current;
  }, null);

const getMaxTimelineMs = (
  timeline: UsageTimelinePoint[],
  valueOf: (point: UsageTimelinePoint) => number | null
) =>
  timeline.reduce<number | null>((current, point) => {
    const value = valueOf(point);
    if (value === null || !Number.isFinite(value)) return current;
    return current === null || value > current ? value : current;
  }, null);

const deltaMeta = (
  summaryDelta: UsageSummaryDelta,
  key: 'estimatedCost' | 'requestCount' | 'totalTokens',
  t: TFunction,
  fallback: string
) =>
  summaryDelta.hasComparison
    ? `${formatDelta(summaryDelta[key])} ${t('usage_analytics.summary_vs_previous')}`
    : fallback;

export const buildUsageOverviewSummaryCards = ({
  anomalyCount,
  locale,
  reasoningTokens,
  summary,
  summaryDelta,
  t,
}: OverviewSummaryCardsInput): UsageSummaryCard[] => {
  const cacheTokens = summary.cachedTokens + summary.cacheReadTokens + summary.cacheCreationTokens;
  const totalTokens = Math.max(summary.totalTokens, 0);
  const p95LatencyLabel =
    summary.p95LatencyMs === null && summary.p95TtftMs !== null
      ? t('usage_analytics.metric_p95_ttft')
      : t('usage_analytics.metric_p95_latency');
  const p95LatencyValue = summary.p95LatencyMs ?? summary.p95TtftMs;

  return [
    {
      accent: 'blue',
      fullLabel: t('usage_analytics.metric_request_count'),
      icon: 'calls',
      label: t('usage_analytics.metric_request_count'),
      meta: deltaMeta(summaryDelta, 'requestCount', t, t('usage_analytics.summary_meta')),
      value: formatMetricValue('requestCount', summary.requestCount),
      valueTitle: formatFullNumber(summary.requestCount, locale),
    },
    {
      accent: 'green',
      fullLabel: t('usage_analytics.success_rate'),
      icon: 'success',
      label: t('usage_analytics.success_rate'),
      meta: `${p95LatencyLabel} ${formatUsageDurationMs(p95LatencyValue)}`,
      tone: summary.successRate >= 0.95 ? 'good' : summary.successRate >= 0.85 ? 'warn' : 'bad',
      value: formatPercent(summary.successRate),
    },
    {
      accent: 'red',
      fullLabel: t('usage_analytics.metric_failure_count'),
      icon: 'failure',
      label: t('usage_analytics.metric_failure_count'),
      meta: `${anomalyCount} ${t('usage_analytics.anomaly_points_title')}`,
      tone: summary.failureCount > 0 ? 'bad' : 'good',
      value: formatMetricValue('requestCount', summary.failureCount),
      valueTitle: formatFullNumber(summary.failureCount, locale),
    },
    {
      accent: 'amber',
      fullLabel: t('usage_analytics.metric_estimated_cost'),
      icon: 'cost',
      label: t('usage_analytics.metric_estimated_cost'),
      meta: deltaMeta(summaryDelta, 'estimatedCost', t, t('usage_analytics.summary_cost_meta')),
      value: formatMetricValue('estimatedCost', summary.estimatedCost),
    },
    {
      accent: 'indigo',
      fullLabel: t('usage_analytics.metric_total_tokens'),
      icon: 'tokens',
      label: t('usage_analytics.metric_total_tokens'),
      meta: `${t('usage_analytics.metric_reasoning_tokens')} ${formatCompactNumber(reasoningTokens)}`,
      value: formatMetricValue('totalTokens', summary.totalTokens),
      valueTitle: formatFullNumber(summary.totalTokens, locale),
      variant: 'secondary',
    },
    {
      accent: 'cyan',
      fullLabel: t('usage_analytics.metric_input_tokens'),
      icon: 'input',
      label: t('usage_analytics.metric_input_tokens'),
      meta: `${t('usage_analytics.share')} ${formatPercent(
        totalTokens > 0 ? summary.inputTokens / totalTokens : 0
      )}`,
      value: formatMetricValue('totalTokens', summary.inputTokens),
      valueTitle: formatFullNumber(summary.inputTokens, locale),
      variant: 'secondary',
    },
    {
      accent: 'violet',
      fullLabel: t('usage_analytics.metric_output_tokens'),
      icon: 'output',
      label: t('usage_analytics.metric_output_tokens'),
      meta: `${t('usage_analytics.share')} ${formatPercent(
        totalTokens > 0 ? summary.outputTokens / totalTokens : 0
      )}`,
      value: formatMetricValue('totalTokens', summary.outputTokens),
      valueTitle: formatFullNumber(summary.outputTokens, locale),
      variant: 'secondary',
    },
    {
      accent: 'teal',
      fullLabel: t('usage_analytics.metric_cached_tokens'),
      icon: 'cache',
      label: t('usage_analytics.metric_cached_tokens'),
      meta: `${t('usage_analytics.cache_read_rate')} ${formatPercent(computeCacheHitRate(summary))}`,
      value: formatMetricValue('totalTokens', cacheTokens),
      valueTitle: formatFullNumber(cacheTokens, locale),
      variant: 'secondary',
    },
  ];
};

export const buildUsageTrendSummaryCards = ({
  locale,
  summaryDelta,
  timeline,
  t,
}: TrendSummaryCardsInput): UsageSummaryCard[] => {
  const peakRequestPoint = getMaxTimelinePoint(timeline, (point) => point.requestCount);
  const peakFailurePoint = getMaxTimelinePoint(timeline, (point) => point.failureRate);
  const peakP95Ms = getMaxTimelineMs(timeline, (point) => point.p95LatencyMs);
  const averageBucketRequests =
    timeline.length > 0
      ? timeline.reduce((sum, point) => sum + point.requestCount, 0) / timeline.length
      : 0;

  return [
    {
      accent: 'indigo',
      icon: 'latency',
      label: t('usage_analytics.trend_peak_request_bucket'),
      meta: peakRequestPoint
        ? `${formatCompactNumber(peakRequestPoint.requestCount)} ${t('usage_analytics.metric_request_count')}`
        : '-',
      value: peakRequestPoint?.label ?? '-',
      valueTitle: peakRequestPoint
        ? formatFullNumber(peakRequestPoint.requestCount, locale)
        : undefined,
    },
    {
      accent: 'blue',
      icon: 'calls',
      label: t('usage_analytics.trend_average_bucket_requests'),
      meta: t('usage_analytics.summary_meta'),
      value: formatCompactNumber(averageBucketRequests),
    },
    {
      accent: 'blue',
      icon: 'trend',
      label: t('usage_analytics.trend_request_change'),
      meta: t('usage_analytics.summary_vs_previous'),
      value: summaryDelta.hasComparison ? formatDelta(summaryDelta.requestCount) : '-',
    },
    {
      accent: 'teal',
      icon: 'tokens',
      label: t('usage_analytics.trend_token_change'),
      meta: t('usage_analytics.summary_vs_previous'),
      value: summaryDelta.hasComparison ? formatDelta(summaryDelta.totalTokens) : '-',
    },
    {
      accent: 'amber',
      icon: 'cost',
      label: t('usage_analytics.trend_cost_change'),
      meta: t('usage_analytics.summary_vs_previous'),
      value: summaryDelta.hasComparison ? formatDelta(summaryDelta.estimatedCost) : '-',
    },
    {
      accent: 'red',
      icon: 'failure',
      label: t('usage_analytics.trend_failure_peak'),
      meta: peakFailurePoint?.label ?? '-',
      tone: peakFailurePoint && peakFailurePoint.failureRate > 0 ? 'bad' : 'good',
      value: peakFailurePoint ? formatPercent(peakFailurePoint.failureRate) : '-',
    },
    {
      accent: 'violet',
      icon: 'latency',
      label: t('usage_analytics.trend_p95_peak'),
      meta: t('usage_analytics.metric_p95_latency'),
      value: formatUsageDurationMs(peakP95Ms),
    },
  ];
};

export const buildUsageEntitySummaryCards = ({
  activeAccent,
  activeCount,
  activeIcon,
  activeLabel,
  activeMeta,
  anomalyCount,
  anomalyLabel,
  locale,
  summary,
  t,
}: EntitySummaryCardsInput): UsageSummaryCard[] => [
  {
    accent: activeAccent,
    icon: activeIcon,
    label: activeLabel,
    meta: activeMeta,
    value: formatCompactNumber(activeCount),
    valueTitle: formatFullNumber(activeCount, locale),
  },
  {
    accent: 'blue',
    icon: 'calls',
    label: t('usage_analytics.metric_request_count'),
    meta: t('usage_analytics.summary_meta'),
    value: formatMetricValue('requestCount', summary.requestCount),
    valueTitle: formatFullNumber(summary.requestCount, locale),
  },
  {
    accent: 'teal',
    icon: 'tokens',
    label: t('usage_analytics.metric_total_tokens'),
    meta: t('usage_analytics.summary_meta'),
    value: formatMetricValue('totalTokens', summary.totalTokens),
    valueTitle: formatFullNumber(summary.totalTokens, locale),
  },
  {
    accent: 'amber',
    icon: 'cost',
    label: t('usage_analytics.metric_estimated_cost'),
    meta: t('usage_analytics.summary_cost_meta'),
    value: formatMetricValue('estimatedCost', summary.estimatedCost),
  },
  {
    accent: anomalyCount === undefined ? 'amber' : 'red',
    icon: anomalyCount === undefined ? 'cost' : 'anomaly',
    label:
      anomalyCount === undefined
        ? t('usage_analytics.metric_average_cost_per_call')
        : (anomalyLabel ?? t('usage_analytics.anomaly_points_title')),
    meta: t('usage_analytics.summary_meta'),
    tone: anomalyCount && anomalyCount > 0 ? 'bad' : undefined,
    value:
      anomalyCount === undefined
        ? formatMetricValue('estimatedCost', summary.averageCostPerCall)
        : formatCompactNumber(anomalyCount),
  },
];

export const buildUsageHeatmapSummaryCards = ({
  locale,
  summary,
  t,
}: HeatmapSummaryCardsInput): UsageSummaryCard[] => [
  {
    accent: 'blue',
    icon: 'calls',
    label: t('usage_analytics.metric_request_count'),
    meta: t('usage_analytics.summary_meta'),
    value: formatMetricValue('requestCount', summary.requestCount),
    valueTitle: formatFullNumber(summary.requestCount, locale),
  },
  {
    accent: 'teal',
    icon: 'tokens',
    label: t('usage_analytics.metric_total_tokens'),
    meta: t('usage_analytics.summary_meta'),
    value: formatMetricValue('totalTokens', summary.totalTokens),
    valueTitle: formatFullNumber(summary.totalTokens, locale),
  },
  {
    accent: 'amber',
    icon: 'cost',
    label: t('usage_analytics.metric_estimated_cost'),
    meta: t('usage_analytics.summary_cost_meta'),
    value: formatMetricValue('estimatedCost', summary.estimatedCost),
  },
  {
    accent: 'red',
    icon: 'failure',
    label: t('usage_analytics.failure_rate'),
    meta: t('usage_analytics.metric_failure_count'),
    tone: summary.failureCount > 0 ? 'bad' : 'good',
    value: formatPercent(
      summary.requestCount > 0 ? summary.failureCount / summary.requestCount : 0
    ),
  },
];
