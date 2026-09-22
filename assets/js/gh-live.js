/*
 * Araç sayfalarındaki GitHub verisini tarayıcıda canlı çeker.
 *
 * Sözleşme (şablonlar ile bu dosya arasındaki tek bağ):
 *   [data-gh-repo="sahip/depo"]   bu elemanın altındaki [data-gh="..."] alanları doldurulur
 *   [data-gh="tagline"]           deponun kısa açıklaması
 *   [data-gh="stars"]             ★ 81.649
 *   [data-gh="language"]          Go
 *   [data-gh="license"]           MIT
 *   [data-gh="pushed"]            son güncelleme tarihi
 *   [data-gh="homepage"]          deponun web sitesi (varsa link olur)
 *   [data-gh="readme"]            README, göreli linkleri düzeltilmiş halde
 *
 *   [data-gh-user="kullanici"]    ana sayfadaki profil bölümleri:
 *     [data-gh="repos"|"followers"|"location"]   rozetler
 *     [data-gh="repo-list"]                      son çalışılan depolar (kart olarak basılır)
 *     [data-gh="repo-section"]                   depo listesini saran bölüm; boşsa gizli kalır
 *
 * Sınırlar ve önlemler:
 *   - Kimliksiz GitHub API'si ziyaretçi IP'si başına saatte 60 istek verir.
 *     Yanıtlar localStorage'da 1 saat tutulur; hata olursa eski kopya kullanılır.
 *   - Aynı depo için aynı sayfada tek istek atılır.
 *   - README, GitHub'ın kendi temizlediği HTML olarak gelir; yine de script,
 *     iframe, on* özellikleri gibi şeyler ayıklanır.
 */
