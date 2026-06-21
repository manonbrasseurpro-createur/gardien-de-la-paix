import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { sujet, questions, reponses } = await req.json();

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) throw new Error("Clé API manquante");

    const prompt = `Tu es un correcteur expert du concours Gardien de la Paix (GPX) de la Police nationale française.

Tu dois corriger la copie d'un candidat pour le sujet suivant :
SUJET : ${sujet}

QUESTIONS ET RÉPONSES DU CANDIDAT :
${questions.map((q: string, i: number) => `Question ${i + 1} : ${q}\nRéponse du candidat : ${reponses[i] || "(pas de réponse)"}`).join("\n\n")}

Donne une correction structurée en JSON avec exactement ce format :
{
  "note": <nombre entre 0 et 20>,
  "appreciation": "<appréciation générale en 2-3 phrases>",
  "points_forts": ["<point fort 1>", "<point fort 2>", "<point fort 3>"],
  "points_ameliorer": ["<point à améliorer 1>", "<point à améliorer 2>", "<point à améliorer 3>"],
  "retour_questions": [
    {"question": 1, "note": <note sur les points de la question>, "commentaire": "<commentaire>"},
    {"question": 2, "note": <note>, "commentaire": "<commentaire>"},
    {"question": 3, "note": <note>, "commentaire": "<commentaire>"},
    {"question": 4, "note": <note>, "commentaire": "<commentaire>"}
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
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data.content[0].text;
    const correction = JSON.parse(text);

    return new Response(JSON.stringify(correction), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
