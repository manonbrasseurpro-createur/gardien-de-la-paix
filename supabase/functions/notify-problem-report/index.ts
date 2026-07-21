import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gpx-webhook-secret",
};

interface ProblemReport {
  id?: string;
  user_id?: string | null;
  email?: string | null;
  page_url?: string | null;
  message?: string;
  created_at?: string;
}

interface WebhookPayload {
  type: string;
  table: string;
  schema: string;
  record: ProblemReport;
  old_record: ProblemReport | null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Europe/Paris",
    });
  } catch {
    return iso;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const webhookSecret = Deno.env.get("PROBLEM_REPORT_WEBHOOK_SECRET");
    if (!webhookSecret) {
      return new Response(JSON.stringify({ error: "Configuration webhook incomplète" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const headerSecret = (req.headers.get("x-gpx-webhook-secret") || "").trim();
    const provided = bearer || headerSecret;

    if (!provided || provided !== webhookSecret) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brevoKey = Deno.env.get("BREVO_API_KEY");
    if (!brevoKey) {
      throw new Error("BREVO_API_KEY manquante");
    }

    const payload = (await req.json()) as WebhookPayload;

    if (payload.type !== "INSERT" || payload.table !== "problem_reports") {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const report = payload.record;
    const userEmail = report.email || "Anonyme";
    const pageUrl = report.page_url || "—";
    const message = report.message || "—";
    const date = formatDate(report.created_at);

    const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<body style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.5; margin: 0; padding: 24px;">
  <h2 style="color: #0f172a; margin-top: 0;">🚨 Nouveau signalement PrepaGPX</h2>
  <table style="border-collapse: collapse; width: 100%; max-width: 560px;">
    <tr>
      <td style="padding: 8px 12px 8px 0; font-weight: bold; vertical-align: top;">Email utilisateur</td>
      <td style="padding: 8px 0;">${escapeHtml(userEmail)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px 8px 0; font-weight: bold; vertical-align: top;">Page concernée</td>
      <td style="padding: 8px 0;">${escapeHtml(pageUrl)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px 8px 0; font-weight: bold; vertical-align: top;">Date</td>
      <td style="padding: 8px 0;">${escapeHtml(date)}</td>
    </tr>
  </table>
  <p style="font-weight: bold; margin: 20px 0 8px;">Message</p>
  <p style="background: #f8fafc; padding: 12px 16px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 0; white-space: pre-wrap;">${escapeHtml(message)}</p>
</body>
</html>`.trim();

    const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": brevoKey,
      },
      body: JSON.stringify({
        sender: {
          name: "PrepaGPX Alertes",
          email: "contact@prepagpx.fr",
        },
        to: [{ email: "contact@prepagpx.fr" }],
        subject: "🚨 Nouveau signalement PrepaGPX",
        htmlContent,
      }),
    });

    if (!brevoResponse.ok) {
      const errText = await brevoResponse.text();
      throw new Error(`Brevo API error (${brevoResponse.status}): ${errText}`);
    }

    const brevoData = await brevoResponse.json();

    return new Response(JSON.stringify({ ok: true, messageId: brevoData.messageId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[notify-problem-report]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
