/* 공개 사이트 동작 (화면 개선 설계 §4). 순수 함수는 Node 테스트용으로 내보내고, 브라우저에서는 바로 시작한다.
   DB 문자열은 textContent로만 넣는다. */
(function (factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  if (typeof document !== "undefined") { api.start(document, window); }
})(function () {
  "use strict";
  const SEARCH_LIMIT = 50;
  const MOBILE = "(max-width: 719px)";

  function visibleFor(card, chosen) {
    if (chosen.region && card.region !== chosen.region) { return false; }
    if (chosen.topics.length && !chosen.topics.some((t) => card.topics.includes(t))) { return false; }
    return true;
  }

  function searchRecords(records, query, limit = SEARCH_LIMIT) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) { return []; }
    return records
      .filter((r) => (r.article.title_ko + " " + r.article.title + " " + r.article.summary).toLowerCase().includes(q))
      .sort((x, y) => (x.article.day < y.article.day ? 1 : x.article.day > y.article.day ? -1 : y.article.score - x.article.score))
      .slice(0, limit);
  }

  function loadAll(days, fetcher) {
    return Promise.allSettled(days.map((d) => fetcher(d))).then((parts) => {
      const done = parts.filter((p) => p.status === "fulfilled");
      return { ok: done.length > 0, complete: done.length === parts.length, records: done.flatMap((p) => p.value) };
    });
  }

  function group(articles) {
    const byCluster = new Map();
    articles.forEach((a) => byCluster.set(a.cluster, (byCluster.get(a.cluster) || []).concat([a])));
    return Array.from(byCluster.values())
      .map((members) => {
        const sorted = members.slice().sort((x, y) => y.score - x.score);
        return { lead: sorted[0], others: sorted.length - 1 };
      })
      .sort((x, y) => y.lead.score - x.lead.score);
  }

  function matches(a, f) {
    if (f.country && a.country !== f.country) { return false; }
    if (a.score < f.score) { return false; }
    if (f.topics.length && !f.topics.some((t) => a.topics.includes(t))) { return false; }
    if (f.q && !(a.title_ko + " " + a.title + " " + a.summary).toLowerCase().includes(f.q)) { return false; }
    return true;
  }

  function el(doc, tag, text, cls) {
    const node = doc.createElement(tag);
    if (text) { node.textContent = text; }
    if (cls) { node.className = cls; }
    return node;
  }

  function titleNode(doc, a) {
    if (!/^https?:\/\//i.test(a.url || "")) { return el(doc, "strong", a.title_ko); }
    const link = el(doc, "a", a.title_ko);
    link.setAttribute("href", a.url);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    return link;
  }

  function startFeed(doc) {
    const list = doc.querySelector(".cards-feed");
    const chipBars = doc.querySelectorAll(".chips[data-filter]");
    if (!list || !chipBars.length) { return; }
    const cards = Array.from(list.querySelectorAll(".story"));
    const more = doc.querySelector("[data-more]");
    const none = doc.querySelector(".empty.filtered");
    const chosen = { region: "", topics: [] };

    function apply() {
      const filtering = Boolean(chosen.region || chosen.topics.length);
      let shown = 0;
      cards.forEach((card) => {
        const ok = visibleFor({ region: card.dataset.region, topics: (card.dataset.topics || "").split(",").filter(Boolean) }, chosen);
        card.classList.toggle("is-off", !ok);
        if (ok) { shown += 1; }
      });
      list.classList.toggle("filtering", filtering);
      if (more) { more.hidden = filtering || !list.querySelector("[data-extra]"); }
      if (none) { none.hidden = shown > 0; }
    }

    chipBars.forEach((bar) => {
      bar.hidden = false;
      bar.addEventListener("click", (event) => {
        const chip = event.target.closest(".chip");
        if (!chip) { return; }
        if (bar.dataset.filter === "region") {
          chosen.region = chip.dataset.value;
          bar.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === chip));
        } else {
          const value = chip.dataset.value;
          chosen.topics = chosen.topics.includes(value) ? chosen.topics.filter((t) => t !== value) : chosen.topics.concat([value]);
          chip.classList.toggle("on", chosen.topics.includes(value));
        }
        apply();
      });
    });
    if (more) {
      more.addEventListener("click", () => {
        list.querySelectorAll("[data-extra]").forEach((c) => c.removeAttribute("data-extra"));
        more.hidden = true;
      });
    }
    doc.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="#a-"]');
      if (!link) { return; }
      const target = doc.getElementById(link.getAttribute("href").slice(1));
      if (target) { target.removeAttribute("data-extra"); target.classList.remove("is-off"); }
    });
  }

  function startTabs(doc, win) {
    const tabs = Array.from(doc.querySelectorAll(".tabs [data-tab]"));
    if (!tabs.length) { return; }
    function show(name) {
      tabs.forEach((t) => {
        const on = t.dataset.tab === name;
        t.classList.toggle("on", on);
        const section = doc.getElementById(t.dataset.tab);
        if (section) { section.classList.toggle("is-off", !on); }
      });
    }
    tabs.forEach((t) => t.addEventListener("click", (event) => {
      event.preventDefault();
      show(t.dataset.tab);
      if (win.history && win.history.replaceState) { win.history.replaceState(null, "", "#" + t.dataset.tab); }
    }));
    show(win.location.hash === "#browse" ? "browse" : "recs");
  }

  function startBrowse(doc, win) {
    const box = doc.getElementById("browse");
    if (!box) { return; }
    const form = box.querySelector("form.filters");
    const list = box.querySelector("ul.list");
    const status = box.querySelector(".status");
    const root = box.dataset.root;
    const day = box.dataset.day;
    const week = (box.dataset.week || "").split(",").filter(Boolean);
    const cache = {};
    let seq = 0;

    function load(d) {
      if (!cache[d]) {
        cache[d] = win.fetch(root + "data/" + d + "/" + box.dataset.region + ".json")
          .then((r) => (r.ok ? r.json() : [])).catch(() => []);
      }
      return cache[d];
    }

    function current() {
      const data = new win.FormData(form);
      return { country: data.get("country") || "", score: Number(data.get("score") || 0), topics: data.getAll("topic"),
               q: String(data.get("q") || "").trim().toLowerCase(), period: data.get("period") };
    }

    function row(item) {
      const a = item.lead;
      const li = el(doc, "li");
      li.appendChild(titleNode(doc, a));
      if (item.others) { li.appendChild(el(doc, "span", " +" + item.others, "more-count")); }
      const meta = [a.press + (a.state ? " (관영)" : ""), a.country, a.topics.join("·"), a.score + "점"];
      if (a.day !== day) { meta.push(a.day); }
      li.appendChild(el(doc, "div", meta.join(" · "), "meta"));
      li.appendChild(el(doc, "div", a.summary, "sum"));
      return li;
    }

    function fillCountries(articles) {
      const select = form.elements.country;
      const chosen = select.value;
      const names = Array.from(new Set(articles.map((a) => a.country))).sort();
      while (select.options.length > 1) { select.remove(1); }
      names.forEach((name) => {
        const option = el(doc, "option", name);
        option.value = name;
        select.appendChild(option);
      });
      select.value = names.includes(chosen) ? chosen : "";
    }

    function render() {
      const f = current();
      const days = f.period === "week" ? [day].concat(week) : [day];
      status.textContent = "불러오는 중…";
      const mine = ++seq;
      Promise.all(days.map(load)).then((parts) => {
        if (mine !== seq) { return; }  // 그새 조건이 바뀌었으면 늦게 온 결과는 버린다
        const all = parts.flat();
        fillCountries(all);
        const shown = group(all.filter((a) => matches(a, current())));
        list.replaceChildren(...shown.map(row));
        status.textContent = shown.length + "개 사건 · 기사 " + all.length + "건 중";
      });
    }

    form.hidden = false;
    form.addEventListener("input", render);
    form.addEventListener("submit", (event) => { event.preventDefault(); render(); });
    render();
  }

  function startSearch(doc, win) {
    const body = doc.body;
    const days = (body.dataset.searchDays || "").split(",").filter(Boolean);
    const form = doc.querySelector("form.search");
    const out = doc.getElementById("search-results");
    if (!form || !out || !days.length) { return; }
    const input = form.querySelector("input[name=q]");
    const root = body.dataset.root || "";
    let records = null;
    let loading = null;
    let timer = null;

    function fetcher(d) {
      return win.fetch(root + "data/" + d + "/recommended.json").then((r) => {
        if (!r.ok) { throw new Error(String(r.status)); }
        return r.json();
      });
    }

    function card(r) {
      const li = el(doc, "li", "", "card story");
      const tags = el(doc, "p", "", "tags");
      tags.appendChild(el(doc, "span", r.article.day, "tag"));
      tags.appendChild(el(doc, "span", r.region_label, "tag soft"));
      li.appendChild(tags);
      const h3 = el(doc, "h3");
      h3.appendChild(titleNode(doc, r.article));
      li.appendChild(h3);
      li.appendChild(el(doc, "p", r.article.press + (r.article.state ? " (관영)" : "") + " · " + r.article.country, "meta"));
      li.appendChild(el(doc, "p", r.article.summary, "sum"));
      return li;
    }

    function show(query, partial) {
      const found = searchRecords(records || [], query);
      const head = el(doc, "header");
      head.appendChild(el(doc, "h2", "검색 결과 " + found.length + "건 (최근 7일 추천)" + (partial ? " · 일부 날짜 자료를 불러오지 못했습니다" : "")));
      const close = el(doc, "button", "닫기", "btn ghost");
      close.type = "button";
      close.addEventListener("click", () => { input.value = ""; out.hidden = true; });
      head.appendChild(close);
      const list = el(doc, "ol", "", "cards-feed");
      found.forEach((r) => list.appendChild(card(r)));
      out.replaceChildren(head, found.length ? list : el(doc, "p", "찾는 기사가 없습니다", "empty"));
      out.hidden = false;
    }

    function run() {
      const query = input.value;
      if (!query.trim()) { out.hidden = true; return; }
      if (records) { show(query); return; }
      out.replaceChildren(el(doc, "p", "불러오는 중…", "muted"));
      out.hidden = false;
      if (loading) { return; }
      loading = loadAll(days, fetcher).then((loaded) => {
        loading = null;
        if (!loaded.ok) {  // 다음 검색 때 다시 불러온다 (빈 결과로 기억하지 않는다)
          out.replaceChildren(el(doc, "p", "검색 자료를 불러오지 못했습니다. 연결을 확인한 뒤 다시 검색하세요.", "empty"));
          return;
        }
        records = loaded.records;
        if (input.value.trim()) { show(input.value, !loaded.complete); } else { out.hidden = true; }
        if (!loaded.complete) { records = null; }  // 일부만 받은 자료는 기억하지 않고 다음 검색 때 다시 받는다
      });
    }

    form.hidden = false;
    form.addEventListener("submit", (event) => { event.preventDefault(); run(); });
    input.addEventListener("input", () => { win.clearTimeout(timer); timer = win.setTimeout(run, 200); });
    if (win.location.hash === "#search") { input.focus(); }
    const tab = doc.querySelector('.tab-search[href="#search"]');
    if (tab) {
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        win.scrollTo(0, 0);
        input.focus();
      });
    }
  }

  function startGlance(doc, win) {
    const glance = doc.querySelector("details.glance");
    if (glance && win.matchMedia && win.matchMedia(MOBILE).matches) { glance.removeAttribute("open"); }
  }

  function start(doc, win) {
    doc.documentElement.classList.add("js");
    const go = () => { startFeed(doc); startTabs(doc, win); startBrowse(doc, win); startSearch(doc, win); startGlance(doc, win); };
    if (doc.readyState === "loading") { doc.addEventListener("DOMContentLoaded", go); } else { go(); }
  }

  return { visibleFor, searchRecords, loadAll, group, matches, start };
});
