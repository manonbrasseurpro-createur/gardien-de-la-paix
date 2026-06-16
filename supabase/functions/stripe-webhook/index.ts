import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { Stripe } from "https://esm.sh/stripe@14?target=deno";

async function findUserIdByEmail(
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string
): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });

  if (error) {
    throw error;
  }

  const user = data.users.find(
    (entry) => entry.email?.trim().toLowerCase() === normalizedEmail
  );

  return user?.id ?? null;
}

async function updateProfilStatut(
  supabaseAdmin: ReturnType<typeof createClient>,
  identifiant: string,
  statutAbonnement: string
) {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ subscription_status: statutAbonnement })
    .eq("id", identifiant);

  if (error) {
    throw error;
  }
}

async function resolveUserIdFromSubscription(
  supabaseAdmin: ReturnType<typeof createClient>,
  stripe: Stripe,
  subscription: Stripe.Subscription
): Promise<string | null> {
  if (subscription.metadata?.user_id) {
    return subscription.metadata.user_id;
  }

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  if (!customerId) {
    return null;
  }

  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted || !("email" in customer) || !customer.email) {
    return null;
  }

  return await findUserIdByEmail(supabaseAdmin, customer.email);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Méthode non autorisée", { status: 405 });
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!stripeSecretKey || !webhookSecret) {
    return new Response("Configuration webhook incomplète", { status: 500 });
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient()
  });

  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  if (!signature) {
    return new Response("Signature manquante", { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (error) {
    console.error("Webhook signature:", error);
    return new Response("Signature invalide", { status: 400 });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const email =
          session.customer_email ||
          session.customer_details?.email ||
          null;

        if (!email) {
          console.error("checkout.session.completed: e-mail client introuvable");
          break;
        }

        const userId =
          (await findUserIdByEmail(supabaseAdmin, email)) ||
          session.client_reference_id ||
          session.metadata?.user_id ||
          null;

        if (!userId) {
          console.error("checkout.session.completed: utilisateur introuvable pour", email);
          break;
        }

        await updateProfilStatut(supabaseAdmin, userId, "active");
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = await resolveUserIdFromSubscription(supabaseAdmin, stripe, subscription);

        if (!userId) {
          console.error("customer.subscription.deleted: utilisateur introuvable");
          break;
        }

        await updateProfilStatut(supabaseAdmin, userId, "free");
        break;
      }

      default:
        break;
    }
  } catch (error) {
    console.error("stripe-webhook handler:", error);
    return new Response("Erreur traitement webhook", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
});
