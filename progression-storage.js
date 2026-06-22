(function () {
  const STORAGE_KEY = "gpxProgressionSessions";

  function readSessions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function writeSessions(sessions) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }

  function toNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeCategories(categories) {
    if (!categories || typeof categories !== "object") {
      return null;
    }

    return Object.entries(categories).reduce((normalized, [label, result]) => {
      if (!result || typeof result !== "object") {
        return normalized;
      }

      const score = toNumber(result.score, toNumber(result.correct, 0));
      const total = toNumber(result.total, 0);
      if (!label || total <= 0) {
        return normalized;
      }

      normalized[label] = {
        score: Math.max(0, Math.min(score, total)),
        total
      };
      return normalized;
    }, {});
  }

  function saveSession(session) {
    if (!session || typeof session !== "object") {
      return;
    }

    const total = toNumber(session.total, 0);
    if (!session.module || total <= 0) {
      return;
    }

    const score = toNumber(session.score, 0);
    const duree = Math.max(0, Math.round(toNumber(session.duree, 0)));
    const normalized = {
      module: String(session.module),
      date: session.date || new Date().toISOString(),
      score: Math.max(0, Math.min(score, total)),
      total,
      duree
    };

    const categories = normalizeCategories(session.categories);
    if (categories && Object.keys(categories).length) {
      normalized.categories = categories;
    }

    const sessions = readSessions();
    sessions.push(normalized);
    writeSessions(sessions);
    syncSessionToSupabase(normalized);
  }

  function getSupabaseClient() {
    if (window.__gpxSupabaseClient) {
      return window.__gpxSupabaseClient;
    }
    const cfg = window.GPX_SUPABASE || {};
    const url = cfg.url || cfg.SUPABASE_URL;
    const anonKey = cfg.anonKey;
    if (!url || !anonKey || !window.supabase?.createClient) {
      return null;
    }
    window.__gpxSupabaseClient = window.supabase.createClient(url, anonKey);
    return window.__gpxSupabaseClient;
  }

  async function syncSessionToSupabase(session) {
    const client = getSupabaseClient();
    if (!client || !window.GPXAuth?.getCurrentUser) {
      return;
    }

    try {
      const user = await window.GPXAuth.getCurrentUser();
      if (!user?.id) {
        return;
      }

      const { error } = await client.from("exam_sessions").insert({
        user_id: user.id,
        module: session.module,
        score: session.score,
        score_max: session.total,
        duree_secondes: session.duree
      });

      if (error) {
        console.warn("[GPX Progression] syncSessionToSupabase:", error);
      }
    } catch (error) {
      console.warn("[GPX Progression] syncSessionToSupabase:", error);
    }
  }

  function clearSessions() {
    localStorage.removeItem(STORAGE_KEY);
  }

  window.GpxProgression = {
    STORAGE_KEY,
    readSessions,
    saveSession,
    clearSessions
  };
})();
