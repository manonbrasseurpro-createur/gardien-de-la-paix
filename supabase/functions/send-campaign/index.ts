import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { corsHeaders } from "../_shared/cors.ts";

const ADMIN_EMAIL = "manonbrasseurpro@gmail.com";
const SENDER = { name: "PrepaGPX", email: "contact@prepagpx.fr" };
const BREVO_API = "https://api.brevo.com/v3";
const MAX_RECIPIENTS = 1000;
const MAX_HTML_BYTES = 100_000;
const CONTACT_CHUNK_SIZE = 8;
const LIST_ADD_CHUNK_SIZE = 150;
const RATE_LIMIT_SECONDS = 20;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAMPAIGN_FOLDER_NAME = "PrepaGPX Campagnes";

let inFlight = false;
let lastAcceptedAt = 0;

interface RecipientInput {
  email?: string;
  firstName?: string;
  first_name?: string;
}

interface NormalizedRecipient {
  email: string;
  firstName: string;
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseBrevoError(status: number, text: string, step: string): string {
  let detail = text.trim();
  try {
    const parsed = JSON.parse(text);
    detail = parsed.message || parsed.error || parsed.code || detail;
  } catch {
    // keep raw text
  }
  if (!detail) detail = `HTTP ${status}`;
  return `${step} : ${detail}`;
}

async function brevoRequest(
  apiKey: string,
  method: string,
  path: string,
  step: string,
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${BREVO_API}${path}`, {
    method,
    headers: {
      "api-key": apiKey,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(parseBrevoError(response.status, text, step));
  }

  return { status: response.status, data };
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function campaignStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    (parts.find((part) => part.type === type)?.value || "").replace(/\D/g, "");

  return `${get("year")}-${get("month")}-${get("day")}_${get("hour")}h${get("minute")}`;
}

function wrapHtmlContent(htmlContent: string): string {
  const trimmed = htmlContent.trim();
  const hasUnsubscribe = /\{\{\s*unsubscribe\s*\}\}/i.test(trimmed);
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(trimmed);
  const inner = looksLikeHtml
    ? trimmed
    : trimmed
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");

  const footer = hasUnsubscribe
    ? ""
    : `
  <p style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280;">
    Vous recevez cet email car vous êtes inscrit(e) sur PrepaGPX.
    <a href="{{ unsubscribe }}" style="color:#0b1f3a;">Se désinscrire</a>
  </p>`;

  if (/<html[\s>]/i.test(inner)) {
    if (hasUnsubscribe) return inner;
    if (/<\/body>/i.test(inner)) return inner.replace(/<\/body>/i, `${footer}</body>`);
    if (/<\/html>/i.test(inner)) return inner.replace(/<\/html>/i, `${footer}</html>`);
    return inner + footer;
  }

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.6;margin:0;padding:24px;">
  ${inner}
  ${footer}
</body>
</html>`;
}

function parseRecipients(body: Record<string, unknown>): RecipientInput[] {
  if (Array.isArray(body.recipients)) return body.recipients as RecipientInput[];
  if (Array.isArray(body.emails)) {
    return (body.emails as unknown[]).map((email) => ({ email: String(email) }));
  }
  return [];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}

function folderNameOf(folder: unknown): string {
  if (!folder || typeof folder !== "object") return "";
  return String((folder as { name?: unknown }).name || "").trim();
}

function folderIdOf(folder: unknown): number {
  if (!folder || typeof folder !== "object") return NaN;
  return Number((folder as { id?: unknown }).id);
}

async function ensureCampaignFolderId(apiKey: string): Promise<number> {
  const pageSize = 50;
  let offset = 0;

  while (true) {
    const { data } = await brevoRequest(
      apiKey,
      "GET",
      `/contacts/folders?limit=${pageSize}&offset=${offset}`,
      "Lecture des dossiers Brevo",
    );
    const folders = Array.isArray(data.folders) ? data.folders : [];
    const existing = folders.find((folder) => folderNameOf(folder) === CAMPAIGN_FOLDER_NAME);
    if (existing) {
      const id = folderIdOf(existing);
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error("Lecture des dossiers Brevo : identifiant de dossier invalide.");
      }
      return id;
    }
    if (folders.length < pageSize) break;
    offset += pageSize;
  }

