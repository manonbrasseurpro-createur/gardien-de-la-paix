/**
 * Présence Realtime des élèves connectés (toutes pages authentifiées).
 * Canal partagé avec le compteur admin : dashboard-online.
 *
 * supabase-js 2.49.8 n'active PAS presence.enabled tout seul à l'abonnement.
 * Sans { presence: { enabled: true } } dans le join, le serveur accepte track()
 * mais n'envoie pas presence_state / presence_diff à CE client — d'où sync
 * invisible alors que l'Inspector (lui, presence enabled) voit bien les events.
 */
(function (global) {
  const CHANNEL_NAME = "dashboard-online";
  const CHANNEL_TOPIC = "realtime:" + CHANNEL_NAME;
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
  global.__gpxPresenceChannel = null;

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
    } else if (reason === "presence_state" || reason === "presence_diff") {
      console.info("[GPX Presence] " + reason + " received", state);
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

  function isSamePresenceChannel(candidate) {
    if (!candidate) {
      return false;
    }
    return candidate.topic === CHANNEL_TOPIC
      || candidate.subTopic === CHANNEL_NAME
      || candidate.topic === CHANNEL_NAME;
  }

  async function removeStalePresenceChannels(supabaseClient, keepChannel) {
    const channels = typeof supabaseClient.getChannels === "function"
      ? supabaseClient.getChannels()
      : [];
    const stale = channels.filter(function (candidate) {
      return isSamePresenceChannel(candidate) && candidate !== keepChannel;
    });
    for (let i = 0; i < stale.length; i += 1) {
      try {
        debugLog("removeChannel stale", stale[i].topic, stale[i]);
        await supabaseClient.removeChannel(stale[i]);
      } catch (error) {
        debugLog("removeChannel stale:", error);
      }
    }
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
    global.__gpxPresenceChannel = null;
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

  function stampPresenceEnabled(activeChannel, userId) {
    if (!activeChannel.params) {
      activeChannel.params = { config: {} };
    }
    if (!activeChannel.params.config) {
      activeChannel.params.config = {};
    }
    const presence = Object.assign({}, activeChannel.params.config.presence || {}, {
      key: userId,
      enabled: true
    });
    activeChannel.params.config.presence = presence;
    return presence;
  }

  function bindPresenceHandlers(activeChannel) {
    const afterSync = activeChannel.on("presence", { event: "sync" }, function () {
      readAndEmitPresence("sync", activeChannel);
    });
    console.info("[GPX Presence] handler sync bound", {
      sameInstance: afterSync === activeChannel,
      topic: activeChannel.topic,
      channel: activeChannel,
      presenceBindings: activeChannel.bindings && activeChannel.bindings.presence
    });

    activeChannel.on("presence", { event: "join" }, function (payload) {
      debugLog("join event", payload);
      readAndEmitPresence("join", activeChannel);
    });
    activeChannel.on("presence", { event: "leave" }, function (payload) {
      debugLog("leave event", payload);
      readAndEmitPresence("leave", activeChannel);
    });

    activeChannel.on("presence_state", {}, function (rawState) {
      console.info("[GPX Presence] presence_state raw", rawState);
      readAndEmitPresence("presence_state", activeChannel);
    });
    activeChannel.on("presence_diff", {}, function (rawDiff) {
      console.info("[GPX Presence] presence_diff raw", rawDiff);
      readAndEmitPresence("presence_diff", activeChannel);
    });

    return activeChannel;
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
      await removeStalePresenceChannels(supabaseClient, null);
      channel = null;

      const activeChannel = supabaseClient.channel(CHANNEL_NAME, {
        config: {
          presence: {
            key: user.id,
            enabled: true
          }
        }
      });
      const presenceJoin = stampPresenceEnabled(activeChannel, user.id);
      channel = activeChannel;
      global.__gpxPresenceChannel = activeChannel;

      console.info("[GPX Presence] channel created", {
        name: CHANNEL_NAME,
        topic: activeChannel.topic,
        subTopic: activeChannel.subTopic,
        presenceJoin: presenceJoin,
        channel: activeChannel
      });

      bindPresenceHandlers(activeChannel);

      console.info("[GPX Presence] subscribe() on same instance", {
        sameAsCreated: activeChannel === channel,
        topic: activeChannel.topic,
        presenceEnabled: !!(activeChannel.params && activeChannel.params.config && activeChannel.params.config.presence && activeChannel.params.config.presence.enabled),
        channel: activeChannel
      });

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
          debugLog("track OK", trackResult, {
            sameInstance: activeChannel === channel,
            topic: activeChannel.topic
          });
          const stateAfterTrack = activeChannel.presenceState() || {};
          if (Object.keys(stateAfterTrack).length > 0) {
            emitSync(stateAfterTrack);
          } else {
            debugLog("presenceState vide juste après track — attente sync/presence_state");
            setTimeout(function () {
              readAndEmitPresence("track-timeout", activeChannel);
            }, 600);
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
