(function () {
  const SUPABASE_JS_VERSION = "2.49.8";
  const PROFILS_TABLE = "profiles";
  const TRIAL_DAYS = window.GPX_TRIAL_DAYS || 7;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function parseTimestamp(value) {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function getTrialEndsAt(profile) {
    const start = parseTimestamp(profile?.freeTrialStart);
    if (!start) {
      return null;
    }
    return new Date(start.getTime() + TRIAL_DAYS * MS_PER_DAY);
  }

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

  function normalizeProfile(profil, fallbackEmail) {
    const statutAbonnement = String(profil.subscription_status ?? "trial").toLowerCase();
    const subscriptionEnd = parseTimestamp(
      profil.subscription_end ?? profil.subscription_ends_at ?? profil.subscriptionEndsAt
    );
    const freeTrialStart = parseTimestamp(profil.free_trial_start ?? profil.freeTrialStart);

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
      subscriptionStatus: statutAbonnement,
      statutAbonnement,
      subscriptionPlan: profil.subscription_plan || profil.subscriptionPlan || null,
      subscriptionEnd,
      subscriptionEndsAt: subscriptionEnd,
      freeTrialStart,
      freeTrialUsed: Boolean(profil.free_trial_used ?? profil.freeTrialUsed),
      freeTrialKey: profil.free_trial_key || profil.freeTrialKey || null,
      isComplimentary: Boolean(profil.is_complimentary ?? false)
    };
  }

  function hasActiveSubscription(profile) {
    if (!profile) {
      return false;
    }
    if (profile.isComplimentary === true) {
      return true;
    }

    const status = profile.statutAbonnement || profile.subscriptionStatus;
    const now = Date.now();

    if (status === "active") {
      if (profile.subscriptionEnd) {
        return profile.subscriptionEnd.getTime() > now;
      }
      return true;
    }

    if (status === "trial") {
      const trialEndsAt = getTrialEndsAt(profile);
      return Boolean(trialEndsAt && trialEndsAt.getTime() > now);
    }

    return false;
  }

  function isTrialExpired(profile) {
    if (!profile) {
      return false;
    }
    const status = profile.statutAbonnement || profile.subscriptionStatus;
    if (status !== "trial") {
      return false;
    }
    const trialEndsAt = getTrialEndsAt(profile);
    if (!trialEndsAt) {
      return true;
    }
    return trialEndsAt.getTime() <= Date.now();
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
        subscription_status: "trial",
        free_trial_start: new Date().toISOString(),
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
          first_name: data.first_name || meta.first_name || meta.given_name || (meta.full_name ? meta.full_name.split(" ")[0] : "") || (meta.name ? meta.name.split(" ")[0] : "") || "",
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

  async function ensureTrialProfile(userId) {
    const client = getSupabaseClient();
    const nowIso = new Date().toISOString();
    const { error } = await client
      .from(PROFILS_TABLE)
      .update({
        free_trial_start: nowIso,
        subscription_status: "trial"
      })
      .eq("id", userId)
      .is("free_trial_start", null);

    if (error) {
      console.warn("[GPX Auth] ensureTrialProfile:", error);
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

    let profile;
    if (data.session) {
      await ensureTrialProfile(data.user.id);
      profile = await fetchProfile(data.user.id, data.user.email);
    } else {
      profile = normalizeProfile(
          {
            id: data.user.id,
            first_name: String(firstName).trim(),
            subscription_status: "trial",
            free_trial_start: new Date().toISOString()
          },
          data.user.email
        );
    }

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

  async function loginWithGoogle() {
    const client = getSupabaseClient();
    console.info("[GPX Auth] signInWithOAuth (Google)...");
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/compte.html"
      }
    });
    if (error) {
      console.error("[GPX Auth] Google signIn error:", error);
      throw mapAuthError(error);
    }
  }

  async function submitSatisfactionSurvey({ note, modulesUtilises, contenuRealiste, aidePrincipale, amelioration, recommande, commentaire }) {
    const client = getSupabaseClient();
    const { data: userData } = await client.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) {
      throw new Error("Vous devez être connectée pour envoyer ce formulaire.");
    }
    const { error } = await client
      .from("satisfaction_surveys")
      .insert({
        user_id: userId,
        note,
        modules_utilises: modulesUtilises,
        contenu_realiste: contenuRealiste,
        aide_principale: aidePrincipale,
        amelioration,
        recommande,
        commentaire
      });
    if (error) {
      console.error("[GPX Auth] submitSatisfactionSurvey error:", error);
      throw mapAuthError(error);
    }
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
      dbPatch.subscription_status = patch.subscriptionStatus;
    }
    if (patch.subscriptionPlan !== undefined) {
      dbPatch.subscription_plan = patch.subscriptionPlan;
    }
    if (patch.subscriptionEnd !== undefined) {
      const iso = patch.subscriptionEnd instanceof Date
        ? patch.subscriptionEnd.toISOString()
        : patch.subscriptionEnd;
      dbPatch.subscription_end = iso;
      dbPatch.subscription_ends_at = iso;
    }
    if (patch.freeTrialStart !== undefined) {
      dbPatch.free_trial_start = patch.freeTrialStart instanceof Date
        ? patch.freeTrialStart.toISOString()
        : patch.freeTrialStart;
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
    loginWithGoogle,
    submitSatisfactionSurvey,
    logout,
    updateProfile,
    activateDemoSubscription,
    hasActiveSubscription,
    isTrialExpired,
    getTrialEndsAt,
    onAuthStateChange,
    getDiagnostics
  };
})();
