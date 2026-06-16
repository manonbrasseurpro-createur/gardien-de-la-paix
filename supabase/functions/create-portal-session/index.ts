import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { Stripe } from "https://esm.sh/stripe@14?target=deno";

const RETURN_URL = "https://gardien-de-la-paix.vercel.app/compte.html";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Méthode non autorisée", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Token manquant." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeSecretKey) {
    return new Response(JSON.stringify({ error: "Configuration Stripe incomplète." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user?.email) {
    return new Response(JSON.stringify({ error: "Utilisateur non authentifié." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient()
  });

  const customers = await stripe.customers.list({ email: user.email, limit: 1 });
  if (customers.data.length === 0) {
    return new Response(JSON.stringify({ error: "Aucun compte Stripe associé à cet e-mail." }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  const customerId = customers.data[0].id;

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: RETURN_URL
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("create-portal-session:", error);
    return new Response(JSON.stringify({ error: "Impossible de créer la session portail Stripe." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
