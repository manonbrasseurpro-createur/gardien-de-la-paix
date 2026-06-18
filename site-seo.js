/**
 * Configuration SEO — renseignez l'URL publique de votre site (sans slash final).
 * Exemple : "https://www.votre-domaine.fr"
 */
window.GPX_SITE_URL = "https://prepagpx.fr";

(function applySeoUrls() {
  if (typeof document === "undefined") return;
  var base = (window.GPX_SITE_URL || "").replace(/\/$/, "");
  if (!base) return;

  var path = window.location.pathname || "/";
  if (path.endsWith("/index.html")) {
    path = path.slice(0, -"/index.html".length) + "/";
  } else if (path === "/index.html") {
    path = "/";
  }
  var url = base + (path === "/" ? "/" : path);

  var link = document.createElement("link");
  link.rel = "canonical";
  link.href = url;
  document.head.appendChild(link);

  var ogUrl = document.querySelector("meta[property='og:url']");
  if (!ogUrl) {
    ogUrl = document.createElement("meta");
    ogUrl.setAttribute("property", "og:url");
    document.head.appendChild(ogUrl);
  }
  ogUrl.content = url;
})();
