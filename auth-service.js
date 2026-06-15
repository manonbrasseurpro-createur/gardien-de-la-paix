(function () {
  const SUPABASE_JS_VERSION = "2.49.8";

  function getConfig() {
    const cfg = window.GPX_SUPABASE || {};
    const url = cfg.url || cfg.SUPABASE_URL || "";
    const anonKey = cfg.anonKey || cfg.anon_key || cfg.publishableKey || "";
    return { url, anonKey };
  }

  function isSupabaseConfigured() {
    const { url, anonKey } = getConfig();
    return Boolean(url && anonKey);
  }

  function resolveCreateClient() {
    const lib = window.supabase;
    if (!lib) {
      return null;
    }
    if (typeof lib.createClient === "function") {
      return lib.createClient;
    }
    if (lib.default && typeof lib.default.createClient === "function") {
      return lib.default.createClient;
    }
    return null;
  }

  function requireSupabaseLibrary() {
    const createClient = resolveCreateClient();
    if (!createClient) {
      throw new Error(
        "La bibliothèque @supabase/supabase-js n'est pas chargée. Vérifiez le script CDN (avant auth-service.js)."
      );
    }
    return createClient;
  }

  function getSupabaseClient() {
    const createClient = requireSupabaseLibrary();
    if (!isSupabaseConfigured()) {
      throw new Error("Supabase n'est pas configuré dans supabase-config.js.");
    }

    if (!window.__gpxSupabaseClient) {
      const { url, anonKey } = getConfig();
      window.__gpxSupabaseClient = createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      });
    }
    return window.__gpxSupabaseClient;
  }

  function normalizeProfile(profile, fallbackEmail) {
    return {
      id: profile.id,
      email: profile.email || fallbackEmail || "",
      firstName: profile.first_name || profile.firstName || "",
      lastName: profile.last_name || profile.lastName || "",
      phone: profile.phone || "",
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

  function mapAuthError(error) {
    const message = error?.message || "";
    const code = error?.code || "";

    if (code === "bad_jwt" || message.includes("Invalid JWT")) {
      return new Error(
        "Erreur de clé API Supabase (Invalid JWT). Mettez à jour @supabase/supabase-js (CDN ≥ 2.49.8) ou utilisez temporairement la clé anon legacy (eyJ...) dans supabase-config.js."
      );
    }
    if (message.includes("Invalid login credentials")) {
      return new Error("Identifiants incorrects.");
    }
    if (message.includes("User already registered")) {
      return new Error("Un compte existe déjà avec cette adresse e-mail.");
    }
    if (message.includes("Password should be at least")) {
      return new Error("Le mot de passe doit contenir au moins 8 caractères.");
    }
    if (message.includes("Unable to validate email address")) {
      return new Error("Adresse e-mail invalide.");
    }
    if (message.includes("Email not confirmed")) {
      return new Error("Confirmez votre e-mail avant de vous connecter (vérifiez votre boîte de réception).");
    }
    if (message.includes("Signup is disabled")) {
      return new Error("Les inscriptions sont désactivées dans Supabase (Authentication → Providers → Email).");
    }
    return new Error(message || "Une erreur d'authentification s'est produite.");
  }

  function validateCredentials({ firstName, lastName, email, password, requireName }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (requireName && (!firstName || !lastName)) {
      throw new Error("Le nom et le prénom sont obligatoires.");
    }
    if (!normalizedEmail || !password) {
      throw new Error("L'e-mail et le mot de passe sont obligatoires.");
    }
    if (password.length < 8) {
      throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
    }
    return normalizedEmail;
  }

  function normalizePhone(phone) {
    const trimmed = String(phone || "").trim();
    if (!trimmed) {
      throw new Error("Le numéro de téléphone est obligatoire.");
    }
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length < 10) {
      throw new Error("Numéro de téléphone invalide (10 chiffres minimum).");
    }
    return trimmed;
  }

  async function saveProfilePhone(userId, phone) {
    const client = getSupabaseClient();
    const { error } = await client.from("profiles").update({ phone }).eq("id", userId);
    if (error) {
      console.warn("[GPX Auth] profiles.phone update:", error);
      throw new Error(error.message);
    }
  }

  async function profileFromAuthUser(client, userId, fallbackEmail) {
    const { data, error } = await client.auth.getUser();
    if (error) {
      console.warn("[GPX Auth] auth.getUser:", error);
    }
    const user = data?.user;
    const meta = user?.user_metadata || {};
    return normalizeProfile(
      {
        id: userId,
        email: user?.email || fallbackEmail,
        first_name: meta.first_name || "",
        last_name: meta.last_name || "",
        phone: meta.phone || ""
      },
      fallbackEmail
    );
  }

  async function fetchProfile(userId, fallbackEmail) {
    const client = getSupabaseClient();

    try {
      const { data, error } = await client
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        console.warn("[GPX Auth] profiles.select:", error.message, error);
        return await profileFromAuthUser(client, userId, fallbackEmail);
      }

      if (!data) {
        return await profileFromAuthUser(client, userId, fallbackEmail);
      }

      return normalizeProfile(data, fallbackEmail);
    } catch (error) {
      console.warn("[GPX Auth] fetchProfile:", error);
      return await profileFromAuthUser(client, userId, fallbackEmail);
    }
  }

  async function register({ firstName, lastName, email, phone, password }) {
    const normalizedEmail = validateCredentials({
      firstName,
      lastName,
      email,
      password,
      requireName: true
    });
    const normalizedPhone = normalizePhone(phone);

    const client = getSupabaseClient();
    console.info("[GPX Auth] signUp…", { email: normalizedEmail });

    const { data, error } = await client.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          first_name: String(firstName).trim(),
          last_name: String(lastName).trim(),
          phone: normalizedPhone
        }
      }
    });

    if (error) {
      console.error("[GPX Auth] signUp error:", error);
      throw mapAuthError(error);
    }

    if (!data.user) {
      throw new Error("Inscription impossible. Réessayez.");
    }

    console.info("[GPX Auth] signUp OK", {
      userId: data.user.id,
      session: Boolean(data.session)
    });

    if (data.session) {
      await saveProfilePhone(data.user.id, normalizedPhone);
    }

    const profile = data.session
      ? await fetchProfile(data.user.id, data.user.email)
      : normalizeProfile(
          {
            id: data.user.id,
            email: data.user.email,
            first_name: String(firstName).trim(),
            last_name: String(lastName).trim(),
            phone: normalizedPhone
          },
          data.user.email
        );

    return {
      profile,
      emailConfirmationRequired: !data.session
    };
  }

  async function login({ email, password }) {
    const normalizedEmail = validateCredentials({
      email,
      password,
      requireName: false
    });

    const client = getSupabaseClient();
    console.info("[GPX Auth] signInWithPassword…", { email: normalizedEmail });

    const { data, error } = await client.auth.signInWithPassword({
      email: normalizedEmail,
      password
    });

    if (error) {
      console.error("[GPX Auth] signIn error:", error);
      throw mapAuthError(error);
    }

    console.info("[GPX Auth] signIn OK", { userId: data.user.id });
    return await fetchProfile(data.user.id, data.user.email);
  }

  async function logout() {
    if (!isSupabaseConfigured() || !resolveCreateClient()) {
      return;
    }
    const client = getSupabaseClient();
    const { error } = await client.auth.signOut();
    if (error) {
      console.error("[GPX Auth] signOut error:", error);
      throw mapAuthError(error);
    }
    console.info("[GPX Auth] signOut OK");
  }

  async function getCurrentUser() {
    if (!isSupabaseConfigured() || !resolveCreateClient()) {
      return null;
    }

    try {
      const client = getSupabaseClient();
      const { data, error } = await client.auth.getSession();
      if (error) {
        throw error;
      }
      const session = data?.session;
      if (!session?.user) {
        return null;
      }
      return await fetchProfile(session.user.id, session.user.email);
    } catch (error) {
      console.warn("[GPX Auth] getCurrentUser:", error);
      return null;
    }
  }

  async function isLoggedIn() {
    if (!isSupabaseConfigured() || !resolveCreateClient()) {
      return false;
    }

    try {
      const client = getSupabaseClient();
      const { data, error } = await client.auth.getSession();
      if (error) {
        return false;
      }
      return Boolean(data?.session?.user);
    } catch (error) {
      return false;
    }
  }

  async function getAccessToken() {
    if (!isSupabaseConfigured() || !resolveCreateClient()) {
      return null;
    }

    try {
      const client = getSupabaseClient();
      const { data, error } = await client.auth.getSession();
      if (error) {
        return null;
      }
      return data?.session?.access_token ?? null;
    } catch (error) {
      return null;
    }
  }

  async function updateProfile(userId, patch) {
    const client = getSupabaseClient();
    const dbPatch = {};
    if (patch.freeTrialUsed !== undefined) {
      dbPatch.free_trial_used = patch.freeTrialUsed;
    }
    if (patch.freeTrialKey !== undefined) {
      dbPatch.free_trial_key = patch.freeTrialKey;
    }
    if (patch.subscriptionStatus !== undefined) {
      dbPatch.subscription_status = patch.subscriptionStatus;
    }
    if (patch.subscriptionEndsAt !== undefined) {
      dbPatch.subscription_ends_at = patch.subscriptionEndsAt;
    }

    const { error } = await client.from("profiles").update(dbPatch).eq("id", userId);
    if (error) {
      console.error("[GPX Auth] updateProfile:", error);
      throw new Error(error.message);
    }
    return await fetchProfile(userId);
  }

  async function activateDemoSubscription(userId) {
    const endsAt = new Date();
    endsAt.setMonth(endsAt.getMonth() + 1);

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
    return await fetchProfile(userId);
  }

  function onAuthStateChange(callback) {
    const client = getSupabaseClient();
    return client.auth.onAuthStateChange(callback);
  }

  function getDiagnostics() {
    const { url, anonKey } = getConfig();
    const createClient = resolveCreateClient();
    let clientOk = false;
    let clientError = null;

    if (createClient && isSupabaseConfigured()) {
      try {
        getSupabaseClient();
        clientOk = true;
      } catch (error) {
        clientError = error.message;
      }
    }

    return {
      supabaseJsVersionRecommended: SUPABASE_JS_VERSION,
      configured: isSupabaseConfigured(),
      url,
      keyPrefix: anonKey ? anonKey.slice(0, 15) + "…" : "",
      libraryLoaded: Boolean(window.supabase),
      createClientAvailable: Boolean(createClient),
      clientOk,
      clientError
    };
  }

  window.GPXAuth = {
    isSupabaseConfigured,
    isLocalMode: () => false,
    isLoggedIn,
    getCurrentUser,
    getAccessToken,
    register,
    login,
    logout,
    updateProfile,
    activateDemoSubscription,
    hasActiveSubscription,
    onAuthStateChange,
    getDiagnostics
  };
})();
