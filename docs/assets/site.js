(function () {
  "use strict";
  const box = document.getElementById("browse");
  if (!box) { return; }
  const form = box.querySelector("form.filters");
  const list = box.querySelector("ul.list");
  const status = box.querySelector(".status");
  const root = box.dataset.root;
  const region = box.dataset.region;
  const day = box.dataset.day;
  const week = (box.dataset.week || "").split(",").filter(Boolean);
  const cache = {};

  function load(d) {
    if (!cache[d]) {
      cache[d] = fetch(root + "data/" + d + "/" + region + ".json")
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
    }
    return cache[d];
  }

  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text) { node.textContent = text; }
    if (cls) { node.className = cls; }
    return node;
  }

  function group(articles) {
    const byCluster = new Map();
    articles.forEach((a) => {
      const members = byCluster.get(a.cluster) || [];
      members.push(a);
      byCluster.set(a.cluster, members);
    });
    return Array.from(byCluster.values())
      .map((members) => {
        members.sort((x, y) => y.score - x.score);
        return { lead: members[0], others: members.length - 1 };
      })
      .sort((x, y) => y.lead.score - x.lead.score);
  }

  function current() {
    const data = new FormData(form);
    return {
      country: data.get("country") || "",
      score: Number(data.get("score") || 0),
      topics: data.getAll("topic"),
      q: String(data.get("q") || "").trim().toLowerCase(),
      period: data.get("period"),
    };
  }

  function matches(a, f) {
    if (f.country && a.country !== f.country) { return false; }
    if (a.score < f.score) { return false; }
    if (f.topics.length && !f.topics.some((t) => a.topics.includes(t))) { return false; }
    if (f.q && !(a.title_ko + " " + a.title + " " + a.summary).toLowerCase().includes(f.q)) { return false; }
    return true;
  }

  function row(item) {
    const a = item.lead;
    const li = el("li");
    const title = /^https?:\/\//i.test(a.url) ? el("a", a.title_ko) : el("strong", a.title_ko);
    if (title.tagName === "A") {
      title.setAttribute("href", a.url);
      title.setAttribute("target", "_blank");
      title.setAttribute("rel", "noopener noreferrer");
    }
    li.appendChild(title);
    if (item.others) { li.appendChild(el("span", " +" + item.others, "more")); }
    const meta = [a.press + (a.state ? " (관영)" : ""), a.country, a.topics.join("·"), a.score + "점"];
    if (a.day !== day) { meta.push(a.day); }
    li.appendChild(el("div", meta.join(" · "), "meta"));
    li.appendChild(el("div", a.summary, "sum"));
    return li;
  }

  function fillCountries(articles) {
    const select = form.elements.country;
    const chosen = select.value;
    const names = Array.from(new Set(articles.map((a) => a.country))).sort();
    while (select.options.length > 1) { select.remove(1); }
    names.forEach((name) => {
      const option = el("option", name);
      option.value = name;
      select.appendChild(option);
    });
    select.value = names.includes(chosen) ? chosen : "";
  }

  function render() {
    const f = current();
    const days = f.period === "week" ? [day].concat(week) : [day];
    status.textContent = "불러오는 중…";
    Promise.all(days.map(load)).then((parts) => {
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
})();
