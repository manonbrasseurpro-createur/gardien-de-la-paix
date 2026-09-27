(function () {
  const STORAGE_KEY = "gpxProgressionSessions";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const RETRY_DELAY_MS = 1500;

  let epoch = 0;
  let accountSync = null;
  const syncListeners = [];
  let syncSettled = false;

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

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function toNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function sameNumber(left, right) {
    const a = Number(left);
    const b = Number(right);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.001;
  }

  function withinOneDay(leftIso, rightIso) {
    const left = Date.parse(leftIso || "");
    const right = Date.parse(rightIso || "");
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return false;
    }
    return Math.abs(left - right) <= DAY_MS;
  }

  function createClientId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function normalizeCategories(categories) {
    if (!categories || typeof categories !== "object" || Array.isArray(categories)) {
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

  function withCategories(session, categories) {
    const normalized = normalizeCategories(categories);
    if (!normalized || !Object.keys(normalized).length) {
      return session;
    }
    return {
      ...session,
      categories: normalized
    };
  }

  function sessionKey(session) {
    if (session.client_id) {
      return `c:${session.client_id}`;
    }
    if (session.serverId) {
      return `s:${session.serverId}`;
    }
    return `l:${session.module}|${session.date}|${session.score}|${session.total}|${session.duree}`;
  }

  function commitMerged(merged) {
    const byKey = new Map();
    merged.forEach((session) => {
      byKey.set(sessionKey(session), session);
    });
    readSessions().forEach((session) => {
      const key = sessionKey(session);
      if (!byKey.has(key)) {
        byKey.set(key, session);
      }
    });
    writeSessions(Array.from(byKey.values()));
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

  async function getUser() {
    if (!window.GPXAuth?.getCurrentUser) {
      return null;
    }
    try {
      return await window.GPXAuth.getCurrentUser();
    } catch (error) {
      console.warn("[GPX Progression] getCurrentUser:", error);
      return null;
    }
  }

  function isDuplicateError(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    return code === "23505" || message.includes("exam_sessions_user_client_id_uidx") || message.includes("duplicate key");
  }

  function insertPayload(userId, session) {
    const payload = {
      user_id: userId,
      client_id: session.client_id,
      module: session.module,
      score: session.score,
      score_max: session.total,
      duree_secondes: session.duree,
      recorded_at: session.date
    };
    if (session.categories && Object.keys(session.categories).length) {
      payload.categories = session.categories;
    }
    return payload;
  }

  async function insertSession(client, userId, session, started) {
    if (!session?.client_id || started !== epoch) {
      return;
    }

    const payload = insertPayload(userId, session);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (started !== epoch) {
        return;
      }
      const { error } = await client.from("exam_sessions").insert(payload);
      if (!error || isDuplicateError(error)) {
        return;
      }
      console.warn("[GPX Progression] syncSessionToSupabase:", error);
      if (attempt === 0) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  async function pushSession(session, started) {
    try {
      const user = await getUser();
      if (!user?.id || started !== epoch) {
        return;
      }
      const client = getSupabaseClient();
      if (!client) {
        return;
      }
      await insertSession(client, user.id, session, started);
    } catch (error) {
      console.warn("[GPX Progression] syncSessionToSupabase:", error);
    }
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
    const normalized = withCategories({
      client_id: createClientId(),
      module: String(session.module),
      date: session.date || new Date().toISOString(),
      score: Math.max(0, Math.min(score, total)),
      total,
      duree
    }, session.categories);

    const sessions = readSessions();
    sessions.push(normalized);
    writeSessions(sessions);
    void pushSession(normalized, epoch);
  }

  function sessionFromRow(row) {
    const session = {
      serverId: row.id,
      module: String(row.module),
      date: row.recorded_at || row.created_at,
      score: toNumber(row.score, 0),
      total: toNumber(row.score_max, 0),
      duree: Math.max(0, Math.round(toNumber(row.duree_secondes, 0)))
    };
    if (row.client_id) {
      session.client_id = row.client_id;
    }
    return withCategories(session, row.categories);
  }

  function mergePair(local, row) {
    const session = {
      serverId: row.id,
      module: local.module || String(row.module),
      date: local.date || row.recorded_at || row.created_at,
      score: toNumber(local.score, toNumber(row.score, 0)),
      total: toNumber(local.total, toNumber(row.score_max, 0)),
      duree: Math.max(0, Math.round(toNumber(local.duree, toNumber(row.duree_secondes, 0))))
    };
    const clientId = local.client_id || row.client_id;
    if (clientId) {
      session.client_id = clientId;
    }
    return withCategories(session, local.categories || row.categories);
  }

  function findApproximateMatch(session, serverRows, usedIds) {
    return serverRows.find((row) => {
      if (usedIds.has(row.id) || row.client_id) {
        return false;
      }
      if (String(row.module) !== String(session.module)) {
        return false;
      }
      if (!sameNumber(row.score, session.score) || !sameNumber(row.score_max, session.total)) {
        return false;
      }
      if (Math.round(toNumber(row.duree_secondes, -1)) !== Math.round(toNumber(session.duree, -2))) {
        return false;
      }
      return withinOneDay(session.date, row.recorded_at || row.created_at);
    });
  }

  function backfillPatch(row, session) {
    const patch = {};
    const serverCategories = normalizeCategories(row.categories);
    if ((!serverCategories || !Object.keys(serverCategories).length) && session.categories) {
      patch.categories = session.categories;
    }
    if (!row.recorded_at && session.date) {
      patch.recorded_at = session.date;
    }
    return patch;
  }

  function reconcile(localSessions, serverRows) {
    const usedIds = new Set();
    const serverByClientId = new Map();
    serverRows.forEach((row) => {
      if (row.client_id) {
        serverByClientId.set(row.client_id, row);
      }
    });

    const merged = [];
    const toInsert = [];
    const toBackfill = [];

    localSessions.forEach((session) => {
      const byClient = session.client_id ? serverByClientId.get(session.client_id) : null;
      if (byClient) {
        usedIds.add(byClient.id);
        merged.push(mergePair(session, byClient));
        return;
      }

      const byServerId = session.serverId
        ? serverRows.find((row) => row.id === session.serverId)
        : null;
      if (byServerId) {
        usedIds.add(byServerId.id);
        merged.push(mergePair(session, byServerId));
        return;
      }

      if (!session.client_id) {
        const match = findApproximateMatch(session, serverRows, usedIds);
        if (match) {
          usedIds.add(match.id);
          const linked = mergePair(session, match);
          merged.push(linked);
          const patch = backfillPatch(match, linked);
          if (Object.keys(patch).length) {
            toBackfill.push({ id: match.id, patch });
          }
          return;
        }

        const created = {
          ...session,
          client_id: createClientId()
        };
        merged.push(created);
        toInsert.push(created);
        return;
      }

      merged.push(session);
      toInsert.push(session);
    });

    serverRows.forEach((row) => {
      if (!usedIds.has(row.id)) {
        merged.push(sessionFromRow(row));
      }
    });

    return { merged, toInsert, toBackfill };
  }

  async function fetchServerSessions(client, userId) {
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client
        .from("exam_sessions")
        .select("id, client_id, module, score, score_max, duree_secondes, categories, recorded_at, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        throw error;
      }

      const batch = Array.isArray(data) ? data : [];
      rows.push(...batch);
      if (batch.length < pageSize) {
        return rows;
      }
    }
  }

  async function backfillRow(client, userId, item, started) {
    if (started !== epoch) {
      return;
    }
    const { error } = await client
      .from("exam_sessions")
      .update(item.patch)
      .eq("id", item.id)
      .eq("user_id", userId);
    if (error) {
      console.warn("[GPX Progression] backfill:", error);
    }
  }

  async function runAccountSync() {
    const started = epoch;
    const user = await getUser();
    if (!user?.id || started !== epoch) {
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      return;
    }

    let serverRows;
    try {
      serverRows = await fetchServerSessions(client, user.id);
    } catch (error) {
      console.warn("[GPX Progression] lecture exam_sessions:", error);
      return;
    }

    if (started !== epoch) {
      return;
    }

    const { merged, toInsert, toBackfill } = reconcile(readSessions(), serverRows);
    if (started !== epoch) {
      return;
    }
    commitMerged(merged);

    for (let index = 0; index < toBackfill.length; index += 1) {
      if (started !== epoch) {
        return;
      }
      try {
        await backfillRow(client, user.id, toBackfill[index], started);
      } catch (error) {
        console.warn("[GPX Progression] backfill:", error);
      }
    }

    for (let index = 0; index < toInsert.length; index += 1) {
      if (started !== epoch) {
        return;
      }
      try {
        await insertSession(client, user.id, toInsert[index], started);
      } catch (error) {
        console.warn("[GPX Progression] syncSessionToSupabase:", error);
      }
    }
  }

  function notifySynced() {
    syncSettled = true;
    syncListeners.slice().forEach((callback) => {
      try {
        callback();
      } catch (error) {
        console.warn("[GPX Progression] onSynced:", error);
      }
    });
  }

  function onSynced(callback) {
    if (typeof callback !== "function") {
      return;
    }
    syncListeners.push(callback);
    if (syncSettled && !accountSync) {
      try {
        callback();
      } catch (error) {
        console.warn("[GPX Progression] onSynced:", error);
      }
    }
  }

  function ensureAccountSync() {
    if (!accountSync) {
      syncSettled = false;
      accountSync = runAccountSync().finally(() => {
        accountSync = null;
        notifySynced();
      });
    }
    return accountSync;
  }

  async function deleteServerSessions(started) {
    try {
      const user = await getUser();
      if (!user?.id) {
        return;
      }
      const client = getSupabaseClient();
      if (!client) {
        return;
      }
      const { error } = await client.from("exam_sessions").delete().eq("user_id", user.id);
      if (error) {
        console.warn("[GPX Progression] clearSessions:", error);
      }
      if (started === epoch) {
        const sessions = readSessions().filter((session) => session.client_id);
        for (let index = 0; index < sessions.length; index += 1) {
          await insertSession(client, user.id, sessions[index], started);
        }
      }
    } catch (error) {
      console.warn("[GPX Progression] clearSessions:", error);
    }
  }

  function clearSessions() {
    epoch += 1;
    const started = epoch;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn("[GPX Progression] clearSessions:", error);
    }
    void deleteServerSessions(started);
  }

  function watchAuth() {
    void ensureAccountSync();
    if (typeof window.GPXAuth?.onAuthStateChange !== "function") {
      return;
    }
    if (typeof window.GPXAuth.isSupabaseConfigured === "function" && !window.GPXAuth.isSupabaseConfigured()) {
      return;
    }
    try {
      window.GPXAuth.onAuthStateChange((event, session) => {
        if (!session?.user) {
          return;
        }
        if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
          void ensureAccountSync();
        }
      });
    } catch (error) {
      console.warn("[GPX Progression] onAuthStateChange:", error);
    }
  }

  watchAuth();

  window.GpxProgression = {
    STORAGE_KEY,
    readSessions,
    saveSession,
    clearSessions,
    onSynced
  };
})();
