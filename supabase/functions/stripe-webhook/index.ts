import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

function mapStripeStatus(status: string): string {
  if (status === "active" || status === "trialing") {
    return "active";
  }
  if (status === "past_due") {
    return "past_due";
  }
  return "cancelled";
}

async function updateProfileFromSubscription(
  supabaseAdmin: ReturnType<typeof createClient>,
  stripe: Stripe,
  subscription: Stripe.Subscription,
  userIdHint?: string | null
) {
  const userId =
    userIdHint ||
    subscription.metadata?.user_id ||
    null;

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;

  const endsAt = new Date(subscription.current_period_end * 1000).toISOString();
  const status = mapStripeStatus(subscription.status);

  const patch = {
    subscription_status: status,
    subscription_ends_at: endsAt,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    updated_at: new Date().toISOString()
  };

  if (userId) {
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", userId);
    if (error) {
      throw error;
    }
    return;
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .update(patch)
    .eq("stripe_subscription_id", subscription.id);

  if (error) {
    throw error;
  }
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
        if (session.mode !== "subscription" || !session.subscription) {
          break;
        }

        const userId = session.client_reference_id || session.metadata?.user_id;
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string
        );

        await updateProfileFromSubscription(supabaseAdmin, stripe, subscription, userId);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await updateProfileFromSubscription(
          supabaseAdmin,
          stripe,
          subscription,
          subscription.metadata?.user_id
        );
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.user_id;

        const patch = {
          subscription_status: "cancelled",
          subscription_ends_at: new Date(subscription.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString()
        };

        if (userId) {
          await supabaseAdmin.from("profiles").update(patch).eq("id", userId);
        } else {
          await supabaseAdmin
            .from("profiles")
            .update(patch)
            .eq("stripe_subscription_id", subscription.id);
        }
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
