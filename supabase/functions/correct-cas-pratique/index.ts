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

Sois rigoureux sur les références juridiques citées par le candidat : vérifie que le numéro d'article correspond bien au bon texte de loi pour la situation décrite, et ne confonds jamais un numéro d'alinéa avec un numéro d'article (par exemple, "article 222-13" est un article à part entière, pas un alinéa de l'article 222). Si le candidat cite un article manifestement incorrect pour la situation décrite (mauvais numéro, mauvais code), signale-le clairement dans ta correction plutôt que de l'ignorer ou de le valider implicitement.

Signale toute erreur de procédure où le candidat attribue à un gardien de la paix (APJ) une prérogative réservée à un OPJ, notamment la décision de placement en garde à vue — un APJ rend compte à l'OPJ qui décide, il ne décide pas lui-même.

Tu dois corriger la copie d'un candidat pour le sujet suivant :
SUJET : ${sujet}

QUESTIONS ET RÉPONSES DU CANDIDAT :
${questions.map((q: string, i: number) => `Question ${i + 1} : ${q}\nRéponse du candidat : ${reponses[i] || "(pas de réponse)"}`).join("\n\n")}

Donne une correction structurée en JSON avec exactement ce format :

Important : si la copie ne contient réellement aucun élément positif à souligner (réponse vide, hors-sujet, ou un seul mot sans rapport), renvoie un tableau "points_forts" VIDE []. N'invente jamais de points forts artificiels. Sois honnête et factuel.
{
  "note": <nombre entre 0 et 20>,
  "appreciation": "<appréciation générale en 2-3 phrases>",
  "points_forts": ["<point fort 1>", "<point fort 2 si pertinent>"],
  "points_ameliorer": ["<point à améliorer 1>", "<point à améliorer 2>", "<point à améliorer 3>"],
  "retour_questions": [
${questions.map((_: string, i: number) => `    {"question": ${i + 1}, "note": <note obtenue sur le barème de cette question (ex: 3 sur 4)>, "commentaire": "<commentaire>"}`).join(",\n")}
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
      return new Response(
        JSON.stringify({ error: "La correction n'a pas pu être générée correctement, veuillez réessayer." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
