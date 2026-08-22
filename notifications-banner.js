/**
 * Bannières de notifications site (compte connecté).
 * Style aligné sur .gpx-score-bug-notice.
 */
(function (global) {
  const TYPE_META = {
    info: { kicker: "Information" },
    warning: { kicker: "Attention" },
    success: { kicker: "Bonne nouvelle" },
    promo: { kicker: "Offre" }
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function resolveAudience(user) {
    if (user?.isComplimentary === true) return "complimentary";
    const status = String(user?.subscriptionStatus || user?.statutAbonnement || "").toLowerCase();
    if (status === "active") return "subscriber";
    if (status === "trial") return "free";
    return "all";
  }

  function isInDateWindow(notification, now) {
    if (notification.start_date && new Date(notification.start_date) > now) return false;
    if (notification.end_date && new Date(notification.end_date) < now) return false;
    return true;
  }

  function matchesAudience(notification, audience) {
    const target = String(notification.target_audience || "all");
    if (target === "all") return true;
    return target === audience;
  }

  function noticeMarkup(notification, options) {
    const opts = options || {};
    const type = TYPE_META[notification.type] || TYPE_META.info;
    const title = String(notification.title || "").trim();
    const message = String(notification.message || "").trim();
    const dismissible = notification.dismissible !== false;
    const closeBtn = dismissible && !opts.preview
      ? '<button type="button" class="gpx-score-bug-notice__close" data-dismiss-notice aria-label="Fermer">×</button>'
      : "";
    const titleHtml = title
      ? `<h2 class="gpx-site-notice__title">${escapeHtml(title)}</h2>`
      : "";
    return `
      ${closeBtn}
      <p class="gpx-score-bug-notice__kicker">${escapeHtml(type.kicker)}</p>
      ${titleHtml}
      <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
    `;
  }

  function buildNoticeElement(notification) {
    const el = document.createElement("aside");
    const type = notification.type && TYPE_META[notification.type] ? notification.type : "info";
    el.className = `gpx-site-notice gpx-site-notice--${type}`;
    el.dataset.notificationId = notification.id;
    el.setAttribute("role", "status");
    el.innerHTML = noticeMarkup(notification);
    return el;
  }

  function ensureHost() {
    let host = document.getElementById("gpx-site-notices");
    if (host) {
      if (host.parentNode !== document.body) {
        document.body.appendChild(host);
      }
      return host;
    }
    host = document.createElement("div");
    host.id = "gpx-site-notices";
    host.className = "gpx-site-notices";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
    return host;
  }

  function renderPreview(notification, container) {
    if (!container) return;
    const type = notification.type && TYPE_META[notification.type] ? notification.type : "info";
    const preview = document.createElement("aside");
    preview.className = `gpx-site-notice gpx-site-notice--${type}`;
    preview.innerHTML = noticeMarkup(notification, { preview: true });
    container.innerHTML = "";
    if (String(notification.message || "").trim()) {
      container.appendChild(preview);
    }
  }

  async function dismissNotice(notificationId, element) {
    element?.remove();
    const host = document.getElementById("gpx-site-notices");
    if (host && host.children.length === 0) {
      host.remove();
    }

    const client = global.__gpxSupabaseClient;
    const user = await global.GPXAuth?.getCurrentUser?.();
    if (!client || !user?.id || !notificationId) return;

    const { error } = await client.from("notification_dismissals").insert({
      notification_id: notificationId,
      user_id: user.id
    });
    if (error && error.code !== "23505") {
      console.warn("[GPX] notification dismiss:", error);
    }
  }

  async function mount(user) {
    if (!user?.id) return;
    const client = global.__gpxSupabaseClient;
    if (!client) return;

    const now = new Date();
    const audience = resolveAudience(user);

    const [{ data: notifications, error: notifError }, { data: dismissals, error: dismissError }, { data: targets, error: targetError }] =
      await Promise.all([
        client
          .from("site_notifications")
          .select("id, title, message, type, target_audience, active, start_date, end_date, dismissible")
          .eq("active", true)
          .order("created_at", { ascending: false }),
        client
          .from("notification_dismissals")
          .select("notification_id")
          .eq("user_id", user.id),
        client
          .from("notification_targets")
          .select("notification_id")
          .eq("user_id", user.id)
      ]);

    if (notifError) {
      console.warn("[GPX] site notifications:", notifError);
      return;
    }
    if (dismissError) {
      console.warn("[GPX] notification dismissals:", dismissError);
    }
    if (targetError) {
      console.warn("[GPX] notification targets:", targetError);
    }

    const dismissed = new Set((dismissals || []).map((row) => row.notification_id));
    const targeted = new Set((targets || []).map((row) => row.notification_id));
    const visible = (notifications || []).filter((notification) => {
      if (dismissed.has(notification.id)) return false;
      if (!isInDateWindow(notification, now)) return false;
      if (String(notification.target_audience || "") === "users") {
        // Mode ciblage précis : ignore target_audience large, uniquement notification_targets.
        return targeted.has(notification.id) && Boolean(String(notification.message || "").trim());
      }
      if (!matchesAudience(notification, audience)) return false;
      return Boolean(String(notification.message || "").trim());
    });

    if (visible.length === 0) {
      document.getElementById("gpx-site-notices")?.remove();
      return;
    }

    const host = ensureHost();
    host.innerHTML = "";
    visible.forEach((notification) => {
      const el = buildNoticeElement(notification);
      el.querySelectorAll("[data-dismiss-notice]").forEach((button) => {
        button.addEventListener("click", () => dismissNotice(notification.id, el));
      });
      host.appendChild(el);
    });
  }

  global.GPXNotifications = {
    mount,
    renderPreview,
    resolveAudience,
    TYPE_META
  };

  document.addEventListener("DOMContentLoaded", async () => {
    if (!global.GPXAuth?.getCurrentUser) return;
    const user = await global.GPXAuth.getCurrentUser();
    if (user) {
      await mount(user);
    }
  });
})(typeof window !== "undefined" ? window : globalThis);
