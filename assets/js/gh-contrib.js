/*
 * GitHub katkı grafiği (profil sayfası): son bir yıl + istenen yıl seçilebilir.
 *
 * GitHub'ın kendi API'si katkı takvimini anahtarsız vermiyor (GraphQL ve token
 * gerekiyor). Bu yüzden herkese açık bir yardımcı servis kullanılıyor:
 *   https://github-contributions-api.jogruber.de/v4/<kullanici>?y=all
 * Servis açılmazsa grafik yerine GitHub profiline bağlantı gösterilir; sayfanın
 * geri kalanı etkilenmez. Yanıt localStorage'da 1 saat tutulur.
 *
 * Sözleşme (assets/../_layouts/profile.html):
 *   [data-gh-contrib="kullanici"]   bölümün kökü
 *   [data-gh="contrib-total"]       başlık ("Son bir yılda N katkı")
 *   [data-gh="contrib-graph"]       grafiğin basılacağı yer
 *   [data-gh="contrib-years"]       yıl düğmelerinin basılacağı liste
 *   .contrib-box                    üzerine hover ipucu eklenen kutu
 */
(function () {
  "use strict";

  var TTL = 60 * 60 * 1000;
  var MONTHS = { tr: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"], en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] };

  function language() {
    return document.documentElement.lang === "tr" ? "tr" : "en";
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  var CELL = 10;
  var STEP = 13;
  var LEFT = 28;
  var TOP = 16;

  // ── veri ────────────────────────────────────────────────────

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

  function load(user) {
    var key = "gh:contrib:all:" + user;
    var hit = readCache(key);
    if (hit && Date.now() - hit.t < TTL) return Promise.resolve(hit.v);
    return fetch("https://github-contributions-api.jogruber.de/v4/" + encodeURIComponent(user) + "?y=all")
      .then(function (response) {
        if (!response.ok) throw new Error("contrib " + response.status);
        return response.json();
      })
      .then(function (data) {
        // Yalnızca gereken alanlar saklansın; önbellek küçük kalsın.
        var slim = (data.contributions || []).map(function (d) {
          return [d.date, d.count || 0, d.level || 0];
        });
        writeCache(key, slim);
        return slim;
      })
      .catch(function (error) {
        if (hit) return hit.v; // süresi geçmiş kopya, hiç yoktan iyi
        throw error;
      });
  }

  function toDays(rows) {
    var today = new Date().toISOString().slice(0, 10);
    return rows
      .map(function (r) {
        return { date: r[0], count: r[1], level: r[2] };
      })
      .filter(function (d) {
        return d.date <= today; // henüz yaşanmamış günler çizilmesin
      })
      .sort(function (a, b) {
        return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      });
  }

  // Seçilen takvim yılını 1 Ocak - 31 Aralık olarak döndürür. Henüz yaşanmamış
  // günler `future` işaretli boş hücre olur; böylece devam eden yılda da grafik
  // "Son 1 yıl" gibi kutunun sonuna kadar dolar.
  function fullYear(year, all) {
    var byDate = {};
    all.forEach(function (d) {
      byDate[d.date] = d;
    });
    var out = [];
    for (var t = Date.UTC(+year, 0, 1); t <= Date.UTC(+year, 11, 31); t += 864e5) {
      var key = new Date(t).toISOString().slice(0, 10);
      out.push(byDate[key] || { date: key, count: 0, level: 0, future: true });
    }
    return out;
  }

  // ── çizim ───────────────────────────────────────────────────

  function parseDate(text) {
    var p = text.split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }

  function longDate(date) {
    return date.toLocaleDateString(language() === "tr" ? "tr-TR" : "en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }

  function node(name, attrs) {
    var n = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) {
      n.setAttribute(k, attrs[k]);
    });
    return n;
  }

  function sum(days) {
    return days.reduce(function (total, d) {
      return total + d.count;
    }, 0);
  }

  function buildSvg(days) {
    var offset = parseDate(days[0].date).getUTCDay(); // hafta pazar günü başlar
    // Yıl bitmemişse ya da kısaysa bile grafik hep 53 hafta genişliğinde çizilir;
    // yoksa yıl değiştikçe kutu daralıp genişler ve yıl düğmeleri yana kayar.
    var weeks = Math.max(Math.ceil((days.length + offset) / 7), 53);
    var width = LEFT + weeks * STEP - (STEP - CELL);
    var height = TOP + 7 * STEP - (STEP - CELL);

    var svg = node("svg", {
      width: width,
      height: height,
      viewBox: "0 0 " + width + " " + height,
      role: "img",
      "aria-label": language() === "tr" ? sum(days) + " GitHub katkısı" : sum(days) + " GitHub contributions"
    });

    (language() === "tr" ? [["Pzt", 1], ["Çar", 3], ["Cum", 5]] : [["Mon", 1], ["Wed", 3], ["Fri", 5]]).forEach(function (d) {
      var t = node("text", { x: 0, y: TOP + d[1] * STEP + CELL - 1 });
      t.textContent = d[0];
      svg.appendChild(t);
    });

    var labels = [];
    var lastMonth = -1;
    days.forEach(function (d, i) {
      var pos = i + offset;
      var col = Math.floor(pos / 7);
      var row = pos % 7;
      var date = parseDate(d.date);

      if (date.getUTCMonth() !== lastMonth) {
        lastMonth = date.getUTCMonth();
        labels.push({ col: col, month: lastMonth });
      }

      var attrs = {
        x: LEFT + col * STEP,
        y: TOP + row * STEP,
        width: CELL,
        height: CELL,
        rx: 2,
        class: d.future ? "lv0 is-future" : "lv" + Math.max(0, Math.min(4, d.level))
      };
      if (!d.future) {
        attrs["data-count"] = d.count;
        attrs["data-date"] = d.date;
      }
      svg.appendChild(node("rect", attrs));
    });

    // Ayın ilk (kısmi) haftası bir sonraki ayla çakışıyorsa ilk etiketi at.
    if (labels.length > 1 && labels[1].col - labels[0].col < 3) labels.shift();
    labels.forEach(function (l) {
      var t = node("text", { x: LEFT + l.col * STEP, y: 10 });
      t.textContent = MONTHS[language()][l.month];
      svg.appendChild(t);
    });

    return svg;
  }

  // ── hover ipucu ─────────────────────────────────────────────

  function setupTooltip(box) {
    var tip = document.createElement("div");
    tip.className = "contrib-tip";
    tip.hidden = true;
    box.appendChild(tip);

    function show(cell) {
      var count = +cell.getAttribute("data-count");
      var text = (language() === "tr" ? (count ? count + " katkı" : "Katkı yok") : (count ? count + " contributions" : "No contributions")) + " · " + longDate(parseDate(cell.getAttribute("data-date")));
      tip.textContent = "";
      var strong = document.createElement("strong");
      strong.textContent = language() === "tr" ? (count ? count + " katkı" : "Katkı yok") : (count ? count + " contributions" : "No contributions");
      tip.appendChild(strong);
      tip.appendChild(document.createTextNode(" · " + longDate(parseDate(cell.getAttribute("data-date")))));
      tip.hidden = false;

      var boxRect = box.getBoundingClientRect();
      var cellRect = cell.getBoundingClientRect();
      var x = cellRect.left - boxRect.left + cellRect.width / 2 - tip.offsetWidth / 2;
      x = Math.max(4, Math.min(x, box.clientWidth - tip.offsetWidth - 4));
      tip.style.left = x + "px";
      tip.style.top = cellRect.top - boxRect.top - tip.offsetHeight - 8 + "px";
      cell.setAttribute("aria-label", text);
    }

    function hide() {
      tip.hidden = true;
    }

    box.addEventListener("mouseover", function (e) {
      if (e.target.tagName === "rect" && e.target.hasAttribute("data-date")) show(e.target);
    });
    box.addEventListener("mouseout", function (e) {
      if (e.target.tagName === "rect") hide();
    });
    // Dokunmatik ekranda üzerine gelme yok: dokununca göster, dışına dokununca gizle.
    box.addEventListener("click", function (e) {
      if (e.target.tagName === "rect" && e.target.hasAttribute("data-date")) show(e.target);
      else hide();
    });
    box.addEventListener("scroll", hide, true);
  }

  // ── sayfa ───────────────────────────────────────────────────

  function fail(root, user) {
    var graph = root.querySelector('[data-gh="contrib-graph"]');
    graph.textContent = "";
    var p = document.createElement("p");
    p.className = "contrib-status";
    p.appendChild(document.createTextNode(language() === "tr" ? "Katkı grafiği şu an yüklenemedi. " : "The contribution graph is currently unavailable. "));
    var a = document.createElement("a");
    a.href = "https://github.com/" + user;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = language() === "tr" ? "GitHub profilimde gör →" : "View my GitHub profile →";
    p.appendChild(a);
    graph.appendChild(p);
    var years = root.querySelector('[data-gh="contrib-years"]');
    if (years) years.hidden = true;
  }

  function setup(root, rows) {
    var all = toDays(rows);
    if (!all.length) throw new Error("boş veri");

    var graph = root.querySelector('[data-gh="contrib-graph"]');
    var heading = root.querySelector('[data-gh="contrib-total"]');
    var list = root.querySelector('[data-gh="contrib-years"]');
    var box = root.querySelector(".contrib-box");

    var yearSet = {};
    all.forEach(function (d) {
      yearSet[d.date.slice(0, 4)] = true;
    });
    var years = Object.keys(yearSet).sort().reverse();

    var views = [{ id: "last", days: all.slice(-365) }];
    years.forEach(function (y) {
      views.push({ id: y, days: fullYear(y, all) });
    });

    function select(view) {
      var total = sum(view.days);
      var tr = language() === "tr";
      var n = total.toLocaleString(tr ? "tr-TR" : "en-US");
      if (heading) heading.textContent = tr
        ? (view.id === "last" ? "Son bir yılda " + n + " katkı" : view.id + " yılında " + n + " katkı")
        : (view.id === "last" ? n + " contributions in the last year" : n + " contributions in " + view.id);
      graph.textContent = "";
      graph.appendChild(buildSvg(view.days));
      graph.scrollLeft = graph.scrollWidth; // dar ekranda en güncel haftalar görünsün
      if (list) {
        Array.prototype.forEach.call(list.querySelectorAll("button"), function (b) {
          b.setAttribute("aria-pressed", b.getAttribute("data-view") === view.id ? "true" : "false");
        });
      }
    }

    if (list) {
      list.textContent = "";
      views.forEach(function (view) {
        var li = document.createElement("li");
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = view.id === "last" ? (language() === "tr" ? "Son 1 yıl" : "Last year") : view.id;
        b.setAttribute("data-view", view.id);
        b.addEventListener("click", function () {
          select(view);
        });
        li.appendChild(b);
        list.appendChild(li);
      });
    }

    if (box) setupTooltip(box);
    var current = views[0];
    if (list) {
      list.addEventListener("click", function (event) {
        var button = event.target.closest("button[data-view]");
        if (button) current = views.filter(function (view) { return view.id === button.getAttribute("data-view"); })[0] || current;
      });
    }
    document.addEventListener("languagechange", function () {
      if (list) {
        Array.prototype.forEach.call(list.querySelectorAll("button"), function (button) {
          if (button.getAttribute("data-view") === "last") button.textContent = language() === "tr" ? "Son 1 yıl" : "Last year";
        });
      }
      select(current);
    });
    select(current);
  }

  function init() {
    document.querySelectorAll("[data-gh-contrib]").forEach(function (root) {
      var user = root.getAttribute("data-gh-contrib");
      load(user)
        .then(function (rows) {
          setup(root, rows);
        })
        .catch(function () {
          fail(root, user);
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
