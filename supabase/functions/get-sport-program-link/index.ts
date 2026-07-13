import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { corsHeaders } from "../_shared/cors.ts";

const SPORT_PROGRAMS_BUCKET = "sport-programs";
const SIGNED_URL_TTL_SECONDS = 5 * 60;

const ALLOWED_SPORT_PROGRAMS = new Set([
  "initial-debutant.pdf",
  "initial-intermediaire.pdf",
  "initial-avance.pdf",
  "intermediaire-debutant.pdf",
  "intermediaire-intermediaire.pdf",
  "intermediaire-avance.pdf"
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentification requise." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return new Response(JSON.stringify({ error: "Configuration Supabase incomplète." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: authData, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Session invalide. Reconnectez-vous." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const userId = authData.user.id;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("sport_access, sport_program")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("get-sport-program-link profiles:", profileError);
      return new Response(JSON.stringify({ error: "Impossible de lire le profil utilisateur." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!profile?.sport_access) {
      return new Response(JSON.stringify({ error: "Accès non autorisé." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const sportProgram = String(profile.sport_program || "").trim();
    if (!ALLOWED_SPORT_PROGRAMS.has(sportProgram)) {
      return new Response(JSON.stringify({ error: "Accès non autorisé." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
      .from(SPORT_PROGRAMS_BUCKET)
      .createSignedUrl(sportProgram, SIGNED_URL_TTL_SECONDS);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error("get-sport-program-link signedUrl:", signedUrlError);
      return new Response(JSON.stringify({ error: "Impossible de générer le lien de téléchargement." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ url: signedUrlData.signedUrl }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("get-sport-program-link:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur serveur." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
