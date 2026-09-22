/*
 * Tema düğmesi: açık <-> koyu (düğme _includes/header.html'de).
 * İlk tema, sayfa çizilmeden önce _includes/head.html içindeki küçük script
 * tarafından <html data-theme="..."> olarak ayarlanır; bu dosya yalnızca
 * düğmeyi bağlar, seçimi localStorage'a yazar ve "themechange" olayı yayar
 * (README görselleri buna göre açık/koyu sürüme geçer).
 */
(function () {
  "use strict";

  var root = document.documentElement;

  function current() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function label(button) {
    var dark = current() === "dark";
    button.textContent = dark ? "\u2600" : "\u263E"; // güneş / ay
    button.setAttribute("aria-label", dark ? "Açık temaya geç" : "Koyu temaya geç");
    button.title = dark ? "Açık tema" : "Koyu tema";
  }

  function init() {
    // Düğme _includes/header.html'de duruyor; burada yalnızca bağlanıyor.
    var button = document.querySelector(".theme-toggle");
    if (!button) return;
    label(button);

    button.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
      } catch (e) {
        /* depolama kapalı: bu sayfa için geçerli, hatırlanmaz */
      }
      label(button);
      document.dispatchEvent(new CustomEvent("themechange"));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
