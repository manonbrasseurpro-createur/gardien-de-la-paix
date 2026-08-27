import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { Stripe } from "https://esm.sh/stripe@14?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

const CONFIRMATION_PHRASE = "SUPPRIMER";
const ACTIVE_SUBSCRIPTION_MESSAGE =
  "Vous devez d'abord résilier votre abonnement avant de pouvoir supprimer votre compte. Rendez-vous dans 'Gérer mon abonnement' pour le faire.";

const BLOCKING_STRIPE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused"
]);

type JsonRecord = Record<string, unknown>;

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function stripeStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const candidate = error as { statusCode?: number; status?: number };
  return candidate.statusCode ?? candidate.status;
}

function isBlockingSubscription(subscription: Stripe.Subscription): boolean {
  if (!BLOCKING_STRIPE_STATUSES.has(subscription.status)) {
    return false;
  }
  if (subscription.cancel_at_period_end) {
    return false;
  }
  if (subscription.canceled_at) {
    return false;
  }
  return true;
}

async function retrieveSubscriptionIfExists(
  stripe: Stripe,
  subscriptionId: string
): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    if (stripeStatusCode(error) === 404) {
      return null;
    }
    throw error;
  }
}

async function listSubscriptionsForCustomer(
  stripe: Stripe,
  customerId: string
): Promise<Stripe.Subscription[]> {
  try {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100
    });
    return page.data;
  } catch (error) {
    if (stripeStatusCode(error) === 404) {
      return [];
    }
    throw error;
  }
}

async function collectCustomerIds(
  stripe: Stripe,
  stripeCustomerId: string | null,
  email: string | null
): Promise<string[]> {
  const ids = new Set<string>();
  if (stripeCustomerId) {
    ids.add(stripeCustomerId);
  }

  const normalizedEmail = email?.trim();
  if (normalizedEmail) {
    const customers = await stripe.customers.list({
      email: normalizedEmail,
      limit: 10
    });
    for (const customer of customers.data) {
      if (!customer.deleted) {
        ids.add(customer.id);
      }
    }
  }

  return [...ids];
}

async function hasBlockingStripeSubscription(
  stripe: Stripe,
  profile: {
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
  },
  email: string | null
): Promise<boolean> {
  if (profile.stripe_subscription_id) {
    const named = await retrieveSubscriptionIfExists(stripe, profile.stripe_subscription_id);
    if (named && isBlockingSubscription(named)) {
      return true;
    }
  }

  const customerIds = await collectCustomerIds(
    stripe,
    profile.stripe_customer_id ?? null,
    email
  );

  for (const customerId of customerIds) {
    const subscriptions = await listSubscriptionsForCustomer(stripe, customerId);
    if (subscriptions.some(isBlockingSubscription)) {
      return true;
    }
  }

  return false;
}

async function deleteRows(
  supabaseAdmin: ReturnType<typeof createClient>,
  table: string,
  column: string,
  value: string
) {
  const { error } = await supabaseAdmin.from(table).delete().eq(column, value);
  if (error) {
    throw new Error(`Impossible de supprimer les données (${table}): ${error.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non autorisée." }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authentification requise." }, 401);
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return jsonResponse({ error: "Authentification requise." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return jsonResponse({ error: "Configuration Supabase incomplète." }, 500);
    }
    if (!stripeSecretKey) {
      return jsonResponse({ error: "Configuration Stripe incomplète." }, 500);
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !authData.user?.id) {
      return jsonResponse({ error: "Session invalide. Reconnectez-vous." }, 401);
    }

    const user = authData.user;

    const body = await req.json().catch(() => ({}));
    const requestedUserId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (requestedUserId && requestedUserId !== user.id) {
      return jsonResponse(
        { error: "Vous ne pouvez supprimer que votre propre compte." },
        403
      );
    }

    const action = String(body.action || "check").toLowerCase();
    const confirmation = String(body.confirmation || "").trim();

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, subscription_status, stripe_customer_id, stripe_subscription_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("delete-own-account profiles:", profileError);
      return jsonResponse({ error: "Impossible de vérifier le compte." }, 500);
    }

    if (!profile || profile.id !== user.id) {
      return jsonResponse({ error: "Profil introuvable." }, 404);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient()
    });

    let hasActiveStripeSubscription = false;
    try {
      hasActiveStripeSubscription = await hasBlockingStripeSubscription(
        stripe,
        profile,
        user.email ?? profile.email ?? null
      );
    } catch (error) {
      console.error("delete-own-account stripe:", error);
      return jsonResponse(
        {
          error:
            "Impossible de vérifier l'abonnement Stripe. Réessayez dans quelques instants."
        },
        503
      );
    }

    if (hasActiveStripeSubscription) {
      return jsonResponse(
        {
          canDelete: false,
          code: "active_subscription",
          error: ACTIVE_SUBSCRIPTION_MESSAGE
        },
        409
      );
    }

    if (action !== "delete") {
      return jsonResponse({
        canDelete: true,
        code: "ok"
      });
    }

    if (confirmation !== CONFIRMATION_PHRASE) {
      return jsonResponse(
        {
          canDelete: true,
          code: "confirmation_required",
          error: `Tapez ${CONFIRMATION_PHRASE} pour confirmer la suppression.`
        },
        400
      );
    }

    const userEmail = (user.email || profile.email || "").trim();

    await deleteRows(supabaseAdmin, "problem_reports", "user_id", user.id);
    await deleteRows(supabaseAdmin, "satisfaction_surveys", "user_id", user.id);
    if (userEmail) {
      const { error: reportsEmailError } = await supabaseAdmin
        .from("problem_reports")
        .delete()
        .ilike("email", userEmail);
      if (reportsEmailError) {
        throw new Error(
          `Impossible de supprimer les signalements : ${reportsEmailError.message}`
        );
      }

      const { error: questionsError } = await supabaseAdmin
        .from("intervenant_questions")
        .delete()
        .ilike("student_email", userEmail);
      if (questionsError) {
        throw new Error(
          `Impossible de supprimer les questions : ${questionsError.message}`
        );
      }
    }

    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      console.error("delete-own-account deleteUser:", deleteUserError);
      return jsonResponse(
        { error: "Impossible de supprimer le compte. Réessayez." },
        500
      );
    }

    return jsonResponse({
      ok: true,
      canDelete: true,
      message: "Votre compte a bien été supprimé."
    });
  } catch (error) {
    console.error("delete-own-account:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erreur serveur." },
      500
    );
  }
});
