(function () {
  const PUBLIC_PAGES = new Set(["index.html", "compte.html", "tarifs.html", "confirmation.html"]);

  /** Modes « petits tests » : un seul essai gratuit pour les comptes sans abonnement. */
  const SMALL_TEST_MODES = {
    "psychotechnique.html": ["mini", "category"],
    "culture-langue.html": ["mini-culture", "mini-language"],
    "culture-generale.html": ["mini"],
    "cas-pratique.html": ["question"]
  };

  /** Modes « tests complets » ou entraînements longs : abonnement requis. */
  const FULL_OR_PREMIUM_MODES = {
    "psychotechnique.html": ["complete", "personality", "cognitive"],
    "culture-langue.html": ["complete", "culture", "language"],
    "culture-generale.html": ["complete", "institutions", "symboles", "histoire-actualite"],
    "verbal.html": ["complete", "type"],
    "spatial.html": ["complete", "type"],
    "numerique.html": ["complete", "type"],
    "personnalite.html": ["full"],
    "cas-pratique.html": ["simulation", "single", "examples", "vocabulary"],
    "progression.html": ["full"]
  };

  function getPageName() {
    const path = window.location.pathname.split("/").pop() || "index.html";
    return path.includes(".html") ? path : `${path}.html`;
  }

  function buildTrialKey(moduleId, mode, extra) {
    const base = `${moduleId}:${mode}`;
    return extra ? `${base}:${extra}` : base;
  }

  function isSmallTestMode(moduleId, mode, extra) {
    const allowed = SMALL_TEST_MODES[moduleId];
    if (!allowed) {
      return false;
    }
    if (mode === "category" && allowed.includes("category")) {
      return true;
    }
    return allowed.includes(mode);
  }

  function isPremiumMode(moduleId, mode) {
    const modes = FULL_OR_PREMIUM_MODES[moduleId];
    if (!modes) {
      return true;
    }
    if (mode === "complete" || mode === "full") {
      return true;
    }
    if (modes.includes(mode)) {
      return true;
    }
    if (modes.includes("type") && mode.startsWith("type:")) {
      return true;
    }
    return false;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensurePaywallModal() {
    if (document.getElementById("gpx-paywall-modal")) {
      return;
    }

    const modal = document.createElement("div");
    modal.id = "gpx-paywall-modal";
    modal.className = "gpx-paywall hidden";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "gpx-paywall-title");
    modal.innerHTML = `
      <div class="gpx-paywall__backdrop" data-close-paywall></div>
      <div class="gpx-paywall__card">
        <h2 id="gpx-paywall-title">Abonnement requis</h2>
        <p id="gpx-paywall-message"></p>
        <div class="gpx-paywall__actions">
          <a class="primary-button" href="tarifs.html">Voir les tarifs</a>
          <button type="button" class="secondary-button" data-close-paywall>Fermer</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll("[data-close-paywall]").forEach((el) => {
      el.addEventListener("click", () => modal.classList.add("hidden"));
    });
  }

  function showPaywall(message) {
    ensurePaywallModal();
    const modal = document.getElementById("gpx-paywall-modal");
    const messageEl = document.getElementById("gpx-paywall-message");
    messageEl.textContent = message;
    modal.classList.remove("hidden");
  }

  async function evaluateAccess(moduleId, mode, extra) {
    const user = await window.GPXAuth.getCurrentUser();
    if (!user) {
      return {
        allowed: false,
        reason: "login",
        message: "Créez un compte ou connectez-vous pour accéder aux entraînements."
      };
    }

    if (window.GPXAuth.hasActiveSubscription(user)) {
      return { allowed: true, user };
    }

    if (isSmallTestMode(moduleId, mode, extra)) {
      if (!user.freeTrialUsed) {
        return {
          allowed: true,
          user,
          consumeFreeTrial: true,
          trialKey: buildTrialKey(moduleId, mode, extra)
        };
      }
      if (user.freeTrialKey === buildTrialKey(moduleId, mode, extra)) {
        return { allowed: true, user, replaySameTrial: true };
      }
      return {
        allowed: false,
        reason: "trial_used",
        message:
          "Votre essai gratuit (un petit test) a déjà été utilisé. Souscrivez un abonnement pour accéder à tous les tests et simulations."
      };
    }

    if (isPremiumMode(moduleId, mode)) {
      return {
        allowed: false,
        reason: "subscription",
        message:
          "Ce mode est réservé aux abonnés. Sans abonnement, vous pouvez essayer un seul petit test (mini test ou question isolée)."
      };
    }

    return {
      allowed: false,
      reason: "subscription",
      message: "Abonnement requis pour accéder à ce contenu."
    };
  }

  async function guard(moduleId, mode, extra, onAllowed) {
    const result = await evaluateAccess(moduleId, mode, extra);

    if (!result.allowed) {
      if (result.reason === "login") {
        const redirect = encodeURIComponent(window.location.pathname.split("/").pop() || "index.html");
        window.location.href = `compte.html?redirect=${redirect}`;
        return;
      }
      showPaywall(result.message);
      return;
    }

    if (result.consumeFreeTrial) {
      await window.GPXAuth.updateProfile(result.user.id, {
        freeTrialUsed: true,
        freeTrialKey: result.trialKey
      });
    }

    onAllowed();
  }

  async function requireAuthForPage() {
    const page = getPageName();
    if (PUBLIC_PAGES.has(page)) {
      return;
    }

    const user = await window.GPXAuth.getCurrentUser();
    if (!user) {
      const redirect = encodeURIComponent(page);
      window.location.href = `compte.html?redirect=${redirect}`;
    }
  }

  function injectSiteNav() {
    if (document.getElementById("gpx-site-nav")) {
      return;
    }

    const nav = document.createElement("nav");
    nav.id = "gpx-site-nav";
    nav.className = "gpx-site-nav";
    nav.setAttribute("aria-label", "Compte et abonnement");
    nav.innerHTML = `
      <div class="gpx-site-nav__inner">
        <a class="gpx-site-nav__brand" href="index.html">GPX Entraînement</a>
        <div class="gpx-site-nav__links" id="gpx-site-nav-links">
          <span class="gpx-site-nav__status">Chargement…</span>
        </div>
      </div>
    `;
    document.body.insertBefore(nav, document.body.firstChild);

    window.GPXAuth.getCurrentUser().then((user) => {
      const links = document.getElementById("gpx-site-nav-links");
      if (!links) {
        return;
      }

      if (!user) {
        links.innerHTML = `
          <a href="tarifs.html">Tarifs</a>
          <a class="gpx-site-nav__cta" href="compte.html">Créer un compte</a>
        `;
        return;
      }

      const subscribed = window.GPXAuth.hasActiveSubscription(user);
      const trialLabel = user.freeTrialUsed
        ? "Essai gratuit utilisé"
        : "1 petit test gratuit disponible";

      links.innerHTML = `
        <span class="gpx-site-nav__user">${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</span>
        <span class="gpx-site-nav__badge ${subscribed ? "is-active" : ""}">${subscribed ? "Abonné" : trialLabel}</span>
        <a href="tarifs.html">Tarifs</a>
        <a href="compte.html">Mon compte</a>
        <button type="button" class="gpx-site-nav__logout" id="gpx-logout-button">Déconnexion</button>
      `;

      document.getElementById("gpx-logout-button")?.addEventListener("click", async () => {
        await window.GPXAuth.logout();
        window.location.href = "compte.html";
      });
    });
  }

  window.GPXAccess = {
    guard,
    evaluateAccess,
    isSmallTestMode,
    isPremiumMode,
    requireAuthForPage,
    injectSiteNav,
    getPageName
  };

  document.addEventListener("DOMContentLoaded", () => {
    injectSiteNav();
    requireAuthForPage();
  });
})();
