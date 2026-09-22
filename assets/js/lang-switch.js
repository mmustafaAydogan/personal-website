/**
 * lang-switch.js
 * Default: English. Toggles EN ↔ TR.
 *
 * How it works:
 *   • [data-tr="..."]      → element whose text swaps (English is the rendered default)
 *   • [data-lang="en/tr"]  → block shown only in that language (hidden attr on TR blocks)
 *   • [data-lang-switch="en/tr"] → toggle buttons
 */
(function () {
  'use strict';
  var KEY = 'lang';
  var DEFAULT = 'en';
  var lang;
  try { lang = localStorage.getItem(KEY) || DEFAULT; } catch (e) { lang = DEFAULT; }

  function apply(l) {
    lang = l;
    document.documentElement.setAttribute('lang', lang);

    // Swap text content on [data-tr] elements
    document.querySelectorAll('[data-tr]').forEach(function (el) {
      if (!el.hasAttribute('data-en')) {
        el.setAttribute('data-en', el.textContent.trim());
      }
      el.textContent = lang === 'tr'
        ? el.getAttribute('data-tr')
        : el.getAttribute('data-en');
    });

    // Show/hide language blocks
    document.querySelectorAll('[data-lang]').forEach(function (el) {
      el.hidden = el.getAttribute('data-lang') !== lang;
    });

    // Mark active button
    document.querySelectorAll('[data-lang-switch]').forEach(function (btn) {
      var active = btn.getAttribute('data-lang-switch') === lang;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });

    document.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: lang } }));
  }

  document.addEventListener('DOMContentLoaded', function () {
    apply(lang);
    document.querySelectorAll('[data-lang-switch]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = btn.getAttribute('data-lang-switch');
        try { localStorage.setItem(KEY, next); } catch (e) {}
        apply(next);
      });
    });
  });
})();