(function () {
  "use strict";

  var API = "https://api.github.com/repos/";
  var TTL = 60 * 60 * 1000;
  var inflight = {};

  // ── önbellek + istek ────────────────────────────────────────

  function readCache(key) {
    try {
      var raw = JSON.parse(localStorage.getItem(key));
      return raw && raw.t ? raw : null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value }));
    } catch (e) {
      /* depolama kapalı ya da dolu: önbelleksiz devam */
    }
  }

  function cached(key, url, accept, parse) {
    if (inflight[key]) return inflight[key];
    var hit = readCache(key);
    if (hit && Date.now() - hit.t < TTL) {
      return (inflight[key] = Promise.resolve(hit.v));
    }
    inflight[key] = fetch(url, { headers: { Accept: accept } })
      .then(function (response) {
        if (!response.ok) throw new Error("GitHub " + response.status);
        return parse(response);
      })
      .then(function (value) {
        writeCache(key, value);
        return value;
      })
      .catch(function (error) {
        if (hit) return hit.v; // süresi geçmiş kopya, hiç yoktan iyi
        throw error;
      });
    return inflight[key];
  }

  function fetchRepo(repo) {
    return cached("gh:repo:" + repo, API + repo, "application/vnd.github+json", function (r) {
      return r.json();
    });
  }

  function fetchReadme(repo) {
    return cached("gh:readme:" + repo, API + repo + "/readme", "application/vnd.github.html+json", function (r) {
      return r.text();
    });
  }

  // ── biçimlendirme ───────────────────────────────────────────

  function formatNumber(n) {
    return n.toLocaleString("tr-TR");
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric" });
  }

  function fill(root, name, text) {
    var nodes = root.querySelectorAll('[data-gh="' + name + '"]');
    for (var i = 0; i < nodes.length; i++) {
      if (text) {
        nodes[i].textContent = text;
        nodes[i].hidden = false;
      }
      nodes[i].classList.remove("is-loading");
    }
  }

  // ── README ──────────────────────────────────────────────────

  var ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;

  function resolve(value, base) {
    if (!value || value.charAt(0) === "#" || ABSOLUTE.test(value) || value.indexOf("//") === 0) return value;
    try {
      return new URL(value.replace(/^\//, ""), base).href;
    } catch (e) {
      return value;
    }
  }

  function fixSrcset(value, base) {
    return value
      .split(",")
      .map(function (part) {
        var pieces = part.trim().split(/\s+/);
        pieces[0] = resolve(pieces[0], base);
        return pieces.join(" ");
      })
      .join(", ");
  }

  function renderReadme(html, repo, target) {
    var repoUrl = "https://github.com/" + repo;
    var doc = new DOMParser().parseFromString(html, "text/html");

    doc.querySelectorAll("script,style,iframe,object,embed,form,link,meta,a.anchor").forEach(function (n) {
      n.remove();
    });

    doc.querySelectorAll("*").forEach(function (node) {
      Array.prototype.slice.call(node.attributes).forEach(function (attr) {
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      });
    });

    doc.querySelectorAll("img,source").forEach(function (node) {
      var src = node.getAttribute("src");
      if (src) node.setAttribute("src", resolve(src, repoUrl + "/raw/HEAD/"));
      var srcset = node.getAttribute("srcset");
      if (srcset) node.setAttribute("srcset", fixSrcset(srcset, repoUrl + "/raw/HEAD/"));
      if (node.tagName === "IMG") node.setAttribute("loading", "lazy");
    });

    doc.querySelectorAll("a[href]").forEach(function (link) {
      var href = link.getAttribute("href");
      if (/^javascript:/i.test(href)) {
        link.removeAttribute("href");
        return;
      }
      // "#kurulum" gibi sayfa içi bağlantılar bu sitede değil, GitHub'da anlamlı.
      link.setAttribute("href", href.charAt(0) === "#" ? repoUrl + href : resolve(href, repoUrl + "/blob/HEAD/"));
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    });

    // README'ler koyu/açık mod için ayrı görsel sunabiliyor:
    // <source media="(prefers-color-scheme: dark)">. Bu koşul işletim sistemine
    // bakar, oysa sitenin teması düğmeyle seçiliyor; koşulu site temasına
    // bağlıyoruz (uyan kaynak "all", uymayan "not all" olur).
    doc.querySelectorAll("source[media]").forEach(function (node) {
      var found = /prefers-color-scheme:\s*(dark|light)/i.exec(node.getAttribute("media"));
      if (found) node.setAttribute("data-gh-scheme", found[1].toLowerCase());
    });

    target.textContent = "";
    while (doc.body.firstChild) target.appendChild(doc.body.firstChild);
    applyScheme(target);
  }

  function applyScheme(target) {
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    target.querySelectorAll("source[data-gh-scheme]").forEach(function (node) {
      var wantsDark = node.getAttribute("data-gh-scheme") === "dark";
      node.setAttribute("media", wantsDark === dark ? "all" : "not all");
    });
  }

  // ── README içindekiler ─────────────────────────────────────

  function buildToc(root, target, expand) {
    var nav = root.querySelector(".readme-toc");
    var list = nav && nav.querySelector('[data-gh="readme-toc"]');
    if (!list) return;

    var heads = Array.prototype.slice
      .call(target.querySelectorAll("h1,h2,h3"))
      .filter(function (h) {
        return h.textContent.trim();
      });
    // README'nin en üstteki başlığı genelde projenin adı; listeyi kalabalıklaştırmasın.
    if (heads.length > 1 && heads[0].tagName === "H1") heads.shift();
    heads = heads.slice(0, 30);
    if (heads.length < 3) return;

    var links = [];
    heads.forEach(function (h, i) {
      h.id = "readme-h-" + i;
      var li = el("li", "toc-" + h.tagName.toLowerCase());
      var a = el("a", "", h.textContent.trim());
      a.href = "#" + h.id;
      li.appendChild(a);
      list.appendChild(li);
      links.push(a);
    });
    nav.hidden = false;

    list.addEventListener("click", function (event) {
      var a = event.target.closest && event.target.closest("a");
      if (!a) return;
      event.preventDefault();
      var heading = document.getElementById(a.getAttribute("href").slice(1));
      if (!heading) return;
      goTo(heading);
    });

    // Başlığa atlar. Yavaş (smooth) kaydırma kullanılmıyor: README'deki görseller
    // tembel yüklendiği için kaydırma sırasında yükseklikleri değişiyor ve sayfa
    // hedefi ıskalıyordu. Anlık atlanır, sonra görseller yüklendikçe (üç saniye
    // boyunca) başlık yeniden üste hizalanır. Kullanıcı kendisi kaydırırsa bırakılır.
    function goTo(heading) {
      expand(); // kırpılmış README'de başlık gizli olabilir, önce aç
      var cancelled = false;
      function cancel() {
        cancelled = true;
      }
      ["wheel", "touchstart", "keydown"].forEach(function (name) {
        window.addEventListener(name, cancel, { once: true, passive: true });
      });
      function align() {
        if (!cancelled) heading.scrollIntoView({ behavior: "auto", block: "start" });
      }
      requestAnimationFrame(function () {
        align();
        target.addEventListener("load", align, true); // görsel load olayı kabarcıklanmaz, yakalama şart
        setTimeout(function () {
          target.removeEventListener("load", align, true);
        }, 3000);
      });
    }

    // Görünümde hangi bölümdeysen listede o vurgulanır.
    var ticking = false;
    function mark() {
      ticking = false;
      var current = -1;
      heads.forEach(function (h, i) {
        if (h.getBoundingClientRect().top <= 140) current = i;
      });
      links.forEach(function (a, i) {
        a.classList.toggle("is-active", i === current);
      });
    }
    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(mark);
        }
      },
      { passive: true }
    );
    mark();
  }

  function setupReadme(root, repo) {
    var target = root.querySelector('[data-gh="readme"]');
    if (!target) return;
    target.textContent = language() === "tr" ? "README yükleniyor…" : "Loading README…";
    var section = target.closest(".readme");
    var toggle = section && section.querySelector(".readme-toggle");

    fetchReadme(repo)
      .then(function (html) {
        renderReadme(html, repo, target);
        function expand() {
          if (!section) return;
          section.classList.add("is-expanded");
          if (toggle) {
            toggle.textContent = "Daralt";
            toggle.setAttribute("aria-expanded", "true");
          }
        }
        document.addEventListener("themechange", function () {
          applyScheme(target);
        });
        target.classList.remove("is-loading");
        if (toggle && target.scrollHeight > target.clientHeight + 40) {
          toggle.hidden = false;
          toggle.addEventListener("click", function () {
            var open = section.classList.toggle("is-expanded");
            toggle.textContent = open ? "Daralt" : "Devamını göster";
            toggle.setAttribute("aria-expanded", open ? "true" : "false");
          });
        } else if (section) {
          section.classList.add("is-expanded"); // kısa README: kırpmaya gerek yok
        }
        buildToc(root, target, expand);
      })
      .catch(function () {
        target.classList.remove("is-loading");
        target.innerHTML = "";
        var p = document.createElement("p");
        p.className = "gh-error";
        p.innerHTML =
          'README şu an GitHub\'dan alınamadı. <a href="' + repoUrl(repo) + '" target="_blank" rel="noopener noreferrer">GitHub\'da aç &rarr;</a>';
        target.appendChild(p);
        if (section) section.classList.add("is-expanded");
      });
  }

  function repoUrl(repo) {
    return "https://github.com/" + repo;
  }

  // ── depo bilgisi ────────────────────────────────────────────

  function setupInfo(root, repo) {
    fill(root, "tagline", language() === "tr" ? "GitHub'dan yükleniyor…" : "Loading from GitHub…");
    fetchRepo(repo)
      .then(function (info) {
        fill(root, "tagline", info.description);
        fill(root, "stars", "★ " + formatNumber(info.stargazers_count));
        fill(root, "language", info.language);
        var spdx = info.license && info.license.spdx_id;
        fill(root, "license", spdx && spdx !== "NOASSERTION" ? spdx : (language() === "tr" ? "Lisans yok" : "No license"));
        fill(root, "pushed", info.pushed_at ? formatDate(info.pushed_at) : "");

        var home = root.querySelector('[data-gh="homepage"]');
        if (home && info.homepage) {
          home.href = info.homepage;
          home.target = "_blank";
          home.rel = "noopener noreferrer";
          home.hidden = false;
        }
        // Boş açıklamalı depolarda kart boş kalmasın.
        fill(root, "tagline", info.description ? "" : "Ayrıntılar GitHub sayfasında.");
      })
      .catch(function () {
        fill(root, "tagline", "Ayrıntılar için GitHub sayfasına bak.");
        fill(root, "stars", "");
      });
  }

  // ── kullanıcı profili ───────────────────────────────────────

  function fetchUser(user) {
    return cached("gh:user:" + user, "https://api.github.com/users/" + user, "application/vnd.github+json", function (r) {
      return r.json();
    });
  }

  function fetchUserRepos(user) {
    return cached(
      "gh:userrepos:" + user,
      "https://api.github.com/users/" + user + "/repos?sort=pushed&direction=desc&per_page=20",
      "application/vnd.github+json",
      function (r) {
        return r.json();
      }
    );
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function repoCard(repo, full, internal, projectUrl) {
    var card = el("li", "tool-card");
    var link = el("a", "tool-card-link");
    link.href = internal ? projectUrl + "?repo=" + encodeURIComponent(repo.name) : repo.html_url;
    if (!internal) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }

    var head = el("span", "tool-card-head");
    head.appendChild(el("span", "tool-card-name", full ? repo.full_name : repo.name));
    if (repo.stargazers_count > 0) {
      head.appendChild(el("span", "tool-card-stars", "\u2605 " + formatNumber(repo.stargazers_count)));
    }
    link.appendChild(head);
    link.appendChild(el("span", "tool-card-tagline", repo.description || "Açıklama eklenmemiş."));
    card.appendChild(link);

    var meta = el("ul", "tool-card-meta");
    if (repo.language) meta.appendChild(el("li", "meta-tag meta-category", repo.language));
    if (repo.pushed_at) meta.appendChild(el("li", "meta-tag", formatDate(repo.pushed_at)));
    card.appendChild(meta);
    return card;
  }

  function setupUser(root, user) {
    fetchUser(user)
      .then(function (info) {
        fill(root, "repos", info.public_repos ? info.public_repos + " repo" : "");
        fill(root, "followers", info.followers ? info.followers + " takipçi" : "");
        fill(root, "location", info.location || "");
      })
      .catch(function () {
        /* rozetler hidden kalır */
      });

    var list = root.querySelector('[data-gh="repo-list"]');
    if (!list) return;
    var section = root.matches('[data-gh="repo-section"]') ? root : root.closest('[data-gh="repo-section"]');

    fetchUserRepos(user)
      .then(function (repos) {
        var shown = repos
          .filter(function (r) {
            return !r.fork && !r.archived && r.name.toLowerCase() !== user.toLowerCase();
          })
          .slice(0, 6);
        if (!shown.length) return;
        list.textContent = "";
        shown.forEach(function (r) {
          list.appendChild(repoCard(r, false, true, root.getAttribute("data-project-url")));
        });
        if (section) section.hidden = false;
      })
      .catch(function () {
        /* bölüm gizli kalır */
      });
  }

  // ── yıldızladığım depolar ───────────────────────────────────

  var STAR_PAGES = 3; // 3 x 100 = en son 300 yıldız; kimliksiz istek bütçesini korur
  var STAR_STEP = 24;

  function fetchStarred(user) {
    var pages = [];
    for (var i = 1; i <= STAR_PAGES; i++) {
      pages.push(
        cached(
          "gh:starred:" + user + ":" + i,
          "https://api.github.com/users/" + user + "/starred?per_page=100&page=" + i,
          "application/vnd.github.star+json",
          function (r) {
            return r.json();
          }
        )
      );
    }
    return Promise.all(pages).then(function (all) {
      var out = [];
      all.forEach(function (page) {
        (page || []).forEach(function (item) {
          var repo = item.repo || item;
          repo.starred_at = item.starred_at;
          out.push(repo);
        });
      });
      return out;
    });
  }

  function setupStars(root, user) {
    var list = root.querySelector('[data-gh="star-list"]');
    var status = root.querySelector('[data-gh="star-status"]');
    var search = root.querySelector('[data-gh="star-search"]');
    var lang = root.querySelector('[data-gh="star-lang"]');
    var more = root.querySelector('[data-gh="star-more"]');
    var count = root.querySelector('[data-gh="star-count"]');
    var all = [];
    var matched = [];
    var shown = 0;

    function draw(reset) {
      if (reset) {
        list.textContent = "";
        shown = 0;
      }
      matched.slice(shown, shown + STAR_STEP).forEach(function (r) {
        list.appendChild(repoCard(r, true));
      });
      shown = Math.min(shown + STAR_STEP, matched.length);
      more.hidden = shown >= matched.length;
      status.hidden = matched.length > 0;
      status.textContent = matched.length ? "" : "Eşleşen repo yok.";
      count.textContent = matched.length === all.length ? all.length + " repo" : matched.length + " / " + all.length + " repo";
    }

    function apply() {
      var q = search.value.trim().toLowerCase();
      var l = lang.value;
      matched = all.filter(function (r) {
        if (l && r.language !== l) return false;
        if (!q) return true;
        return (r.full_name + " " + (r.description || "")).toLowerCase().indexOf(q) !== -1;
      });
      draw(true);
    }

    fetchStarred(user)
      .then(function (repos) {
        all = repos;
        var langs = {};
        repos.forEach(function (r) {
          if (r.language) langs[r.language] = (langs[r.language] || 0) + 1;
        });
        Object.keys(langs)
          .sort(function (a, b) {
            return langs[b] - langs[a];
          })
          .forEach(function (name) {
            var o = el("option", "", name + " (" + langs[name] + ")");
            o.value = name;
            lang.appendChild(o);
          });
        root.querySelector('[data-gh="star-tools"]').hidden = false;
        apply();
      })
      .catch(function () {
        status.hidden = false;
        status.classList.remove("is-loading");
        status.innerHTML =
          'Yıldızladığım repolar şu an GitHub\'dan alınamadı. <a href="https://github.com/' + user + '?tab=stars" target="_blank" rel="noopener noreferrer">GitHub\'da aç &rarr;</a>';
      });

    search.addEventListener("input", apply);
    lang.addEventListener("change", apply);
    more.addEventListener("click", function () {
      draw(false);
    });
  }

  function setupProjectPage() {
    document.querySelectorAll("[data-gh-project]").forEach(function (root) {
      var owner = root.getAttribute("data-gh-owner");
      var name = new URLSearchParams(window.location.search).get("repo") || "";
      if (!owner || !/^[A-Za-z0-9._-]+$/.test(name)) {
        root.querySelectorAll(".tool-head,.readme,.tool-facts").forEach(function (node) { node.hidden = true; });
        var error = root.querySelector("[data-project-error]");
        error.hidden = false;
        error.textContent = language() === "tr" ? "Geçerli bir proje seçilmedi." : "No valid project was selected.";
        return;
      }

      var repo = owner + "/" + name;
      var github = repoUrl(repo);
      root.setAttribute("data-gh-repo", repo);
      root.querySelector("[data-project-title]").textContent = name;
      root.querySelector("[data-project-mark]").textContent = name.charAt(0).toUpperCase();
      root.querySelectorAll("[data-project-github]").forEach(function (link) { link.href = github; });
      var repoLabel = root.querySelector("[data-project-repo]");
      if (repoLabel) repoLabel.textContent = repo;
      document.title = name + " | Mustafa Aydoğan";
    });
  }

  function language() {
    return document.documentElement.lang === "tr" ? "tr" : "en";
  }

  function init() {
    setupProjectPage();
    document.querySelectorAll("[data-gh-stars]").forEach(function (root) {
      setupStars(root, root.getAttribute("data-gh-stars"));
    });
    document.querySelectorAll("[data-gh-user]").forEach(function (root) {
      setupUser(root, root.getAttribute("data-gh-user"));
    });
    document.querySelectorAll("[data-gh-repo]").forEach(function (root) {
      var repo = root.getAttribute("data-gh-repo");
      setupInfo(root, repo);
      setupReadme(root, repo);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
