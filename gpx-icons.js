/**
 * Icônes SVG PrepaGPX — source unique pour toutes les pages.
 * Usage : gpxIcon("target") ou <span data-gpx-icon="target"></span> + gpxMountIcons()
 */
(function (global) {
  const PATHS = {
    clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
    document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h6"></path>',
    bulb: '<path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M12 2a7 7 0 0 0-4 12c.6.6 1 1.5 1 2.4V18h6v-1.6c0-.9.4-1.8 1-2.4A7 7 0 0 0 12 2z"></path>',
    sparkles: '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"></path><path d="M19 14l.7 2.1L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.9L19 14z"></path>',
    star: '<polygon points="12 3 14.5 9.5 21.5 10 16.5 14.5 18.2 21.5 12 17.8 5.8 21.5 7.5 14.5 2.5 10 9.5 9.5"></polygon>',
    "star-solid": '<polygon points="12 3 14.5 9.5 21.5 10 16.5 14.5 18.2 21.5 12 17.8 5.8 21.5 7.5 14.5 2.5 10 9.5 9.5"></polygon>',
    pen: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>',
    target: '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="5"></circle><circle cx="12" cy="12" r="1" fill="currentColor"></circle>',
    "file-pen": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M12 18l4-4-2-2-4 4 .5 1.5L12 18z"></path>',
    help: '<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7v.5"></path><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"></rect><path d="M9 3H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2"></path><path d="M9 12h6M9 16h4"></path>',
    siren: '<path d="M12 4v2"></path><path d="M6 10a6 6 0 0 1 12 0"></path><path d="M5 14h14l-1 6H6l-1-6z"></path><path d="M9 10l-2-2M15 10l2-2"></path>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="3"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a3 3 0 0 1 0 5.74"></path>',
    scales: '<path d="M12 3v18"></path><path d="M5 7h14"></path><path d="M5 7l-3 7h6L5 7z"></path><path d="M19 7l-3 7h6l-3-7z"></path>',
    landmark: '<path d="M4 21h16"></path><path d="M6 21V10l6-4 6 4v11"></path><path d="M9 21v-6h6v6"></path><path d="M9 10h6"></path>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
    ban: '<circle cx="12" cy="12" r="9"></circle><path d="m5.5 5.5 13 13"></path>',
    trophy: '<path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"></path><path d="M5 6H3a3 3 0 0 0 3 5"></path><path d="M19 6h2a3 3 0 0 1-3 5"></path>',
    alert: '<path d="M12 9v4"></path><path d="M12 17h.01"></path><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path>',
    rocket: '<path d="M5 15c1 2 3 4 5 4l5-5c1-4 2-8-1-11-3-3-7-2-11-1L5 15z"></path><path d="M9 15l-2 5 5-2"></path><circle cx="12.5" cy="8.5" r="1.2"></circle>',
    newspaper: '<path d="M4 6h12a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2V6z"></path><path d="M18 8h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2"></path><path d="M8 11h6M8 15h4"></path>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"></path>'
  };

  function gpxIcon(name, opts) {
    opts = opts || {};
    const size = opts.size || 16;
    const filled = Boolean(opts.filled) || name === "star-solid";
    const extraClass = opts.className ? " " + opts.className : "";
    const body = PATHS[name];
    if (!body) {
      return "";
    }
    return (
      '<svg class="gpx-inline-icon' +
      extraClass +
      '" width="' +
      size +
      '" height="' +
      size +
      '" viewBox="0 0 24 24" fill="' +
      (filled ? "currentColor" : "none") +
      '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body +
      "</svg>"
    );
  }

  function gpxMountIcons(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-gpx-icon]").forEach(function (el) {
      const name = el.getAttribute("data-gpx-icon");
      const size = Number(el.getAttribute("data-gpx-size")) || 16;
      const className = el.getAttribute("data-gpx-class") || "";
      const filled = el.getAttribute("data-gpx-filled") === "true";
      el.outerHTML = gpxIcon(name, { size: size, className: className, filled: filled });
    });
  }

  global.gpxIcon = gpxIcon;
  global.gpxMountIcons = gpxMountIcons;
})(typeof window !== "undefined" ? window : globalThis);
