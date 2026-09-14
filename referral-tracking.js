(function () {
    const STORAGE_KEY = "gpx_referral_source";
  
    function captureReferralFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (!ref) {
        return;
      }
      const normalized = ref.trim().toLowerCase();
      if (!normalized) {
        return;
      }
      // Attribution "premier clic" : on ne remplace pas une valeur déjà stockée
      const existing = localStorage.getItem(STORAGE_KEY);
      if (existing) {
        return;
      }
      try {
        localStorage.setItem(STORAGE_KEY, normalized);
      } catch (error) {
        console.warn("[GPX Referral] impossible d'enregistrer la source :", error);
      }
    }
  
    function getReferralSource() {
      try {
        return localStorage.getItem(STORAGE_KEY) || null;
      } catch (error) {
        return null;
      }
    }
  
    captureReferralFromUrl();
  
    window.GPXReferral = {
      get: getReferralSource
    };
  })();