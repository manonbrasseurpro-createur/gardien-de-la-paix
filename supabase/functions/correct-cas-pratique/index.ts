import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function correctionPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const stored = { ...(value as Record<string, unknown>) };
  delete stored.ai_correction_saved;
  delete stored.error;

  if (!("note" in stored) || !("retour_questions" in stored)) {
    return null;
  }

  return stored;
}

async function saveAiCorrection(
  supabase: { from: (table: string) => any },
  userId: string,
  clientId: unknown,
  correction: Record<string, unknown>
): Promise<boolean> {
  if (typeof clientId !== "string" || !CLIENT_ID_RE.test(clientId)) {
    return false;
  }

  try {
    const { data, error } = await supabase
      .from("exam_sessions")
      .update({ ai_correction: correction })
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .select("id");

    if (error) {
      console.error("saveAiCorrection:", error);
      return false;
    }

    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    console.error("saveAiCorrection:", error);
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authentification requise." }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return jsonResponse({ error: "Session invalide. Reconnectez-vous." }, 401);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("subscription_status, is_complimentary")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError) {
      return jsonResponse({ error: "Impossible de vérifier l'abonnement." }, 500);
    }

    const status = String(profile?.subscription_status ?? "").toLowerCase();
    const canUseAi = profile?.is_complimentary === true || status === "active";

    if (!canUseAi) {
      return jsonResponse(
        {
          error:
            "La correction IA est réservée aux abonnés. Passez à une formule payante pour y accéder.",
        },
        403
      );
    }

    const body = await req.json();

    if (body?.persist_only === true) {
      const stored = correctionPayload(body.correction);
      if (!stored) {
        return jsonResponse({ error: "Correction invalide." }, 400);
      }

      const saved = await saveAiCorrection(supabase, authData.user.id, body.client_id, stored);
      return jsonResponse({ ...stored, ai_correction_saved: saved });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: claimed, error: rateError } = await supabaseAdmin.rpc(
      "claim_ai_correction_slot",
      { p_user_id: authData.user.id }
    );

    if (rateError) {
      console.error("claim_ai_correction_slot:", rateError);
      return jsonResponse({ error: "Impossible de vérifier la limite de fréquence." }, 500);
    }

    if (!claimed) {
      return jsonResponse(
        {
          error: "Merci de patienter quelques instants avant une nouvelle correction.",
        },
        429
      );
    }

    const { sujet, questions, reponses } = body;

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) throw new Error("Clé API manquante");

    const prompt = `Tu es un correcteur expert du concours Gardien de la Paix (GPX) de la Police nationale française.

Sois rigoureux sur les références juridiques citées par le candidat : vérifie que le numéro d'article correspond bien au bon texte de loi pour la situation décrite, et ne confonds jamais un numéro d'alinéa avec un numéro d'article (par exemple, "article 222-13" est un article à part entière, pas un alinéa de l'article 222). Si le candidat cite un article manifestement incorrect pour la situation décrite (mauvais numéro, mauvais code), signale-le clairement dans ta correction plutôt que de l'ignorer ou de le valider implicitement.

Signale toute erreur de procédure où le candidat attribue à un gardien de la paix (APJ) une prérogative réservée à un OPJ, notamment la décision de placement en garde à vue — un APJ rend compte à l'OPJ qui décide, il ne décide pas lui-même.

Base ta correction UNIQUEMENT sur les textes de loi fournis dans le dossier documentaire du cas (SUJET fourni). N'invente jamais de circonstance aggravante, d'article ou de peine qui ne figure pas explicitement dans les documents du dossier — même si tu penses connaître le droit réel, tiens-toi strictement aux textes donnés dans l'énoncé, car ce sont eux qui font foi pour l'exercice.

Barème de sévérité — hors-sujet et absence de fond :
Si une réponse ne contient aucun élément de qualification juridique, aucune action concrète liée au rôle de gardien de la paix, et aucune référence au dossier documentaire (réponse vide, hors-sujet, texte de test, ou phrase sans contenu analysable), attribue 0 à cette question. Si toutes les réponses sont dans ce cas, la note globale doit être 0 (au plus 1/20 seulement si un détail minime réellement utile apparaît). N'accorde jamais une note intermédiaire par défaut. N'invente aucun point fort.

Tu dois corriger la copie d'un candidat pour le sujet suivant :
SUJET : ${sujet}

QUESTIONS ET RÉPONSES DU CANDIDAT :
${questions.map((q: string, i: number) => `Question ${i + 1} : ${q}\nRéponse du candidat : ${reponses[i] || "(pas de réponse)"}`).join("\n\n")}

Donne une correction structurée en JSON avec exactement ce format :

Si la copie ne contient réellement aucun élément positif à souligner, renvoie un tableau "points_forts" VIDE [].
{
  "note": <nombre entre 0 et 20, 0 si aucun fond juridique ni action GPX ni dossier>,
  "appreciation": "<appréciation générale en 2-3 phrases>",
  "points_forts": ["<point fort 1 si et seulement s'il existe réellement>"],
  "points_ameliorer": ["<point à améliorer 1>", "<point à améliorer 2>", "<point à améliorer 3>"],
  "retour_questions": [
${questions.map((_: string, i: number) => `    {"question": ${i + 1}, "note": <note réelle de cette question, 0 si hors-sujet ou vide>, "commentaire": "<commentaire>"}`).join(",\n")}
  ]
}

Réponds UNIQUEMENT avec le JSON, sans texte avant ou après, sans balises markdown.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data.content[0].text;
    let correction;
    try {
      correction = JSON.parse(text);
    } catch {
      return jsonResponse(
        { error: "La correction n'a pas pu être générée correctement, veuillez réessayer." },
        500
      );
    }

    const stored = correctionPayload(correction);
    if (!stored) {
      return jsonResponse(
        { error: "La correction n'a pas pu être générée correctement, veuillez réessayer." },
        500
      );
    }

    const saved = await saveAiCorrection(supabase, authData.user.id, body.client_id, stored);
    return jsonResponse({ ...stored, ai_correction_saved: saved });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
});
