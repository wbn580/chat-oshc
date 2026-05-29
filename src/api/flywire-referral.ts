// chat-oshc Worker v2 — Flywire Referral URL builder
//
// Builds the white-label referral landing URL that replaces Cohort Go's
// three-fold attribution (partner= / hidden agent_organisation_id= / cookie).
// Single referrer UUID embedded in URL → Flywire system-level attribution.
//
// Provider param reserved for Phase 2 deep-link support (not functional yet;
// Flywire landing does not accept pre-filled params per 5/29 testing).

const FLYWIRE_REFERRER_UUID = '0df195ef-7f4d-4faf-82e2-1878faa84597';
const FLYWIRE_BASE_URL = 'https://agents.flywire.com/services/Unilink/oshc-au';

/**
 * Build the Flywire white-label referral landing URL.
 *
 * @param sessionUuid - D1 sessions.id (e.g. "chat-oshc-lx3k2f-a1b2c3")
 *                      used as utm_campaign for later reconciliation
 * @param provider     - Optional: target provider for Phase 2 deep-link.
 *                      Currently unused; reserved for future Flywire API upgrade.
 * @returns Full referral URL with referrer UUID + UTM params
 */
export function buildReferralUrl(sessionUuid: string, provider?: string): string {
  const u = new URL(FLYWIRE_BASE_URL);
  u.searchParams.set('referrer', FLYWIRE_REFERRER_UUID);
  u.searchParams.set('utm_source', 'chat-oshc-net');
  u.searchParams.set('utm_medium', 'widget');
  u.searchParams.set('utm_campaign', sessionUuid);

  // Provider deep-link not supported yet (5/29 tested), but interface reserved
  if (provider) {
    u.searchParams.set('utm_term', provider);
  }

  return u.toString();
}
