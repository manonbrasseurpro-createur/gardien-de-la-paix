/**
 * Présence Realtime des élèves connectés (toutes pages authentifiées).
 * Canal partagé avec le compteur admin : dashboard-online.
 */
(function (global) {
  const CHANNEL_NAME = "dashboard-online";
  const TAB_STORAGE_KEY = "gpxPresenceTabId";
  const READY_TIMEOUT_MS = 10000;
  const READY_INTERVAL_MS = 200;
  const syncListeners = new Set();

  let channel = null;
  let client = null;
  let started = false;
  let joining = false;
  let left = false;
  let authSubscription = null;
  let lifecycleBound = false;

  global.__gpxPresenceState = global.__gpxPresenceState || {};

  function isDebug() {
    try {
      if (global.GPX_PRESENCE_DEBUG === false || localStorage.getItem("gpxPresenceDebug") === "0") {
        return false;
      }
    } catch (error) {
      if (global.GPX_PRESENCE_DEBUG === false) {
        return false;
      }
    }
    return true;
  }

  function debugLog() {
    if (!isDebug()) {
      return;
    }
    console.info.apply(console, ["[GPX Presence]"].concat([].slice.call(arguments)));
  }

  function getSupabaseClient() {
    return global.__gpxSupabaseClient || null;
  }

  function getTabId() {
    try {
      let tabId = sessionStorage.getItem(TAB_STORAGE_KEY);
      if (!tabId) {
        tabId = (global.crypto?.randomUUID && global.crypto.randomUUID())
          || `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        sessionStorage.setItem(TAB_STORAGE_KEY, tabId);
      }
      return tabId;
    } catch (error) {
      return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  }

  function presenceList(presences) {
    if (Array.isArray(presences)) {
      return presences;
    }
    if (presences && Array.isArray(presences.metas)) {
      return presences.metas;
    }
    if (presences && typeof presences === "object") {
      return [presences];
    }
    return [];
  }

  function uniquePeople(state) {
    const source = state || global.__gpxPresenceState || {};
    const people = [];
    Object.values(source).forEach(function (presences) {
      presenceList(presences).forEach(function (presence) {
        const name = String(presence.firstName || presence.first_name || "").trim() || "Candidat";
        const key = String(presence.userId || presence.email || name).trim().toLowerCase();
        if (!key || people.some(function (item) { return item.key === key; })) {
          return;
        }
        people.push({
          key: key,
          name: name,
          userId: presence.userId || "",
          email: presence.email || ""
        });
      });
    });
    return people;
  }

  function emitSync(state) {
    global.__gpxPresenceState = state && typeof state === "object" ? state : {};
    syncListeners.forEach(function (listener) {
      try {
        listener(global.__gpxPresenceState);
      } catch (error) {
        console.warn("[GPX Presence] listener:", error);
      }
    });
    global.dispatchEvent(new CustomEvent("gpx-presence-sync", {
      detail: global.__gpxPresenceState
    }));
  }

  function readAndEmitPresence(reason, activeChannel) {
    const target = activeChannel || channel;
    if (!target || typeof target.presenceState !== "function") {
      debugLog("readAndEmit: channel indisponible", reason);
      return;
    }
    const state = target.presenceState() || {};
    if (reason === "sync") {
      console.info("[GPX Presence] sync event fired", state);
    } else {
      debugLog("presence update", reason, state);
    }
    emitSync(state);
  }

  function onSync(listener) {
    if (typeof listener !== "function") {
      return function unsubscribe() {};
    }
    syncListeners.add(listener);
    if (global.__gpxPresenceState) {
      try {
        listener(global.__gpxPresenceState);
      } catch (error) {
        console.warn("[GPX Presence] listener:", error);
      }
    }
    return function unsubscribe() {
      syncListeners.delete(listener);
    };
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function ensureClient() {
    if (getSupabaseClient()) {
      return getSupabaseClient();
    }
    if (global.GPXAuth?.getCurrentUser) {
      try {
        await global.GPXAuth.getCurrentUser();
      } catch (error) {
        debugLog("ensureClient getCurrentUser:", error);
      }
    }
    return getSupabaseClient();
  }

  async function waitForAuthReady() {
    const deadline = Date.now() + READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (!global.GPXAuth?.getCurrentUser) {
        debugLog("sortie temporaire: GPXAuth.getCurrentUser absent");
        await sleep(READY_INTERVAL_MS);
        continue;
      }

      let user = null;
      try {
        user = await global.GPXAuth.getCurrentUser();
      } catch (error) {
        debugLog("getCurrentUser a levé:", error);
      }

      const supabaseClient = await ensureClient();
      if (supabaseClient) {
        bindAuthListener(supabaseClient);
      }
      if (!user?.id) {
        debugLog("sortie temporaire: session utilisateur absente (user.id manquant)");
      } else if (!supabaseClient) {
        debugLog("sortie temporaire: __gpxSupabaseClient absent");
      } else {
        return { user: user, client: supabaseClient };
      }

      await sleep(READY_INTERVAL_MS);
    }

    const user = global.GPXAuth?.getCurrentUser ? await global.GPXAuth.getCurrentUser().catch(function () { return null; }) : null;
    const supabaseClient = getSupabaseClient();
    if (!global.GPXAuth?.getCurrentUser) {
      console.warn("[GPX Presence] abandon: GPXAuth.getCurrentUser toujours absent après", READY_TIMEOUT_MS, "ms");
    } else if (!user?.id) {
      console.warn("[GPX Presence] abandon: session utilisateur toujours absente après", READY_TIMEOUT_MS, "ms");
    } else if (!supabaseClient) {
      console.warn("[GPX Presence] abandon: __gpxSupabaseClient toujours absent après", READY_TIMEOUT_MS, "ms");
    }
    return { user: user, client: supabaseClient };
  }

  async function leaveChannel() {
    if (left && !channel) {
      return;
    }
    left = true;
    started = false;
    joining = false;
    const activeChannel = channel;
    const activeClient = client;
    channel = null;
    if (!activeChannel || !activeClient) {
      return;
    }
    try {
      await activeChannel.untrack();
    } catch (error) {
      console.warn("[GPX Presence] untrack:", error);
    }
    try {
      await activeClient.removeChannel(activeChannel);
    } catch (error) {
      console.warn("[GPX Presence] removeChannel:", error);
    }
  }

  function bindPresenceHandlers(activeChannel) {
    activeChannel.on("presence", { event: "sync" }, function () {
      readAndEmitPresence("sync", activeChannel);
    });
    activeChannel.on("presence", { event: "join" }, function (payload) {
      debugLog("join event", payload);
      readAndEmitPresence("join", activeChannel);
    });
    activeChannel.on("presence", { event: "leave" }, function (payload) {
      debugLog("leave event", payload);
      readAndEmitPresence("leave", activeChannel);
    });
  }

  async function joinChannel(user, supabaseClient) {
    if (!user?.id) {
      debugLog("join: sortie user.id manquant");
      return;
    }
    if (!supabaseClient) {
      debugLog("join: sortie client manquant");
      return;
    }
    if (started && channel) {
      return;
    }
    if (joining) {
      return;
    }

    joining = true;
    left = false;
    client = supabaseClient;

    try {
      if (channel) {
        try {
          await client.removeChannel(channel);
        } catch (error) {
          debugLog("removeChannel précédent:", error);
        }
        channel = null;
      }

      const activeChannel = client.channel(CHANNEL_NAME, {
        config: { presence: { key: user.id } }
      });
      channel = activeChannel;

      bindPresenceHandlers(activeChannel);

      activeChannel.subscribe(async function (status) {
        if (status !== "SUBSCRIBED") {
          console.warn("[GPX Presence] subscribe status =", status);
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            started = false;
            joining = false;
          }
          return;
        }

        started = true;
        joining = false;
        try {
          const trackResult = await activeChannel.track({
            userId: user.id,
            firstName: user.firstName || "Candidat",
            email: user.email || "",
            tabId: getTabId()
          });
          debugLog("track OK", trackResult);
          const stateAfterTrack = activeChannel.presenceState() || {};
          if (Object.keys(stateAfterTrack).length > 0) {
            emitSync(stateAfterTrack);
          } else {
            debugLog("presenceState vide juste après track — attente sync/join");
            setTimeout(function () {
              readAndEmitPresence("track-timeout", activeChannel);
            }, 400);
          }
        } catch (error) {
          console.warn("[GPX Presence] track:", error);
        }
      });
    } catch (error) {
      started = false;
      joining = false;
      console.warn("[GPX Presence] start:", error);
    }
  }

  function bindAuthListener(supabaseClient) {
    if (authSubscription || !supabaseClient?.auth?.onAuthStateChange) {
      return;
    }
    const result = supabaseClient.auth.onAuthStateChange(function (event, session) {
      if (event === "SIGNED_OUT") {
        leaveChannel();
        return;
      }
      if (!session?.user) {
        return;
      }
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        joinChannel({
          id: session.user.id,
          email: session.user.email || "",
          firstName: session.user.user_metadata?.first_name
            || session.user.user_metadata?.given_name
            || "Candidat"
        }, supabaseClient);
      }
    });
    authSubscription = result?.data?.subscription || null;
  }

  function bindLifecycle() {
    if (lifecycleBound) {
      return;
    }
    lifecycleBound = true;
    global.addEventListener("pagehide", function () {
      leaveChannel();
    });
    global.addEventListener("pageshow", function (event) {
      if (event.persisted) {
        left = false;
        started = false;
        joining = false;
        startPresence();
      }
    });
  }

  async function startPresence() {
    bindLifecycle();

    if (!global.GPXAuth?.getCurrentUser) {
      debugLog("sortie: GPXAuth.getCurrentUser absent au démarrage, attente…");
    }

    const ready = await waitForAuthReady();
    if (ready.client) {
      bindAuthListener(ready.client);
    }

    if (!global.GPXAuth?.getCurrentUser) {
      console.warn("[GPX Presence] sortie: GPXAuth.getCurrentUser absent");
      return;
    }
    if (!ready.user?.id) {
      debugLog("session pas encore prête — attente onAuthStateChange INITIAL_SESSION");
      return;
    }
    if (!ready.client) {
      console.warn("[GPX Presence] sortie: __gpxSupabaseClient absent");
      return;
    }

    await joinChannel(ready.user, ready.client);
  }

  global.GPXPresence = {
    CHANNEL_NAME: CHANNEL_NAME,
    uniquePeople: uniquePeople,
    onSync: onSync,
    start: startPresence,
    leave: leaveChannel
  };

  function boot() {
    startPresence();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