  const created = await brevoRequest(
    apiKey,
    "POST",
    "/contacts/folders",
    "Création du dossier Brevo",
    { name: CAMPAIGN_FOLDER_NAME },
  );
  const id = Number(created.data.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Création du dossier Brevo : identifiant de dossier manquant.");
  }
  return id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Méthode non autorisée." });
  }

  let campaignRowId: string | null = null;
  let supabaseAdmin: ReturnType<typeof createClient> | null = null;

  try {
    const now = Date.now();
    if (inFlight || now - lastAcceptedAt < RATE_LIMIT_SECONDS * 1000) {
      return jsonResponse(429, {
        error: `Un envoi est déjà en cours ou vient d'être lancé. Patientez ${RATE_LIMIT_SECONDS} secondes.`,
      });
    }
    inFlight = true;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      inFlight = false;
      return jsonResponse(401, { error: "Authentification requise." });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const brevoKey = Deno.env.get("BREVO_CAMPAIGN_API_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      inFlight = false;
      return jsonResponse(500, { error: "Configuration Supabase incomplète." });
    }
    if (!brevoKey) {
      inFlight = false;
      return jsonResponse(500, { error: "Clé API campagnes Brevo manquante (BREVO_CAMPAIGN_API_KEY)." });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !authData.user?.email) {
      inFlight = false;
      return jsonResponse(401, { error: "Session invalide. Reconnectez-vous." });
    }

    const callerEmail = authData.user.email.trim().toLowerCase();
    if (callerEmail !== ADMIN_EMAIL) {
      inFlight = false;
      return jsonResponse(403, { error: "Accès refusé. Cette action est réservée à l'administratrice." });
    }

    const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const subject = String(payload.subject || "").trim();
    const rawHtml = String(payload.htmlContent || payload.body || payload.html || "").trim();
    const rawRecipients = parseRecipients(payload);

    if (!subject) {
      inFlight = false;
      return jsonResponse(400, { error: "L'objet de la campagne est obligatoire." });
    }
    if (!rawHtml) {
      inFlight = false;
      return jsonResponse(400, { error: "Le corps du message est obligatoire." });
    }
    if (new TextEncoder().encode(rawHtml).length > MAX_HTML_BYTES) {
      inFlight = false;
      return jsonResponse(400, { error: "Le corps du message est trop volumineux (100 Ko max)." });
    }
    if (rawRecipients.length === 0) {
      inFlight = false;
      return jsonResponse(400, { error: "Sélectionnez au moins un destinataire." });
    }

    const seen = new Set<string>();
    const incoming: NormalizedRecipient[] = [];
    for (const item of rawRecipients) {
      const email = normalizeEmail(typeof item === "string" ? item : item?.email);
      if (!email || seen.has(email)) continue;
      if (!EMAIL_RE.test(email)) {
        inFlight = false;
        return jsonResponse(400, { error: `Adresse email invalide : ${email}` });
      }
      seen.add(email);
      incoming.push({
        email,
        firstName: String(item?.firstName || item?.first_name || "").trim(),
      });
    }

    if (incoming.length === 0) {
      inFlight = false;
      return jsonResponse(400, { error: "Sélectionnez au moins un destinataire." });
    }
    if (incoming.length > MAX_RECIPIENTS) {
      inFlight = false;
      return jsonResponse(400, {
        error: `Trop de destinataires (${incoming.length}). Maximum : ${MAX_RECIPIENTS}.`,
      });
    }

    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: recent } = await supabaseAdmin
      .from("email_campaigns")
      .select("sent_at, status")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent?.sent_at) {
      const elapsed = (Date.now() - new Date(recent.sent_at).getTime()) / 1000;
      if (elapsed < RATE_LIMIT_SECONDS && recent.status !== "failed") {
        inFlight = false;
        return jsonResponse(429, {
          error: `Un envoi vient d'être effectué. Patientez ${RATE_LIMIT_SECONDS} secondes avant une nouvelle campagne.`,
        });
      }
    }

    const emails = incoming.map((r) => r.email);
    const profiles: { email: string | null; first_name: string | null }[] = [];
    for (let i = 0; i < emails.length; i += 80) {
      const chunk = emails.slice(i, i + 80);
      const { data, error: profilesError } = await supabaseAdmin
        .from("profiles")
        .select("email, first_name")
        .in("email", chunk);
      if (profilesError) {
        inFlight = false;
        return jsonResponse(500, {
          error: `Impossible de vérifier les destinataires : ${profilesError.message}`,
        });
      }
      profiles.push(...(data || []));
    }

    const profileByEmail = new Map(
      profiles.map((p) => [normalizeEmail(p.email), String(p.first_name || "").trim()]),
    );
    const unknown = emails.filter((email) => !profileByEmail.has(email));
    if (unknown.length > 0) {
      inFlight = false;
      const preview = unknown.slice(0, 5).join(", ");
      return jsonResponse(400, {
        error: `Destinataires inconnus dans PrepaGPX (${unknown.length}) : ${preview}${unknown.length > 5 ? "…" : ""}`,
      });
    }

    const recipients: NormalizedRecipient[] = incoming.map((r) => ({
      email: r.email,
      firstName: r.firstName || profileByEmail.get(r.email) || "",
    }));

    const stamp = campaignStamp();
    const listName = `Campagne_${stamp}`;
    const campaignName = `PrepaGPX_${stamp}`;
    const htmlContent = wrapHtmlContent(rawHtml);

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("email_campaigns")
      .insert({
        sent_by: authData.user.id,
        subject,
        recipient_count: recipients.length,
        status: "sending",
      })
      .select("id")
      .single();

    if (insertError || !inserted?.id) {
      inFlight = false;
      return jsonResponse(500, {
        error: `Impossible d'enregistrer la campagne : ${insertError?.message || "erreur inconnue"}`,
      });
    }

    campaignRowId = inserted.id;
    lastAcceptedAt = Date.now();

    async function upsertBrevoContact(
      recipient: NormalizedRecipient,
      firstNameAttr: "PRENOM" | "FIRSTNAME" | null,
    ) {
      const body: Record<string, unknown> = {
        email: recipient.email,
        updateEnabled: true,
      };
      if (recipient.firstName && firstNameAttr) {
        body.attributes = { [firstNameAttr]: recipient.firstName };
      }
      await brevoRequest(brevoKey, "POST", "/contacts", `Contact ${recipient.email}`, body);
    }

    const namedProbe = recipients.find((recipient) => recipient.firstName) || recipients[0];
    if (!namedProbe) {
      throw new Error("Aucun destinataire valide.");
    }
    let firstNameAttr: "PRENOM" | "FIRSTNAME" | null = namedProbe.firstName ? "PRENOM" : null;
    try {
      await upsertBrevoContact(namedProbe, firstNameAttr);
    } catch (prenomError) {
      if (!namedProbe.firstName) throw prenomError;
      try {
        await upsertBrevoContact(namedProbe, "FIRSTNAME");
        firstNameAttr = "FIRSTNAME";
      } catch {
        await upsertBrevoContact(namedProbe, null);
        firstNameAttr = null;
      }
    }

    const contactFailures: string[] = [];
    await mapWithConcurrency(
      recipients.filter((recipient) => recipient.email !== namedProbe.email),
      CONTACT_CHUNK_SIZE,
      async (recipient) => {
        try {
          await upsertBrevoContact(recipient, recipient.firstName ? firstNameAttr : null);
        } catch (error) {
          contactFailures.push(error instanceof Error ? error.message : String(error));
        }
      },
    );

    if (contactFailures.length > 0) {
      throw new Error(
        `Échec de synchronisation de ${contactFailures.length} contact(s) Brevo. ${contactFailures[0]}`,
      );
    }

    const folderId = await ensureCampaignFolderId(brevoKey);

    let listRes;
    try {
      listRes = await brevoRequest(brevoKey, "POST", "/contacts/lists", "Création de la liste Brevo", {
        name: listName,
        folderId,
      });
    } catch {
      listRes = await brevoRequest(brevoKey, "POST", "/contacts/lists", "Création de la liste Brevo", {
        name: `${listName}_${Date.now().toString().slice(-4)}`,
        folderId,
      });
    }
    const listId = Number(listRes.data.id);
    if (!Number.isFinite(listId) || listId <= 0) {
      throw new Error("Création de la liste Brevo : identifiant de liste manquant.");
    }

    for (let i = 0; i < emails.length; i += LIST_ADD_CHUNK_SIZE) {
      const chunk = emails.slice(i, i + LIST_ADD_CHUNK_SIZE);
      await brevoRequest(
        brevoKey,
        "POST",
        `/contacts/lists/${listId}/contacts/add`,
        "Ajout des contacts à la liste Brevo",
        { emails: chunk },
      );
    }

    const campaignRes = await brevoRequest(brevoKey, "POST", "/emailCampaigns", "Création de la campagne Brevo", {
      name: campaignName,
      subject,
      sender: SENDER,
      htmlContent,
      recipients: { listIds: [listId] },
    });
    const campaignId = Number(campaignRes.data.id);
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      throw new Error("Création de la campagne Brevo : identifiant de campagne manquant.");
    }

    await supabaseAdmin
      .from("email_campaigns")
      .update({ brevo_campaign_id: campaignId })
      .eq("id", campaignRowId);

    await brevoRequest(
      brevoKey,
      "POST",
      `/emailCampaigns/${campaignId}/sendNow`,
      "Lancement de l'envoi Brevo",
    );

    await supabaseAdmin
      .from("email_campaigns")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", campaignRowId);

    inFlight = false;
    return jsonResponse(200, {
      ok: true,
      message: `Campagne envoyée à ${recipients.length} destinataire${recipients.length > 1 ? "s" : ""}.`,
      campaignId: campaignRowId,
      brevoCampaignId: campaignId,
      brevoListId: listId,
      recipientCount: recipients.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur serveur inattendue.";
    console.error("[send-campaign]", message);

    if (supabaseAdmin && campaignRowId) {
      await supabaseAdmin
        .from("email_campaigns")
        .update({ status: "failed" })
        .eq("id", campaignRowId);
    }

    inFlight = false;
    return jsonResponse(500, { error: message });
  }
});
