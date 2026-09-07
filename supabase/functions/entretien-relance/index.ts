import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_MODEL = "claude-sonnet-5";
const NB_QUESTIONS_MAX = 6;

// Banque de questions statique, envoyée à l'IA comme matériau
// d'inspiration (registre, niveau, couverture des catégories) —
// l'IA rédige la question finale, personnalisée ; elle ne pioche
// pas forcément mot pour mot dedans.
const BANQUE_INSPIRATION = {
  motivation: [
    "Pourquoi souhaitez-vous devenir gardien de la paix ?",
    "Quelles sont vos qualités et vos défauts pour ce métier ?",
    "Comment réagissez-vous face à la pression ou au stress ?",
  ],
  mise_en_situation: [
    "Vous êtes en patrouille et un collègue commet une erreur devant un usager. Que faites-vous ?",
    "Un usager se montre agressif verbalement lors d'un contrôle. Comment réagissez-vous ?",
    "On vous demande d'intervenir sur un différend familial. Quelle est votre attitude ?",
  ],
  culture_concours: [
    "Quelles sont, selon vous, les grandes missions du gardien de la paix ?",
    "Quelles qualités déontologiques vous semblent indispensables dans ce métier ?",
  ],
  actualite: [
    "Un sujet d'actualité récent en lien avec la sécurité vous a-t-il marqué ?",
    "Comment la police nationale peut-elle renforcer la confiance avec la population ?",
  ],
};

const SYSTEM_PROMPT = `Tu joues le rôle d'un membre du jury lors de l'entretien oral du concours de gardien de la paix (police nationale française).

RÔLE ET TON
- Tu poses UNE SEULE question à la fois, naturelle et professionnelle, comme le ferait un vrai jury.
- Appuie-toi sur ce que le candidat a déjà dit (CV, présentation, réponses précédentes) pour rebondir dessus — ne pose pas une question déconnectée du contexte.
- Si tu repères une contradiction ou une zone floue entre deux éléments donnés par le candidat, tu peux le pousser à préciser ou à s'expliquer — reste factuel, respectueux et professionnel, jamais agressif, moqueur ou intimidant. Le but est d'évaluer, pas de déstabiliser gratuitement.
- Tu peux t'appuyer sur le profil de personnalité fourni (s'il existe) pour orienter subtilement une question, sans jamais citer de chiffre ou de score au candidat directement.

LIMITES STRICTES
- Ne présente JAMAIS un fait juridique, réglementaire, un coefficient, une procédure ou une statistique comme vrai dans ta question — tu n'es pas une source fiable pour ces informations. Reste sur la motivation, la personnalité, les mises en situation professionnelles, la connaissance générale du métier, ou l'actualité.
- Ne mentionne jamais de nom réel de personne (juré, intervenant, etc.).
- Une seule question, en français, formulée telle qu'un jury la dirait à l'oral.

FORMAT DE RÉPONSE
Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, sans balises markdown :
{"question": "...", "categoryId": "motivation|mise_en_situation|culture_concours|actualite"}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentification requise." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Session invalide. Reconnectez-vous." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("subscription_status, subscription_plan, subscription_end, is_complimentary")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError) {
      return new Response(JSON.stringify({ error: "Impossible de vérifier l'abonnement." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aAcces =
      profile?.is_complimentary === true ||
      (profile?.subscription_plan === "biannual" &&
        String(profile?.subscription_status ?? "").toLowerCase() === "active" &&
        profile?.subscription_end &&
        new Date(profile.subscription_end) > new Date());

    if (!aAcces) {
      return new Response(
        JSON.stringify({ error: "Le simulateur d'entretien est réservé à la formule 6 mois." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: resultatsPersonnalite, error: errPersonnalite } = await supabase
      .from("personality_test_results")
      .select("analyse_text")
      .eq("user_id", authData.user.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (errPersonnalite) {
      return new Response(
        JSON.stringify({ error: "Impossible de vérifier le test de personnalité." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!resultatsPersonnalite || resultatsPersonnalite.length === 0) {
      return new Response(
        JSON.stringify({ error: "Le test de personnalité doit être passé avant l'entretien." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const analyseText = resultatsPersonnalite[0].analyse_text;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: claimed, error: rateError } = await supabaseAdmin.rpc(
      "claim_entretien_ia_slot",
      { p_user_id: authData.user.id }
    );

    if (rateError) {
      console.error("claim_entretien_ia_slot:", rateError);
      return new Response(
        JSON.stringify({ error: "Impossible de vérifier la limite de fréquence." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!claimed) {
      return new Response(
        JSON.stringify({ error: "Merci de patienter quelques secondes avant la question suivante." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { cv, presentation, historique, numeroQuestion } = await req.json();

    const cvTexte = String(cv ?? "").slice(0, 4000);
    const presentationTexte = String(presentation ?? "").slice(0, 4000);
    const historiqueArr = Array.isArray(historique) ? historique.slice(0, NB_QUESTIONS_MAX) : [];
    const numQuestion = Number(numeroQuestion) || 1;

    if (numQuestion < 1 || numQuestion > NB_QUESTIONS_MAX) {
      return new Response(JSON.stringify({ error: "Numéro de question invalide." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const historiqueTexte = historiqueArr.length
      ? historiqueArr
          .map(
            (h: any, i: number) =>
              `Q${i + 1} (${h.categoryId ?? "?"}) : ${h.question}\nRéponse du candidat : ${h.reponse}`
          )
          .join("\n\n")
      : "(aucune question posée pour l'instant — c'est la première question après la présentation)";

    const userPrompt = `CV / parcours du candidat :
${cvTexte || "(non renseigné)"}

Présentation orale donnée en début d'entretien :
${presentationTexte || "(non renseignée)"}

Profil de personnalité (issu du test psychotechnique du candidat) :
${analyseText}

Historique de l'entretien jusqu'ici :
${historiqueTexte}

Exemples de questions par catégorie, pour inspiration de registre (à ne pas recopier telles quelles) :
${JSON.stringify(BANQUE_INSPIRATION)}

C'est la question n°${numQuestion} sur ${NB_QUESTIONS_MAX}. Pose la prochaine question du jury, en rebondissant naturellement sur ce qui précède.`;

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) throw new Error("Clé API manquante");

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const anthropicData = await anthropicRes.json();
    const rawText = (anthropicData.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    let parsed: { question?: string; categoryId?: string } = {};
    try {
      const clean = rawText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      console.error("[entretien-relance] Réponse IA non parsable:", rawText);
    }

    if (!parsed.question) {
      parsed = {
        question: "Pouvez-vous préciser ce point de votre parcours ?",
        categoryId: "motivation",
      };
    }

    return new Response(
      JSON.stringify({ question: parsed.question, categoryId: parsed.categoryId ?? "motivation" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});