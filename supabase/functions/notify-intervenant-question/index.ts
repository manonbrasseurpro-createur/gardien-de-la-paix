import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface IntervenantQuestion {
  id?: string;
  quote_id?: string | null;
  student_name?: string;
  student_email?: string;
  message?: string;
  status?: string;
  created_at?: string;
}

interface WebhookPayload {
  type: string;
  table: string;
  schema: string;
  record: IntervenantQuestion;
  old_record: IntervenantQuestion | null;
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

async function fetchIntervenantContext(quoteId: string | null | undefined): Promise<string> {
  if (!quoteId) {
    return "—";
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.warn("[notify-intervenant-question] Supabase admin non configuré, contexte indisponible.");
    return "—";
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabaseAdmin
    .from("professional_quotes")
    .select("context")
    .eq("id", quoteId)
    .maybeSingle();

  if (error) {
    console.error("[notify-intervenant-question] Erreur lecture professional_quotes:", error.message);
    return "—";
  }

  return data?.context?.trim() || "—";
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
    const brevoKey = Deno.env.get("BREVO_API_KEY");
    if (!brevoKey) {
      throw new Error("BREVO_API_KEY manquante");
    }

    const payload = (await req.json()) as WebhookPayload;

    if (payload.type !== "INSERT" || payload.table !== "intervenant_questions") {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const question = payload.record;
    const studentName = question.student_name?.trim() || "—";
    const studentEmail = question.student_email?.trim() || "—";
    const message = question.message?.trim() || "—";
    const date = formatDate(question.created_at);
    const intervenantPoste = await fetchIntervenantContext(question.quote_id);

    const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<body style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.5; margin: 0; padding: 24px;">
  <h2 style="color: #0B1F3A; margin-top: 0;">Nouvelle question pour un intervenant PrepaGPX</h2>
  <table style="border-collapse: collapse; width: 100%; max-width: 560px;">
    <tr>
      <td style="padding: 8px 12px 8px 0; font-weight: bold; vertical-align: top;">Intervenant (poste)</td>
      <td style="padding: 8px 0;">${escapeHtml(intervenantPoste)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px 8px 0; font-weight: bold; vertical-align: top;">Élève</td>
      <td style="padding: 8px 0;">${escapeHtml(studentName)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px 8px 0; font-weight: bold; vertical-align: top;">Email élève</td>
      <td style="padding: 8px 0;">${escapeHtml(studentEmail)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px 8px 0; font-weight: bold; vertical-align: top;">Date</td>
      <td style="padding: 8px 0;">${escapeHtml(date)}</td>
    </tr>
  </table>
  <p style="font-weight: bold; margin: 20px 0 8px;">Message</p>
  <p style="background: #F6F4EE; padding: 12px 16px; border-radius: 8px; border: 1px solid #e3e1d8; margin: 0; white-space: pre-wrap;">${escapeHtml(message)}</p>
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
          name: "PrepaGPX Intervenants",
          email: "contact@prepagpx.fr",
        },
        to: [{ email: "contact@prepagpx.fr" }],
        subject: "Nouvelle question pour un intervenant PrepaGPX",
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
    console.error("[notify-intervenant-question]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
