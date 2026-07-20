import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { Stripe } from "https://esm.sh/stripe@14?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

const SUCCESS_URL =
  "https://prepagpx.fr/confirmation.html?session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://prepagpx.fr/tarifs.html?cancelled=1";

const PLAN_PRICE_IDS: Record<string, string> = {
  monthly: Deno.env.get("STRIPE_PRICE_MONTHLY") || "price_1TvHsSRo8Yl21kLoiekwHVfF",
  quarterly: Deno.env.get("STRIPE_PRICE_QUARTERLY") || "price_1TvHuDRo8Yl21kLoGTA5OZb2",
  biannual: Deno.env.get("STRIPE_PRICE_BIANNUAL") || "price_1TvHvBRo8Yl21kLoSua5O2wj"
};

// "monthly" est un abonnement récurrent ; "quarterly" et "biannual" sont des paiements uniques
const PLAN_MODE: Record<string, "subscription" | "payment"> = {
  monthly: "subscription",
  quarterly: "payment",
  biannual: "payment"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: "Configuration Stripe incomplète (STRIPE_SECRET_KEY)." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const plan = String(body.plan || "quarterly");
    const stripePriceId = PLAN_PRICE_IDS[plan];

    if (!stripePriceId) {
      return new Response(JSON.stringify({ error: "Formule inconnue." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentification requise." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Session invalide. Reconnectez-vous." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const user = authData.user;
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient()
    });

    const session = await stripe.checkout.sessions.create({
      mode: PLAN_MODE[plan] ?? "payment",
      allow_promotion_codes: true,
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      billing_address_collection: "required",
      automatic_tax: { enabled: true },
      line_items: [{ price: stripePriceId, quantity: 1 }],
      metadata: { user_id: user.id, plan },
      ...(PLAN_MODE[plan] === "subscription"
        ? { subscription_data: { metadata: { user_id: user.id, plan } } }
        : { payment_intent_data: { metadata: { user_id: user.id, plan } } }),
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL
    });

    if (!session.url) {
      return new Response(JSON.stringify({ error: "Impossible de créer la session Stripe." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("create-checkout-session:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur serveur." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
