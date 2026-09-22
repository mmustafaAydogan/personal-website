(function () {
  "use strict";

  function setup(root) {
    var viewport = root.querySelector("[data-brand-viewport]");
    if (!viewport) return;

    root.querySelectorAll("[data-brand-image]").forEach(function (image) {
      function loaded() {
        image.closest(".brand-logo-frame").classList.add("has-image");
      }
      function missing() {
        image.closest(".brand-logo-frame").classList.remove("has-image");
      }
      image.addEventListener("load", loaded);
      image.addEventListener("error", missing);
      if (image.complete && image.naturalWidth) loaded();
    });

  }

  document.querySelectorAll("[data-brand-slider]").forEach(setup);
})();
