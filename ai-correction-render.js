(function () {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function hasAiCorrection(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    if (!Object.keys(value).length) {
      return false;
    }
    return value.note != null || Array.isArray(value.retour_questions) || typeof value.appreciation === "string";
  }

  function renderHtml(correction) {
    const note = escapeHtml(correction?.note ?? "");
    const appreciation = escapeHtml(correction?.appreciation ?? "");
    const pointsForts = Array.isArray(correction?.points_forts) ? correction.points_forts : [];
    const pointsAmeliorer = Array.isArray(correction?.points_ameliorer) ? correction.points_ameliorer : [];
    const retour = Array.isArray(correction?.retour_questions) ? correction.retour_questions : [];
    const columns = pointsForts.length > 0 ? "1fr 1fr" : "1fr";

    return `
      <h3 style="color: var(--navy); margin: 0 0 16px; font-family: 'Spectral', serif;">Correction IA — ${note}/20</h3>
      <p style="color: var(--text); margin-bottom: 16px;">${appreciation}</p>
      <div style="display: grid; grid-template-columns: ${columns}; gap: 16px; margin-bottom: 20px;">
        ${pointsForts.length > 0 ? `
        <div style="padding: 16px; background: #f0fdf4; border-radius: 8px; border: 1px solid #86efac;">
          <strong style="color: #166534;">Points forts</strong>
          <ul style="margin: 8px 0 0; padding-left: 16px; color: #166534;">
            ${pointsForts.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
          </ul>
        </div>
        ` : ""}
        <div style="padding: 16px; background: #fff7ed; border-radius: 8px; border: 1px solid #fdba74;">
          <strong style="color: #9a3412;">Points à améliorer</strong>
          <ul style="margin: 8px 0 0; padding-left: 16px; color: #9a3412;">
            ${pointsAmeliorer.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
          </ul>
        </div>
      </div>
      <h4 style="color: var(--navy); margin: 0 0 12px;">Retour par question</h4>
      ${retour.map((item) => `
        <div style="padding: 12px 16px; margin-bottom: 8px; background: white; border-radius: 8px; border: 1px solid var(--border);">
          <strong style="color: var(--navy);">Question ${escapeHtml(item?.question)} — ${escapeHtml(item?.note)} pts</strong>
          <p style="margin: 4px 0 0; color: var(--muted); font-size: 0.93rem;">${escapeHtml(item?.commentaire)}</p>
        </div>
      `).join("")}
      <p style="margin-top: 16px; font-size: 0.8rem; color: var(--muted);">⚠️ Cette correction est générée par IA à titre indicatif. Elle ne reflète pas le jugement officiel du jury GPX.</p>
    `;
  }

  async function loadMap() {
    const map = new Map();
    if (!window.GPXAuth?.getCurrentUser) {
      return map;
    }

    try {
      const user = await window.GPXAuth.getCurrentUser();
      const client = window.__gpxSupabaseClient;
      if (!user?.id || !client) {
        return map;
      }

      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await client
          .from("exam_sessions")
          .select("id, client_id, ai_correction")
          .eq("user_id", user.id)
          .eq("module", "cas-pratique")
          .order("created_at", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) {
          console.warn("[GPX Progression] ai_correction:", error);
          return map;
        }

        const batch = Array.isArray(data) ? data : [];
        batch.forEach((row) => {
          if (!hasAiCorrection(row.ai_correction)) {
            return;
          }
          if (row.client_id) {
            map.set("c:" + row.client_id, row.ai_correction);
          }
          if (row.id) {
            map.set("s:" + row.id, row.ai_correction);
          }
        });

        if (batch.length < pageSize) {
          return map;
        }
      }
    } catch (error) {
      console.warn("[GPX Progression] ai_correction:", error);
    }

    return map;
  }

  window.GpxAiCorrection = {
    hasAiCorrection,
    renderHtml,
    loadMap
  };
})();
