import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { Stripe } from "https://esm.sh/stripe@14?target=deno";
import * as XLSX from "https://esm.sh/xlsx@0.18.5?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

const ADMIN_EMAIL = "manonbrasseurpro@gmail.com";
const PARIS = "Europe/Paris";
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function zoneWallClockMs(timeZone: string, utcMs: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") {
      map[part.type] = Number(part.value);
    }
  }
  if (map.hour === 24) {
    map.hour = 0;
    const shifted = new Date(Date.UTC(map.year, map.month - 1, map.day + 1));
    map.year = shifted.getUTCFullYear();
    map.month = shifted.getUTCMonth() + 1;
    map.day = shifted.getUTCDate();
  }
  return Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
}

function parisMidnightUnix(year: number, month: number): number {
  const desired = Date.UTC(year, month - 1, 1, 0, 0, 0);
  let utc = desired;
  for (let pass = 0; pass < 3; pass += 1) {
    const offset = zoneWallClockMs(PARIS, utc) - utc;
    utc = desired - offset;
  }
  return Math.floor(utc / 1000);
}

function monthBounds(month: string): { gte: number; lt: number } | null {
  const match = MONTH_RE.exec(month);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const gte = parisMidnightUnix(year, monthNumber);
  const lt = parisMidnightUnix(nextYear, nextMonth);
  if (!Number.isFinite(gte) || !Number.isFinite(lt) || lt <= gte) {
    return null;
  }
  return { gte, lt };
}

async function listAll<T extends { id: string }>(
  listPage: (startingAfter?: string) => Promise<{ data: T[]; has_more: boolean }>
): Promise<T[]> {
  const rows: T[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await listPage(startingAfter);
    const batch = page.data ?? [];
    rows.push(...batch);
    if (!page.has_more || batch.length === 0) {
      return rows;
    }
    startingAfter = batch[batch.length - 1].id;
  }
}

function euros(cents: number): number {
  return cents / 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Méthode non autorisée." });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse(401, { error: "Authentification requise." });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse(500, { error: "Configuration Supabase incomplète." });
    }
    if (!stripeSecretKey) {
      return jsonResponse(500, { error: "Configuration Stripe incomplète (STRIPE_SECRET_KEY)." });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !authData.user?.email) {
      return jsonResponse(401, { error: "Session invalide. Reconnectez-vous." });
    }

    const callerEmail = authData.user.email.trim().toLowerCase();
    if (callerEmail !== ADMIN_EMAIL) {
      return jsonResponse(403, { error: "Accès refusé. Cette action est réservée à l'administratrice." });
    }

    let month = "";
    try {
      const body = await req.json();
      month = String(body?.month || "").trim();
    } catch {
      month = "";
    }

    const bounds = monthBounds(month);
    if (!bounds) {
      return jsonResponse(400, { error: "Mois manquant ou mal formé. Attendu : AAAA-MM." });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const invoiceCreatedGte = bounds.gte - 60 * 24 * 60 * 60;
    const invoices = await listAll<Stripe.Invoice>((startingAfter) =>
      stripe.invoices.list({
        status: "paid",
        created: { gte: invoiceCreatedGte, lt: bounds.lt },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
    );

    let invoiceHt = 0;
    let invoiceTax = 0;
    for (const invoice of invoices) {
      const paidAt = invoice.status_transitions?.paid_at;
      if (paidAt == null || paidAt < bounds.gte || paidAt >= bounds.lt) {
        continue;
      }
      invoiceHt += invoice.total_excluding_tax ?? 0;
      invoiceTax += invoice.tax ?? 0;
    }

    const sessions = await listAll<Stripe.Checkout.Session>((startingAfter) =>
      stripe.checkout.sessions.list({
        status: "complete",
        created: { gte: bounds.gte, lt: bounds.lt },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
    );

    let paymentHt = 0;
    let paymentTax = 0;
    for (const session of sessions) {
      if (session.mode !== "payment") {
        continue;
      }
      const tax = session.total_details?.amount_tax ?? 0;
      paymentTax += tax;
      paymentHt += (session.amount_total ?? 0) - tax;
    }

    const totalHt = invoiceHt + paymentHt;
    const totalTax = invoiceTax + paymentTax;
    const rows: Array<Array<string | number>> = [
      ["Catégorie", "HT", "TVA", "TTC"],
      ["Abonnements (factures Stripe)", euros(invoiceHt), euros(invoiceTax), euros(invoiceHt + invoiceTax)],
      ["Paiements uniques (trimestriel / semestriel)", euros(paymentHt), euros(paymentTax), euros(paymentHt + paymentTax)],
      ["Total", euros(totalHt), euros(totalTax), euros(totalHt + totalTax)],
      [],
      ["Remboursements et avoirs non déduits de ce total — aucun remboursement n'a eu lieu à ce jour, à vérifier manuellement dans Stripe si ce n'est plus le cas."],
    ];

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Rapport");
    const written = XLSX.write(book, { type: "array", bookType: "xlsx" });
    const bytes = written instanceof Uint8Array ? written : new Uint8Array(written);
    const filename = `rapport-financier-${month}.xlsx`;

    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("generate-financial-report:", error);
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : "Erreur serveur.",
    });
  }
});
