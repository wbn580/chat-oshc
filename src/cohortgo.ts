// chat-oshc Worker — Cohort Go Insurance Quote API integration
//
// @deprecated 2026-05-29 · v2 short-term quote fallback only
//   POST endpoints removed per Maggie email 5/29 "discontinue all transactions"
//   Now GET-only: getInsuranceQuotes() for quote.json read-only fallback
//   TODO Phase 2: cut over to Flywire Insurance Quote API
//   (https://agents.flywire.com/api/insurance-quotes?type=INSURANCE-OSHC)
//   → then credentials_merge.py remove cohortgo_api_user

import type { Env, QuoteParams, ProviderQuote } from './types';

/**
 * 调 Cohort Go Quote API 拿 5 家 provider 实时报价
 * GET https://cohortflow.com/api/v1/services/insurance/quote.json
 */
export async function getQuote(
  env: Env,
  params: QuoteParams,
): Promise<ProviderQuote[]> {
  const auth = btoa(`${env.COHORTGO_API_USERNAME}:${env.COHORTGO_API_PASSWORD}`);
  const url = new URL(`${env.COHORTGO_BASE_URL}/services/insurance/quote.json`);
  url.searchParams.set('country', 'AU');
  url.searchParams.set('course_start_date', params.start);
  url.searchParams.set('course_finish_date', params.finish);
  url.searchParams.set('adults', String(params.adults));
  url.searchParams.set('children', String(params.children));

  const resp = await fetch(url.toString(), {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Cohort Go quote failed: HTTP ${resp.status} — ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as any;

  // Cohort Go returns an array of provider quotes
  const raw = Array.isArray(data) ? data : (data.quotes ?? data.data ?? [data]);

  return raw.map((q: any) => {
    const purchaseUrl = q.purchase_url ?? q.purchaseUrl ?? '';
    const premium = parseFloat(
      q.premium ?? q.total_premium ?? q.price ?? q.total ?? q.amount ?? q.total_price ?? '0'
    );
    return {
      provider: q.provider ?? q.insurer ?? q.insurer_name ?? 'Unknown',
      product: q.product ?? q.product_name ?? q.name ?? '',
      premium,
      premium_formatted: `AU$ ${premium.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      purchase_url: purchaseUrl,
    };
  });
}

/**
 * Cohort Go 返回的 purchase_url 已含 partner=au-unilink
 * 我们在基础上附加 fw_counselor_key=chat-oshc-{sessionUuid}
 */
export function appendCounselorKey(purchaseUrl: string, sessionUuid: string): string {
  try {
    const u = new URL(purchaseUrl);
    u.searchParams.set('fw_counselor_key', `chat-oshc-${sessionUuid}`);
    return u.toString();
  } catch {
    // URL parse 失败 — 尝试直接拼接
    const sep = purchaseUrl.includes('?') ? '&' : '?';
    return `${purchaseUrl}${sep}fw_counselor_key=chat-oshc-${sessionUuid}`;
  }
}

/**
 * 按价格排序 + 推荐最便宜的（将来可加权重）
 */
export function pickRecommendation(quotes: ProviderQuote[]): string {
  if (quotes.length === 0) return '';
  const sorted = [...quotes].sort((a, b) => a.premium - b.premium);
  return sorted[0].provider;
}
