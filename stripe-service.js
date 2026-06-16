(function () {
  function getSupabaseConfig() {
    const cfg = window.GPX_SUPABASE || {};
    return {
      url: (cfg.url || cfg.SUPABASE_URL || "").replace(/\/$/, ""),
      anonKey: cfg.anonKey || cfg.anon_key || cfg.publishableKey || ""
    };
  }

  async function startSubscriptionCheckout() {
    const user = await window.GPXAuth.getCurrentUser();
    if (!user) {
      window.location.href = "connexion.html?redirect=tarifs.html";
      return;
    }

    const token = await window.GPXAuth.getAccessToken();
    if (!token) {
      throw new Error("Session expirée. Reconnectez-vous.");
    }

    const { url, anonKey } = getSupabaseConfig();
    if (!url || !anonKey) {
      throw new Error("Supabase n'est pas configuré.");
    }

    const response = await fetch(`${url}/functions/v1/create-checkout-session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        "Content-Type": "application/json"
      }
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "Impossible de lancer le paiement Stripe.");
    }

    if (!payload.url) {
      throw new Error("URL de paiement Stripe manquante.");
    }

    window.location.href = payload.url;
  }

  async function startPortalSession() {
    const token = await window.GPXAuth.getAccessToken();
    if (!token) {
      throw new Error("Session expirée. Reconnectez-vous.");
    }

    const { url, anonKey } = getSupabaseConfig();
    if (!url || !anonKey) {
      throw new Error("Supabase n'est pas configuré.");
    }

    const response = await fetch(`${url}/functions/v1/create-portal-session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        "Content-Type": "application/json"
      }
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "Impossible d'accéder au portail Stripe.");
    }

    if (!payload.url) {
      throw new Error("URL du portail Stripe manquante.");
    }

    window.location.href = payload.url;
  }

  window.GPXStripe = {
    startSubscriptionCheckout,
    startPortalSession
  };
})();
