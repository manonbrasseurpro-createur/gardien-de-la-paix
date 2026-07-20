/**
 * Configuration Supabase (production).
 */
window.GPX_SUPABASE = {
  SUPABASE_URL: "https://ivrafclenoukjhmubrgq.supabase.co",
  url: "https://ivrafclenoukjhmubrgq.supabase.co",
  anonKey: "sb_publishable_2qTM2nZuSi54q56juJz1Nw_RDPzMdR6"
};

/** Durée de l'essai gratuit (jours), géré côté Supabase — pas de CB requise. */
window.GPX_TRIAL_DAYS = 7;

window.GPX_STRIPE = {
  currency: "EUR",
  plans: {
    monthly: {
      id: "monthly",
      priceId: "price_1TvHsSRo8Yl21kLoiekwHVfF",
      label: "1 mois",
      price: "14,90 €",
      period: "/ mois",
      monthlyEquivalent: "14,90 € / mois",
      savings: null,
      badge: null
    },
    quarterly: {
      id: "quarterly",
      priceId: "price_1TvHuDRo8Yl21kLoGTA5OZb2",
      label: "3 mois",
      price: "29,90 €",
      period: "soit 9,97 € / mois",
      monthlyEquivalent: "9,97 € / mois",
      savings: "Économisez 33 %",
      badge: "Le plus populaire"
    },
    biannual: {
      id: "biannual",
      priceId: "price_1TvHvBRo8Yl21kLoSua5O2wj",
      label: "6 mois",
      price: "49,90 €",
      period: "soit 8,32 € / mois",
      monthlyEquivalent: "8,32 € / mois",
      savings: "Économisez 44 %",
      badge: "Meilleur tarif"
    }
  }
};
