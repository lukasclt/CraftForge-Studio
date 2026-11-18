import type { CopilotLowLimitWarning, CopilotUsageState } from '../types/ide';

export const DEFAULT_COPILOT_LIMIT = 50;
export const LOW_QUOTA_THRESHOLD = 5;
export const MAX_COPILOT_WARNINGS = 5;
export const QUOTA_WINDOW_MS = 1000 * 60 * 60 * 24;

export function createInitialCopilotUsage(
  limit = DEFAULT_COPILOT_LIMIT,
  now = Date.now()
): CopilotUsageState {
  const safeLimit = Math.max(1, Math.floor(limit));
  return {
    used: 0,
    limit: safeLimit,
    remaining: safeLimit,
    warningsShown: 0,
    maxWarnings: MAX_COPILOT_WARNINGS,
    resetAt: now + QUOTA_WINDOW_MS,
    source: 'quota',
  };
}

export function normalizeCopilotUsage(
  usage: Partial<CopilotUsageState> | null | undefined,
  now = Date.now()
): CopilotUsageState {
  if (!usage || (usage.resetAt && now >= usage.resetAt)) {
    return createInitialCopilotUsage(usage?.limit || DEFAULT_COPILOT_LIMIT, now);
  }
  const limit = Math.max(1, Number(usage.limit ?? DEFAULT_COPILOT_LIMIT));
  const used = Math.max(0, Math.min(limit, Number(usage.used ?? 0)));
  const remaining =
    usage.remaining !== undefined
      ? Math.max(0, Math.min(limit, Number(usage.remaining)))
      : Math.max(0, limit - used);
  const warningsShown = Math.max(
    0,
    Math.min(MAX_COPILOT_WARNINGS, Number(usage.warningsShown ?? 0))
  );
  return {
    used,
    limit,
    remaining,
    warningsShown,
    maxWarnings: MAX_COPILOT_WARNINGS,
    resetAt: Number(usage.resetAt ?? now + QUOTA_WINDOW_MS),
    source: usage.source === 'github-headers' ? 'github-headers' : 'quota',
  };
}

export interface HeaderQuotaSync {
  limit?: number;
  remaining?: number;
  resetAt?: number;
}

export function consumeCopilotUsage(
  current: CopilotUsageState,
  headerQuota?: HeaderQuotaSync,
  now = Date.now()
): {
  nextUsage: CopilotUsageState;
  warning: CopilotLowLimitWarning | null;
  limitReached: boolean;
} {
  const base = normalizeCopilotUsage(current, now);

  let nextLimit = base.limit;
  let nextUsed = Math.min(base.limit, base.used + 1);
  let nextRemaining = Math.max(0, nextLimit - nextUsed);
  let nextResetAt = base.resetAt;
  let nextSource: CopilotUsageState['source'] = base.source;

  if (
    headerQuota &&
    typeof headerQuota.limit === 'number' &&
    headerQuota.limit > 0 &&
    typeof headerQuota.remaining === 'number' &&
    headerQuota.remaining >= 0
  ) {
    nextLimit = Math.floor(headerQuota.limit);
    nextRemaining = Math.min(nextLimit, Math.floor(headerQuota.remaining));
    nextUsed = Math.max(0, nextLimit - nextRemaining);
    if (headerQuota.resetAt && headerQuota.resetAt > now) {
      nextResetAt = headerQuota.resetAt;
    }
    nextSource = 'github-headers';
  }

  let warningsShown = base.warningsShown;
  let warning: CopilotLowLimitWarning | null = null;

  if (nextRemaining <= LOW_QUOTA_THRESHOLD && warningsShown < MAX_COPILOT_WARNINGS) {
    warningsShown += 1;
    const message =
      nextRemaining > 0
        ? `Seu limite do GitHub Copilot está acabando! Restam ${nextRemaining} ${nextRemaining === 1 ? 'requisição' : 'requisições'} (Aviso ${warningsShown}/${MAX_COPILOT_WARNINGS}).`
        : `Seu limite do GitHub Copilot acabou (0 restantes). Aviso final (${warningsShown}/${MAX_COPILOT_WARNINGS}).`;

    warning = {
      id: `warn_${now}_${warningsShown}`,
      warningNumber: warningsShown,
      maxWarnings: MAX_COPILOT_WARNINGS,
      remaining: nextRemaining,
      message,
      createdAt: now,
    };
  }

  return {
    nextUsage: {
      used: nextUsed,
      limit: nextLimit,
      remaining: nextRemaining,
      warningsShown,
      maxWarnings: MAX_COPILOT_WARNINGS,
      resetAt: nextResetAt,
      source: nextSource,
    },
    warning,
    limitReached: nextRemaining <= 0,
  };
}

export function isCopilotLowQuota(usage: CopilotUsageState): boolean {
  return usage.remaining <= LOW_QUOTA_THRESHOLD;
}

export function formatCopilotQuotaSummary(usage: CopilotUsageState): string {
  return `Uso Copilot: ${usage.used}/${usage.limit} (${usage.remaining} restantes)`;
}
