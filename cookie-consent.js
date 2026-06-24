(function () {
  const STORAGE_KEY = "gpx_cookie_consent";
  const POSTHOG_KEY = "phc_n3a4j525PHcjbxXbpWYTycBJArAWwBiJvN3moC6GY8Jk";

  function getStoredConsent() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function setStoredConsent(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      /* ignore */
    }
  }

  function loadPostHog() {
    if (document.getElementById("gpx-posthog-snippet") || window.posthog?.__loaded) {
      if (window.posthog?.opt_in_capturing) {
        window.posthog.opt_in_capturing();
      }
      return;
    }

    const script = document.createElement("script");
    script.id = "gpx-posthog-snippet";
    script.textContent = `
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="Pn On init Wn Qn ki Gn Kn zn capture calculateEventProperties rs register register_once register_for_session unregister unregister_for_session os getFeatureFlag getFeatureFlagPayload getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync ls identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty ns es createPersonProfile setInternalOrTestUser ss Hn cs opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing Yn debug Ci gr getPageViewId captureTraceFeedback captureTraceMetric qn".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init('${POSTHOG_KEY}', {
        api_host: 'https://us.i.posthog.com',
        defaults: '2026-05-30',
        person_profiles: 'identified_only',
        opt_out_capturing_by_default: true
    });
    posthog.opt_in_capturing();
    `;
    document.head.appendChild(script);
  }

  function optOutPostHog() {
    if (window.posthog?.opt_out_capturing) {
      window.posthog.opt_out_capturing();
    }
  }

  function hideBanner() {
    document.getElementById("gpx-cookie-banner")?.classList.add("is-hidden");
  }

  function showBanner() {
    const banner = document.getElementById("gpx-cookie-banner");
    if (!banner) {
      return;
    }
    banner.classList.remove("is-hidden");
  }

  function acceptCookies() {
    setStoredConsent("accepted");
    hideBanner();
    loadPostHog();
  }

  function refuseCookies() {
    setStoredConsent("refused");
    hideBanner();
    optOutPostHog();
  }

  function injectBanner() {
    if (document.getElementById("gpx-cookie-banner")) {
      return;
    }

    const banner = document.createElement("div");
    banner.id = "gpx-cookie-banner";
    banner.className = "gpx-cookie-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-live", "polite");
    banner.setAttribute("aria-label", "Consentement cookies");
    banner.innerHTML = `
      <div class="gpx-cookie-banner__inner">
        <p class="gpx-cookie-banner__text">
          Nous utilisons des cookies d'analyse (PostHog) pour améliorer votre expérience sur PrepaGPX. Ces cookies sont activés uniquement avec votre accord.
          <a href="confidentialite.html">En savoir plus</a>
        </p>
        <div class="gpx-cookie-banner__actions">
          <button type="button" class="secondary-button gpx-cookie-banner__btn" id="gpx-cookie-refuse">Refuser</button>
          <button type="button" class="primary-button gpx-cookie-banner__btn" id="gpx-cookie-accept">Accepter</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById("gpx-cookie-accept")?.addEventListener("click", acceptCookies);
    document.getElementById("gpx-cookie-refuse")?.addEventListener("click", refuseCookies);
  }

  function bindManageCookiesLinks() {
    document.addEventListener("click", (event) => {
      const link = event.target.closest("[data-gpx-manage-cookies]");
      if (!link) {
        return;
      }
      event.preventDefault();
      showBanner();
    });
  }

  function initCookieConsent() {
    injectBanner();
    bindManageCookiesLinks();

    const consent = getStoredConsent();
    if (consent === "accepted") {
      hideBanner();
      loadPostHog();
      return;
    }
    if (consent === "refused") {
      hideBanner();
      return;
    }
    showBanner();
  }

  window.GPXCookieConsent = {
    accept: acceptCookies,
    refuse: refuseCookies,
    open: showBanner
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCookieConsent);
  } else {
    initCookieConsent();
  }
})();
