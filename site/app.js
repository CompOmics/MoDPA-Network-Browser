/* MoDPA network browser. Data: window.MODPA_DATA, written by scripts/build_data.py. */
(function () {
  "use strict";

  const D = window.MODPA_DATA;
  if (!D) {
    document.getElementById("welcome").innerHTML =
      "<h1>No data</h1><p>site/data/modpa-data.js is missing. Run scripts/build_data.py.</p>";
    return;
  }
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- modifications
  // Colour follows the modification, in the fixed categorical order of the validated palette.
  // The methyl family shares one hue; its members differ by label (me1/me2/me3).
  // Succinyl has three sites and folds into "other" rather than adding a ninth hue.
  const MODSTYLE = {
    21: { v: "--mod-phospho", short: "p" },
    1: { v: "--mod-acetyl", short: "ac" },
    34: { v: "--mod-methyl", short: "me1" },
    36: { v: "--mod-methyl", short: "me2" },
    37: { v: "--mod-methyl", short: "me3" },
    23: { v: "--mod-dehydrated", short: "dh" },
    535: { v: "--mod-gg", short: "ub" },
    299: { v: "--mod-carboxy", short: "cx" },
    7: { v: "--mod-deamidated", short: "cit" },
    53: { v: "--mod-hne", short: "hne" },
    64: { v: "--mod-other", short: "su" },
  };
  const MOD_ORDER = [21, 1, 34, 36, 37, 23, 535, 299, 7, 53, 64];
  const modName = (m) => D.mods[m] || "Unimod " + m;
  let COLORS = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const get = (v) => cs.getPropertyValue(v).trim();
    COLORS = {
      edge: get("--edge"), edgeHi: get("--edge-hi"), text: get("--text-primary"),
      textMuted: get("--text-secondary"), surface: get("--surface-0"), surface1: get("--surface-1"),
      compound: get("--compound"), compoundBorder: get("--compound-border"), accent: get("--accent"),
    };
    for (const m of MOD_ORDER) COLORS[m] = get(MODSTYLE[m].v);
  }
  const modColor = (m) => COLORS[m] || "#888";

  // ---------------------------------------------------------------- data model
  const N = D.nodes.map((r, i) => {
    const [acc, pos, res, mod, cl] = r;
    const p = D.proteins[acc] || [acc, "", 0];
    return { i, acc, pos, res, mod, cl, gene: p[0], id: `${acc}|${pos}|${res}|${mod}` };
  });
  const E = D.edges.map((r, k) => ({ k, a: r[0], b: r[1], s: r[2] / 10000, q: r[3], art: r[4] === 1 }));
  const adj = N.map(() => []);
  for (const e of E) { adj[e.a].push(e); adj[e.b].push(e); }
  for (const l of adj) l.sort((x, y) => y.s - x.s);
  const other = (e, i) => (e.a === i ? e.b : e.a);

  const byProt = new Map(), byMod = new Map(), byCl = new Map(), byGene = new Map();
  for (const n of N) {
    push(byProt, n.acc, n.i); push(byMod, n.mod, n.i); push(byCl, n.cl, n.i);
    push(byGene, n.gene.toUpperCase(), n.acc);
  }
  for (const [g, accs] of byGene) byGene.set(g, [...new Set(accs)]);
  function push(m, k, v) { const l = m.get(k); l ? l.push(v) : m.set(k, [v]); }

  const siteLabel = (n) => `${MODSTYLE[n.mod].short}${n.res}${n.pos}`;
  const fullLabel = (n) => `${n.gene} ${siteLabel(n)}`;
  const fmtScore = (s) => s.toFixed(3);
  const fmtQ = (q) => (q < 0.001 ? q.toExponential(1) : q.toPrecision(2));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------------------------------------------------------------- state
  const state = {
    query: null, t: 0.6, shell: true, max: 300, group: true, labels: true, artefacts: true,
    hiddenMods: new Set(), selected: null,
  };
  let view = null;

  // ---------------------------------------------------------------- search
  const SUGG = [];
  for (const [acc, p] of Object.entries(D.proteins)) {
    const n = byProt.get(acc).length;
    SUGG.push({ kind: "protein", label: p[0], keys: [p[0].toUpperCase(), acc.toUpperCase()],
      sub: `${acc} · ${n} site${n > 1 ? "s" : ""}`, q: { type: "protein", acc } });
  }
  for (const m of MOD_ORDER) {
    if (!byMod.has(m)) continue;
    SUGG.push({ kind: "modification", label: modName(m), keys: [modName(m).toUpperCase(), "UNIMOD:" + m],
      sub: `${byMod.get(m).length} sites`, q: { type: "mod", mod: m } });
  }
  for (const [cl, l] of [...byCl].sort((a, b) => a[0] - b[0])) {
    SUGG.push({ kind: "cluster", label: `Cluster ${cl}`, keys: [`CLUSTER ${cl}`], sub: `${l.length} sites`,
      q: { type: "cluster", cl } });
  }

  function parseQuery(text) {
    const t = text.trim();
    if (!t) return null;
    const up = t.toUpperCase();
    let m = up.match(/^([A-Z0-9-]+)\|(\d+)\|([A-Z])\|(\d+)$/);
    if (m) {
      const n = N.find((x) => x.acc === m[1] && x.pos === +m[2] && x.res === m[3] && x.mod === +m[4]);
      return n ? { type: "site", i: n.i } : null;
    }
    m = up.match(/^CLUSTER\s*(\d+)$/);
    if (m && byCl.has(+m[1])) return { type: "cluster", cl: +m[1] };
    const prot = (s) => (D.proteins[s] ? s : (byGene.get(s) || [])[0]);
    m = up.match(/^(\S+?)[\s_:|-]+(?:[A-Z]{0,3}?)([A-Z])?(\d+)$/);
    if (m && prot(m[1])) {
      const acc = prot(m[1]);
      const hits = byProt.get(acc).filter((i) => N[i].pos === +m[3] && (!m[2] || N[i].res === m[2]));
      if (hits.length === 1) return { type: "site", i: hits[0] };
      if (hits.length > 1) return { type: "protein", acc, focus: hits };
    }
    if (prot(up)) return { type: "protein", acc: prot(up) };
    for (const md of MOD_ORDER) if (modName(md).toUpperCase() === up || up === "UNIMOD:" + md) return { type: "mod", mod: md };
    return null;
  }

  function suggestions(text) {
    const up = text.trim().toUpperCase();
    if (!up) return [];
    const scored = [];
    for (const s of SUGG) {
      let best = 0;
      for (const k of s.keys) {
        if (k === up) best = Math.max(best, 3);
        else if (k.startsWith(up)) best = Math.max(best, 2);
        else if (up.length >= 3 && k.includes(up)) best = Math.max(best, 1);
      }
      if (best) scored.push([best, s]);
    }
    // Sites of an exactly matched protein, e.g. "TP53 S1" lists TP53 sites starting with S1.
    const m = up.match(/^(\S+)(?:\s+(\S*))?$/);
    if (m) {
      const acc = D.proteins[m[1]] ? m[1] : (byGene.get(m[1]) || [])[0];
      if (acc) {
        const frag = (m[2] || "").replace(/^[A-Z]{2,3}(?=[A-Z]\d)/, "");
        for (const i of byProt.get(acc)) {
          const n = N[i];
          const key = `${n.res}${n.pos}`;
          if (frag && !key.startsWith(frag) && !String(n.pos).startsWith(frag)) continue;
          scored.push([m[2] ? 2.5 : 0.5, { kind: "site", label: fullLabel(n), sub: `${modName(n.mod)} · cluster ${n.cl}`,
            q: { type: "site", i } }]);
        }
      }
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label, undefined, { numeric: true }));
    return scored.slice(0, 14).map((x) => x[1]);
  }

  const input = $("search"), list = $("suggest");
  let items = [], active = -1;
  function renderSuggest() {
    items = suggestions(input.value);
    active = items.length ? 0 : -1;
    list.innerHTML = items.map((s, k) =>
      `<li role="option" data-k="${k}" aria-selected="${k === active}"><span class="kind">${s.kind}</span>` +
      `<span>${esc(s.label)}</span><span class="sub">${esc(s.sub)}</span></li>`).join("");
    list.hidden = !items.length;
  }
  function choose(q) {
    list.hidden = true;
    if (!q) return;
    input.blur();
    setQuery(q);
  }
  input.addEventListener("input", renderSuggest);
  input.addEventListener("focus", () => input.value && renderSuggest());
  input.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 150));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      if (!items.length) return;
      ev.preventDefault();
      active = (active + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      [...list.children].forEach((li, k) => li.setAttribute("aria-selected", k === active));
      list.children[active].scrollIntoView({ block: "nearest" });
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const parsed = parseQuery(input.value);
      choose(parsed || (items[active] && items[active].q));
    } else if (ev.key === "Escape") {
      list.hidden = true;
    }
  });
  list.addEventListener("mousedown", (ev) => {
    const li = ev.target.closest("li");
    if (li) { ev.preventDefault(); choose(items[+li.dataset.k].q); }
  });

  // ---------------------------------------------------------------- view construction
  function activeDegree(i) {
    let d = 0;
    for (const e of adj[i]) if (e.s >= state.t && edgeVisible(e)) d++;
    return d;
  }
  const edgeVisible = (e) => (state.artefacts || !e.art) && !state.hiddenMods.has(N[e.a].mod) && !state.hiddenMods.has(N[e.b].mod);

  function seedsFor(q) {
    if (q.type === "protein") return byProt.get(q.acc).slice();
    if (q.type === "site") return [q.i];
    if (q.type === "mod") return byMod.get(q.mod).slice();
    if (q.type === "cluster") return byCl.get(q.cl).slice();
    return [];
  }

  function buildView(q) {
    const notes = [];
    let seeds = seedsFor(q).filter((i) => !state.hiddenMods.has(N[i].mod));
    const broad = q.type === "mod" || q.type === "cluster";
    if (broad) {
      const before = seeds.length;
      seeds = seeds.filter((i) => activeDegree(i) > 0);
      if (seeds.length < before) notes.push(`${before - seeds.length} sites without edges at this threshold are hidden.`);
    }
    // In broad views, keep 40% of the node budget for partners, so truncated seeds do not end up isolated.
    const seedCap = broad && state.shell ? Math.floor(state.max * 0.6) : state.max;
    if (seeds.length > seedCap) {
      const deg = new Map(seeds.map((i) => [i, activeDegree(i)]));
      seeds.sort((a, b) => deg.get(b) - deg.get(a));
      notes.push(`Showing the ${seedCap} best-connected of ${seeds.length} matching sites. Raise "Max nodes" or the score threshold.`);
      seeds = seeds.slice(0, seedCap);
    }
    const seedSet = new Set(seeds);
    const nodes = new Set(seeds);
    if (state.shell) {
      const cand = new Map();
      for (const i of seeds) for (const e of adj[i]) {
        if (e.s < state.t || !edgeVisible(e)) continue;
        const j = other(e, i);
        if (!nodes.has(j) && (!cand.has(j) || cand.get(j) < e.s)) cand.set(j, e.s);
      }
      const ranked = [...cand].sort((a, b) => b[1] - a[1]);
      const room = Math.max(0, state.max - nodes.size);
      if (ranked.length > room) notes.push(`${ranked.length - room} of ${ranked.length} partners not shown (node limit).`);
      for (const [j] of ranked.slice(0, room)) nodes.add(j);
    }
    const edges = [];
    for (const i of nodes) for (const e of adj[i]) {
      if (e.a === i && nodes.has(e.b) && e.s >= state.t && edgeVisible(e)) edges.push(e);
    }
    if (state.group && nodes.size > GROUP_MAX) notes.push(`Protein grouping is off above ${GROUP_MAX} sites.`);
    return { seeds: seedSet, nodes, edges, notes };
  }

  // ---------------------------------------------------------------- cytoscape
  const hasFcose = typeof cytoscape !== "undefined" && typeof cytoscapeFcose !== "undefined";
  if (hasFcose) cytoscape.use(cytoscapeFcose);
  const hasSvg = typeof cytoscape !== "undefined" && typeof cytoscapeSvg !== "undefined";
  if (hasSvg) cytoscape.use(cytoscapeSvg);
  else document.getElementById("svg").hidden = true;
  let cy = null;

  function cyStyle() {
    return [
      { selector: "node", style: {
        "background-color": "data(color)", width: 18, height: 18,
        "border-width": 1.5, "border-color": COLORS.surface1,
        label: state.labels ? "data(label)" : "", "font-size": 9, color: COLORS.text,
        "text-valign": "bottom", "text-margin-y": 2,
        "text-outline-color": COLORS.surface, "text-outline-width": 2, "min-zoomed-font-size": 6,
      } },
      { selector: "node.seed", style: { width: 24, height: 24, "border-width": 2.5, "border-color": COLORS.text } },
      { selector: ":parent", style: {
        "background-color": COLORS.compound, "background-opacity": 1, "border-width": 1,
        "border-color": COLORS.compoundBorder, shape: "round-rectangle", padding: 10,
        label: "data(label)", "font-size": 11, "font-weight": 600, color: COLORS.textMuted,
        "text-valign": "top", "text-halign": "center", "text-margin-y": -2, "text-outline-width": 0,
      } },
      { selector: "edge", style: {
        width: "mapData(s, 0.6, 1, 0.8, 5)", "line-color": COLORS.edge, opacity: 0.75, "curve-style": "haystack",
      } },
      { selector: "edge.art", style: { "line-style": "dashed", "curve-style": "straight" } },
      { selector: ".faded", style: { opacity: 0.12 } },
      { selector: "edge.hl", style: { "line-color": COLORS.edgeHi, opacity: 1 } },
      { selector: "node:selected", style: { "border-color": COLORS.accent, "border-width": 4 } },
      { selector: "edge:selected", style: { "line-color": COLORS.accent, opacity: 1 } },
    ];
  }

  // fcose packs protein boxes poorly in large views, leaving empty boxes behind; group small views only.
  const GROUP_MAX = 200;
  const groupingOn = (v) => state.group && v.nodes.size <= GROUP_MAX;

  function toElements(v) {
    const els = [];
    const count = new Map();
    for (const i of v.nodes) count.set(N[i].acc, (count.get(N[i].acc) || 0) + 1);
    const parents = new Set();
    for (const i of v.nodes) {
      const n = N[i];
      const grouped = groupingOn(v) && count.get(n.acc) > 1;
      if (grouped && !parents.has(n.acc)) {
        parents.add(n.acc);
        els.push({ data: { id: "p:" + n.acc, label: n.gene } });
      }
      els.push({
        data: { id: "n" + i, idx: i, color: modColor(n.mod), label: grouped ? siteLabel(n) : fullLabel(n),
          parent: grouped ? "p:" + n.acc : undefined },
        classes: v.seeds.has(i) ? "seed" : "",
      });
    }
    for (const e of v.edges) {
      els.push({ data: { id: "e" + e.k, k: e.k, source: "n" + e.a, target: "n" + e.b, s: e.s }, classes: e.art ? "art" : "" });
    }
    return els;
  }

  function layoutOpts(n) {
    if (hasFcose) {
      return { name: "fcose", quality: n > 400 ? "draft" : "default", randomize: true, animate: false,
        nodeRepulsion: 6000, idealEdgeLength: 55, edgeElasticity: 0.3, nestingFactor: 0.4,
        nodeSeparation: 60, nodeDimensionsIncludeLabels: true, numIter: 4000, packComponents: true, tilingPaddingVertical: 20, tilingPaddingHorizontal: 20, fit: true, padding: 30 };
    }
    return { name: "cose", animate: false, fit: true, padding: 30, nodeRepulsion: 8000 };
  }

  // Fit, but never zoom past 1.4x: a five-node view should not fill the screen with giant nodes.
  function runLayout() {
    const l = cy.layout(layoutOpts(cy.nodes().length));
    l.one("layoutstop", () => { cy.fit(undefined, 30); if (cy.zoom() > 1.4) { cy.zoom(1.4); cy.center(); } });
    l.run();
  }

  function render() {
    if (!state.query) return;
    view = buildView(state.query);
    $("welcome").hidden = true;
    const els = toElements(view);
    if (!cy) {
      cy = cytoscape({ container: $("cy"), elements: [], style: cyStyle(), wheelSensitivity: 0.25,
        minZoom: 0.05, maxZoom: 4, boxSelectionEnabled: false });
      bindCy();
    }
    cy.batch(() => { cy.elements().remove(); cy.add(els); });
    cy.style(cyStyle());
    // Track and notice change the canvas height, so draw them before the layout fits the view.
    renderTitle(); renderNotice(); renderTrack();
    cy.resize();
    runLayout();
    if (state.selected && !cy.getElementById(state.selected).length) state.selected = null;
    if (state.selected) cy.getElementById(state.selected).select();
    renderLegend(); renderDetails(); writeHash();
  }

  function bindCy() {
    const tip = $("tooltip");
    cy.on("mouseover", "node, edge", (ev) => {
      const el = ev.target;
      if (el.isParent()) return;
      tip.innerHTML = el.isNode() ? nodeTip(N[el.data("idx")]) : edgeTip(E[el.data("k")]);
      tip.hidden = false;
      if (el.isNode()) {
        const nb = el.closedNeighborhood();
        cy.elements().not(nb).not(el.ancestors()).not(nb.ancestors()).addClass("faded");
        el.connectedEdges().addClass("hl");
        highlightTrack(el.data("idx"));
      }
    });
    cy.on("mousemove", (ev) => {
      if (tip.hidden) return;
      const r = $("cy").getBoundingClientRect(), s = $("cy").parentElement.getBoundingClientRect();
      const x = ev.renderedPosition.x + r.left - s.left + 14, y = ev.renderedPosition.y + r.top - s.top + 14;
      tip.style.left = Math.min(x, s.width - tip.offsetWidth - 8) + "px";
      tip.style.top = Math.min(y, s.height - tip.offsetHeight - 8) + "px";
    });
    cy.on("mouseout", "node, edge", () => {
      tip.hidden = true;
      cy.elements().removeClass("faded hl");
      highlightTrack(null);
    });
    cy.on("tap", (ev) => {
      if (ev.target === cy) { state.selected = null; renderDetails(); return; }
      if (ev.target.isParent()) return;
      state.selected = ev.target.id();
      renderDetails();
    });
    cy.on("dbltap", "node", (ev) => {
      if (!ev.target.isParent()) setQuery({ type: "protein", acc: N[ev.target.data("idx")].acc });
    });
  }

  function nodeTip(n) {
    return `<b>${esc(fullLabel(n))}</b><br>${esc(D.proteins[n.acc][1] || n.acc)}<br>` +
      `<span class="dot" style="background:${modColor(n.mod)}"></span>${esc(modName(n.mod))} on ${n.res}${n.pos}` +
      `<br><span class="muted">${n.acc} · cluster ${n.cl} · ${activeDegree(n.i)} edges ≥ ${state.t.toFixed(2)}</span>`;
  }
  function edgeTip(e) {
    return `<b>${esc(fullLabel(N[e.a]))} – ${esc(fullLabel(N[e.b]))}</b><br>score ${fmtScore(e.s)} · q ${fmtQ(e.q)}` +
      (e.art ? `<br><span class="muted">flagged as potential artefact</span>` : "");
  }

  // ---------------------------------------------------------------- panels
  function queryTitle(q) {
    if (q.type === "protein") { const p = D.proteins[q.acc]; return `${esc(p[0])}<small>${q.acc} · ${esc(p[1])}</small>`; }
    if (q.type === "site") { const n = N[q.i]; return `${esc(fullLabel(n))}<small>${n.id} · ${esc(modName(n.mod))}</small>`; }
    if (q.type === "mod") return `${esc(modName(q.mod))}<small>Unimod ${q.mod} · all sites</small>`;
    if (q.type === "cluster") return `Cluster ${q.cl}<small>Leiden partition</small>`;
    return "";
  }
  function renderTitle() {
    const prots = new Set([...view.nodes].map((i) => N[i].acc)).size;
    $("view-title").innerHTML = queryTitle(state.query) +
      `<small>${view.nodes.size} sites · ${view.edges.length} edges · ${prots} proteins</small>`;
  }
  function renderNotice() {
    const el = $("notice");
    el.textContent = view.notes.join(" ");
    el.hidden = !view.notes.length;
    if (view.nodes.size && !view.edges.length) {
      el.textContent += (el.textContent ? " " : "") + "No associations at this threshold. Lower the score threshold.";
      el.hidden = false;
    }
  }

  function renderLegend() {
    const counts = new Map();
    if (view) for (const i of view.nodes) counts.set(N[i].mod, (counts.get(N[i].mod) || 0) + 1);
    $("legend").innerHTML = MOD_ORDER.filter((m) => byMod.has(m)).map((m) =>
      `<li data-mod="${m}" class="${state.hiddenMods.has(m) ? "off" : ""}" title="Click to hide or show">` +
      `<span class="swatch" style="background:${modColor(m)}"></span>${esc(modName(m))}` +
      `<span class="count">${view ? counts.get(m) || 0 : byMod.get(m).length}</span></li>`).join("");
  }
  $("legend").addEventListener("click", (ev) => {
    const li = ev.target.closest("li");
    if (!li) return;
    const m = +li.dataset.mod;
    state.hiddenMods.has(m) ? state.hiddenMods.delete(m) : state.hiddenMods.add(m);
    state.query ? render() : renderLegend();
  });

  // Protein track: every site of the protein in the network, as a lollipop on the sequence axis.
  function renderTrack() {
    const box = $("track");
    const q = state.query;
    const acc = q.type === "protein" ? q.acc : q.type === "site" ? N[q.i].acc : null;
    if (!acc) { box.hidden = true; return; }
    const [gene, , len0] = D.proteins[acc];
    const sites = byProt.get(acc);
    const len = Math.max(len0, ...sites.map((i) => N[i].pos));
    const W = Math.max(400, box.clientWidth || $("cy").clientWidth - 24), H = 74, L = 16, R = 22, base = 54;
    const x = (p) => L + ((p - 1) / Math.max(1, len - 1)) * (W - L - R);
    const stack = new Map();
    const ticks = niceTicks(len);
    let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(gene)} sites along the sequence">`;
    svg += `<rect x="${L}" y="${base - 3}" width="${W - L - R}" height="6" rx="3" fill="${COLORS.compound}" stroke="${COLORS.compoundBorder}"/>`;
    for (const t of ticks) svg += `<text x="${x(t)}" y="${H - 2}" text-anchor="middle">${t}</text>`;
    let lastLabel = -Infinity;
    for (const i of sites) {
      const n = N[i];
      const lvl = stack.get(n.pos) || 0;
      stack.set(n.pos, lvl + 1);
      const cy0 = base - 20 - lvl * 11, xx = x(n.pos);
      const inView = view.nodes.has(i);
      svg += `<g class="lolli${inView ? "" : " dim"}" data-i="${i}"><title>${esc(fullLabel(n))} · ${esc(modName(n.mod))}${inView ? "" : " (not in view)"}</title>` +
        `<line x1="${xx}" x2="${xx}" y1="${base - 3}" y2="${cy0}"/>` +
        `<circle cx="${xx}" cy="${cy0}" r="5" fill="${modColor(n.mod)}"/>` +
        (lvl === 0 && xx - lastLabel >= 34 ? `<text x="${xx}" y="${cy0 - 8}" text-anchor="middle">${n.res}${n.pos}</text>` : "") + `</g>`;
      if (lvl === 0 && xx - lastLabel >= 34) lastLabel = xx;
    }
    svg += `</svg>`;
    box.innerHTML = svg;
    box.hidden = false;
  }
  function niceTicks(len) {
    const step = [10, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((s) => len / s <= 8) || 10000;
    const out = [1];
    for (let t = step; t < len; t += step) out.push(t);
    if (len - out[out.length - 1] > step / 3) out.push(len);
    return out;
  }
  function highlightTrack(i) {
    for (const g of $("track").querySelectorAll(".lolli")) g.classList.toggle("hi", +g.dataset.i === i);
  }
  $("track").addEventListener("click", (ev) => {
    const g = ev.target.closest(".lolli");
    if (!g) return;
    const i = +g.dataset.i;
    if (!view.nodes.has(i)) { setQuery({ type: "site", i }); return; }
    state.selected = "n" + i;
    cy.elements().unselect();
    const el = cy.getElementById(state.selected).select();
    cy.animate({ center: { eles: el }, duration: 250 });
    renderDetails();
  });
  $("track").addEventListener("mouseover", (ev) => {
    const g = ev.target.closest(".lolli");
    if (!g || !cy) return;
    const el = cy.getElementById("n" + g.dataset.i);
    if (el.length) { cy.elements().not(el.closedNeighborhood()).not(el.ancestors()).addClass("faded"); el.connectedEdges().addClass("hl"); }
  });
  $("track").addEventListener("mouseout", () => cy && cy.elements().removeClass("faded hl"));

  function renderDetails() {
    const box = $("details");
    if (!view) { box.innerHTML = aboutHtml(); return; }
    const sel = state.selected && cy && cy.getElementById(state.selected);
    if (sel && sel.length && sel.isNode()) box.innerHTML = nodeDetails(N[sel.data("idx")]);
    else if (sel && sel.length && sel.isEdge()) box.innerHTML = edgeDetails(E[sel.data("k")]);
    else box.innerHTML = viewDetails();
  }

  function partnerRows(i, limit) {
    const rows = adj[i].filter((e) => e.s >= state.t && edgeVisible(e)).slice(0, limit);
    if (!rows.length) return `<p class="empty">No partners at score ≥ ${state.t.toFixed(2)}.</p>`;
    return `<table><thead><tr><th>Partner</th><th class="num">Score</th><th class="num">q</th></tr></thead><tbody>` +
      rows.map((e) => {
        const j = other(e, i), m = N[j];
        return `<tr class="link" data-site="${j}" title="Open ${esc(fullLabel(m))}"><td><span class="dot" style="background:${modColor(m.mod)}"></span>` +
          `${esc(fullLabel(m))}${e.art ? ' <span class="chip">artefact?</span>' : ""}</td>` +
          `<td class="num">${fmtScore(e.s)}</td><td class="num">${fmtQ(e.q)}</td></tr>`;
      }).join("") + `</tbody></table>`;
  }

  function nodeDetails(n) {
    const p = D.proteins[n.acc];
    return `<h3>${esc(fullLabel(n))}</h3><p class="subtitle">${esc(p[1] || "")}</p><dl>` +
      `<dt>Protein</dt><dd><a href="https://www.uniprot.org/uniprotkb/${n.acc}/entry" target="_blank" rel="noopener">${n.acc}</a> · ${esc(p[0])}${p[2] ? ` · ${p[2]} aa` : ""}</dd>` +
      `<dt>Site</dt><dd>${n.res}${n.pos}</dd>` +
      `<dt>Modification</dt><dd><span class="dot" style="background:${modColor(n.mod)}"></span>${esc(modName(n.mod))} ` +
      `(<a href="https://www.unimod.org/modifications_view.php?editid1=${n.mod}" target="_blank" rel="noopener">Unimod ${n.mod}</a>)</dd>` +
      `<dt>Cluster</dt><dd><a href="#" data-cluster="${n.cl}">${n.cl}</a> (${byCl.get(n.cl).length} sites)</dd>` +
      `<dt>Node ID</dt><dd>${n.id}</dd></dl>` +
      `<div class="viewbar-actions"><button data-goto-site="${n.i}">Centre on this site</button>` +
      `<button data-goto-prot="${n.acc}">All ${esc(p[0])} sites</button></div>` +
      `<h4>Partners (score ≥ ${state.t.toFixed(2)})</h4>${partnerRows(n.i, 200)}`;
  }

  function edgeDetails(e) {
    const a = N[e.a], b = N[e.b];
    return `<h3>${esc(fullLabel(a))} – ${esc(fullLabel(b))}</h3><dl>` +
      `<dt>Score</dt><dd>${fmtScore(e.s)}</dd><dt>q-value</dt><dd>${fmtQ(e.q)}</dd>` +
      `<dt>Same protein</dt><dd>${a.acc === b.acc ? "yes, " + Math.abs(a.pos - b.pos) + " residues apart" : "no"}</dd>` +
      `<dt>Artefact flag</dt><dd>${e.art ? "potential artefact" : "no"}</dd></dl>` +
      (e.art ? `<p class="hint">Same modification within 5 residues on one protein. This rough proximity rule does not test whether the sites share a tryptic peptide.</p>` : "") +
      `<table><tbody>` + [a, b].map((n) => `<tr class="link" data-site="${n.i}"><td><span class="dot" style="background:${modColor(n.mod)}"></span>${esc(fullLabel(n))}</td><td>${esc(modName(n.mod))}</td><td>${n.acc}</td></tr>`).join("") + `</tbody></table>`;
  }

  function viewDetails() {
    const deg = new Map();
    for (const e of view.edges) { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); }
    const top = [...view.nodes].sort((a, b) => (deg.get(b) || 0) - (deg.get(a) || 0)).slice(0, 25);
    const prots = new Map();
    for (const i of view.nodes) prots.set(N[i].acc, (prots.get(N[i].acc) || 0) + 1);
    const topP = [...prots].sort((a, b) => b[1] - a[1]).slice(0, 15);
    return `<h4>Most connected sites in view</h4><table><thead><tr><th>Site</th><th class="num">Edges in view</th></tr></thead><tbody>` +
      top.map((i) => `<tr class="link" data-site="${i}"><td><span class="dot" style="background:${modColor(N[i].mod)}"></span>${esc(fullLabel(N[i]))}</td><td class="num">${deg.get(i) || 0}</td></tr>`).join("") +
      `</tbody></table><h4>Proteins in view</h4><table><thead><tr><th>Protein</th><th class="num">Sites in view</th></tr></thead><tbody>` +
      topP.map(([acc, c]) => `<tr class="link" data-prot="${acc}"><td>${esc(D.proteins[acc][0])} <span class="chip">${acc}</span></td><td class="num">${c}</td></tr>`).join("") +
      `</tbody></table><p class="hint">Click a node or edge for details. Double-click a node to open its protein.</p>`;
  }

  function aboutHtml() {
    return `<h4>About</h4><p>Each node is a PTM event: protein, position, residue and modification. ` +
      `Edges join PTM pairs whose VAE latent profiles are similar across public experiments (score = cosine similarity, q &lt; ${D.meta.qmax}).</p>` +
      `<dl><dt>Sites</dt><dd>${N.length.toLocaleString()}</dd><dt>Edges</dt><dd>${E.length.toLocaleString()}</dd>` +
      `<dt>Proteins</dt><dd>${Object.keys(D.proteins).length.toLocaleString()}</dd><dt>Clusters</dt><dd>${byCl.size}</dd></dl>`;
  }

  $("details").addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-site],[data-prot],[data-cluster],[data-goto-site],[data-goto-prot]");
    if (!t) return;
    ev.preventDefault();
    if (t.dataset.gotoSite) setQuery({ type: "site", i: +t.dataset.gotoSite });
    else if (t.dataset.gotoProt) setQuery({ type: "protein", acc: t.dataset.gotoProt });
    else if (t.dataset.cluster) setQuery({ type: "cluster", cl: +t.dataset.cluster });
    else if (t.dataset.prot) setQuery({ type: "protein", acc: t.dataset.prot });
    else if (t.dataset.site) setQuery({ type: "site", i: +t.dataset.site });
  });

  // ---------------------------------------------------------------- query, controls, URL
  function setQuery(q, keepSelection) {
    state.query = q;
    if (!keepSelection) state.selected = q.type === "site" ? "n" + q.i : null;
    const prot = q.type === "protein" ? D.proteins[q.acc][0] : q.type === "site" ? fullLabel(N[q.i])
      : q.type === "mod" ? modName(q.mod) : `cluster ${q.cl}`;
    input.value = prot;
    render();
  }

  const scoreEl = $("score");
  scoreEl.min = Math.floor(D.meta.minScore * 100) / 100;
  scoreEl.addEventListener("input", () => {
    state.t = +scoreEl.value;
    $("score-out").value = state.t.toFixed(2);
    updateScoreHint();
  });
  scoreEl.addEventListener("change", () => state.query && render());
  function updateScoreHint() {
    const n = E.filter((e) => e.s >= state.t).length;
    $("score-hint").textContent = `${n.toLocaleString()} of ${E.length.toLocaleString()} edges pass.`;
  }
  const bindCheck = (id, key) => $(id).addEventListener("change", (ev) => { state[key] = ev.target.checked; state.query && render(); });
  bindCheck("shell", "shell"); bindCheck("group", "group"); bindCheck("artefacts", "artefacts");
  $("labels").addEventListener("change", (ev) => { state.labels = ev.target.checked; cy && cy.style(cyStyle()); writeHash(); });
  $("maxnodes").addEventListener("change", (ev) => { state.max = +ev.target.value; state.query && render(); });
  $("fit").addEventListener("click", () => { if (!cy) return; cy.fit(undefined, 30); if (cy.zoom() > 1.4) { cy.zoom(1.4); cy.center(); } });
  $("relayout").addEventListener("click", () => cy && runLayout());
  $("home-link").addEventListener("click", (ev) => { ev.preventDefault(); location.hash = ""; location.reload(); });

  $("png").addEventListener("click", () => {
    if (!cy) return;
    const a = document.createElement("a");
    a.href = cy.png({ full: true, scale: 3, bg: COLORS.surface });
    a.download = `modpa-${fileStem()}.png`;
    a.click();
  });
  $("svg").addEventListener("click", () => {
    if (!cy) return;
    const svg = cy.svg({ full: true, scale: 1, bg: COLORS.surface });
    download(new Blob([svg], { type: "image/svg+xml" }), `modpa-${fileStem()}.svg`);
  });
  $("csv").addEventListener("click", () => {
    if (!view) return;
    const head = ["nodeA", "geneA", "siteA", "modA", "nodeB", "geneB", "siteB", "modB", "score", "qvalue", "potential_artefact"];
    const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const rows = view.edges.map((e) => {
      const a = N[e.a], b = N[e.b];
      return [a.id, a.gene, a.res + a.pos, modName(a.mod), b.id, b.gene, b.res + b.pos, modName(b.mod), e.s, e.q, e.art].map(cell).join(",");
    });
    const blob = new Blob([head.join(",") + "\n" + rows.join("\n") + "\n"], { type: "text/csv" });
    download(blob, `modpa-${fileStem()}-t${state.t.toFixed(2)}.csv`);
  });
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function fileStem() {
    const q = state.query;
    return q.type === "protein" ? D.proteins[q.acc][0] : q.type === "site" ? N[q.i].id.replace(/\|/g, "_")
      : q.type === "mod" ? modName(q.mod).replace(/\W+/g, "") : "cluster" + q.cl;
  }

  function writeHash() {
    const q = state.query;
    if (!q) return;
    const v = q.type === "protein" ? q.acc : q.type === "site" ? N[q.i].id : q.type === "mod" ? q.mod : q.cl;
    const p = new URLSearchParams({ [q.type]: v, t: state.t.toFixed(2) });
    if (!state.shell) p.set("shell", "0");
    if (state.max !== 300) p.set("max", state.max);
    if (!state.group) p.set("group", "0");
    if (state.hiddenMods.size) p.set("hide", [...state.hiddenMods].join(","));
    history.replaceState(null, "", "#" + p.toString());
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.has("t")) { state.t = Math.min(1, Math.max(+scoreEl.min, +p.get("t") || 0.6)); }
    if (p.get("shell") === "0") state.shell = false;
    if (p.has("max")) state.max = +p.get("max") || 300;
    if (p.get("group") === "0") state.group = false;
    if (p.has("hide")) p.get("hide").split(",").forEach((m) => state.hiddenMods.add(+m));
    scoreEl.value = state.t; $("score-out").value = state.t.toFixed(2);
    $("shell").checked = state.shell; $("group").checked = state.group; $("maxnodes").value = String(state.max);
    if (p.has("protein") && D.proteins[p.get("protein")]) return { type: "protein", acc: p.get("protein") };
    if (p.has("site")) { const q = parseQuery(p.get("site")); if (q) return q; }
    if (p.has("mod") && byMod.has(+p.get("mod"))) return { type: "mod", mod: +p.get("mod") };
    if (p.has("cluster") && byCl.has(+p.get("cluster"))) return { type: "cluster", cl: +p.get("cluster") };
    return null;
  }

  // ---------------------------------------------------------------- start
  function examples() {
    const topProt = [...byProt].sort((a, b) => b[1].length - a[1].length).slice(0, 3).map(([acc]) => ({ type: "protein", acc }));
    const topSite = N.reduce((b, n) => (adj[n.i].length > adj[b].length ? n.i : b), 0);
    const rare = MOD_ORDER.filter((m) => byMod.has(m) && m !== 21).sort((a, b) => byMod.get(b).length - byMod.get(a).length)[1];
    const ex = [...topProt, { type: "site", i: topSite }, { type: "mod", mod: rare }, { type: "cluster", cl: 0 }];
    $("examples").innerHTML = ex.map((q, k) => {
      const label = q.type === "protein" ? D.proteins[q.acc][0] : q.type === "site" ? fullLabel(N[q.i]) : q.type === "mod" ? modName(q.mod) : "Cluster " + q.cl;
      return `<button data-k="${k}">${esc(label)}</button>`;
    }).join("");
    $("examples").onclick = (ev) => { const b = ev.target.closest("button"); if (b) setQuery(ex[+b.dataset.k]); };
  }

  readColors();
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener && mq.addEventListener("change", () => {
    readColors();
    if (cy) { cy.style(cyStyle()); cy.nodes().not(":parent").forEach((n) => n.data("color", modColor(N[n.data("idx")].mod))); }
    renderLegend(); if (view) { renderTrack(); renderDetails(); }
  });
  window.addEventListener("resize", () => { if (view) renderTrack(); });

  $("meta").innerHTML = `Data: ${esc(D.meta.label)}<br>${esc(D.meta.edgesFile)}<br>Built ${D.meta.built}`;
  examples();
  updateScoreHint();
  renderLegend();
  renderDetails();
  if (typeof cytoscape === "undefined") {
    $("welcome").innerHTML = "<h1>Cytoscape.js did not load</h1><p>The network library is loaded from a CDN. Check the internet connection.</p>";
    return;
  }
  const initial = readHash();
  updateScoreHint();
  if (initial) setQuery(initial);
})();
