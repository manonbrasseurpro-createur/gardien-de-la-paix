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
      priceId: "price_1Tm87ERo8Yl21kLocoYxUW1Y",
      label: "1 mois",
      price: "14,90 €",
      period: "/ mois",
      monthlyEquivalent: null,
      savings: null
    },
    quarterly: {
      id: "quarterly",
      priceId: "price_1Tm87zRo8Yl21kLo2W127mKN",
      label: "3 mois",
      price: "29,90 €",
      period: "soit 9,97 € / mois",
      monthlyEquivalent: "9,97 € / mois",
      savings: "Économisez 33 %"
    },
    biannual: {
      id: "biannual",
      priceId: "price_1Tm88JRo8Yl21kLoIZBe2PI2",
      label: "6 mois",
      price: "49,90 €",
      period: "soit 8,32 € / mois",
      monthlyEquivalent: "8,32 € / mois",
      savings: "Économisez 44 %",
      badge: "Le plus populaire"
    },
    annual: {
      id: "annual",
      priceId: "price_1Tm88hRo8Yl21kLoa2mUyLNQ",
      label: "1 an",
      price: "89,90 €",
      period: "soit 7,49 € / mois",
      monthlyEquivalent: "7,49 € / mois",
      savings: "Économisez 50 %",
      badge: "Meilleur tarif"
    }
  }
};
