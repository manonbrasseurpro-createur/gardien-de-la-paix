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

async function updateProfileSubscription(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  patch: Record<string, unknown>
) {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update(patch)
    .eq("id", userId);

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

function subscriptionEndsAt(subscription: Stripe.Subscription): string {
  return new Date(subscription.current_period_end * 1000).toISOString();
}

function planEndsAt(plan: string): string | null {
  const PLAN_MONTHS: Record<string, number> = { quarterly: 3, biannual: 6 };
  const months = PLAN_MONTHS[plan];
  if (!months) return null;
  const end = new Date();
  end.setMonth(end.getMonth() + months);
  return end.toISOString();
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

        const userId =
          session.metadata?.user_id ||
          session.client_reference_id ||
          (email ? await findUserIdByEmail(supabaseAdmin, email) : null);

        if (!userId) {
          console.error("checkout.session.completed: utilisateur introuvable");
          break;
        }

        const plan = session.metadata?.plan || null;
        let subscriptionEnd: string | null = null;
        let stripeCustomerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
        let stripeSubscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;

        if (stripeSubscriptionId) {
          // Formule récurrente (monthly) : on lit current_period_end depuis la subscription Stripe
          const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
          subscriptionEnd = subscriptionEndsAt(subscription);
          stripeCustomerId =
            typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer?.id ?? stripeCustomerId;
        } else if (plan) {
          // Paiement unique (quarterly / biannual) : on calcule la date de fin à partir du plan
          subscriptionEnd = planEndsAt(plan);
        }

        await updateProfileSubscription(supabaseAdmin, userId, {
          subscription_status: "active",
          subscription_plan: plan,
          subscription_end: subscriptionEnd,
          subscription_ends_at: subscriptionEnd,
          stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: stripeSubscriptionId
        });
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = await resolveUserIdFromSubscription(supabaseAdmin, stripe, subscription);

        if (!userId) {
          console.error("customer.subscription.updated: utilisateur introuvable");
          break;
        }

        const endsAt = subscriptionEndsAt(subscription);
        const isActive = subscription.status === "active" || subscription.status === "trialing";

        await updateProfileSubscription(supabaseAdmin, userId, {
          subscription_status: isActive ? "active" : "expired",
          subscription_plan: subscription.metadata?.plan || null,
          subscription_end: endsAt,
          subscription_ends_at: endsAt,
          stripe_subscription_id: subscription.id
        });
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = await resolveUserIdFromSubscription(supabaseAdmin, stripe, subscription);

        if (!userId) {
          console.error("customer.subscription.deleted: utilisateur introuvable");
          break;
        }

        await updateProfileSubscription(supabaseAdmin, userId, {
          subscription_status: "expired",
          subscription_end: new Date().toISOString(),
          subscription_ends_at: new Date().toISOString(),
          stripe_subscription_id: null
        });
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
