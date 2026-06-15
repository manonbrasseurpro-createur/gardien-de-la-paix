(function () {
  const LOCAL_USERS_KEY = "gpx_users_db";
  const LOCAL_SESSION_KEY = "gpx_auth_session";

  function isSupabaseConfigured() {
    const cfg = window.GPX_SUPABASE || {};
    return Boolean(cfg.url && cfg.anonKey);
  }

  function getSupabaseClient() {
    if (!window.supabase || !isSupabaseConfigured()) {
      return null;
    }
    if (!window.__gpxSupabaseClient) {
      window.__gpxSupabaseClient = window.supabase.createClient(
        window.GPX_SUPABASE.url,
        window.GPX_SUPABASE.anonKey
      );
    }
    return window.__gpxSupabaseClient;
  }

  async function hashPassword(password, salt) {
    const data = new TextEncoder().encode(`${salt}:${password}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function readLocalUsers() {
    try {
      const raw = localStorage.getItem(LOCAL_USERS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function writeLocalUsers(users) {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  }

  function normalizeProfile(profile, fallbackEmail) {
    return {
      id: profile.id,
      email: profile.email || fallbackEmail || "",
      firstName: profile.first_name || profile.firstName || "",
      lastName: profile.last_name || profile.lastName || "",
      subscriptionStatus: profile.subscription_status || profile.subscriptionStatus || "none",
      subscriptionEndsAt: profile.subscription_ends_at || profile.subscriptionEndsAt || null,
      freeTrialUsed: Boolean(profile.free_trial_used ?? profile.freeTrialUsed),
      freeTrialKey: profile.free_trial_key || profile.freeTrialKey || null
    };
  }

  function hasActiveSubscription(profile) {
    if (!profile) {
      return false;
    }
    if (profile.subscriptionStatus === "active") {
      if (!profile.subscriptionEndsAt) {
        return true;
      }
      return new Date(profile.subscriptionEndsAt) > new Date();
    }
    return false;
  }

  async function registerLocal({ firstName, lastName, email, password }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!firstName || !lastName || !normalizedEmail || !password) {
      throw new Error("Tous les champs sont obligatoires.");
    }
    if (password.length < 8) {
      throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
    }

    const users = readLocalUsers();
    if (users[normalizedEmail]) {
      throw new Error("Un compte existe déjà avec cette adresse e-mail.");
    }

    const salt = crypto.randomUUID();
    const passwordHash = await hashPassword(password, salt);
    const id = crypto.randomUUID();
    users[normalizedEmail] = {
      id,
      email: normalizedEmail,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      passwordHash,
      salt,
      subscriptionStatus: "none",
      subscriptionEndsAt: null,
      freeTrialUsed: false,
      freeTrialKey: null
    };
    writeLocalUsers(users);
    localStorage.setItem(LOCAL_SESSION_KEY, id);

    return normalizeProfile({
      id,
      email: normalizedEmail,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      subscription_status: "none",
      free_trial_used: false
    });
  }

  async function loginLocal({ email, password }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const users = readLocalUsers();
    const user = users[normalizedEmail];
    if (!user) {
      throw new Error("Identifiants incorrects.");
    }
    const passwordHash = await hashPassword(password, user.salt);
    if (passwordHash !== user.passwordHash) {
      throw new Error("Identifiants incorrects.");
    }
    localStorage.setItem(LOCAL_SESSION_KEY, user.id);
    return normalizeProfile(user);
  }

  function logoutLocal() {
    localStorage.removeItem(LOCAL_SESSION_KEY);
  }

  function getLocalSessionUser() {
    const sessionId = localStorage.getItem(LOCAL_SESSION_KEY);
    if (!sessionId) {
      return null;
    }
    const users = readLocalUsers();
    const entry = Object.values(users).find((user) => user.id === sessionId);
    if (!entry) {
      localStorage.removeItem(LOCAL_SESSION_KEY);
      return null;
    }
    return normalizeProfile(entry);
  }

  async function updateLocalProfile(userId, patch) {
    const users = readLocalUsers();
    const entry = Object.values(users).find((user) => user.id === userId);
    if (!entry) {
      return null;
    }
    const emailKey = entry.email;
    if (patch.freeTrialUsed !== undefined) {
      users[emailKey].freeTrialUsed = patch.freeTrialUsed;
    }
    if (patch.freeTrialKey !== undefined) {
      users[emailKey].freeTrialKey = patch.freeTrialKey;
    }
    if (patch.subscriptionStatus !== undefined) {
      users[emailKey].subscriptionStatus = patch.subscriptionStatus;
    }
    if (patch.subscriptionEndsAt !== undefined) {
      users[emailKey].subscriptionEndsAt = patch.subscriptionEndsAt;
    }
    writeLocalUsers(users);
    return normalizeProfile(users[emailKey]);
  }

  async function registerSupabase({ firstName, lastName, email, password }) {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("Supabase n'est pas configuré.");
    }

    const { data, error } = await client.auth.signUp({
      email: String(email).trim().toLowerCase(),
      password,
      options: {
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim()
        }
      }
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data.user) {
      throw new Error("Inscription impossible. Réessayez.");
    }

    return await fetchSupabaseProfile(data.user.id, data.user.email);
  }

  async function loginSupabase({ email, password }) {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error("Supabase n'est pas configuré.");
    }

    const { data, error } = await client.auth.signInWithPassword({
      email: String(email).trim().toLowerCase(),
      password
    });

    if (error) {
      throw new Error("Identifiants incorrects.");
    }

    return await fetchSupabaseProfile(data.user.id, data.user.email);
  }

  async function logoutSupabase() {
    const client = getSupabaseClient();
    if (client) {
      await client.auth.signOut();
    }
  }

  async function fetchSupabaseProfile(userId, fallbackEmail) {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return normalizeProfile({ id: userId, email: fallbackEmail }, fallbackEmail);
    }

    return normalizeProfile(data, fallbackEmail);
  }

  async function getCurrentUser() {
    if (isSupabaseConfigured()) {
      const client = getSupabaseClient();
      const { data } = await client.auth.getSession();
      const session = data?.session;
      if (!session?.user) {
        return null;
      }
      return await fetchSupabaseProfile(session.user.id, session.user.email);
    }
    return getLocalSessionUser();
  }

  async function register(formData) {
    if (isSupabaseConfigured()) {
      return await registerSupabase(formData);
    }
    return await registerLocal(formData);
  }

  async function login(formData) {
    if (isSupabaseConfigured()) {
      return await loginSupabase(formData);
    }
    return await loginLocal(formData);
  }

  async function logout() {
    if (isSupabaseConfigured()) {
      await logoutSupabase();
    } else {
      logoutLocal();
    }
  }

  async function updateProfile(userId, patch) {
    if (isSupabaseConfigured()) {
      const client = getSupabaseClient();
      const dbPatch = {};
      if (patch.freeTrialUsed !== undefined) {
        dbPatch.free_trial_used = patch.freeTrialUsed;
      }
      if (patch.freeTrialKey !== undefined) {
        dbPatch.free_trial_key = patch.freeTrialKey;
      }
      const { error } = await client.from("profiles").update(dbPatch).eq("id", userId);
      if (error) {
        throw new Error(error.message);
      }
      return await fetchSupabaseProfile(userId);
    }
    return await updateLocalProfile(userId, patch);
  }

  async function activateDemoSubscription(userId) {
    const endsAt = new Date();
    endsAt.setMonth(endsAt.getMonth() + 1);
    const patch = {
      subscriptionStatus: "active",
      subscriptionEndsAt: endsAt.toISOString()
    };

    if (isSupabaseConfigured()) {
      const client = getSupabaseClient();
      const { error } = await client
        .from("profiles")
        .update({
          subscription_status: "active",
          subscription_ends_at: endsAt.toISOString()
        })
        .eq("id", userId);
      if (error) {
        throw new Error(error.message);
      }
      return await fetchSupabaseProfile(userId);
    }

    return await updateLocalProfile(userId, patch);
  }

  window.GPXAuth = {
    isSupabaseConfigured,
    isLocalMode: () => !isSupabaseConfigured(),
    getCurrentUser,
    register,
    login,
    logout,
    updateProfile,
    activateDemoSubscription,
    hasActiveSubscription
  };
})();
