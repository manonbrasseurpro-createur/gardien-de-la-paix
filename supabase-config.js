/**
 * Configuration Supabase (production).
 * SUPABASE_URL et anonKey (clé publishable sb_publishable_...) sont utilisés par auth-service.js.
 */
window.GPX_SUPABASE = {
  SUPABASE_URL: "https://ivrafclenoukjhmubrgq.supabase.co",
  url: "https://ivrafclenoukjhmubrgq.supabase.co",
  anonKey: "sb_publishable_2qTM2nZuSi54q56juJz1Nw_RDPzMdR6"
};

window.GPX_STRIPE = {
  /** Affichage tarifs (le montant réel est configuré côté Stripe / Edge Function). */
  monthlyPriceLabel: "19,90 €",
  monthlyPriceCents: 1990,
  currency: "EUR"
};
