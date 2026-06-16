(function () {
  const SUPABASE_JS_VERSION = "2.49.8";
  const PROFILS_TABLE = "profiles";

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

  function mapStatutAbonnement(statut) {
    const value = String(statut || "free").toLowerCase();
    if (value === "active") {
      return "active";
    }
    return "none";
  }

  function normalizeProfile(profil, fallbackEmail) {
    const statutAbonnement = profil.subscription_status ?? "free";

    return {
      id: profil.id,
      email: fallbackEmail || "",
      firstName:
        profil.prénom ||
        profil.prenom ||
        profil.first_name ||
        profil.firstName ||
        "",
      lastName:
        profil["nom de famille"] ||
        profil.nom_de_famille ||
        profil.last_name ||
        profil.lastName ||
        "",
      phone: profil.téléphone || profil.telephone || profil.phone || "",
      subscriptionStatus: mapStatutAbonnement(statutAbonnement),
      statutAbonnement: statutAbonnement,
      subscriptionEndsAt: null,
      freeTrialUsed: Boolean(profil.free_trial_used ?? profil.freeTrialUsed),
      freeTrialKey: profil.free_trial_key || profil.freeTrialKey || null
    };
  }

  function hasActiveSubscription(profile) {
    if (!profile) {
      return false;
    }
    return profile.subscriptionStatus === "active" || profile.statutAbonnement === "active";
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

  function validateCredentials({ firstName, email, password, requireName }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (requireName && !firstName) {
      throw new Error("Le prénom est obligatoire.");
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

  async function saveProfilPhone(userId, phone) {
    const client = getSupabaseClient();
    const { error } = await client
      .from(PROFILS_TABLE)
      .update({ téléphone: phone })
      .eq("id", userId);

    if (error) {
      console.warn("[GPX Auth] profiles.téléphone update:", error);
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
        prénom: meta.first_name || meta.prénom || "",
        "nom de famille": meta.last_name || meta.nom_de_famille || "",
        téléphone: meta.phone || meta.téléphone || "",
        subscription_status: "free",
        free_trial_used: meta.free_trial_used,
        free_trial_key: meta.free_trial_key
      },
      user?.email || fallbackEmail
    );
  }

  async function fetchProfile(userId, fallbackEmail) {
    const client = getSupabaseClient();

    try {
      const { data, error } = await client
        .from(PROFILS_TABLE)
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        console.warn("[GPX Auth] profiles.select error:", error.message, error);
        return await profileFromAuthUser(client, userId, fallbackEmail);
      }

      if (!data) {
        console.warn(
          "[GPX Auth] profiles.select: aucune ligne trouvée pour id =", userId,
          "— vérifiez que la table 'profiles' a une politique RLS autorisant SELECT pour auth.uid() = id"
        );
        return await profileFromAuthUser(client, userId, fallbackEmail);
      }

      console.info("[GPX Auth] profiles row:", { id: data.id, subscription_status: data.subscription_status });

      const { data: userData } = await client.auth.getUser();
      const meta = userData?.user?.user_metadata || {};

      return normalizeProfile(
        {
          ...data,
          first_name: data.first_name || meta.first_name || "",
          last_name: data.last_name || meta.last_name || "",
          free_trial_used: meta.free_trial_used ?? data.free_trial_used,
          free_trial_key: meta.free_trial_key ?? data.free_trial_key
        },
        userData?.user?.email || fallbackEmail
      );
    } catch (error) {
      console.warn("[GPX Auth] fetchProfile exception:", error);
      return await profileFromAuthUser(client, userId, fallbackEmail);
    }
  }

  async function register({ firstName, email, password }) {
    const normalizedEmail = validateCredentials({
      firstName,
      email,
      password,
      requireName: true
    });

    const client = getSupabaseClient();
    console.info("[GPX Auth] signUp…", { email: normalizedEmail });

    const { data, error } = await client.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          first_name: String(firstName).trim()
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

    const profile = data.session
      ? await fetchProfile(data.user.id, data.user.email)
      : normalizeProfile(
          {
            id: data.user.id,
            first_name: String(firstName).trim(),
            subscription_status: "free"
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

    if (patch.freeTrialUsed !== undefined || patch.freeTrialKey !== undefined) {
      const metaPatch = {};
      if (patch.freeTrialUsed !== undefined) {
        metaPatch.free_trial_used = patch.freeTrialUsed;
      }
      if (patch.freeTrialKey !== undefined) {
        metaPatch.free_trial_key = patch.freeTrialKey;
      }

      const { error: metaError } = await client.auth.updateUser({ data: metaPatch });
      if (metaError) {
        console.error("[GPX Auth] updateUser metadata:", metaError);
        throw new Error(metaError.message);
      }
    }

    const dbPatch = {};
    if (patch.subscriptionStatus !== undefined) {
      dbPatch.subscription_status = patch.subscriptionStatus === "active" ? "active" : "free";
    }
    if (patch.phone !== undefined) {
      dbPatch.téléphone = patch.phone;
    }

    if (Object.keys(dbPatch).length > 0) {
      const { error } = await client.from(PROFILS_TABLE).update(dbPatch).eq("id", userId);
      if (error) {
        console.error("[GPX Auth] updateProfile profiles:", error);
        throw new Error(error.message);
      }
    }

    return await fetchProfile(userId);
  }

  async function activateDemoSubscription(userId) {
    const client = getSupabaseClient();
    const { error } = await client
      .from(PROFILS_TABLE)
      .update({ subscription_status: "active" })
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
