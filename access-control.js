(function () {
  const PUBLIC_PAGES = new Set(["index.html", "compte.html", "connexion.html", "inscription.html", "tarifs.html", "confirmation.html", "mentions-legales.html", "cgv.html", "politique-confidentialite.html"]);

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
        window.location.href = `connexion.html?redirect=${redirect}`;
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
      window.location.href = `connexion.html?redirect=${redirect}`;
    }
  }

  function injectLegalFooter() {
    if (document.getElementById("gpx-legal-footer") || document.querySelector(".site-footer")) {
      return;
    }

    const footer = document.createElement("p");
    footer.id = "gpx-legal-footer";
    footer.className = "gpx-legal-footer";
    footer.innerHTML =
      '<a href="mentions-legales.html">Mentions légales</a>' +
      ' · <a href="cgv.html">CGV</a>' +
      ' · <a href="politique-confidentialite.html">Politique de confidentialité</a>';
    document.body.appendChild(footer);
  }

  function injectPostHog() {
    if (document.getElementById("gpx-posthog-snippet")) {
      return;
    }

    const script = document.createElement("script");
    script.id = "gpx-posthog-snippet";
    script.textContent = `
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="Pn On init Wn Qn ki Gn Kn zn capture calculateEventProperties rs register register_once register_for_session unregister unregister_for_session os getFeatureFlag getFeatureFlagPayload getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync ls identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty ns es createPersonProfile setInternalOrTestUser ss Hn cs opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing Yn debug Ci gr getPageViewId captureTraceFeedback captureTraceMetric qn".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init('phc_n3a4j525PHcjbxXbpWYTycBJArAWwBiJvN3moC6GY8Jk', {
        api_host: 'https://us.i.posthog.com',
        defaults: '2026-05-30',
        person_profiles: 'identified_only',
    });
    `;
    document.head.appendChild(script);
  }

  function injectSiteNav() {
    if (document.getElementById("gpx-site-nav")) {
      return;
    }

    if (!document.getElementById("gpx-fonts-link")) {
      const fontLink = document.createElement("link");
      fontLink.id = "gpx-fonts-link";
      fontLink.rel = "stylesheet";
      fontLink.href = "https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@1,600&family=Spectral:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap";
      document.head.appendChild(fontLink);
    }

    const nav = document.createElement("nav");
    nav.id = "gpx-site-nav";
    nav.className = "gpx-site-nav";
    nav.setAttribute("aria-label", "Compte et abonnement");
    nav.innerHTML = `
      <div class="gpx-site-nav__inner">
        <a class="gpx-site-nav__brand" href="index.html">Prepa GPX<span class="gpx-site-nav__flag" aria-hidden="true"></span></a>
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
          <a href="connexion.html">Se connecter</a>
          <a class="gpx-site-nav__cta" href="inscription.html">Créer un compte</a>
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
        window.location.href = "connexion.html";
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
    injectPostHog();
    injectSiteNav();
    injectLegalFooter();
    requireAuthForPage();
  });
})();
