(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;

  var widgetKey = script.getAttribute("data-widget-key");
  if (!widgetKey) {
    console.error("[cx-widget] missing data-widget-key attribute on the embed <script> tag");
    return;
  }

  var position = script.getAttribute("data-position") === "bottom-left" ? "bottom-left" : "bottom-right";
  var platformOrigin = new URL(script.src, window.location.href).origin;

  var CLOSED_SIZE = { width: "84px", height: "84px" };
  var OPEN_SIZE_DESKTOP = { width: "424px", height: "736px" };

  function mount() {
    var iframe = document.createElement("iframe");
    iframe.src = platformOrigin + "/embed/" + encodeURIComponent(widgetKey);
    iframe.title = "Chat widget";
    iframe.setAttribute("allow", "");
    iframe.style.position = "fixed";
    iframe.style.bottom = "0";
    iframe.style[position === "bottom-left" ? "left" : "right"] = "0";
    iframe.style.border = "none";
    iframe.style.background = "transparent";
    iframe.style.zIndex = "2147483000";
    iframe.style.colorScheme = "normal";
    applySize(iframe, false);

    document.body.appendChild(iframe);

    window.addEventListener("message", function (event) {
      if (event.origin !== platformOrigin) return;
      var data = event.data;
      if (!data || data.source !== "cx-widget" || data.type !== "resize") return;
      applySize(iframe, Boolean(data.open));
    });
  }

  function applySize(iframe, open) {
    var isMobile = window.innerWidth < 640;
    if (!open) {
      iframe.style.width = CLOSED_SIZE.width;
      iframe.style.height = CLOSED_SIZE.height;
      iframe.style.top = "";
      iframe.style.left = position === "bottom-left" ? "0" : "";
      iframe.style.right = position === "bottom-right" ? "0" : "";
    } else if (isMobile) {
      iframe.style.top = "0";
      iframe.style.left = "0";
      iframe.style.right = "0";
      iframe.style.width = "100%";
      iframe.style.height = "100%";
    } else {
      iframe.style.top = "";
      iframe.style.left = position === "bottom-left" ? "0" : "";
      iframe.style.right = position === "bottom-right" ? "0" : "";
      iframe.style.width = OPEN_SIZE_DESKTOP.width;
      iframe.style.height = OPEN_SIZE_DESKTOP.height;
    }
  }

  function checkAudienceThenMount() {
    var path = window.location.pathname;
    var url = platformOrigin + "/api/embed-chat/" + encodeURIComponent(widgetKey) + "/should-mount?path=" + encodeURIComponent(path);
    fetch(url)
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data && data.allowed) mount();
      })
      .catch(function () {
        // Audience-check failure shouldn't hide the widget entirely — fail open, same as "no rules configured."
        mount();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkAudienceThenMount);
  } else {
    checkAudienceThenMount();
  }
})();
