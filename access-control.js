(function () {
  const PUBLIC_PAGES = new Set(["index.html", "actualites.html", "flashcards.html", "compte.html", "connexion.html", "inscription.html", "tarifs.html", "confirmation.html", "mentions-legales.html", "cgv.html", "politique-confidentialite.html"]);

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

  const NAV_ICON_COMPTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"></circle><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"></path></svg>';
  const NAV_ICON_LOGOUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="M16 17l5-5-5-5"></path><path d="M21 12H9"></path></svg>';

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
      '<a href="concours-gpx.html">Concours GPX</a>' +
      ' · <a href="mentions-legales.html">Mentions légales</a>' +
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

  function getSubscriptionBadge(user) {
    if (window.GPXAuth.hasActiveSubscription(user)) {
      return { text: "Abonné", className: "is-active" };
    }
    if (user.freeTrialUsed) {
      return { text: "Gratuit", className: "" };
    }
    return { text: "Essai", className: "is-trial" };
  }

  function removeGlobalDashboardSidebar() {
    document.getElementById("global-dash-sidebar")?.remove();
    document.getElementById("dash-sidebar-toggle")?.remove();
    document.body.classList.remove("has-dash-sidebar", "dash-sidebar-collapsed");
  }

  async function populateSiteNavLinks() {
    if (!window.GPXAuth?.getCurrentUser) {
      return;
    }

    const links = document.getElementById("gpx-site-nav-links");
    if (!links) {
      return;
    }

    const user = await window.GPXAuth.getCurrentUser();
    const nav = document.getElementById("gpx-site-nav");

    const commonLinks = `
      <a href="index.html">Accueil</a>
      <a href="actualites.html">Actualités</a>
      <a href="tarifs.html">Tarifs</a>
    `;

    if (!user) {
      nav?.classList.remove("gpx-site-nav--app", "gpx-site-nav--show-logo");
      links.innerHTML = `
        ${commonLinks}
        <a href="connexion.html">Se connecter</a>
        <a class="gpx-site-nav__cta" href="inscription.html">S'inscrire</a>
      `;
      return;
    }

    const subscribed = window.GPXAuth.hasActiveSubscription(user);
    const badge = getSubscriptionBadge(user);

    nav?.classList.add("gpx-site-nav--app");
    if (subscribed) {
      nav?.classList.remove("gpx-site-nav--show-logo");
    } else {
      nav?.classList.add("gpx-site-nav--show-logo");
    }

    links.innerHTML = `
      <a href="tarifs.html">Tarifs</a>
      <span class="gpx-site-nav__user">${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</span>
      <span class="gpx-site-nav__badge ${badge.className}">${badge.text}</span>
    `;
  }

  async function injectSiteNav() {
    if (!document.getElementById("gpx-fonts-link")) {
      const fontLink = document.createElement("link");
      fontLink.id = "gpx-fonts-link";
      fontLink.rel = "stylesheet";
      fontLink.href = "https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@1,600&family=Spectral:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap";
      document.head.appendChild(fontLink);
    }

    if (!document.getElementById("gpx-site-nav")) {
      if (getPageName() === "dashboard.html") {
        return;
      }

      const nav = document.createElement("nav");
      nav.id = "gpx-site-nav";
      nav.className = "gpx-site-nav";
      nav.setAttribute("aria-label", "Navigation principale");
      nav.innerHTML = `
        <div class="gpx-site-nav__inner">
          <a class="gpx-site-nav__brand" href="index.html">Prepa GPX<span class="gpx-site-nav__flag" aria-hidden="true"></span></a>
          <div class="gpx-site-nav__links" id="gpx-site-nav-links">
            <span class="gpx-site-nav__status">Chargement…</span>
          </div>
        </div>
      `;
      document.body.insertBefore(nav, document.body.firstChild);
    }

    if (document.getElementById("gpx-site-nav-links")) {
      await populateSiteNavLinks();
    }
  }

  async function submitProblemReport({ userId, email, pageUrl, message }) {
    if (!window.GPXAuth?.isSupabaseConfigured?.()) {
      throw new Error("Supabase n'est pas configuré.");
    }
    const client = window.__gpxSupabaseClient;
    if (!client) {
      throw new Error("Session indisponible. Reconnectez-vous.");
    }
    const { error } = await client.from("problem_reports").insert({
      user_id: userId,
      email,
      page_url: pageUrl,
      message
    });
    if (error) {
      throw new Error(error.message || "Impossible d'envoyer le signalement.");
    }
  }

  function injectProblemReportButton() {
    if (document.getElementById("gpx-problem-report-btn") || !window.GPXAuth?.getCurrentUser) {
      return;
    }

    window.GPXAuth.getCurrentUser().then((user) => {
      if (!user || document.getElementById("gpx-problem-report-btn")) {
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.id = "gpx-problem-report-btn";
      button.textContent = "🛟 Un problème ?";
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", "gpx-problem-report-modal");
      button.style.cssText =
        "position: fixed; bottom: 20px; left: 20px; z-index: 9998;" +
        "background: var(--navy); color: white; border: none;" +
        "padding: 10px 16px; border-radius: 999px; font-size: 0.85rem; font-weight: 700;" +
        "cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2);";

      const modal = document.createElement("div");
      modal.id = "gpx-problem-report-modal";
      modal.className = "gpx-paywall hidden";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "gpx-problem-report-title");
      modal.innerHTML = `
        <div class="gpx-paywall__backdrop" data-close-problem-report></div>
        <div class="gpx-paywall__card">
          <h2 id="gpx-problem-report-title">Vous rencontrez un problème ?</h2>
          <p id="gpx-problem-report-intro">Décrivez ce qui ne fonctionne pas, on s'en occupe rapidement.</p>
          <label class="hidden" for="gpx-problem-report-message">Description du problème</label>
          <textarea
            id="gpx-problem-report-message"
            rows="5"
            required
            placeholder="Exemple : le bouton de correction ne répond pas, le score affiché semble incorrect…"
            style="width: 100%; margin-top: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; font: inherit; resize: vertical;"
          ></textarea>
          <p id="gpx-problem-report-feedback" class="hidden" style="margin-top: 12px; font-weight: 600;"></p>
          <div class="gpx-paywall__actions" id="gpx-problem-report-actions">
            <button type="button" class="primary-button" id="gpx-problem-report-submit">Envoyer</button>
            <button type="button" class="secondary-button" data-close-problem-report>Annuler</button>
          </div>
        </div>
      `;

      document.body.appendChild(button);
      document.body.appendChild(modal);

      const messageField = document.getElementById("gpx-problem-report-message");
      const feedbackEl = document.getElementById("gpx-problem-report-feedback");
      const introEl = document.getElementById("gpx-problem-report-intro");
      const actionsEl = document.getElementById("gpx-problem-report-actions");
      const submitButton = document.getElementById("gpx-problem-report-submit");

      function closeProblemReportModal() {
        modal.classList.add("hidden");
        feedbackEl.classList.add("hidden");
        feedbackEl.textContent = "";
        feedbackEl.style.color = "";
        introEl.classList.remove("hidden");
        messageField.classList.remove("hidden");
        actionsEl.classList.remove("hidden");
        messageField.value = "";
        submitButton.disabled = false;
        submitButton.textContent = "Envoyer";
      }

      function openProblemReportModal() {
        modal.classList.remove("hidden");
        messageField.focus();
      }

      button.addEventListener("click", openProblemReportModal);
      modal.querySelectorAll("[data-close-problem-report]").forEach((el) => {
        el.addEventListener("click", closeProblemReportModal);
      });

      submitButton.addEventListener("click", async () => {
        const message = messageField.value.trim();
        if (!message) {
          feedbackEl.textContent = "Merci de décrire le problème avant d'envoyer.";
          feedbackEl.style.color = "#b42318";
          feedbackEl.classList.remove("hidden");
          messageField.focus();
          return;
        }

        submitButton.disabled = true;
        submitButton.textContent = "Envoi…";
        feedbackEl.classList.add("hidden");

        try {
          await submitProblemReport({
            userId: user.id,
            email: user.email,
            pageUrl: window.location.href,
            message
          });

          introEl.classList.add("hidden");
          messageField.classList.add("hidden");
          actionsEl.classList.add("hidden");
          feedbackEl.textContent = "Merci, votre signalement a bien été envoyé !";
          feedbackEl.style.color = "#166534";
          feedbackEl.classList.remove("hidden");

          window.setTimeout(closeProblemReportModal, 2000);
        } catch (error) {
          feedbackEl.textContent = error.message || "Une erreur s'est produite. Réessayez.";
          feedbackEl.style.color = "#b42318";
          feedbackEl.classList.remove("hidden");
          submitButton.disabled = false;
          submitButton.textContent = "Envoyer";
        }
      });
    });
  }

  async function injectGlobalDashboardSidebar() {
    if (getPageName() === "dashboard.html") {
      return;
    }
    if (document.getElementById("global-dash-sidebar") || !window.GPXAuth?.getCurrentUser) {
      return;
    }

    let user;
    try {
      user = await window.GPXAuth.getCurrentUser();
    } catch (error) {
      console.warn("[GPX Access] injectGlobalDashboardSidebar:", error);
      return;
    }

    if (!user || document.getElementById("global-dash-sidebar")) {
      return;
    }

    const sidebarMarkup = `
        <button class="dash-sidebar-toggle" id="dash-sidebar-toggle" aria-label="Afficher/masquer le menu">☰</button>
        <aside class="global-dash-sidebar" id="global-dash-sidebar">
          <a class="gpx-site-nav__brand global-dash-sidebar__brand" href="index.html">Prepa GPX<span class="gpx-site-nav__flag" aria-hidden="true"></span></a>
          <nav class="global-dash-sidebar__nav">
            <a class="global-dash-sidebar__item" href="index.html">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"></path><path d="M5 9.5V20h14V9.5"></path><path d="M10 20v-6h4v6"></path></svg>
              Accueil
            </a>
            <a class="global-dash-sidebar__item" href="actualites.html">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="7" y1="8" x2="17" y2="8"></line><line x1="7" y1="12" x2="17" y2="12"></line><line x1="7" y1="16" x2="13" y2="16"></line></svg>
              Actualités
            </a>
            <a class="global-dash-sidebar__item" href="dashboard.html">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>
              Tableau de bord
            </a>
            <a class="global-dash-sidebar__item" href="dashboard.html#examen">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="5"></circle><circle cx="12" cy="12" r="1" fill="currentColor"></circle></svg>
              Nouvel examen
            </a>
            <a class="global-dash-sidebar__item" href="flashcards.html">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="14" height="10" rx="2"></rect><rect x="7" y="9" width="14" height="10" rx="2" fill="var(--navy-dark)"></rect></svg>
              Flashcards
            </a>
            <a class="global-dash-sidebar__item" href="dashboard.html#progression">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="20" y2="20"></line><path d="M4 16l5-5 4 4 7-7"></path></svg>
              Ma progression
            </a>
            <a class="global-dash-sidebar__item" href="dashboard.html#communaute">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"></circle><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5"></path><circle cx="17" cy="9" r="2.5"></circle><path d="M15.5 13.5c2.5.3 4.5 2 4.5 4.5"></path></svg>
              Communauté
            </a>
            <div class="global-dash-sidebar__sep"></div>
            <a class="global-dash-sidebar__item" href="compte.html">${NAV_ICON_COMPTE} Mon compte</a>
            <button class="global-dash-sidebar__item" type="button" id="global-dash-logout-btn">${NAV_ICON_LOGOUT} Déconnexion</button>
          </nav>
        </aside>
    `;

    const navEl = document.getElementById("gpx-site-nav");
    if (navEl) {
      navEl.insertAdjacentHTML("afterend", sidebarMarkup);
    } else {
      document.body.insertAdjacentHTML("afterbegin", sidebarMarkup);
    }

    document.body.classList.add("has-dash-sidebar");

    const sidebar = document.getElementById("global-dash-sidebar");
    const toggle = document.getElementById("dash-sidebar-toggle");
    const collapsed = localStorage.getItem("gpxSidebarCollapsed") === "true";
    const mobileQuery = window.matchMedia("(max-width: 820px)");

    if (collapsed) {
      document.body.classList.add("dash-sidebar-collapsed");
      sidebar.classList.add("is-collapsed");
    }

    toggle.addEventListener("click", () => {
      if (mobileQuery.matches) {
        sidebar.classList.toggle("is-open");
        return;
      }

      const isCollapsed = document.body.classList.toggle("dash-sidebar-collapsed");
      sidebar.classList.toggle("is-collapsed", isCollapsed);
      sidebar.classList.remove("is-open");
      localStorage.setItem("gpxSidebarCollapsed", isCollapsed ? "true" : "false");
    });

    document.getElementById("global-dash-logout-btn")?.addEventListener("click", async () => {
      await window.GPXAuth.logout();
      window.location.href = "connexion.html";
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

  document.addEventListener("DOMContentLoaded", async () => {
    injectPostHog();
    await injectSiteNav();
    const user = await window.GPXAuth?.getCurrentUser?.();
    if (user) {
      await injectGlobalDashboardSidebar();
    } else {
      removeGlobalDashboardSidebar();
    }
    injectLegalFooter();
    injectProblemReportButton();
    await requireAuthForPage();
  });
})();
