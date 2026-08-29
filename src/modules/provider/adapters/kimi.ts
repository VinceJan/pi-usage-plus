import type { UsageAdapter, UsageSnapshot } from "../../../core/types.ts";
import { safeError, sameOriginFetch } from "../../../core/security.ts";

const CN_ORIGIN = "https://api.moonshot.cn";
const AI_ORIGIN = "https://api.moonshot.ai";

interface KimiResponse {
  available_balance?: string | number;
  cash_balance?: string | number;
  voucher_balance?: string | number;
  balance?: string | number;
  total_balance?: string | number;
  data?: {
    available_balance?: string | number;
    cash_balance?: string | number;
    balance?: string | number;
    total_balance?: string | number;
  };
}

function toNumber(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function extractBalance(data: KimiResponse): number | undefined {
  // Try multiple shapes
  if (data.data) {
    const d = data.data;
    return toNumber(d.available_balance) ?? toNumber(d.cash_balance) ?? toNumber(d.balance) ?? toNumber(d.total_balance);
  }
  return toNumber(data.available_balance) ?? toNumber(data.cash_balance) ?? toNumber(data.balance) ?? toNumber(data.total_balance) ?? toNumber(data.voucher_balance);
}

export const kimiAdapter: UsageAdapter = {
  id: "kimi",
  label: "Kimi / Moonshot",
  canHandle(target) {
    const pid = target.providerId.toLowerCase();
    if (pid.includes("kimi") || pid.includes("moonshot")) return true;
    if (target.baseUrl) {
      try {
        const host = new URL(target.baseUrl).host;
        if (host.includes("moonshot.cn") || host.includes("moonshot.ai")) return true;
      } catch (error: unknown) {
        void error;
        return false;
      }
    }
    return false;
  },
  async fetch({ target, signal, fetchFn }): Promise<UsageSnapshot> {
    const fetchedAt = new Date().toISOString();
    const apiKey = (target.auth?.auth as Record<string, unknown> | undefined)?.apiKey as string | undefined;
    if (!apiKey) {
      return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "Kimi", state: "unauthorized", fetchedAt, accounts: [], error: "No API key found in Pi auth for Kimi / Moonshot" };
    }
    // Choose origin based on baseUrl, default to CN (most CC Switch CN users)
    let preferred = CN_ORIGIN;
    if (target.baseUrl) {
      try {
        const host = new URL(target.baseUrl).host;
        if (host.includes("moonshot.ai")) preferred = AI_ORIGIN;
        else if (host.includes("moonshot.cn")) preferred = CN_ORIGIN;
      } catch (error: unknown) {
        void error;
        // ignore invalid baseUrl, keep default
      }
    }
    const tryOrigins = preferred === CN_ORIGIN ? [CN_ORIGIN, AI_ORIGIN] : [AI_ORIGIN, CN_ORIGIN];
    try {
      let lastError: string | undefined;
      for (const origin of tryOrigins) {
        const url = new URL("/v1/users/me/balance", origin);
        const response = await sameOriginFetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
          signal,
        }, fetchFn, origin);
        if (response.status === 401 || response.status === 403) {
          if (origin === tryOrigins[tryOrigins.length - 1]) {
            return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "Kimi", state: "unauthorized", fetchedAt, accounts: [], error: `Kimi returned HTTP ${response.status} (api key invalid for ${origin})` };
          }
          lastError = `HTTP ${response.status}`;
          continue;
        }
        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          if (origin === tryOrigins[tryOrigins.length - 1]) throw new Error(`Kimi returned HTTP ${response.status} from ${origin}`);
          continue;
        }
        const data = await response.json() as KimiResponse;
        const balance = extractBalance(data);
        if (balance === undefined) {
          return { adapterId: this.id, sourceProviderId: target.providerId, displayName: "Kimi", state: "empty", fetchedAt, accounts: [], error: "Kimi balance format unexpected" };
        }
        const currency = origin === CN_ORIGIN ? "CNY" : "USD";
        const symbol = currency === "CNY" ? "¥" : "$";
        return {
          adapterId: this.id,
          sourceProviderId: target.providerId,
          displayName: "Kimi",
          state: "ok",
          fetchedAt,
          summary: `Balance ${symbol}${balance.toFixed(2)}`,
          accounts: [{
            id: "kimi-account",
            provider: target.providerId,
            label: "Kimi",
            status: "available",
            metrics: [{
              kind: "balance",
              id: "kimi-balance",
              label: "Balance",
              amount: balance,
              currency,
            }],
          }],
        };
      }
      throw new Error(lastError || "Kimi request failed");
    } catch (error) {
      throw new Error(safeError(error));
    }
  },
};
