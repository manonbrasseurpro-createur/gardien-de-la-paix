/**
 * Présence Realtime des élèves connectés (toutes pages authentifiées).
 * Canal partagé avec le compteur admin : dashboard-online.
 */
(function (global) {
  const CHANNEL_NAME = "dashboard-online";
  const TAB_STORAGE_KEY = "gpxPresenceTabId";
  const syncListeners = new Set();

  let channel = null;
  let client = null;
  let started = false;
  let left = false;
  let authSubscription = null;

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

  function uniquePeople(state) {
    const source = state || global.__gpxPresenceState || {};
    const people = [];
    Object.values(source).forEach((presences) => {
      (Array.isArray(presences) ? presences : []).forEach((presence) => {
        const name = String(presence.firstName || presence.first_name || "").trim() || "Candidat";
        const key = String(presence.userId || presence.email || name).trim().toLowerCase();
        if (!key || people.some((item) => item.key === key)) {
          return;
        }
        people.push({
          key,
          name,
          userId: presence.userId || "",
          email: presence.email || ""
        });
      });
    });
    return people;
  }

  function emitSync(state) {
    global.__gpxPresenceState = state || {};
    syncListeners.forEach((listener) => {
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

  async function leaveChannel() {
    if (left) {
      return;
    }
    left = true;
    started = false;
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

  async function startPresence() {
    if (started) {
      return;
    }
    if (!global.GPXAuth?.getCurrentUser) {
      return;
    }

    const user = await global.GPXAuth.getCurrentUser();
    if (!user?.id) {
      return;
    }

    client = getSupabaseClient();
    if (!client) {
      return;
    }

    started = true;
    left = false;

    const tabId = getTabId();
    const presenceKey = `${user.id}:${tabId}`;

    try {
      channel = client.channel(CHANNEL_NAME, {
        config: { presence: { key: presenceKey } }
      });

      channel.on("presence", { event: "sync" }, () => {
        emitSync(channel ? channel.presenceState() : {});
      });

      channel.subscribe(async (status) => {
        if (status !== "SUBSCRIBED" || !channel) {
          return;
        }
        try {
          await channel.track({
            userId: user.id,
            firstName: user.firstName || "Candidat",
            email: user.email || ""
          });
        } catch (error) {
          console.warn("[GPX Presence] track:", error);
        }
      });
    } catch (error) {
      started = false;
      console.warn("[GPX Presence] start:", error);
    }
  }

  function bindLifecycle() {
    global.addEventListener("pagehide", () => {
      leaveChannel();
    });
    global.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        left = false;
        startPresence();
      }
    });

    const existingClient = getSupabaseClient();
    if (existingClient?.auth?.onAuthStateChange && !authSubscription) {
      const { data } = existingClient.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          leaveChannel();
        }
      });
      authSubscription = data?.subscription || null;
    }
  }

  global.GPXPresence = {
    CHANNEL_NAME,
    uniquePeople,
    onSync,
    start: startPresence,
    leave: leaveChannel
  };

  document.addEventListener("DOMContentLoaded", async () => {
    await startPresence();
    bindLifecycle();
  });
})(typeof window !== "undefined" ? window : globalThis);
