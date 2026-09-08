import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { GoogleAuth } from "npm:google-auth-library@9";
import { corsHeaders } from "../_shared/cors.ts";

const SITE_URL = "https://prepagpx.fr/"; // doit correspondre EXACTEMENT à la propriété dans Search Console
const DESTINATAIRE_EMAIL = "manonbrasseurpro@gmail.com";
const ANTHROPIC_MODEL = "claude-sonnet-5";

// Liste des robots IA connus à surveiller (best effort côté Cloudflare —
// voir note dans getCloudflareBotStats)
const BOTS_IA = ["GPTBot", "ClaudeBot", "Google-Extended", "PerplexityBot", "CCBot", "Bytespider"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // -----------------------------------------------------------------
    // Sécurité : ce n'est pas un appel utilisateur, mais un déclenchement
    // automatique (Cron). On vérifie un secret partagé plutôt qu'un JWT
    // utilisateur — même principe que notify-problem-report.
    // -----------------------------------------------------------------
    const authHeader = req.headers.get("Authorization") || "";
    const expectedSecret = Deno.env.get("VEILLE_SEO_CRON_SECRET");
    if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
      return new Response(JSON.stringify({ error: "Non autorisé." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // -----------------------------------------------------------------
    // Période : les 7 derniers jours pleins, avec un décalage de 3 jours
    // car Google Search Console a un délai avant de fournir des données
    // fiables (les 1-3 derniers jours sont souvent incomplets).
    // -----------------------------------------------------------------
    const today = new Date();
    const periodEnd = new Date(today);
    periodEnd.setDate(periodEnd.getDate() - 3);
    const periodStart = new Date(periodEnd);
    periodStart.setDate(periodStart.getDate() - 6);

    const previousPeriodEnd = new Date(periodStart);
    previousPeriodEnd.setDate(previousPeriodEnd.getDate() - 1);
    const previousPeriodStart = new Date(previousPeriodEnd);
    previousPeriodStart.setDate(previousPeriodStart.getDate() - 6);

    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    // -----------------------------------------------------------------
    // 1. Données Google Search Console
    // -----------------------------------------------------------------
    const gscData = await getSearchConsoleData(
      fmt(periodStart), fmt(periodEnd),
      fmt(previousPeriodStart), fmt(previousPeriodEnd)
    );

    // -----------------------------------------------------------------
    // 2. Données Cloudflare (robots IA) — best effort
    //
    // Fenêtre indépendante de celle de Google : le plan Cloudflare ne
    // permet de consulter que les ~8 derniers jours (limite découverte
    // au test), donc on reste volontairement plus récent que la période
    // Search Console (qui a elle un décalage de 3 jours pour être fiable).
    // -----------------------------------------------------------------
    const cfPeriodEnd = new Date(today);
    cfPeriodEnd.setDate(cfPeriodEnd.getDate() - 1);
    const cfPeriodStart = new Date(cfPeriodEnd);
    cfPeriodStart.setDate(cfPeriodStart.getDate() - 5);

    let cloudflareData: unknown = null;
    let cloudflareError: string | null = null;
    try {
      cloudflareData = await getCloudflareBotStats(fmt(cfPeriodStart), fmt(cfPeriodEnd));
    } catch (err) {
      cloudflareError = err instanceof Error ? err.message : String(err);
      console.error("[veille-seo-geo] Cloudflare error:", cloudflareError);
    }

    // -----------------------------------------------------------------
    // 3. Résumé généré par l'IA
    // -----------------------------------------------------------------
    const { resume, points_notables } = await genererResume(gscData, cloudflareData, cloudflareError);

    // -----------------------------------------------------------------
    // 4. Enregistrement en base
    // -----------------------------------------------------------------
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("seo_geo_reports")
      .insert({
        period_start: fmt(periodStart),
        period_end: fmt(periodEnd),
        gsc_data: gscData,
        cloudflare_data: cloudflareData,
        cloudflare_error: cloudflareError,
        resume,
        points_notables,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[veille-seo-geo] insert error:", insertError);
    }

    // -----------------------------------------------------------------
    // 5. Envoi de l'email via Brevo
    // -----------------------------------------------------------------
    let emailEnvoye = false;
    try {
      await envoyerEmailBrevo(resume, points_notables, fmt(periodStart), fmt(periodEnd));
      emailEnvoye = true;
    } catch (err) {
      console.error("[veille-seo-geo] email error:", err);
    }

    if (inserted?.id) {
      await supabaseAdmin
        .from("seo_geo_reports")
        .update({ email_envoye: emailEnvoye })
        .eq("id", inserted.id);
    }

    return new Response(JSON.stringify({ ok: true, resume, cloudflareError }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[veille-seo-geo] Erreur inattendue:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// =====================================================================
// Google Search Console
// =====================================================================
async function getSearchConsoleAccessToken() {
  const credentials = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")!);
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse.token) throw new Error("Impossible d'obtenir un token Google.");
  return tokenResponse.token;
}

async function querySearchAnalytics(accessToken: string, startDate: string, endDate: string, dimensions: string[], rowLimit = 10) {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Search Console API error (${res.status}): ${text}`);
  }
  return res.json();
}

async function getSearchConsoleData(startDate: string, endDate: string, prevStartDate: string, prevEndDate: string) {
  const accessToken = await getSearchConsoleAccessToken();

  const [totals, prevTotals, topPages, topQueries] = await Promise.all([
    querySearchAnalytics(accessToken, startDate, endDate, []),
    querySearchAnalytics(accessToken, prevStartDate, prevEndDate, []),
    querySearchAnalytics(accessToken, startDate, endDate, ["page"], 10),
    querySearchAnalytics(accessToken, startDate, endDate, ["query"], 10),
  ]);

  return {
    periode: { startDate, endDate },
    totaux: totals.rows?.[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    totaux_periode_precedente: prevTotals.rows?.[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    pages_les_plus_vues: (topPages.rows ?? []).map((r: any) => ({ page: r.keys[0], clics: r.clicks, impressions: r.impressions })),
    requetes_les_plus_frequentes: (topQueries.rows ?? []).map((r: any) => ({ requete: r.keys[0], clics: r.clicks, impressions: r.impressions, position: r.position })),
  };
}

// =====================================================================
// Cloudflare — statistiques de passage des robots IA
//
// NOTE IMPORTANTE : cette requête GraphQL suppose que le plan Cloudflare
// donne accès aux données de requêtes filtrées par user-agent via
// httpRequestsAdaptiveGroups. Sur un plan gratuit, ce niveau de détail
// n'est pas garanti — si cette fonction échoue, le rapport continue de
// fonctionner uniquement avec les données Google (voir cloudflare_error
// dans la table). À valider ensemble au premier vrai passage.
// =====================================================================
async function getCloudflareBotStats(startDate: string, endDate: string) {
  const token = Deno.env.get("CLOUDFLARE_API_TOKEN")!;
  const zoneId = Deno.env.get("CLOUDFLARE_ZONE_ID")!;

  // La zone Cloudflare limite httpRequestsAdaptiveGroups à 1 jour par
  // requête (confirmé au test) — on boucle donc jour par jour et on
  // additionne les résultats.
  const dates: string[] = [];
  const cursor = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const query = `
    query($zoneTag: string!, $day: Date!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 1000,
            filter: { date_geq: $day, date_leq: $day }
          ) {
            count
            dimensions {
              userAgent
            }
          }
        }
      }
    }
  `;

  const compteurs: Record<string, number> = {};
  BOTS_IA.forEach((bot) => { compteurs[bot] = 0; });

  for (const day of dates) {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { zoneTag: zoneId, day } }),
    });

    if (!res.ok) {
      throw new Error(`Cloudflare API error (${res.status}) pour ${day}: ${await res.text()}`);
    }

    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(`Cloudflare GraphQL error pour ${day}: ${JSON.stringify(json.errors)}`);
    }

    const groups = json.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
    groups.forEach((g: any) => {
      const ua = String(g.dimensions?.userAgent ?? "");
      BOTS_IA.forEach((bot) => {
        if (ua.includes(bot)) {
          compteurs[bot] += g.count ?? 0;
        }
      });
    });
  }

  return { periode: { startDate, endDate }, passages_par_robot: compteurs };
}

// =====================================================================
// Résumé généré par l'IA
// =====================================================================
async function genererResume(gscData: any, cloudflareData: any, cloudflareError: string | null) {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

  const systemPrompt = `Tu prépares un rapport hebdomadaire de veille SEO/GEO pour la fondatrice d'un site de préparation au concours de gardien de la paix (PrepaGPX). Elle est non-technique. Rédige un résumé clair, concret, en français, qui met en avant les changements notables (hausses, baisses, nouvelles pages qui montent, chutes à surveiller). Reste factuel, ne dramatise pas des variations normales, et ne mentionne jamais de statistique que tu n'as pas reçue dans les données. Réponds UNIQUEMENT en JSON valide, sans texte avant/après, sans balises markdown : {"resume": "3-5 phrases de synthèse", "points_notables": ["point 1", "point 2", "..."]}`;

  const userPrompt = `Données Google Search Console (période actuelle vs période précédente) :
${JSON.stringify(gscData, null, 2)}

Données Cloudflare (passages des robots IA) :
${cloudflareError ? "Indisponibles cette semaine (erreur technique : " + cloudflareError + ")" : JSON.stringify(cloudflareData, null, 2)}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[veille-seo-geo] Erreur API Anthropic:", res.status, errText);
    return { resume: "Le résumé automatique n'a pas pu être généré cette semaine (erreur API IA) — voir les données brutes dans le panneau admin.", points_notables: [] };
  }

  const data = await res.json();
  const rawText = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");

  try {
    const clean = rawText.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    console.error("[veille-seo-geo] Résumé IA non parsable:", rawText);
    return { resume: "Le résumé automatique n'a pas pu être généré cette semaine — voir les données brutes dans le panneau admin.", points_notables: [] };
  }
}

// =====================================================================
// Email via Brevo
// =====================================================================
async function envoyerEmailBrevo(resume: string, pointsNotables: string[], startDate: string, endDate: string) {
  const brevoKey = Deno.env.get("BREVO_API_KEY")!;

  const pointsHtml = pointsNotables.length
    ? "<ul>" + pointsNotables.map((p) => `<li>${p}</li>`).join("") + "</ul>"
    : "";

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": brevoKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: "PrepaGPX — Veille SEO/GEO", email: "contact@prepagpx.fr" },
      to: [{ email: DESTINATAIRE_EMAIL }],
      subject: `Veille SEO/GEO — semaine du ${startDate} au ${endDate}`,
      htmlContent: `<p>${resume}</p>${pointsHtml}<p>Détail complet dans le panneau admin.</p>`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Brevo error (${res.status}): ${await res.text()}`);
  }
}