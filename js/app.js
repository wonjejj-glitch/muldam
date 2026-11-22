/* 댐 용수공급 평가 플랫폼 v2 – 화면 로직 */
(function () {
  'use strict';
  var E = window.DamEngine, WB = window.WB, COST = window.Cost, C = window.Charts, fmt = C.fmt, SC = C.STAGE_COLORS;
  var P = window.PLATFORM_DATA || null, D05 = window.D05 || { dams: [] }, MW = window.MYWATER, REG = window.REGISTRY, GIS = window.GIS;
  var $ = function (id) { return document.getElementById(id); };
  var qsa = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var STORE = 'muldam.v3', STORE_BASE = 'muldam.baselines.v3';
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(v, d) { return v == null || isNaN(v) ? '-' : (v * 100).toFixed(d == null ? 1 : d) + '%'; }
  function man(cmd) { return cmd == null ? '-' : fmt(cmd / 10000, 1); }   // ㎥/일 → 만㎥/일
  function eok(won) { return won == null ? '-' : fmt(won / 1e8, 0); }     // 원 → 억원

  /* ================= 상태 ================= */
  var CRITS = {
    y95: { label: '20년 빈도 가뭄까지 (추천 · 연 신뢰도 95%)', unit: 'year', target: 0.95 },
    y0: { label: '관측기간 최대 가뭄까지 (보수적 · 부족 0회)', unit: 'year', target: 1 },
    y90: { label: '10년 빈도 가뭄까지 (완화 · 연 신뢰도 90%)', unit: 'year', target: 0.90 }
  };
  // 판정 기준은 추천·보수적·완화 세 가지만 고름. 일·양적신뢰도 등은 상세 표의 참고 지표로만 보여 줌
  var CRIT_SEL = ['y0', 'y95', 'y90'];   // 엄격 → 완화 순서
  var LV_CRITS = CRIT_SEL;
  var DEF = {
    tab: 'overview', crit: 'y95', src: 'mywater',
    dam: '소양강댐', damDemand: {}, damAdd: 10000,
    st: { dam: '소양강댐', plants: [{ name: '정수장 1', q: 10000, on: true }], factors: [100, 100, 100, 100, 100], lag: true, carry: false, minDays: 1,
      crit: { warnOk: 10, warnBad: 30, maxEmergency: 0, minRel: 50 }, spec: {} },
    plant: 'cheonsang', plantQ: {}, radius: 120, fKind: '', fRiver: '',
    reg: { plants: null, routes: null, damCoords: {}, cost: {} }
  };
  var S = clone(DEF);
  try { var sv = JSON.parse(localStorage.getItem(STORE) || 'null'); if (sv) { S = Object.assign(clone(DEF), sv); S.st = Object.assign(clone(DEF.st), sv.st || {}); S.reg = Object.assign(clone(DEF.reg), sv.reg || {}); } } catch (e) { /* 저장소 없음 */ }
  if (CRIT_SEL.indexOf(S.crit) < 0 || !S.crit2) { S.crit = 'y95'; S.crit2 = 1; }   // 기준을 두 가지로 줄인 뒤 한 번은 기본(20년 빈도)으로
  if (S.lv && LV_CRITS.indexOf(S.lv.crit) < 0) S.lv.crit = 'y95';
  var BASES = {};
  try { BASES = JSON.parse(localStorage.getItem(STORE_BASE) || '{}') || {}; } catch (e) { BASES = {}; }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* 무시 */ } }
  function crit() { return CRITS[S.crit] || CRITS.y95; }

  /* ================= 등록부 ================= */
  function plants() { return S.reg.plants || REG.plants; }
  function gisDam(name) { var d = damByName(name); var g = d && d.code && GIS && GIS.dams ? GIS.dams[d.code] : null; return g ? [g.lat, g.lon] : null; }
  function coordOf(name) { return S.reg.damCoords[name] || gisDam(name) || REG.damCoords[name] || null; }
  function coordSrc(name) { return S.reg.damCoords[name] ? '사용자' : gisDam(name) ? 'MyWater GIS' : REG.damCoords[name] ? '개략' : '-'; }
  /** 전국 정수장 목록(MyWater GIS) – 등록 정수장과 연결된 시설은 제외 */
  var GPL = null;
  function gisPlants() {
    if (GPL) return GPL;
    var linked = {}; plants().forEach(function (p) { if (p.gis) linked[p.gis] = 1; });
    GPL = (GIS && GIS.plants ? GIS.plants : []).filter(function (g) { return !linked[g.name]; }).map(function (g) {
      return { id: g.id, name: g.name, region: g.kind + '정수장', capacity: g.capacity, source: '', demand: null, hwl: null, lat: g.lat, lon: g.lon,
        note: [g.org, (g.area || '').trim() ? '급수: ' + g.area.trim() : '', (g.completed || '').trim() ? '준공 ' + g.completed.trim() : ''].filter(Boolean).join(' · '), fromGis: true, kind: g.kind };
    });
    return GPL;
  }
  function gisCapOf(p) { if (!GIS || !p.gis) return null; var g = GIS.plants.filter(function (x) { return x.name === p.gis; })[0]; return g ? g.capacity : null; }
  function costParams() { return Object.assign({}, S.reg.cost); }
  function hwlOf(p) { var v = S.plantHwl && S.plantHwl[p.id]; return v != null ? v : p.hwl; }
  function plantById(id) { return plants().filter(function (p) { return p.id === id; })[0] || gisPlants().filter(function (p) { return p.id === id; })[0]; }

  /* ================= 댐 목록 ================= */
  var DAMS = [];
  (function buildDams() {
    var d05ByName = {}; D05.dams.forEach(function (d) { d05ByName[d.name] = d; });
    if (MW && MW.dams && MW.dams.length) {
      MW.dams.forEach(function (d) {
        DAMS.push({ name: d.name, code: d.code, kind: d.kind, river: d.river, basic: d.basic || {}, mw: d, d05: d05ByName[d.name] || null, snapshot: d.snapshot, snapshotDate: d.snapshotDate, dg: d.dg || null });
      });
    } else {
      D05.dams.forEach(function (d) {
        DAMS.push({ name: d.name, kind: '다목적댐', river: '낙동강', basic: { nwl: d.nwl, lwl: d.lwl, fwl: d.fwl, annualSupply: null }, mw: null, d05: d });
      });
    }
    DAMS.sort(function (a, b) { return (a.kind === b.kind ? 0 : a.kind === '다목적댐' ? -1 : 1) || a.name.localeCompare(b.name, 'ko'); });
  })();
  function damByName(n) { return DAMS.filter(function (d) { return d.name === n; })[0]; }
  /** MyWater 일일 스냅샷(대응단계 기준저수량)이 300일 이상 누적되면 연간 기준선으로 사용 */
  function snapBaseline(dam) {
    var sn = dam && dam.mw && dam.mw.snapshots; if (!sn) return null;
    var by = {};
    // 주의 기준이 없는 댐(감포 등)도 쌓이도록 관심·심각만 필수로 봄. 주의가 없으면 심각과 같은 값으로 둠(관심 → 심각으로 바로 넘어감)
    Object.keys(sn).forEach(function (d) { var x = sn[d]; if (x && x.g > 0 && x.ss > 0) by[d.slice(4, 6) + '-' + d.slice(6, 8)] = Object.assign({}, x, { j: x.j > 0 ? x.j : x.ss }); });
    var keys = Object.keys(by).sort(); if (keys.length < 300) return null;
    var days = []; for (var i = 0; i < 366; i++) { var dt = new Date(Date.UTC(2024, 0, 1 + i)); days.push(dt.toISOString().slice(5, 10)); }
    var idx = keys.map(function (k) { return days.indexOf(k); });
    return days.map(function (md, i) {
      if (by[md]) { var x = by[md]; return { md: md, gs: x.g, js: x.j, ss: x.ss, es: null, ns: x.n || x.g }; }
      var a = 0; while (a < idx.length && idx[a] < i) a++;
      var p0 = idx[(a - 1 + idx.length) % idx.length], p1 = idx[a % idx.length];
      var d0 = (i - p0 + 366) % 366, d1 = (p1 - i + 366) % 366, w = d0 / (d0 + d1 || 1);
      var A = by[days[p0]], B = by[days[p1]], f = function (k) { return A[k] + (B[k] - A[k]) * w; };
      return { md: md, gs: f('g'), js: f('j'), ss: f('ss'), es: null, ns: (A.n || A.g) + ((B.n || B.g) - (A.n || A.g)) * w };
    });
  }
  // MyWater 기준저수량: 0·빈 값은 그 단계 기준이 정해지지 않은 것(예: 감포댐 주의·경계 0)
  function thrTxt(v) { return v > 0 ? fmt(v, 1) : '-'; }
  function snapDays(dam) { var sn = dam && dam.mw && dam.mw.snapshots; if (!sn) return 0; var md = {}; Object.keys(sn).forEach(function (d) { if (sn[d] && sn[d].g > 0 && sn[d].ss > 0) md[d.slice(4)] = 1; }); return Object.keys(md).length; }   // 서로 다른 월·일 수(300 이상이면 분석)
  function hasStage(name) { return (name === '운문댐' && !!P) || !!BASES[name] || !!snapBaseline(damByName(name)); }
  function rivers() {
    var r = []; DAMS.forEach(function (d) { if (d.river && r.indexOf(d.river) < 0) r.push(d.river); });
    var ord = ['한강', '낙동강', '금강', '섬진강', '영산강', '기타'], rk = function (x) { var i = ord.indexOf(x); return i < 0 ? 99 : i; };
    return r.sort(function (a, b) { return rk(a) - rk(b); });
  }
  function damOptions(filterFn) {
    return rivers().map(function (rv) {
      var ds = DAMS.filter(function (d) { return d.river === rv && (!filterFn || filterFn(d)); });
      return ds.length ? '<optgroup label="' + esc(rv) + '">' + ds.map(function (d) { return '<option>' + esc(d.name) + '</option>'; }).join('') + '</optgroup>' : '';
    }).join('');
  }

  /* ================= 물수지 모형 ================= */
  var MC = {}, HVC = {};
  /** MyWater 공식 수위-저수용량 곡선식(data/curves.js) – 없으면 관측 수위·저수량 쌍으로 대체 */
  function curveOf(dam) { var c = window.HVCURVES && dam.code ? window.HVCURVES.dams[dam.code] : null; return c && c.table && c.table.length > 5 ? c : null; }
  function hvOf(dam) {
    if (HVC[dam.name]) return HVC[dam.name];
    var c = curveOf(dam);
    HVC[dam.name] = c ? WB.curveFns(c.table) : WB.hvFromObs(dam.mw.h, dam.mw.s).fns;
    return HVC[dam.name];
  }
  function model(dam, src) {
    src = src === 'd05' && dam.d05 ? 'd05' : (dam.mw ? 'mywater' : 'd05');
    var dem = S.damDemand[dam.name];
    var key = dam.name + '|' + src + '|' + (dem == null ? '' : dem);
    if (MC[key]) return MC[key];
    var m, hv = null;
    if (src === 'd05') {
      m = WB.fromD05(dam.d05);
      hv = WB.curveFns(dam.d05.curve);
      if (dem != null) { var tot = 0; m.demand.forEach(function (v, i) { tot += v * m.dt[i]; }); var cur = tot * 86400 / 1e6 / (m.dates.length * 5 / 365); var f = dem / cur; m.demand = m.demand.map(function (v) { return v * f; }); }
    } else {
      hv = hvOf(dam);
      var o = {};
      if (dem != null) o.annualMcm = dem;
      if (dam.basic.lwl != null && curveOf(dam)) o.sMin = hv.vOfH(dam.basic.lwl);   // MyWater 공식 곡선식으로 저수위 저수량
      m = WB.fromMyWater(dam.mw, hv, o);
    }
    m.hv = hv; m.src = src;
    m.annualMcm = (function () { var t = 0; m.demand.forEach(function (v, i) { t += v * m.dt[i]; }); var days = 0; m.dt.forEach(function (x) { days += x; }); return t * 86400 / 1e6 / (days / 365); })();
    MC[key] = m;
    return m;
  }
  var EC = {};
  function evalDam(dam) {
    var m = model(dam, S.src), key = dam.name + '|' + m.src + '|' + S.crit + '|' + (S.damDemand[dam.name] == null ? '' : S.damDemand[dam.name]);
    if (EC[key]) return EC[key];
    var base = WB.run(m, 0), mt0 = WB.metrics(m, base);
    var add = WB.maxAdd(m, crit());
    // 외부 도수 의존: ① 기존 공급량이 평균 유입량의 1.3배 초과, ② 유역면적 대비 유입량이 자연 유출로 볼 수 없는 수준(연 1,500mm 초과, 국내 하천은 대개 500~1,000mm)
    var runoffMm = m.src === 'mywater' && m.meanInflow != null && dam.basic.basin > 0 ? m.meanInflow * 31536 / dam.basic.basin : null;
    var transfer = runoffMm != null && runoffMm > 1500;
    var external = m.src === 'mywater' && m.meanInflow != null && (m.dCms > m.meanInflow * 1.3 || transfer);
    var unknown = m.src === 'mywater' && !(dam.basic.annualSupply > 0) && S.damDemand[dam.name] == null;
    var grade = external ? 'X' : unknown ? 'U' : add == null ? 'C' : add * 86400 >= 0.1 * m.annualMcm * 1e6 / 365 ? 'A' : add >= 0 ? 'B' : 'C';
    var r = { dam: dam, m: m, base: base, mt0: mt0, addCms: add, addCmd: add == null ? null : add * 86400, external: external, transfer: transfer, runoffMm: runoffMm, unknown: unknown, grade: grade };
    EC[key] = r; return r;
  }
  var GRADE = { A: ['여유', 'l0'], B: ['소폭 여유', 'l1'], C: ['여유 없음', 'lx'], X: ['평가 부적합', 'lx'], U: ['기존공급 미상', 'l1'] };
  var LINKED = REG.linked || {};   // MyWater 용수공급전망(용수댐) 안내: 연계 가뭄관리

  /* ================= 가뭄단계(조정기준) 데이터셋 ================= */
  var SDS = {};
  function stageDataset(name) {
    if (SDS[name]) return SDS[name];
    var ds = null;
    if (name === '운문댐' && P && !BASES[name]) {
      ds = E.prepare({ name: '운문댐', baseline: P.unmun.baseline, daily: P.unmun.daily, lag: P.unmun.lag });
      ds.sourceNote = '';
    } else if (BASES[name] || snapBaseline(damByName(name))) {
      var dam = damByName(name); if (!dam || !dam.mw) return null;
      var bl = BASES[name] || snapBaseline(dam);
      var m = model(dam, 'mywater'), mw = dam.mw, off = WB.diffDays(mw.start, m.dates[0]), daily = [];
      for (var i = off; i < mw.n; i++) if (mw.s[i] != null) daily.push({ date: WB.addDays(mw.start, i), h: mw.h[i], s: mw.s[i], actual: null });
      ds = E.prepare({ name: name, baseline: bl, daily: daily, lag: {} });
      ds.sourceNote = BASES[name] ? 'MyWater 일자료 + 사용자 기준선 CSV' : 'MyWater 일자료 + MyWater 기준저수량 누적(' + snapDays(dam) + '일)';
    }
    SDS[name] = ds; return ds;
  }

  /* ================= 공통 컨트롤 ================= */
  function initControls() {
    qsa('.critSel').forEach(function (sel) {
      sel.innerHTML = CRIT_SEL.map(function (k) { return '<option value="' + k + '">' + CRITS[k].label + '</option>'; }).join('');
      sel.value = S.crit;
      sel.onchange = function () { S.crit = this.value; qsa('.critSel').forEach(function (x) { x.value = S.crit; }); save(); renderTab(); };
    });
    qsa('.srcSel').forEach(function (sel) {
      sel.value = S.src;
      sel.onchange = function () { S.src = this.value; qsa('.srcSel').forEach(function (x) { x.value = S.src; }); save(); renderTab(); };
    });
    $('tabs').addEventListener('click', function (e) {
      var t = e.target.dataset.tab; if (!t) return;
      S.tab = t; save(); showTab();
    });
    window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(renderTab, 150); });
    $('btnPrint').onclick = printReport;
    var stamp = MW ? 'MyWater 수집 ' + MW.collected.replace('T', ' ') + ' · 댐 ' + MW.dams.length + '개' : 'MyWater 자료 없음 (tools/collect_mywater.py 실행 필요)';
    $('dataStamp').textContent = stamp;
  }
  var rz = null;
  function showTab() {
    qsa('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === S.tab); });
    qsa('.tab').forEach(function (s) { s.classList.toggle('on', s.id === 'tab-' + S.tab); });
    renderTab();
  }
  function renderTab() {
    try {
      if (S.tab === 'overview') renderOverview();
      if (S.tab === 'dam') renderDam();
      if (S.tab === 'stage') { renderStage(); renderUpload(); }
      if (S.tab === 'plant') { renderSurplus(); if ($('plCheck').open) { renderPlant(); renderCost(); } }
      if (S.tab === 'level') renderLevel();
    } catch (err) { console.error(err); }
  }

  /* ================= 지도 (SVG 개략도) ================= */
  function drawMap(el, o) {
    var pts = [];
    (o.dams || DAMS).forEach(function (d) { var c = coordOf(d.name); if (c) pts.push({ t: 'dam', d: d, c: c }); });
    var dl = pts.map(function (x) { return x.c[0]; }), dn = pts.map(function (x) { return x.c[1]; });
    var bb = dl.length ? [Math.min.apply(null, dl) - 0.3, Math.max.apply(null, dl) + 0.3, Math.min.apply(null, dn) - 0.3, Math.max.apply(null, dn) + 0.3] : null;
    plants().concat(o.extraPlants || []).forEach(function (p) {
      if (p.lat == null || p.lon == null) return;
      if (o.dams && bb && p.id !== o.selPlant && !(p.lat >= bb[0] && p.lat <= bb[1] && p.lon >= bb[2] && p.lon <= bb[3])) return;
      pts.push({ t: 'plant', p: p, c: [p.lat, p.lon] });
    });
    if (!pts.length) { el.innerHTML = '<p class="hint">좌표가 없습니다.</p>'; return; }
    // 범위: 점들을 감싸되 최소 폭 확보, 화면 비율에 맞춰 왜곡 없이 확장
    var la = pts.map(function (x) { return x.c[0]; }), lo = pts.map(function (x) { return x.c[1]; });
    var minLa = Math.min.apply(null, la), maxLa = Math.max.apply(null, la), minLo = Math.min.apply(null, lo), maxLo = Math.max.apply(null, lo);
    var cLa = (minLa + maxLa) / 2, cLo = (minLo + maxLo) / 2, k = Math.cos(cLa * Math.PI / 180);
    var spLa = Math.max(0.5, (maxLa - minLa) * 1.18 + 0.14), spLo = Math.max(0.6, (maxLo - minLo) * 1.18 + 0.2);
    var rr = (o.ratio || [0.62, 1.25]).slice(), cw = el.clientWidth;
    if (o.maxH && cw > 0) { rr[1] = Math.max(0.35, Math.min(rr[1], o.maxH / cw)); rr[0] = Math.min(rr[0], rr[1]); }   // 화면에서 지도 높이가 maxH(px)를 넘지 않게 범위를 옆으로 넓힘
    var Wd = 600, ratio = Math.min(rr[1], Math.max(rr[0], spLa / (spLo * k))), Hd = Math.round(Wd * ratio);   // 정수장 탭은 납작하게(표 옆에서 길게 늘어지지 않게)
    if (spLa / (spLo * k) > ratio) spLo = spLa / (ratio * k); else spLa = spLo * k * ratio;
    minLa = cLa - spLa / 2; maxLa = cLa + spLa / 2; minLo = cLo - spLo / 2; maxLo = cLo + spLo / 2;
    var X = function (lon) { return (lon - minLo) / (maxLo - minLo) * Wd; }, Y = function (lat) { return (maxLa - lat) / (maxLa - minLa) * Hd; };
    var f1 = function (v) { return Math.round(v * 10) / 10; };
    var s = '<svg viewBox="0 0 ' + Wd + ' ' + Hd + '" role="img" aria-label="댐·정수장 위치도"><rect width="' + Wd + '" height="' + Hd + '" class="sea"/>';
    var bm = GIS && GIS.basemap;
    if (bm) {
      bm.sido.forEach(function (sd) {
        var dpath = sd.rings.map(function (r) { return 'M' + r.map(function (p) { return f1(X(p[0])) + ' ' + f1(Y(p[1])); }).join('L') + 'Z'; }).join('');
        s += '<path d="' + dpath + '" class="land"/>';
      });
      bm.rivers.forEach(function (r) { s += '<path d="M' + r.map(function (p) { return f1(X(p[0])) + ' ' + f1(Y(p[1])); }).join('L') + '" class="river"/>'; });
      bm.sido.forEach(function (sd) {
        var r = sd.rings.slice().sort(function (a, b) { return b.length - a.length; })[0], cx = 0, cy = 0;
        r.forEach(function (p) { cx += p[0]; cy += p[1]; }); cx /= r.length; cy /= r.length;
        if (cx > minLo && cx < maxLo && cy > minLa && cy < maxLa) s += '<text x="' + f1(X(cx)) + '" y="' + f1(Y(cy)) + '" class="sido">' + esc(sd.name) + '</text>';
      });
    } else {
      s += '<text x="12" y="20" class="sido" text-anchor="start">배경지도 없음 – tools/collect_gis.py 실행</text>';
    }
    (o.links || []).forEach(function (l) {
      var a = coordOf(l.dam), p = l.plant; if (!a || p.lat == null) return;
      s += '<line x1="' + f1(X(a[1])) + '" y1="' + f1(Y(a[0])) + '" x2="' + f1(X(p.lon)) + '" y2="' + f1(Y(p.lat)) + '" class="link l' + l.level + '"/>';
    });
    // 이름표 겹침 회피: 표식 자리를 먼저 점유하고, 우선순위(선택 > 댐 > 정수장) 순서로 8방향 후보 중 빈 자리에 배치
    var boxes = [], marks = '', labels = '';
    pts.forEach(function (x) { x.x = X(x.c[1]); x.y = Y(x.c[0]); boxes.push([x.x - 7, x.y - 7, x.x + 7, x.y + 7]); });
    var hit = function (b) {
      if (b[0] < 2 || b[1] < 2 || b[2] > Wd - 2 || b[3] > Hd - 30) return true;
      for (var i = 0; i < boxes.length; i++) { var c = boxes[i]; if (b[0] < c[2] && b[2] > c[0] && b[1] < c[3] && b[3] > c[1]) return true; }
      return false;
    };
    var pri = function (a) { return (a.t === 'dam' && a.d.name === o.selDam) || (a.t === 'plant' && a.p.id === o.selPlant) ? 0 : a.t === 'dam' ? 1 : 2; };
    pts.slice().sort(function (a, b) { return pri(a) - pri(b); }).forEach(function (x) {
      var txt = x.t === 'dam' ? x.d.name.replace(/댐$/, '') : x.p.name.replace(/정수장/, '').trim();
      if (x.t === 'plant' && DAMS.some(function (d) { return d.name.replace(/댐$/, '') === txt; })) txt += '(정)';
      var w = txt.length * 11.5 + 4, h = 15;
      var cand = [[9, -h / 2, 'start'], [-9, -h / 2, 'end'], [0, -h - 7, 'middle'], [0, 7, 'middle'], [8, -h - 3, 'start'], [8, 3, 'start'], [-8, -h - 3, 'end'], [-8, 3, 'end']];
      for (var i = 0; i < cand.length; i++) {
        var c = cand[i], ax = x.x + c[0], x0 = c[2] === 'start' ? ax : c[2] === 'end' ? ax - w : ax - w / 2, y0 = x.y + c[1], b = [x0, y0, x0 + w, y0 + h];
        if (!hit(b)) {
          boxes.push(b);
          labels += '<text x="' + f1(ax) + '" y="' + f1(y0 + h - 3.5) + '" text-anchor="' + c[2] + '" class="ml' + (x.t === 'plant' ? ' pl' : '') + '">' + esc(txt) + '</text>';
          break;
        }
      }
    });
    pts.forEach(function (x) {
      if (x.t === 'dam') {
        var cs = curStage(x.d), stg = cs ? E.stageCode(cs.stage) : -1, col = stg > 0 ? SC[stg] : stg === 0 ? '#2f9e6e' : '#9aa7b4', sel = o.selDam === x.d.name;
        marks += '<g class="mdam" data-dam="' + esc(x.d.name) + '"><circle cx="' + f1(x.x) + '" cy="' + f1(x.y) + '" r="' + (sel ? 7.5 : 5.5) + '" fill="' + col + '" stroke="' + (sel ? '#111' : '#fff') + '" stroke-width="' + (sel ? 2 : 1.5) + '"/>' +
          '<title>' + esc(x.d.name) + (cs ? ' · 현재 ' + cs.stage + (cs.src !== 'MyWater' ? '(가뭄포털)' : '') : '') + '</title></g>';
      } else {
        var on = o.selPlant === x.p.id;
        marks += '<g class="mplant" data-plant="' + esc(x.p.id) + '"><rect x="' + f1(x.x - 4.5) + '" y="' + f1(x.y - 4.5) + '" width="9" height="9" rx="1.5" fill="' + (on ? '#e0662b' : '#fff') + '" stroke="#1d4f86" stroke-width="1.6"/><title>' + esc(x.p.name) + '</title></g>';
      }
    });
    s += marks + labels;
    var lg = [['#2f9e6e', '정상'], [SC[1], '관심'], [SC[2], '주의'], [SC[3], '경계·심각'], ['#9aa7b4', '정보 없음']];
    s += '<g class="mlegend" transform="translate(8,' + (Hd - 25) + ')"><rect x="0" y="0" width="' + (lg.length * 62 + 66) + '" height="19" rx="4"/>' +
      lg.map(function (l, i) { return '<circle cx="' + (10 + i * 62) + '" cy="9.5" r="4.5" fill="' + l[0] + '"/><text x="' + (18 + i * 62) + '" y="13.5">' + l[1] + '</text>'; }).join('') +
      '<rect x="' + (lg.length * 62 + 6) + '" y="5" width="9" height="9" rx="1.5" fill="#fff" stroke="#1d4f86" stroke-width="1.5"/><text x="' + (lg.length * 62 + 20) + '" y="13.5">정수장</text></g>';
    s += '</svg>';
    el.innerHTML = s;
    if (o.onDam) qsa('#' + el.id + ' .mdam').forEach(function (g) { g.onclick = function () { o.onDam(g.dataset.dam); }; });
    if (o.onPlant) qsa('#' + el.id + ' .mplant').forEach(function (g) { g.onclick = function () { o.onPlant(g.dataset.plant); }; });
  }

  /* ================= 종합 현황 ================= */
  function lastObs(dam) {
    var mw = dam.mw; if (!mw) return null;
    for (var i = mw.n - 1; i >= 0; i--) if (mw.s[i] != null) return { date: WB.addDays(mw.start, i), s: mw.s[i], h: mw.h[i] };
    return null;
  }
  function stagePill(stage) {
    if (!stage) return '<span class="muted">-</span>';
    var c = E.stageCode(stage), col = c === 0 ? '#2f9e6e' : SC[c];
    return '<span class="pill" style="background:' + col + '22;color:' + (c === 2 ? '#8a6a00' : col) + '">' + esc(stage) + '</span>';
  }
  // 현재 대응단계: MyWater 오늘 값, 없으면 국가가뭄정보포털(drought.go.kr) 수원현황 가뭄단계
  function curStage(d) {
    if (d.snapshot && d.snapshot.stage) return { stage: d.snapshot.stage, src: 'MyWater' };
    if (d.dg && d.dg.stage) return { stage: d.dg.stage, src: '가뭄포털', date: d.dg.date };
    return null;
  }
  function stageCell(d) {
    var c = curStage(d); if (!c) return '<span class="muted">-</span>';
    return stagePill(c.stage) + (c.src !== 'MyWater' ? ' <span class="tag" title="MyWater에 단계가 없어 국가가뭄정보포털(기후에너지환경부) 수원현황 ' + esc(c.date || '') + ' 값을 씁니다">가뭄포털</span>' : '');
  }
  function sharedSnap(d) {
    if (!d.snapshot || d.snapshot.g == null) return false;
    return DAMS.some(function (o) { return o !== d && o.snapshot && o.snapshot.g === d.snapshot.g && o.snapshot.j === d.snapshot.j; });
  }
  var ovBound = false;
  function renderOverview() {
    if (!ovBound) {
      ovBound = true;
      $('fRiver').innerHTML = '<option value="">전체</option>' + rivers().map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('');
      $('fKind').onchange = function () { S.fKind = this.value; save(); renderOverview(); };
      $('fRiver').onchange = function () { S.fRiver = this.value; save(); renderOverview(); };
    }
    $('fKind').value = S.fKind || ''; $('fRiver').value = S.fRiver || '';
    var shown = DAMS.filter(function (d) { return (!S.fKind || d.kind === S.fKind) && (!S.fRiver || d.river === S.fRiver); });
    var rows = shown.map(function (d) { return { d: d, ev: evalDam(d), obs: lastObs(d) }; });
    var warn = rows.filter(function (r) { var cs = curStage(r.d); return cs && E.stageCode(cs.stage) >= 2; }).length;
    var surplus = rows.filter(function (r) { return r.ev.grade === 'A' || r.ev.grade === 'B'; });  // 미상(U)·부적합(X) 제외
    var sumAdd = surplus.reduce(function (a, r) { return a + r.ev.addCmd; }, 0);
    $('ovKpis').innerHTML = [
      ['평가 댐', rows.length + '개', (S.fKind || '다목적·용수댐') + ' · ' + (S.fRiver || '전국') + (MW ? ' (MyWater)' : '')],
      ['현재 주의 이상 단계', warn + '개', MW && MW.dams[0] && rows[0].d.snapshotDate ? rows[0].d.snapshotDate.replace(/(\d{4})(\d\d)(\d\d)/, '$1.$2.$3') + ' 기준' : ''],
      ['추가 공급 여유 댐', surplus.length + '개', '판정: ' + crit().label],
      ['여유량 합계', man(sumAdd) + ' 만㎥/일', '여유 댐 합산(연계 불고려)']
    ].map(function (k) { return '<div class="kpi"><div class="k">' + k[0] + '</div><div class="v">' + k[1] + '</div><div class="d muted">' + k[2] + '</div></div>'; }).join('');
    $('ovHint').textContent = S.src === 'd05' ? '장기모의 반순자료는 6개 댐만 있으며 나머지는 MyWater 일자료로 계산합니다.' : '';
    drawMap($('ovMap'), { maxH: 480, dams: shown, selDam: S.dam, onDam: function (n) { S.dam = n; S.tab = 'dam'; save(); showTab(); } });
    // 계획 공급량 대비 비율(%)로 그림: 큰 댐의 절대량이 화면을 지배하지 않게. 음수는 '단독 모의로는 추가 여유 없음'이라 중립색
    var items = rows.filter(function (r) { return r.ev.addCmd != null && !r.ev.external; }).map(function (r) {
      var plan = r.ev.m.annualMcm * 1e6 / 365, a = r.ev.addCmd;
      if (r.ev.unknown || !(plan > 0)) return { label: r.d.name, v: 0, text: '계획량 미상 · 단독 +' + man(a) + '만', textColor: '#8a96a3' };
      var v = a / plan * 100;
      return { label: r.d.name, v: v, color: v >= 0 ? '#2f9e6e' : '#b9c3cd', textColor: v >= 0 ? null : '#6b7785',
        text: (v >= 0 ? '+' + fmt(v, 0) + '% (+' + man(a) + '만)' : '여유 없음 ' + fmt(v, 0) + '%') + ' · 계획 ' + man(plan) + '만' };
    });
    var cv = $('cOvBars'); cv.parentNode.style.height = Math.max(260, items.length * 22 + 20) + 'px';
    C.drawHBars(cv, items, '%');
    var h = '<table class="t"><tr><th>댐</th><th>수계</th><th>구분</th><th>최근 저수량<br>(백만㎥)</th><th>저수율<br>(상시만수위)</th><th>현재 대응단계</th><th>기준저수량 관심/주의/심각</th><th>계획 공급량<br>(연 백만㎥ / 일평균 만㎥)</th><th>모의기간</th><th>연 부족<br>(회/년)</th><th>일 신뢰도</th><th>추가 여유<br>(단독 모의, 만㎥/일)</th><th>평가</th></tr>';
    rows.forEach(function (r) {
      var d = r.d, ev = r.ev, m = ev.m, sn = d.snapshot, g = GRADE[ev.grade];
      h += '<tr class="click" data-dam="' + esc(d.name) + '"><td><b>' + esc(d.name) + '</b>' + (hasStage(d.name) ? ' <span class="tag">단계분석</span>' : '') + (d.d05 ? ' <span class="tag">장기모의</span>' : '') + '</td><td>' + esc(d.river || '') + '</td><td>' + d.kind + '</td>' +
        '<td>' + (r.obs ? fmt(r.obs.s, 1) : '-') + '</td><td>' + (r.obs && m.sMax ? pct(r.obs.s / m.sMax, 0) : '-') + '</td>' +
        '<td>' + stageCell(d) + '</td><td>' + (sn && !(sn.g > 0) ? '<span class="muted small">미적용' + (LINKED[d.name] ? '(연계: ' + esc(LINKED[d.name]) + ')' : '') + '</span>' : '') + (sn && sn.g ? thrTxt(sn.g) + ' / ' + thrTxt(sn.j) + ' / ' + thrTxt(sn.ss) + (!(sn.j > 0) ? ' <span class="muted small" title="MyWater가 0 또는 빈 값으로 공개한 단계는 기준이 정해지지 않은 것으로 봅니다.">(주의 미설정)</span>' : '') + (sharedSnap(d) ? ' <span class="tag">연계</span>' : '') : (sn ? '' : '<span class="muted">-</span>')) + '</td>' +
        '<td>' + (ev.unknown ? '<span class="muted">미상</span>' : fmt(m.annualMcm, 1) + ' / ' + man(m.annualMcm * 1e6 / 365)) + '</td><td>' + m.dates[0].slice(0, 4) + '~' + m.dates[m.dates.length - 1].slice(0, 4) + (m.src === 'd05' ? ' (장기모의)' : '') + '</td>' +
        '<td>' + ev.mt0.year.def + '/' + ev.mt0.year.n + '</td><td>' + pct(ev.mt0.stepRel, 1) + '</td>' +
        '<td class="' + (ev.addCmd > 0 ? 'down' : 'muted') + '">' + (ev.external ? '-' : (ev.addCmd > 0 ? '+' : '') + man(ev.addCmd)) + '</td><td><span class="pill ' + g[1] + '">' + g[0] + '</span></td></tr>';
    });
    h += '</table><p class="hint">‘추가 공급 가능’은 기존 공급량(MyWater 연간 용수공급용량)을 유지한 채 판정 기준을 만족하는 최대 추가량입니다. 음수는 같은 단순 조건(댐 단독, 매일 같은 양, 1990년 이후 실측 유입)으로는 계획량 위에 더 낼 여유가 없다는 뜻이며, 계획량이 잘못됐다는 뜻은 아닙니다. ‘평가 부적합’은 외부 도수에 의존해(기존 공급량이 유입량보다 크거나, 다른 하천에서 끌어온 물이 유입량에 섞여 있어) 단독 물수지로 평가할 수 없는 댐입니다. 행을 클릭하면 상세 평가로 이동합니다.</p>';
    $('ovTable').innerHTML = h;
    qsa('#ovTable tr.click').forEach(function (tr) { tr.onclick = function () { S.dam = tr.dataset.dam; S.tab = 'dam'; save(); showTab(); }; });
  }

  /* ================= 댐 평가 ================= */
  var damTS = null, damYear = 'recent';
  function renderDam() {
    var sel = $('damSel');
    if (!sel.options.length) {
      sel.innerHTML = damOptions();
      sel.onchange = function () { S.dam = this.value; save(); renderDam(); };
      $('damDemand').oninput = function () { var v = this.value === '' ? null : +this.value; if (v == null) delete S.damDemand[S.dam]; else S.damDemand[S.dam] = v; save(); clearTimeout(rz); rz = setTimeout(renderDam, 250); };
      $('damAdd').oninput = function () { S.damAdd = +this.value || 0; save(); clearTimeout(rz); rz = setTimeout(renderDam, 250); };
      $('damAdd').onkeydown = function (e) { if (e.key === 'Enter') $('damRun').click(); };
      $('damRun').onclick = function () { clearTimeout(rz); S.damAdd = +$('damAdd').value || 0; save(); renderDam(); var b = this; b.textContent = '계산 완료'; setTimeout(function () { b.textContent = '다시 계산'; }, 1200); };
    }
    var dam = damByName(S.dam) || DAMS[0]; S.dam = dam.name; sel.value = dam.name;
    var ev = evalDam(dam), m = ev.m, q = +S.damAdd || 0;
    $('damDemand').value = S.damDemand[dam.name] != null ? S.damDemand[dam.name] : '';
    $('damDemand').placeholder = fmt(m.annualMcm, 1);
    $('damAdd').value = q;
    var rq = WB.run(m, q / 86400), mtq = WB.metrics(m, rq), ok = WB.meets(mtq, crit());
    var lvl = ev.external || (ev.unknown && ok) ? 1 : ok ? 0 : 2;
    // 추가량 0에서 미달이면 '공급 곤란'이 아니라 단독 모의 기준 '여유 없음'(중립 표시)
    var noRoom = !ok && !ev.external && q <= 0;
    $('damVerdict').className = 'verdict' + (noRoom ? '' : ' l' + lvl);
    $('damVerdict').innerHTML = '<div class="stamp">' + (ev.external ? '평가 부적합' : noRoom ? '여유 없음' : !ok ? '추가 공급 곤란' : ev.unknown ? '조건부 가능' : '공급 가능') + '</div><div class="title">' + esc(dam.name) + ' · 기존 ' + man(m.annualMcm * 1e6 / 365) + '만㎥/일 + 추가 ' + man(q) + '만㎥/일</div>' +
      '<ul><li>판정 기준: ' + crit().label + ' → 추가 후 부족 ' + mtq.year.def + '/' + mtq.year.n + '년, 연단위 신뢰도 ' + pct(mtq.year.rel) + '</li>' +
      '<li>기준을 만족하는 최대 추가 공급량: <b>' + (ev.addCmd == null ? '산정 불가' : man(ev.addCmd) + '만㎥/일') + '</b>' + (ev.addCmd != null && ev.addCmd < 0 ? ' (댐 단독·매일 같은 양이라는 단순 조건에서는 계획량 위에 더 낼 여유가 없음. 계획량의 적정성 판단 자료는 아님 — 종합 현황 설명 참고)' : '') + '</li>' +
      (ev.unknown ? '<li><b>MyWater 제원의 연간 용수공급용량이 0입니다' + (LINKED[dam.name] ? '(' + LINKED[dam.name] + '와 연계 가뭄관리 댐)' : '') + '. 실제 기존 공급량을 위 칸에 입력해야 정확한 여유량이 나옵니다.</b></li>' : '') +
      (ev.external ? (ev.transfer ? '<li>MyWater 유입량이 유역(' + fmt(dam.basic.basin, 1) + '㎢)에서 나올 수 있는 양보다 훨씬 큽니다(연 ' + fmt(ev.runoffMm, 0) + 'mm, 국내 하천은 대개 500~1,000mm). 다른 하천에서 끌어온 물(도수)이 유입량에 섞여 있어, 댐 혼자의 여유량으로 볼 수 없습니다.</li>' : '<li>기존 공급량(' + fmt(m.dCms, 2) + '㎥/s)이 평균 유입량(' + fmt(m.meanInflow, 2) + '㎥/s)보다 커서 외부 도수에 의존하는 댐입니다.</li>') : '') +
      (hasStage(dam.name) ? '<li>가뭄단계(조정기준) 분석 가능 → [가뭄단계 분석] 탭</li>' : '') + '</ul>';
    var o0 = ev.mt0;
    // 카드는 판단에 바로 쓰는 세 가지만: 몇 번·얼마나 오래 모자랐나, 얼마나 바닥까지 내려갔나 (나머지는 아래 신뢰도 지표 표)
    var du = m.src === 'd05' ? '반순' : '일', lwl = dam.basic.lwl;
    var minH = m.hv && m.hv.hOfV ? m.hv.hOfV(mtq.minS) : null, atLwl = minH != null && lwl != null && minH <= lwl + 0.05;
    var k = [
      ['부족한 해 (기존 → 추가)', o0.year.def + ' → ' + mtq.year.def + '번', '분석 ' + o0.year.n + '년 중'],
      ['가장 길게 모자란 기간', mtq.maxDefDur ? mtq.maxDefDur + du : '없음', '기존 ' + (o0.maxDefDur ? o0.maxDefDur + du : '없음')],
      [minH != null ? '최저 수위 (모의)' : '최저 저수량 (모의)', minH != null ? 'EL.' + fmt(minH, 1) + (atLwl ? ' <span class="small muted">저수위 도달</span>' : '') : fmt(mtq.minS, 1) + ' 백만㎥',
        (minH != null ? fmt(mtq.minS, 1) + '백만㎥ · ' : '') + mtq.minDate + (lwl != null && !atLwl ? ' · 저수위 EL.' + lwl : '')]
    ];
    $('damKpis').innerHTML = k.map(function (x) { return '<div class="kpi"><div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div><div class="d muted">' + x[2] + '</div></div>'; }).join('');
    // 시계열
    if (!damTS) damTS = new C.TimeSeries($('cDam'), $('tipDam'));
    var years = []; m.dates.forEach(function (d) { var y = d.slice(0, 4); if (years.indexOf(y) < 0) years.push(y); });
    var segs = [['recent', '최근 6년'], ['all', '전체']].concat(years.slice(-6).map(function (y) { return [y, y]; }));
    $('damYearSeg').innerHTML = segs.map(function (s) { return '<button data-y="' + s[0] + '"' + (String(damYear) === s[0] ? ' class="on"' : '') + '>' + s[1] + '</button>'; }).join('');
    qsa('#damYearSeg button').forEach(function (b) { b.onclick = function () { damYear = b.dataset.y; renderDam(); }; });
    var idx = [], y0 = years.length > 6 ? years[years.length - 6] : years[0];
    m.dates.forEach(function (d, i) { var y = d.slice(0, 4); if (damYear === 'all' || (damYear === 'recent' && y >= y0) || y === damYear) idx.push(i); });
    var step = idx.length > 4000 ? Math.ceil(idx.length / 4000) : 1; idx = idx.filter(function (_, j) { return j % step === 0; });
    damTS.set({
      t: idx.map(function (i) { var p = m.dates[i].split('-'); return new Date(+p[0], p[1] - 1, +p[2]).getTime(); }),
      labels: idx.map(function (i) { return m.dates[i]; }),
      series: [
        { name: '관측', data: idx.map(function (i) { return m.observed ? m.observed[i] : (dam.d05 ? dam.d05.series[i][4] : null); }), color: '#9aa7b4', width: 1.5 },
        { name: '모의(기존)', data: idx.map(function (i) { return ev.base.storage[i]; }), color: '#1d4f86', width: 1.5 },
        { name: '모의(기존+추가)', data: idx.map(function (i) { return rq.storage[i]; }), color: '#e0662b', width: 1.5 },
        { name: '저수위', data: idx.map(function () { return m.sMin; }), color: '#111', width: 1, dash: [6, 3] },
        { name: '상시만수위', data: idx.map(function () { return m.sMax; }), color: '#111', width: 1, dash: [2, 3] }
      ],
      yLabel: '저수량 (백만㎥)', strips: [], stageLabel: E.STAGE_LABEL,
      extra: function (j) { var i = idx[j]; return '<div class="small" style="opacity:.8">유입 ' + fmt(m.inflow[i], 2) + '㎥/s · 부족 ' + fmt(rq.deficit[i], 2) + '㎥/s</div>'; }
    });
    // 신뢰도 표
    function relRows(mt) { return [pct(mt.stepRel, 2), pct(mt.ten.rel, 2), pct(mt.mon.rel, 2), pct(mt.year.rel, 2) + ' (' + mt.year.def + '/' + mt.year.n + ')', pct(mt.qRel, 3), fmt(mt.qDef, 2), fmt(mt.resilience, 3), mt.maxDefDur, fmt(mt.vulnerability, 2), fmt(mt.vulnDimless, 3)]; }
    var lab = [(m.src === 'd05' ? '반순' : '일') + ' 기간신뢰도', '순 기간신뢰도', '월 기간신뢰도', '연(수문년) 기간신뢰도', '양적신뢰도', '총 부족량 (백만㎥)', '회복도 (부족사상/부족기간)', '최대 연속 부족기간', '취약도: 최대 단위기간 부족량 (백만㎥)', '무차원 취약도'];
    var a = relRows(o0), b = relRows(mtq);
    $('damRel').innerHTML = '<table class="t"><tr><th>지표</th><th>기존 공급</th><th>기존+추가</th></tr>' + lab.map(function (l, i) { return '<tr><td>' + l + '</td><td>' + a[i] + '</td><td>' + b[i] + '</td></tr>'; }).join('') + '</table>';
    // 제원
    var bs = dam.basic || {};
    var spec = [['상시만수위', 'EL.' + (bs.nwl != null ? bs.nwl : '-') + ' m', fmt(m.sMax, 1) + ' 백만㎥'], ['홍수기제한수위', bs.fwl ? 'EL.' + bs.fwl + ' m' : '-', m.sMaxFlood ? fmt(m.sMaxFlood, 1) + ' 백만㎥' : '-'],
      ['저수위', 'EL.' + (bs.lwl != null ? bs.lwl : '-') + ' m', fmt(m.sMin, 1) + ' 백만㎥'], ['총저수용량', fmt(bs.totalStorage, 1) + ' 백만㎥', ''], ['유효저수량', fmt(bs.effStorage, 1) + ' 백만㎥', ''],
      ['연간 용수공급용량', fmt(bs.annualSupply, 1) + ' 백만㎥/년', man(bs.annualSupply * 1e6 / 365) + ' 만㎥/일'], ['유역면적', fmt(bs.basin, 1) + ' ㎢', ''], ['평균 유입량(모의기간)', fmt(m.meanInflow, 2) + ' ㎥/s', man(m.meanInflow * 86400) + ' 만㎥/일'],
      ['형식', bs.type || '-', dam.kind]];
    $('damSpec').innerHTML = '<table class="t">' + spec.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('') + '</table>' +
      (REG.systems[dam.name] ? '<p class="hint">' + esc(REG.systems[dam.name].note) + '</p>' : '');
    var cvf = curveOf(dam);
    renderCurve(dam);
    $('damSpecSrc').textContent = dam.mw ? '— MyWater 기본현황 · 저수량 환산: ' + (cvf ? 'MyWater 곡선식(' + cvf.date.replace(/(\d{4})(\d\d)(\d\d)/, '$1.$2.$3') + ' 적용)' : '관측 수위·저수량 추정') : '— 장기모의';
    // 민감도
    var qMax = Math.max(100000, Math.ceil(Math.max(q, ev.addCmd || 0) * 2 / 10000) * 10000), xs = [], s1 = [], s2 = [], s3 = [];
    for (var j = 0; j <= 30; j++) { var qq = qMax * j / 30, mt = WB.metrics(m, WB.run(m, qq / 86400)); xs.push(qq); s1.push(mt.year.rel * 100); s2.push(mt.stepRel * 100); s3.push(mt.qRel * 100); }
    C.drawLines($('cDamSens'), xs, [{ data: s1, color: '#1d4f86' }, { data: s2, color: '#e0662b' }, { data: s3, color: '#2f9e6e' }],
      { xLabel: '추가 공급량 (㎥/일)', xFmt: function (v) { return (v / 10000) + '만'; }, yDec: 0, vlines: [{ x: q, label: '검토량 ' + man(q) + '만' }].concat(ev.addCmd > 0 ? [{ x: ev.addCmd, label: '한계 ' + man(ev.addCmd) + '만', color: '#2f9e6e', row: 1 }] : []) });
    // D05 비교
    if (dam.d05) {
      $('damD05Card').style.display = '';
      var dm = WB.fromD05(dam.d05), dr = WB.run(dm, dam.d05.addCms), dmt = WB.metrics(dm, dr), x = dam.d05.result;
      var mwm = dam.mw ? model(dam, 'mywater') : null, mwAdd = mwm ? WB.maxAdd(mwm, CRITS.y0) : null, dAdd = WB.maxAdd(dm, CRITS.y0);
      $('damD05').innerHTML = '<table class="t"><tr><th>항목</th><th>장기모의 원결과</th><th>본 엔진 (장기모의 자료)</th><th>본 엔진 (MyWater ' + (mwm ? mwm.dates[0].slice(0, 4) + '~' + mwm.dates[mwm.dates.length - 1].slice(0, 4) : '') + ')</th></tr>' +
        '<tr><td>분석기간</td><td colspan="2">' + dm.dates[0] + ' ~ ' + dm.dates[dm.dates.length - 1] + ' (반순 ' + dm.dates.length + ')</td><td>' + (mwm ? mwm.dates.length + '일' : '-') + '</td></tr>' +
        '<tr><td>추가 확보가능량 (㎥/s)</td><td>' + fmt(dam.d05.addCms, 2) + '</td><td>' + fmt(dAdd, 2) + ' (부족 0회)</td><td>' + (mwAdd == null ? '-' : fmt(mwAdd, 2)) + ' (부족 0회)</td></tr>' +
        '<tr><td>반순 기간신뢰도 (추가량 적용)</td><td>' + x.stepRel + '% (' + x.stepDef + ')</td><td>' + (dmt.stepRel * 100).toFixed(3) + '% (' + dmt.stepDef + ')</td><td>-</td></tr>' +
        '<tr><td>연 기간신뢰도</td><td>' + x.yearRel + '% (' + x.yearDef + '/' + x.yearN + ')</td><td>' + (dmt.year.rel * 100).toFixed(3) + '% (' + dmt.year.def + '/' + dmt.year.n + ')</td><td>-</td></tr>' +
        '<tr><td>총 부족량 (백만㎥)</td><td>' + x.qDef + '</td><td>' + fmt(dmt.qDef, 3) + '</td><td>-</td></tr></table>' +
        '<p class="hint">장기모의 원결과는 분석기간 중 부족 0~1회를 기준으로 추가 확보가능량을 정했습니다. 본 엔진은 같은 자료로 엑셀 결과를 재현합니다. MyWater 열은 최근 가뭄(2022·2025·2026년 등)이 포함된 기간이라 결과가 다를 수 있습니다.</p>';
    } else $('damD05Card').style.display = 'none';
  }

  /* ================= 가뭄단계 분석 (조정기준) ================= */
  var SR = null;
  function stTotalQ() { return S.st.plants.reduce(function (a, p) { return a + (p.on ? +p.q || 0 : 0); }, 0); }
  function stCrit() { var c = S.st.crit; return { warnOk: +c.warnOk, warnBad: +c.warnBad, maxEmergency: +c.maxEmergency, minReliability: (+c.minRel) / 100 }; }
  function stageCompute() {
    var ds = stageDataset(S.st.dam); if (!ds) return null;
    var dam = damByName(S.st.dam), sp = S.st.spec[S.st.dam] || (S.st.spec[S.st.dam] = { nwlH: dam && dam.basic.nwl, lwlH: dam && dam.basic.lwl });
    var nwlS = sp.nwlH != null ? ds.hv.storageOf(+sp.nwlH) : null, lwlS = sp.lwlH != null ? ds.hv.storageOf(+sp.lwlH) : null;
    if (dam && dam.mw && sp.lwlH === dam.basic.lwl) { var mm = model(dam, 'mywater'); lwlS = mm.sMin; nwlS = mm.sMax; }
    var hasLag = Object.keys(ds.lag || {}).length > 0;
    var base = { factors: S.st.factors.map(function (v) { return (+v) / 100; }), carry: S.st.carry, spillReset: nwlS ? nwlS * 0.95 : null, minDays: +S.st.minDays, lag: S.st.lag && hasLag, spec: { lwlS: lwlS } };
    var q = stTotalQ(), cr = stCrit();
    var curSt = E.currentStages(ds), cur = E.summarize(ds, curSt), curSf = E.safety(ds, curSt, null, base.spec);
    var sim = E.simulate(ds, Object.assign({ q: q }, base)), sup = E.summarize(ds, sim.st, sim.sv), supSf = E.safety(ds, sim.st, sim.sv, base.spec);
    var v = E.verdict(cur, sup, supSf, cr), qOk = E.maxFeasibleQ(ds, base, cr, 0, cur), qMid = E.maxFeasibleQ(ds, base, cr, 1, cur);
    var qMax = Math.max(100000, Math.ceil(Math.max(q, qMid) * 1.5 / 10000) * 10000), sens = [];
    for (var k = 0; k <= 40; k++) { var qq = qMax * k / 40, r = E.simulate(ds, Object.assign({ q: qq }, base)), sm = E.summarize(ds, r.st, r.sv); sens.push({ q: qq, drought: sm.drought, warn: sm.warn, em: sm.emergency }); }
    return { ds: ds, sp: sp, nwlS: nwlS, lwlS: lwlS, hasLag: hasLag, base: base, q: q, curSt: curSt, cur: cur, curSf: curSf, sim: sim, sup: sup, supSf: supSf, v: v, qOk: qOk, qMid: qMid, sens: sens };
  }
  /** 정수장 검토용: 특정 댐·공급량의 가뭄단계 판정 */
  function stageVerdictFor(name, q) {
    var ds = stageDataset(name); if (!ds) return null;
    var dam = damByName(name), lwlS = dam && dam.mw ? model(dam, 'mywater').sMin : null;
    var base = { factors: [1, 1, 1, 1, 1], minDays: 1, lag: Object.keys(ds.lag || {}).length > 0, spec: { lwlS: lwlS } };
    var curSt = E.currentStages(ds), cur = E.summarize(ds, curSt);
    var sim = E.simulate(ds, Object.assign({ q: q }, base)), sup = E.summarize(ds, sim.st, sim.sv), sf = E.safety(ds, sim.st, sim.sv, base.spec);
    return { v: E.verdict(cur, sup, sf, { warnOk: 10, warnBad: 30, maxEmergency: 0, minReliability: 0.5 }), cur: cur, sup: sup };
  }
  var stBound = false;
  function bindStage() {
    var names = DAMS.map(function (d) { return d.name; }).filter(hasStage);
    if (names.indexOf('운문댐') < 0 && P) names.unshift('운문댐');
    // 기준선이 있는 댐을 먼저, 나머지 댐도 모두 고를 수 있게(고르면 기준선 안내를 보여 줌)
    var withB = names.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
    var rest = DAMS.filter(function (d) { return d.mw && names.indexOf(d.name) < 0; }).map(function (d) { return '<option value="' + esc(d.name) + '">' + esc(d.name) + ' (기준선 없음)</option>'; }).join('');
    $('stDam').innerHTML = (withB ? '<optgroup label="기준선 있음 (분석 가능)">' + withB + '</optgroup>' : '') + (rest ? '<optgroup label="기준선 없음">' + rest + '</optgroup>' : '');
    if (!damByName(S.st.dam)) S.st.dam = names[0] || (DAMS[0] && DAMS[0].name);
    $('stDam').value = S.st.dam;
    var sp = S.st.spec[S.st.dam] || {};
    var dam = damByName(S.st.dam);
    if (sp.nwlH == null && dam) sp.nwlH = dam.basic.nwl; if (sp.lwlH == null && dam) sp.lwlH = dam.basic.lwl;
    S.st.spec[S.st.dam] = sp;
    $('nwlH').value = sp.nwlH != null ? sp.nwlH : ''; $('lwlH').value = sp.lwlH != null ? sp.lwlH : '';
    $('optLag').checked = S.st.lag; $('optCarry').checked = S.st.carry; $('optMin').value = S.st.minDays;
    $('cWarnOk').value = S.st.crit.warnOk; $('cWarnBad').value = S.st.crit.warnBad; $('cEm').value = S.st.crit.maxEmergency; $('cRel').value = S.st.crit.minRel;
    renderStPlants(); renderFactors();
    if (stBound) return; stBound = true;
    var upd = function (now) { save(); clearTimeout(rz); rz = setTimeout(renderStage, now ? 0 : 200); };
    $('stDam').onchange = function () { S.st.dam = this.value; bindStage(); upd(true); };
    ['nwlH', 'lwlH'].forEach(function (id) { $(id).oninput = function () { S.st.spec[S.st.dam][id] = this.value === '' ? null : +this.value; upd(); }; });
    $('stPlants').oninput = function (e) { var t = e.target, i = +t.dataset.i, k = t.dataset.k; if (k == null) return; S.st.plants[i][k] = k === 'on' ? t.checked : k === 'q' ? +t.value : t.value; $('qTotal').textContent = '합계 ' + fmt(stTotalQ(), 0) + ' ㎥/일'; upd(); };
    $('stPlants').onclick = function (e) { var d = e.target.dataset.del; if (d == null) return; S.st.plants.splice(+d, 1); renderStPlants(); upd(true); };
    $('stAddPlant').onclick = function () { S.st.plants.push({ name: '정수장 ' + (S.st.plants.length + 1), q: 10000, on: true }); renderStPlants(); upd(true); };
    $('factors').oninput = function (e) { var i = e.target.dataset.f; if (i == null) return; S.st.factors[+i] = +e.target.value; upd(); };
    qsa('[data-preset]').forEach(function (b) { b.onclick = function () { S.st.factors = b.dataset.preset === 'cut' ? [100, 100, 80, 50, 0] : [100, 100, 100, 100, 100]; renderFactors(); upd(true); }; });
    $('optLag').onchange = function () { S.st.lag = this.checked; upd(true); };
    $('optCarry').onchange = function () { S.st.carry = this.checked; upd(true); };
    $('optMin').oninput = function () { S.st.minDays = +this.value || 0; upd(); };
    [['cWarnOk', 'warnOk'], ['cWarnBad', 'warnBad'], ['cEm', 'maxEmergency'], ['cRel', 'minRel']].forEach(function (p) { $(p[0]).oninput = function () { S.st.crit[p[1]] = +this.value; upd(); }; });
  }
  function renderStPlants() {
    $('stPlants').innerHTML = S.st.plants.map(function (p, i) {
      return '<tr><td><input type="checkbox" data-i="' + i + '" data-k="on"' + (p.on ? ' checked' : '') + '></td><td><input type="text" data-i="' + i + '" data-k="name" value="' + esc(p.name) + '"></td>' +
        '<td><input type="number" step="1000" data-i="' + i + '" data-k="q" value="' + p.q + '"></td><td><button class="x" data-del="' + i + '" title="삭제">×</button></td></tr>';
    }).join('') + '<tr><td></td><td class="small muted">정수장명</td><td class="small muted" style="text-align:right">㎥/일</td><td></td></tr>';
    $('qTotal').textContent = '합계 ' + fmt(stTotalQ(), 0) + ' ㎥/일';
  }
  function renderFactors() {
    $('factors').innerHTML = ['정상', '관심', '주의', '심각', '비상'].map(function (n, i) { return '<label><i style="background:' + SC[i] + '"></i>' + n + '<input type="number" min="0" max="100" step="5" data-f="' + i + '" value="' + S.st.factors[i] + '"></label>'; }).join('');
  }
  function delta(a, b, d, goodDown) { var x = b - a, cls = Math.abs(x) < 0.5 ? 'flat' : (x > 0) === (goodDown !== false) ? 'up' : 'down'; return '<span class="' + cls + '">' + (x > 0 ? '▲ ' : x < 0 ? '▼ ' : '') + fmt(Math.abs(x), d == null ? 0 : d) + '</span>'; }
  function stageLegend() { return E.STAGE_LABEL.map(function (l, i) { return '<span><i style="background:' + SC[i] + '"></i>' + l + '</span>'; }).join(''); }

  var TS = null, tsYear = 'all', tsMode = 'S', TOG = { obs: true, sim: true, g: true, j: true, s: true, e: true, n: false, lwl: true };
  function renderStage() {
    bindStage();
    SR = stageCompute();
    if (!SR) {
      var d0 = damByName(S.st.dam), cs = d0 ? curStage(d0) : null, sn = d0 && d0.snapshot, nd = d0 ? snapDays(d0) : 0;
      $('verdict').className = 'verdict';
      $('verdict').innerHTML = '<div class="title">' + esc(S.st.dam || '') + ': 가뭄단계 기준선이 없어 공급 영향을 모의할 수 없습니다.</div><ul>' +
        (cs ? '<li>현재 대응단계: ' + stageCell(d0) + (sn && sn.g > 0 ? ' · 오늘 기준저수량 관심/주의/심각 ' + thrTxt(sn.g) + ' / ' + thrTxt(sn.j) + ' / ' + thrTxt(sn.ss) + ' 백만㎥' : '') + '</li>' : '') +
        '<li>모의에는 1년치(날짜별) 기준저수량이 필요합니다. MyWater는 그날 값만 공개해서, 플랫폼이 매일 모아 300일이 쌓이면 자동으로 분석합니다(이 댐은 지금 ' + nd + '일).</li>' +
        '<li>1년치 기준선 표가 있으면 왼쪽 ‘기준선 불러오기’에서 CSV로 넣으면 바로 분석됩니다.</li>' +
        (sn && !(sn.g > 0) ? '<li class="muted">이 댐은 MyWater에 기준저수량이 정해져 있지 않습니다' + (LINKED[d0.name] ? '(연계 댐 ' + esc(LINKED[d0.name]) + '와 함께 관리)' : '') + '.</li>' : '') + '</ul>';
      ['kpis', 'maxQ', 'stInfo'].forEach(function (id) { if ($(id)) $(id).innerHTML = ''; });
      return;
    }
    var R = SR, ds = R.ds, v = R.v;
    $('stInfo').innerHTML = esc(ds.sourceNote) + '<br>' + ds.daily[0].date + ' ~ ' + ds.daily[ds.daily.length - 1].date + ' (' + fmt(ds.daily.length, 0) + '일)' + (ds.hasActual ? ' · 실적 포함' : ' · 실적 없음(실측 저수량 기준 판정)');
    $('optLag').disabled = !R.hasLag;
    $('verdict').className = 'verdict l' + v.level;
    $('verdict').innerHTML = '<div class="stamp">' + v.label + '</div><div class="title">' + esc(ds.name) + ' → ' + esc(S.st.plants.filter(function (p) { return p.on; }).map(function (p) { return p.name; }).join(', ') || '(없음)') + ' · 추가 ' + fmt(R.q, 0) + ' ㎥/일</div><ul>' + v.reasons.map(function (r) { return '<li>' + esc(r.msg) + '</li>'; }).join('') + '</ul>';
    var c = R.cur, s = R.sup, cf = R.curSf, sf = R.supSf;
    $('kpis').innerHTML = [['연평균 가뭄일수 (관심 이상)', c.drought, s.drought, '일', 0], ['연평균 주의 이상 (감량)', c.warn, s.warn, '일', 0], ['비상공급(가동기준)', c.emergency, s.emergency, '일', 1],
      ['정상 공급가능일수', c.normal, s.normal, '일', 0, false], ['최저 저수량', cf.minS, sf.minS, '백만㎥', 1, false], ['최저 저수위', cf.minH, sf.minH, 'EL.m', 2, false]].map(function (it) {
      return '<div class="kpi"><div class="k">' + it[0] + '</div><div class="v">' + fmt(it[2], it[4]) + ' <small>' + it[3] + '</small></div><div class="d">현재 ' + fmt(it[1], it[4]) + ' → ' + delta(it[1], it[2], it[4], it[5]) + '</div></div>';
    }).join('');
    $('maxQ').innerHTML = '<div class="maxq"><div><span class="pill l0">공급 가능</span><b>' + fmt(R.qOk, 0) + '</b><span class="small muted">㎥/일 이하</span></div><div><span class="pill l1">조건부 가능</span><b>' + fmt(R.qMid, 0) + '</b><span class="small muted">㎥/일 이하</span></div></div>' +
      '<p class="hint">판정 기준과 단계별 공급비율을 적용해 이분 탐색한 값입니다.</p>';
    C.drawSensitivity($('cSens'), R.sens, { q: R.q, zones: [{ from: 0, to: R.qOk, color: 'rgba(47,158,110,.12)' }, { from: R.qOk, to: R.qMid, color: 'rgba(201,138,7,.12)' }] });
    renderStageTS(); renderStageYears(); renderStageSafety();
  }
  function renderStageTS() {
    var R = SR, ds = R.ds;
    if (!TS) TS = new C.TimeSeries($('cTS'), $('tipTS'));
    var years = []; ds.daily.forEach(function (d) { if (years.indexOf(d.year) < 0) years.push(d.year); });
    var showYears = years.length > 8 ? years.slice(-8) : years;
    if (tsYear !== 'all' && years.indexOf(+tsYear) < 0) tsYear = 'all';
    $('yearSeg').innerHTML = '<button data-y="all">전체</button>' + showYears.map(function (y) { return '<button data-y="' + y + '">' + y + '</button>'; }).join('');
    $('modeSeg').innerHTML = '<button data-m="S">저수량</button><button data-m="H">수위</button>';
    qsa('#yearSeg button, #modeSeg button').forEach(function (b) {
      if (b.dataset.y) b.classList.toggle('on', String(tsYear) === b.dataset.y);
      if (b.dataset.m) b.classList.toggle('on', tsMode === b.dataset.m);
      b.onclick = function () { if (b.dataset.y) tsYear = b.dataset.y; if (b.dataset.m) tsMode = b.dataset.m; renderStageTS(); };
    });
    var defs = [['obs', '관측(현재)', '#1d4f86', 2, null], ['sim', '공급 시 모의', '#e0662b', 2, null], ['g', '관심 기준', SC[1], 1.2, [5, 4]], ['j', '주의 기준', SC[2], 1.2, [5, 4]], ['s', '심각 기준', SC[3], 1.2, [5, 4]], ['e', '가동기준', SC[4], 1.2, [5, 4]], ['n', '정상환원', '#2f9e6e', 1.2, [2, 3]], ['lwl', '저수위', '#111', 1, [8, 3, 2, 3]]];
    $('seriesToggles').innerHTML = defs.map(function (d) { return '<label><input type="checkbox" data-s="' + d[0] + '"' + (TOG[d[0]] ? ' checked' : '') + '><i style="background:' + d[2] + '"></i>' + d[1] + '</label>'; }).join('');
    qsa('#seriesToggles input').forEach(function (i) { i.onchange = function () { TOG[i.dataset.s] = i.checked; renderStageTS(); }; });
    var idx = []; ds.daily.forEach(function (d, i) { if (tsYear === 'all' || String(d.year) === String(tsYear)) idx.push(i); });
    var H = tsMode === 'H', hv = ds.hv, pick = function (fn) { return idx.map(fn); };
    var key = { g: H ? 'gh' : 'gs', j: H ? 'jh' : 'js', s: H ? 'sh' : 'ss', e: H ? 'eh' : 'es', n: H ? 'nh' : 'ns' };
    var series = [{ k: 'obs', data: pick(function (i) { return H ? ds.daily[i].h : ds.daily[i].s; }) }, { k: 'sim', data: pick(function (i) { return H ? hv.levelOf(R.sim.sv[i]) : R.sim.sv[i]; }) }];
    ['g', 'j', 's', 'e', 'n'].forEach(function (k) { series.push({ k: k, data: pick(function (i) { var x = ds.daily[i].b[key[k]]; return x == null ? null : x; }) }); });
    var lwlV = H ? (R.sp.lwlH != null ? +R.sp.lwlH : null) : R.lwlS;
    if (lwlV != null) series.push({ k: 'lwl', data: pick(function () { return lwlV; }) });
    series.forEach(function (s) { var d = defs.filter(function (x) { return x[0] === s.k; })[0]; s.name = d[1]; s.color = d[2]; s.width = d[3]; s.dash = d[4]; s.hidden = !TOG[s.k]; });
    TS.set({ t: pick(function (i) { var p = ds.daily[i].date.split('-'); return new Date(+p[0], p[1] - 1, +p[2]).getTime(); }), labels: pick(function (i) { return ds.daily[i].date; }),
      series: series, yLabel: H ? '수위 (EL.m)' : '저수량 (백만㎥)', strips: [{ name: '현재', data: pick(function (i) { return R.curSt[i]; }) }, { name: '공급 시', data: pick(function (i) { return R.sim.st[i]; }) }],
      stageLabel: E.STAGE_LABEL, extra: function (j) { return '<div class="small" style="opacity:.75">누적 공급 ' + fmt(R.sim.cum[idx[j]], 2) + ' 백만㎥</div>'; } });
    $('stageLegend').innerHTML = stageLegend();
  }
  function renderStageYears() {
    var R = SR, cy = R.cur.years, sy = R.sup.years;
    var show = cy.length > 12 ? cy.slice(-12) : cy, off = cy.length - show.length;
    C.drawYearBars($('cYears'), show.map(function (y, i) { return { label: y.year + (y.partial ? '*' : ''), bars: [y, sy[i + off]] }; }), ['현재', '공급']);
    var h = '<table class="t"><tr><th rowspan="2">연도</th><th rowspan="2">분석일수</th><th colspan="2">관심</th><th colspan="2">주의</th><th colspan="2">심각</th><th colspan="2">비상공급</th><th colspan="3">가뭄일수(관심 이상)</th><th colspan="2">최저 저수량</th></tr><tr><th>현재</th><th>공급</th><th>현재</th><th>공급</th><th>현재</th><th>공급</th><th>현재</th><th>공급</th><th>현재</th><th>공급</th><th>증감</th><th>현재</th><th>공급</th></tr>';
    cy.forEach(function (c, i) {
      var s = sy[i], cd = c.c[1] + c.c[2] + c.c[3] + c.c[4], sd = s.c[1] + s.c[2] + s.c[3] + s.c[4];
      h += '<tr><td>' + c.year + (c.partial ? '*' : '') + '</td><td>' + c.days + '</td>';
      for (var k = 1; k <= 4; k++) h += '<td>' + c.c[k] + '</td><td>' + s.c[k] + '</td>';
      h += '<td>' + cd + '</td><td>' + sd + '</td><td>' + delta(cd, sd, 0) + '</td><td>' + fmt(c.minS, 1) + '</td><td>' + fmt(s.minS, 1) + '</td></tr>';
    });
    var ca = R.cur.avg, sa = R.sup.avg;
    h += '<tr class="sum"><td>연평균</td><td>365</td>'; for (var k = 1; k <= 4; k++) h += '<td>' + fmt(ca[k], 0) + '</td><td>' + fmt(sa[k], 0) + '</td>';
    h += '<td>' + fmt(R.cur.drought, 0) + '</td><td>' + fmt(R.sup.drought, 0) + '</td><td>' + delta(R.cur.drought, R.sup.drought, 0) + '</td><td></td><td></td></tr></table><p class="hint">* 미완결 연도는 365일로 비례 환산. 현재기준 = ' + (R.ds.hasActual ? '실적 가뭄단계' : '실측 저수량 기준 판정') + '.</p>';
    $('yearTable').innerHTML = h;
    $('epTable').innerHTML = '<table class="t"><tr><th>#</th><th>시작</th><th>종료</th><th>일수</th><th>최고 단계</th></tr>' + R.sup.episodes.map(function (e, i) { return '<tr><td>' + (i + 1) + '</td><td>' + e.start + '</td><td>' + e.end + '</td><td>' + e.days + '</td><td><span class="st" style="background:' + SC[e.maxStage] + '"></span>' + E.STAGE_LABEL[e.maxStage] + '</td></tr>'; }).join('') + '</table>';
  }
  function renderStageSafety() {
    var R = SR, c = R.curSf, s = R.supSf;
    var rows = [['시간신뢰도 (정상 일수 비율)', pct(c.reliability), pct(s.reliability)], ['주의 이상(감량) 비율', pct(c.warnRatio), pct(s.warnRatio)], ['평균 주의이상 지속기간', fmt(c.meanWarnDur, 0) + '일', fmt(s.meanWarnDur, 0) + '일'],
      ['최장 연속 주의이상', c.maxWarnRun + '일', s.maxWarnRun + '일'], ['취약도 (주의기준 대비 최대 부족)', fmt(c.vulnerability, 1) + ' 백만㎥', fmt(s.vulnerability, 1) + ' 백만㎥'], ['연평균 비상공급', fmt(R.cur.emergency, 1) + '일', fmt(R.sup.emergency, 1) + '일']];
    $('safetyTable').innerHTML = '<table class="t"><tr><th>지표</th><th>현재기준</th><th>공급 시</th></tr>' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('') + '</table>';
    var lw = R.lwlS;
    var lr = [['최저 저수량', fmt(c.minS, 2) + ' (' + c.minDate + ')', fmt(s.minS, 2) + ' (' + s.minDate + ')'], ['최저 저수위', 'EL.' + fmt(c.minH, 2), 'EL.' + fmt(s.minH, 2)],
      ['저수위 대비 여유 저수량', lw != null ? fmt(c.minS - lw, 2) + ' 백만㎥' : '-', lw != null ? fmt(s.minS - lw, 2) + ' 백만㎥' : '-'], ['저수위 하회 일수', c.belowLWL + '일', s.belowLWL + '일']];
    $('levelTable').innerHTML = '<table class="t"><tr><th>항목</th><th>현재기준</th><th>공급 시</th></tr>' + lr.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('') + '</table>' +
      '<p class="hint">저수위 EL.' + (R.sp.lwlH != null ? R.sp.lwlH : '-') + 'm ↔ ' + (lw != null ? fmt(lw, 2) : '-') + ' 백만㎥</p>';
  }

  /* ================= 운영수위 변경 분석 ================= */
  // 운영수위(저류 상한)를 낮추면 이용 가능 저수량이 줄어 갈수기를 버틸 수 있는 공급량(공급능력)이 줄어든다.
  var LVC = {}, lvTS = null, lvYear = null;
  function lvDefaults(dam) {
    var b = dam.basic || {}, ref = (REG.levelRefs || {})[dam.name];
    var y = model(dam, 'mywater').dates;
    return { h0: b.nwl, h1: ref ? ref.lowered : Math.round(((b.nwl || 0) - 2) * 10) / 10, l: b.lwl, y0: +y[0].slice(0, 4) + (y[0].slice(5) === '01-01' ? 0 : 1), y1: +y[y.length - 1].slice(0, 4) };
  }
  function lvModel(dam, H, L, y0, y1) {
    var hv = hvOf(dam), b = dam.basic || {};
    var sMax = hv.vOfH(H), fwlV = b.fwl && b.fwl < b.nwl ? hv.vOfH(Math.min(b.fwl, H)) : null;
    var m = WB.fromMyWater(dam.mw, hv, { annualMcm: 0, sMin: hv.vOfH(L), sMax: sMax, sMaxFlood: fwlV, skipFilling: false });
    var i0 = 0, i1 = m.dates.length;
    for (var i = 0; i < m.dates.length; i++) { var yy = +m.dates[i].slice(0, 4); if (yy < y0) i0 = i + 1; if (yy <= y1) i1 = i + 1; }
    ['dates', 'dt', 'inflow', 'demand', 'flood', 'observed'].forEach(function (k) { if (m[k]) m[k] = m[k].slice(i0, i1); });
    var o0 = m.observed && m.observed[0] != null ? m.observed[0] : sMax;
    m.s0 = Math.min(sMax, o0);
    var s = 0, k = 0; m.inflow.forEach(function (v) { if (v != null) { s += v; k++; } }); m.meanInflow = k ? s / k : 0;
    m.sMaxV = sMax; m.hv = hv;
    return m;
  }
  function lvCap(m, crit) { var a = WB.maxAdd(m, crit, 0, Math.max(0.5, m.meanInflow * 1.5)); return a == null ? 0 : a * 86400; }
  function lvCompute(dam, p, critKey) {
    var key = [dam.name, p.h0, p.h1, p.l, p.y0, p.y1, critKey].join('|');
    if (LVC[key]) return LVC[key];
    var crit = CRITS[critKey] || CRITS.y95;
    var m0 = lvModel(dam, p.h0, p.l, p.y0, p.y1), m1 = lvModel(dam, p.h1, p.l, p.y0, p.y1);
    var q0 = lvCap(m0, crit), q1 = lvCap(m1, crit);
    // 기준 공급능력(q0)을 그대로 공급할 때 두 운영수위의 거동
    var r0 = WB.run(m0, q0 / 86400), r1 = WB.run(m1, q0 / 86400), mt1 = WB.metrics(m1, r1), mt0 = WB.metrics(m0, r0);
    // 연도별 부족
    var yrs = {};
    m1.dates.forEach(function (d, i) {
      var y = d.slice(0, 4), o = yrs[y] || (yrs[y] = { y: y, defVol: 0, defDays: 0, min1: Infinity, min0: Infinity });
      if (r1.deficit[i] > 1e-6) { o.defVol += r1.deficit[i] * 86400 / 1e6; o.defDays++; }
      if (r1.storage[i] < o.min1) o.min1 = r1.storage[i];
      if (r0.storage[i] < o.min0) o.min0 = r0.storage[i];
    });
    var years = Object.keys(yrs).sort().map(function (y) { return yrs[y]; });
    var worst = years.slice().sort(function (a, b) { return b.defVol - a.defVol; })[0];
    // 갈수기 최대 소모량(기준 운영수위에서 q0 공급 시 만수위 대비 최대 저하량) = 버티는 데 필요한 저수량
    var need = 0, peakS = m0.sMaxV;
    for (var i = 0; i < r0.storage.length; i++) { if (r0.storage[i] >= m0.sMaxV - 1e-6) peakS = m0.sMaxV; need = Math.max(need, m0.sMaxV - r0.storage[i]); }
    // 운영수위별 공급능력 곡선
    var curve = [], n = 14, lo = p.l + Math.max(0.5, (Math.max(p.h0, p.h1) - p.l) * 0.06), hi = Math.max(p.h0, p.h1);
    for (var j = 0; j <= n; j++) {
      var H = lo + (hi - lo) * j / n, mm = lvModel(dam, H, p.l, p.y0, p.y1);
      curve.push({ H: H, q: lvCap(mm, crit), usable: mm.sMaxV - mm.sMin });
    }
    var res = { m0: m0, m1: m1, q0: q0, q1: q1, r0: r0, r1: r1, mt0: mt0, mt1: mt1, years: years, worst: worst, need: need, curve: curve };
    LVC[key] = res; return res;
  }
  /* ================= 연계 계통 물수지 (상류댐–하류댐) ================= */
  // serial: 하류 자체 유입 = 하류 유입 − 상류 방류(실측). 상류는 넘치는 물과, 하류가 저수위에 닿을 때 모자란 만큼을 내려보냄
  // pool  : 두 저수지를 하나로 묶음(이상적인 연계, 상한)
  var LINKS = REG.links || [], SYC = {};
  function linksOf(name) { return LINKS.filter(function (l) { return l.down === name || l.up === name; }); }
  function dayMap(mw, k) { var o = {}; for (var i = 0; i < mw.n; i++) { var v = mw[k][i]; if (v != null) o[WB.addDays(mw.start, i)] = v; } return o; }
  function sysSeries(L, y0, y1) {
    var key = [L.down, L.up, y0, y1].join('|'); if (SYC[key]) return SYC[key];
    var dn = damByName(L.down), up = damByName(L.up); if (!dn || !up || !dn.mw || !up.mw) return null;
    var dq = dayMap(dn.mw, 'qin'), uq = dayMap(up.mw, 'qin'), uo = L.type === 'serial' ? dayMap(up.mw, 'qout') : null;
    var a = Math.max(y0, L.from || 0), dates = Object.keys(dq).filter(function (k) { var y = +k.slice(0, 4); return y >= a && y <= y1 && uq[k] != null && (!uo || uo[k] != null); }).sort();
    if (dates.length < 730) return null;
    var debt = 0, dnIn = dates.map(function (k) {   // 하루 차이로 음수가 나오는 날은 다음 날로 넘겨 합계를 보존
      if (!uo) return dq[k];
      var v = dq[k] - uo[k] - debt; if (v < 0) { debt = -v; return 0; } debt = 0; return v; });
    var r = { dates: dates, dt: dates.map(function () { return 1; }), upIn: dates.map(function (k) { return uq[k]; }), dnIn: dnIn, y0: +dates[0].slice(0, 4), y1: +dates[dates.length - 1].slice(0, 4) };
    SYC[key] = r; return r;
  }
  function sysRun(ser, b, add, mode) {
    var n = ser.dates.length, c = 86400 / 1e6, S1 = b.d1, S2 = b.u1, def = new Float64Array(n), need = new Float64Array(n), st = new Float64Array(n);
    var Dd = b.Dd + add, Du = b.Du;   // need에는 하류 취수분만 넣음(판정은 하류 취수 지점 기준)
    for (var i = 0; i < n; i++) {
      var d = 0;
      if (mode === 'pool') {
        var S = S1 + S2 + (ser.upIn[i] + ser.dnIn[i] - Dd - Du) * c, lo = b.d0 + b.u0, hi = b.d1 + b.u1;
        if (S < lo) { d = (lo - S) / c; S = lo; } if (S > hi) S = hi;
        S1 = S - S2; st[i] = S; def[i] = d; need[i] = Dd + Du; continue;
      }
      S2 += (ser.upIn[i] - Du) * c;
      if (S2 < b.u0) S2 = b.u0;   // 상류 직접 취수분(upDirect)의 부족은 상류 몫이라 하류 판정에 넣지 않음
      var sp = Math.max(0, S2 - b.u1); S2 -= sp;
      S1 += ser.dnIn[i] * c + sp - Dd * c;
      if (S1 < b.d0) { var rel = Math.min(b.d0 - S1, S2 - b.u0); S2 -= rel; S1 += rel; if (S1 < b.d0) { d += (b.d0 - S1) / c; S1 = b.d0; } }
      if (S1 > b.d1) S1 = b.d1;
      st[i] = S1 + S2; def[i] = d; need[i] = Dd;
    }
    return { deficit: def, need: need, storage: st };
  }
  /** 계통 공급능력(㎥/일, 두 댐 계획량 포함 총량) */
  var SCC = {};
  function sysCap(ser, b, mode, crit) {
    var ck = [ser.dates[0], ser.dates.length, b.d1, b.d0, b.u1, b.u0, b.Dd, b.Du, mode, crit.label].join('|'); if (ck in SCC) return SCC[ck];
    return (SCC[ck] = sysCap0(ser, b, mode, crit));
  }
  function sysCap0(ser, b, mode, crit) {
    var m = { dates: ser.dates, dt: ser.dt }, ok = function (a) { return WB.meets(WB.metrics(m, sysRun(ser, b, a, mode)), crit); };
    var lo = -b.Dd, hi = Math.max(1, (b.Dd + b.Du) * 2);
    if (!ok(lo)) return null;
    while (ok(hi)) { lo = hi; hi *= 2; if (hi > 1e4) break; }
    for (var k = 0; k < 40 && hi - lo > 1e-4; k++) { var mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
    return (b.Dd + lo + b.Du) * 86400;
  }
  function sysBounds(L, hDn, lDn, hUp) {
    var dn = damByName(L.down), up = damByName(L.up), hd = hvOf(dn), hu = hvOf(up), md = model(dn, 'mywater'), mu = model(up, 'mywater');
    var pd = md.annualMcm * 1e6 / (365 * 86400), pu = mu.annualMcm * 1e6 / (365 * 86400);
    return { d1: hd.vOfH(hDn), d0: hd.vOfH(lDn), u1: hu.vOfH(hUp), u0: mu.sMin, Dd: L.upDirect ? pd : pd + pu, Du: L.upDirect ? pu : 0, plan: (pd + pu) * 86400 };
  }
  function renderLvSys(dam, p, critKey) {
    var Ls = linksOf(dam.name); $('lvSysCard').style.display = Ls.length ? '' : 'none'; if (!Ls.length) return;
    var crit = CRITS[critKey] || CRITS.y95;
    $('lvSys').innerHTML = Ls.map(function (L) {
      var ser = sysSeries(L, p.y0, p.y1);
      if (!ser) return '<p class="hint">' + esc(L.down) + '·' + esc(L.up) + ': 두 댐의 자료가 함께 있는 기간이 짧아 계산하지 않았습니다.</p>';
      var isDn = L.down === dam.name, up = damByName(L.up), dn = damByName(L.down);
      // 이 탭에서 고른 댐의 운영수위를 바꾸고, 짝 댐은 상시만수위로 둠
      var bnd = function (h) { return isDn ? sysBounds(L, h, p.l, up.basic.nwl) : sysBounds(L, dn.basic.nwl, dn.basic.lwl, h); };
      var b0 = bnd(p.h0), b1 = bnd(p.h1);
      var solo0 = lvCap(lvModel(dam, p.h0, p.l, ser.y0, ser.y1), crit), solo1 = lvCap(lvModel(dam, p.h1, p.l, ser.y0, ser.y1), crit);
      var rows = [['' + esc(dam.name) + ' 단독', solo0, solo1, '실측 유입(상류 방류 포함 그대로)']];
      if (L.type === 'serial') rows.push([esc(L.up) + ' 보충(연계)', sysCap(ser, b0, 'serial', crit), sysCap(ser, b1, 'serial', crit), '하류가 저수위에 닿으면 상류에서 내려보냄, 상류 월류도 하류로']);
      // 상류 계획량을 유역 밖으로 직접 보내는 경우(upDirect)는 두 저수지를 한 저수지로 볼 수 없어 상한을 계산하지 않음
      if (!L.upDirect) rows.push(['한 저수지처럼 운영(상한)', sysCap(ser, b0, 'pool', crit), sysCap(ser, b1, 'pool', crit), '두 저수지를 완벽하게 함께 쓴다고 가정']);
      var f = function (v) { return v == null ? '-' : man(v); };
      var t = '<h4>' + esc(L.up) + ' → ' + esc(L.down) + ' <span class="muted small">(' + (L.type === 'serial' ? '상류 방류가 하류 저수지로' : '연결·합류 운영') + ', ' + ser.y0 + '~' + ser.y1 + ', ' + esc(crit.label) + ')</span></h4>' +
        '<table class="t"><tr><th>보는 방식</th><th>EL.' + p.h0 + ' 공급능력<br>(만㎥/일)</th><th>EL.' + p.h1 + ' 공급능력<br>(만㎥/일)</th><th>부족(일평균)</th><th>부족(일최대 ×' + fmt((S.lv && S.lv.peak) || 1, 2) + ')</th><th class="l">가정</th></tr>' +
        rows.map(function (r) { var dq = r[1] != null && r[2] != null ? r[1] - r[2] : null; return '<tr><td><b>' + r[0] + '</b></td><td>' + f(r[1]) + '</td><td>' + f(r[2]) + '</td><td><b>' + (dq == null ? '-' : man(Math.max(0, dq))) + '만</b></td><td>' + (dq == null ? '-' : man(Math.max(0, dq) * ((S.lv && S.lv.peak) || 1))) + '만</td><td class="l small">' + r[3] + '</td></tr>'; }).join('') +
        '<tr class="sum"><td>계획량 합계</td><td colspan="5" class="l">' + esc(L.down) + ' ' + man(model(dn, 'mywater').annualMcm * 1e6 / 365) + '만 + ' + esc(L.up) + ' ' + man(model(up, 'mywater').annualMcm * 1e6 / 365) + '만 = ' + man(b0.plan) + '만㎥/일 (MyWater 연간 용수공급용량)</td></tr></table>' +
        '<p class="hint">' + esc(L.note) + ' 연계 행의 공급능력은 두 댐 계획량을 포함한 계통 전체 값입니다. 단독은 이 댐 계획량만 기준이라 크기를 직접 비교하지 말고 ‘부족’ 열을 비교하세요.' + (L.upDirect ? ' 상류댐 직접 공급분의 부족은 하류 판정에 넣지 않았습니다.' : ' 실제 영향은 대개 연계와 상한 사이에 있습니다.') + '</p>';
      return t;
    }).join('');
  }

  var lvBound = false;
  function renderLevel() {
    var lv = S.lv || (S.lv = { dam: '소양강댐', crit: 'y95', peak: 1 / 0.7 });
    if (!lvBound) {
      lvBound = true;
      $('lvDam').innerHTML = damOptions(function (d) { return !!d.mw; });
      $('lvCrit').innerHTML = LV_CRITS.map(function (k) { return '<option value="' + k + '">' + CRITS[k].label + '</option>'; }).join('');
      $('lvDam').onchange = function () { lv.dam = this.value; lv.p = null; save(); renderLevel(); };
      $('lvCrit').onchange = function () { lv.crit = this.value; save(); renderLevel(); };
      [['lvH0', 'h0'], ['lvH1', 'h1'], ['lvL', 'l'], ['lvY0', 'y0'], ['lvY1', 'y1']].forEach(function (x) {
        $(x[0]).onchange = function () { if (this.value !== '') { lv.p[x[1]] = +this.value; save(); renderLevel(); } };
      });
      $('lvPeak').onchange = function () { lv.peak = +this.value || 1; save(); renderLevel(); };
    }
    var dam = damByName(lv.dam) || DAMS.filter(function (d) { return d.mw; })[0]; lv.dam = dam.name;
    if (!lv.p || lv.p.dam !== dam.name) { lv.p = lvDefaults(dam); lv.p.dam = dam.name; }
    var p = lv.p;
    $('lvDam').value = dam.name; $('lvCrit').value = lv.crit; $('lvH0').value = p.h0; $('lvH1').value = p.h1; $('lvL').value = p.l; $('lvY0').value = p.y0; $('lvY1').value = p.y1; $('lvPeak').value = Math.round(lv.peak * 100) / 100;
    if (!(p.h1 > p.l && p.h0 > p.l)) { $('lvVerdict').innerHTML = '<div class="title">운영수위는 저수위보다 높아야 합니다.</div>'; return; }
    var R = lvCompute(dam, p, lv.crit), hv = hvOf(dam);
    var V0 = hv.vOfH(p.h0), V1 = hv.vOfH(p.h1), VL = hv.vOfH(p.l), u0 = V0 - VL, u1 = V1 - VL;
    var dq = R.q0 - R.q1, dqMax = dq * lv.peak;
    $('lvVerdict').className = 'verdict ' + (dq > 0.5 * 10000 ? 'l2' : dq > 0 ? 'l1' : 'l0');
    $('lvVerdict').innerHTML = '<div class="stamp">부족 ' + man(Math.max(0, dq)) + '만㎥/일</div><div class="title">' + esc(dam.name) + ' 운영수위 EL.' + p.h0 + ' → EL.' + p.h1 + 'm · ' + p.y0 + '~' + p.y1 + ' · ' + esc((CRITS[lv.crit] || CRITS.y95).label) + '</div><ul>' +
      '<li>공급능력 ' + man(R.q0) + '만 → ' + man(R.q1) + '만㎥/일 (일평균 부족 <b>' + man(dq) + '만</b>, 일최대 부족 <b>' + man(dqMax) + '만</b> = 일평균 × ' + fmt(lv.peak, 2) + ')</li>' +
      '<li>이용 가능 저수량(운영수위 − 저수위) ' + fmt(u0, 2) + ' → ' + fmt(u1, 2) + ' 백만㎥ (' + pct(1 - u1 / u0, 0) + ' 감소)</li></ul>';
    $('lvKpis').innerHTML = [
      ['기준 공급능력', man(R.q0) + ' <small>만㎥/일</small>', 'EL.' + p.h0 + ' · 평균유입의 ' + pct(R.q0 / 86400 / R.m0.meanInflow, 0)],
      ['변경 공급능력', man(R.q1) + ' <small>만㎥/일</small>', 'EL.' + p.h1],
      ['부족량(일평균)', man(dq) + ' <small>만㎥/일</small>', '기준 − 변경'],
      ['부족량(일최대)', man(dqMax) + ' <small>만㎥/일</small>', '일평균 × ' + fmt(lv.peak, 2)],
      ['이용 가능 저수량', fmt(u1, 1) + ' <small>백만㎥</small>', '기준 ' + fmt(u0, 1)],
      ['갈수기 필요 저수량', fmt(R.need, 1) + ' <small>백만㎥</small>', '기준 공급능력을 버티는 데 필요']
    ].map(function (k) { return '<div class="kpi"><div class="k">' + k[0] + '</div><div class="v">' + k[1] + '</div><div class="d muted">' + k[2] + '</div></div>'; }).join('');
    // 곡선
    var xs = R.curve.map(function (c) { return c.H; });
    C.drawLines($('cLvCap'), xs, [{ data: R.curve.map(function (c) { return c.q / 10000; }), color: '#1d4f86' }],
      { yMin: 0, yDec: 1, xLabel: '운영수위 (EL.m)', xFmt: function (v) { return fmt(v, 1); }, vlines: [{ x: p.h0, label: '기준 ' + man(R.q0) + '만' }, { x: p.h1, label: '변경 ' + man(R.q1) + '만', color: '#e0662b', row: 1 }] });
    // 원인 설명
    var w = R.worst, defYears = R.years.filter(function (y) { return y.defVol > 1e-6; });
    $('lvWhy').innerHTML = '<ol class="why">' +
      '<li><b>담을 수 있는 물이 줄어듭니다.</b> 운영수위 EL.' + p.h0 + '에서 저수량은 ' + fmt(V0, 2) + '백만㎥입니다. EL.' + p.h1 + '로 낮추면 ' + fmt(V1, 2) + '백만㎥가 됩니다. 저수위(EL.' + p.l + ', ' + fmt(VL, 2) + ') 위로 꺼내 쓸 수 있는 물은 ' + fmt(u0, 2) + ' → ' + fmt(u1, 2) + '백만㎥로 ' + pct(1 - u1 / u0, 0) + ' 줄어듭니다.</li>' +
      '<li><b>장마철에 넘치는 물은 못 모으고 버리게 됩니다.</b> 운영수위를 넘는 유입은 방류할 수밖에 없습니다. 그래서 가을부터 이듬해 봄까지 갈수기에 꺼내 쓸 비축량이 작아집니다.</li>' +
      '<li><b>갈수기를 버티려면 ' + fmt(R.need, 1) + '백만㎥가 필요합니다.</b> 기준 공급능력(' + man(R.q0) + '만㎥/일)으로 공급하면, 가장 가문 시기에 유입보다 공급이 많아 저수지에서 이만큼을 꺼내 써야 합니다. 변경 운영수위의 이용 가능 저수량(' + fmt(u1, 1) + ')으로는 ' + (R.need > u1 ? '모자랍니다.' : '버틸 수 있습니다.') + '</li>' +
      '<li><b>그래서 공급량을 줄여야 합니다.</b> 같은 안정성 기준을 지키려면 공급량을 ' + man(R.q1) + '만㎥/일까지 낮춰야 하고, 그 차이 ' + man(dq) + '만㎥/일이 부족량(일평균)입니다. ' +
        (defYears.length ? '기준 공급능력을 그대로 유지하면 ' + R.years.length + '년 중 ' + defYears.length + '년에 부족이 생기고, 가장 큰 해는 ' + w.y + '년(' + fmt(w.defVol, 2) + '백만㎥, ' + w.defDays + '일)입니다.' : '') + '</li>' +
      '<li><b>일최대 부족량은 시설 규모 기준입니다.</b> 정수장과 관로는 하루 최대 사용량을 감당하도록 짓습니다. 그래서 일평균 부족량에 첨두 배수 ' + fmt(lv.peak, 2) + '를 곱해 ' + man(dqMax) + '만㎥/일로 봅니다. 부하율 70%면 1.43배입니다.</li></ol>';
    // 시계열
    if (!lvTS) lvTS = new C.TimeSeries($('cLvTS'), $('tipLv'));
    var segYears = [String(w ? w.y : R.years[0].y)].concat(defYears.slice().sort(function (a, b) { return b.defVol - a.defVol; }).slice(1, 5).map(function (y) { return y.y; })).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
    if (!lvYear || (lvYear !== 'all' && segYears.indexOf(lvYear) < 0 && !R.years.some(function (y) { return y.y === lvYear; }))) lvYear = segYears[0];
    $('lvYearSeg').innerHTML = '<button data-y="all"' + (lvYear === 'all' ? ' class="on"' : '') + '>전체</button>' + segYears.map(function (y) { var yy = R.years.filter(function (o) { return o.y === y; })[0]; return '<button data-y="' + y + '"' + (lvYear === y ? ' class="on"' : '') + (yy ? ' title="' + y + '년 부족 ' + fmt(yy.defVol, 2) + '백만㎥, ' + yy.defDays + '일"' : '') + '>' + y + '</button>'; }).join('');
    qsa('#lvYearSeg button').forEach(function (b) { b.onclick = function () { lvYear = b.dataset.y; renderLevel(); }; });
    var idx = []; R.m1.dates.forEach(function (d, i) { if (lvYear === 'all' || d.slice(0, 4) === lvYear) idx.push(i); });
    var stp = idx.length > 4000 ? Math.ceil(idx.length / 4000) : 1; idx = idx.filter(function (_, j) { return j % stp === 0; });
    lvTS.set({ t: idx.map(function (i) { var q = R.m1.dates[i].split('-'); return new Date(+q[0], q[1] - 1, +q[2]).getTime(); }), labels: idx.map(function (i) { return R.m1.dates[i]; }),
      series: [{ name: '기준 EL.' + p.h0, data: idx.map(function (i) { return R.r0.storage[i]; }), color: '#1d4f86', width: 1.8 },
        { name: '변경 EL.' + p.h1, data: idx.map(function (i) { return R.r1.storage[i]; }), color: '#e0662b', width: 1.8 },
        { name: '저수위', data: idx.map(function () { return VL; }), color: '#111', width: 1, dash: [6, 3] },
        { name: '변경 운영수위', data: idx.map(function () { return V1; }), color: '#e0662b', width: 1, dash: [2, 3] },
        { name: '기준 운영수위', data: idx.map(function () { return V0; }), color: '#1d4f86', width: 1, dash: [2, 3] }],
      yLabel: '저수량 (백만㎥)', strips: [], stageLabel: E.STAGE_LABEL,
      extra: function (j) { var i = idx[j]; return '<div class="small" style="opacity:.8">유입 ' + fmt(R.m1.inflow[i], 2) + '㎥/s · 변경 시 부족 ' + fmt(R.r1.deficit[i] * 86400 / 10000, 2) + '만㎥/일</div>'; } });
    // 연도별
    $('lvYears').innerHTML = '<table class="t"><tr><th>연도</th><th>부족량(백만㎥)</th><th>부족일수</th><th>최저 저수량: 기준</th><th>최저 저수량: 변경</th></tr>' +
      R.years.map(function (y) { return '<tr' + (y.defVol > 1e-6 ? ' class="hl"' : '') + '><td>' + y.y + '</td><td>' + (y.defVol > 1e-6 ? fmt(y.defVol, 2) : '-') + '</td><td>' + (y.defDays || '-') + '</td><td>' + fmt(y.min0, 2) + '</td><td>' + fmt(y.min1, 2) + '</td></tr>'; }).join('') + '</table>';
    // 참고 비교
    var ref = (REG.levelRefs || {})[dam.name];
    $('lvRef').innerHTML = ref ? '<table class="t"><tr><th>구분</th><th>분석기간</th><th>운영수위</th><th>공급능력</th><th>공급안정성</th></tr>' +
      ref.cases.map(function (c) { return '<tr><td class="l">' + esc(c.label) + '</td><td>' + esc(c.period) + '</td><td>EL.' + c.h + '</td><td>' + fmt(c.q / 10000, 1) + '만</td><td>' + esc(c.rel) + '</td></tr>'; }).join('') +
      '<tr class="sum"><td class="l">본 플랫폼 (MyWater 실측유입)</td><td>' + p.y0 + '~' + p.y1 + '</td><td>EL.' + p.h0 + ' / ' + p.h1 + '</td><td>' + man(R.q0) + ' / ' + man(R.q1) + '만</td><td>' + esc((CRITS[lv.crit] || CRITS.y95).label) + '</td></tr></table>' +
      '<p class="hint">' + esc(ref.note) + '</p>'
      : '<p class="hint">이 댐에 등록된 기존 검토 결과가 없습니다.</p>';
    renderLvSys(dam, p, lv.crit);
  }


  /* ================= 수위-저수량 곡선 (댐 평가 탭) ================= */
  function supNum(s) { return s.replace(/\^3/g, '³').replace(/\^2/g, '²').replace(/ ([+-])(\d)/g, ' $1 $2'); }
  function renderCurve(dam) {
    var card = $('damCurveCard'), cv = curveOf(dam);
    if (!cv) { card.style.display = 'none'; return; }
    card.style.display = '';
    var hv = hvOf(dam), b = dam.basic || {}, tb = cv.table, H0 = tb[0][0];
    var dateTxt = cv.date.replace(/(\d{4})(\d\d)(\d\d)/, '$1.$2.$3');
    $('damCurveSrc').textContent = '— MyWater 곡선식 (' + dateTxt + ' 적용, ' + cv.segments.length + '개 구간)';
    // 그래프 범위: 저수위 − 3m ~ max(계획홍수위, 상시만수위) + 1m
    var lo = (b.lwl != null ? b.lwl : H0) - 3, hi = Math.max(b.pfl || 0, b.nwl || 0, b.fwl || 0) + 1;
    var xs = [], vs = [], obs = [];
    tb.forEach(function (r) { if (r[0] >= lo - 1e-9 && r[0] <= hi + 1e-9) { xs.push(r[0]); vs.push(r[1]); obs.push(null); } });
    // 관측 (최근 3년) → 0.1m 격자에 배치, 오차 계산
    var mw = dam.mw, errs = [], nObs = 0;
    if (mw && mw.h) {
      for (var i = Math.max(0, mw.h.length - 1095); i < mw.h.length; i++) {
        var h = mw.h[i], s = mw.s[i]; if (h == null || s == null) continue;
        var j = Math.round((h - xs[0]) * 10); if (j >= 0 && j < xs.length) obs[j] = s;
        if (s > 0) { errs.push(Math.abs(hv.vOfH(h) - s) / s); nObs++; }
      }
    }
    errs.sort(function (a, c) { return a - c; });
    var med = errs.length ? errs[Math.floor(errs.length / 2)] : null, p95 = errs.length ? errs[Math.floor(errs.length * 0.95)] : null;
    var marks = [];
    if (b.lwl != null) marks.push({ x: b.lwl, label: '저수위 ' + b.lwl, color: '#8e2f6b' });
    if (b.fwl && b.fwl < b.nwl) marks.push({ x: b.fwl, label: '홍수기제한 ' + b.fwl, color: '#2f9e6e', row: 1 });
    if (b.nwl != null) marks.push({ x: b.nwl, label: '상시만수위 ' + b.nwl, color: '#1d2733', row: 2 });
    if (b.pfl && b.pfl > b.nwl) marks.push({ x: b.pfl, label: '계획홍수위 ' + b.pfl, color: '#9aa7b4', row: 3 });
    var lvR0 = REG.levelRefs && REG.levelRefs[dam.name];
    if (lvR0 && lvR0.lowered) marks.push({ x: lvR0.lowered, label: '낮춘 운영수위 ' + lvR0.lowered, color: '#e0662b', row: 1 });
    C.drawLines($('cDamCurve'), xs, [{ data: vs, color: '#1d4f86', width: 2 }, { data: obs, color: '#e0662b', points: true, r: 2.6, alpha: 0.5 }],
      { xLabel: '수위 (EL.m)', xFmt: function (v) { return fmt(v, 0); }, yDec: vs[vs.length - 1] < 20 ? 1 : 0, yMin: 0, vlines: marks });
    // 주요 수위별 저수량과 1m당 저수량
    var sMin = b.lwl != null ? hv.vOfH(b.lwl) : null;
    function dvdh(h) { return hv.vOfH(h + 0.5) - hv.vOfH(h - 0.5); }
    var lv = [];
    if (b.lwl != null) lv.push(['저수위', b.lwl]);
    var lvR = REG.levelRefs && REG.levelRefs[dam.name];
    if (lvR && lvR.lowered) lv.push(['낮춘 운영수위(검토)', lvR.lowered]);
    if (b.fwl && b.fwl < b.nwl) lv.push(['홍수기제한수위', b.fwl]);
    if (b.nwl != null) lv.push(['상시만수위', b.nwl]);
    if (b.pfl && b.pfl > b.nwl) lv.push(['계획홍수위', b.pfl]);
    lv.sort(function (a, c) { return a[1] - c[1]; });
    $('damCurveLv').innerHTML = '<table class="t"><tr><th>수위</th><th>EL.m</th><th>저수량 (백만㎥)</th><th>저수위 위 이용량 (백만㎥)</th><th>1m당 저수량 (백만㎥/m)</th></tr>' +
      lv.map(function (r) { var v = hv.vOfH(r[1]); return '<tr' + (r[0].indexOf('낮춘') === 0 ? ' class="hl"' : '') + '><td>' + r[0] + '</td><td>' + fmt(r[1], 1) + '</td><td>' + fmt(v, 2) + '</td><td>' + (sMin == null ? '-' : fmt(Math.max(0, v - sMin), 2)) + '</td><td>' + fmt(dvdh(r[1]), 2) + '</td></tr>'; }).join('') + '</table>' +
      (b.effStorage != null && sMin != null && b.nwl != null ? '<p class="hint">상시만수위~저수위 곡선식 이용량 ' + fmt(hv.vOfH(b.nwl) - sMin, 2) + '백만㎥ · MyWater 제원 유효저수량 ' + fmt(b.effStorage, 1) + '백만㎥</p>' : '');
    // 구간별 식
    $('damCurveSeg').innerHTML = '<table class="t"><tr><th>구간</th><th>수위 범위 (EL.m)</th><th>곡선식</th></tr>' + cv.segments.map(function (sg, k) {
      var rng = sg.lo <= -900 ? '~ ' + fmt(sg.hi, 2) : sg.hi >= 900 ? fmt(sg.lo, 2) + ' ~' : fmt(sg.lo, 2) + ' ~ ' + fmt(sg.hi, 2);
      return '<tr><td>' + (k + 1) + '</td><td>' + rng + '</td><td class="mono">V = ' + esc(supNum(sg.expr.replace(/\*/g, '·').replace(/X/g, 'H'))) + '</td></tr>';
    }).join('') + '</table>';
    $('damCurveNote').textContent = '관측 대비 오차: 최근 3년 ' + nObs + '일, 중앙값 ' + pct(med, 2) + ' · 95% ' + pct(p95, 2) +
      '. 이 곡선식으로 저수위·운영수위의 저수량을 환산합니다. 수위가 낮을수록 수면적이 좁아 1m당 저수량이 작으므로, 운영수위를 낮추면 이용 가능한 저수량이 수위 저하 비율보다 크게 줄어듭니다.';
  }
  /* ================= 댐별 여유용량 (여유용량·공급 검토 탭 첫 화면) ================= */
  function kmLL(a, b) { var R = 6371, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r, x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2); return 2 * R * Math.asin(Math.sqrt(x)); }
  function nearPlants(dam, km, n) {
    var c = coordOf(dam.name); if (!c) return [];
    var all = plants().map(function (p) { return Object.assign({ cap: gisCapOf(p) || p.capacity }, p); }).concat(gisPlants().map(function (p) { return Object.assign({ cap: p.capacity }, p); }));
    return all.filter(function (p) { return p.lat != null && p.lon != null && !(p.cap != null && p.cap < 1000); })   // 하루 1천㎥ 미만 소규모(마을) 시설 제외
      .map(function (p) { return { p: p, km: kmLL(c, [p.lat, p.lon]) }; })
      .filter(function (x) { return x.km <= km; }).sort(function (a, b) { return a.km - b.km; }).slice(0, n);
  }
  var spBound = false;
  function renderSurplus() {
    if (!spBound) {
      spBound = true;
      $('spRiver').innerHTML = '<option value="">전체</option>' + rivers().map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('');
      $('spRiver').onchange = function () { S.spRiver = this.value; save(); renderSurplus(); };
      $('spKind').onchange = function () { S.spKind = this.value; save(); renderSurplus(); };
      $('spR').onchange = function () { S.spR = +this.value || 30; save(); renderSurplus(); };
      $('plCheck').addEventListener('toggle', function () { S.plOpen = this.open; save(); if (this.open) { renderPlant(); renderCost(); } });
    }
    var R = S.spR || 30;
    $('spRiver').value = S.spRiver || ''; $('spKind').value = S.spKind || ''; $('spR').value = R;
    var rows = DAMS.filter(function (d) { return (!S.spRiver || d.river === S.spRiver) && (!S.spKind || d.kind === S.spKind); })
      .map(function (d) { return { d: d, ev: evalDam(d), obs: lastObs(d) }; });
    var tier = function (r) { return r.ev.external ? 4 : r.ev.unknown ? 2 : r.ev.addCmd > 0 ? 1 : 3; };
    rows.sort(function (a, b) { return tier(a) - tier(b) || (b.ev.addCmd || -1e12) - (a.ev.addCmd || -1e12); });
    var yes = rows.filter(function (r) { return tier(r) === 1; }), unk = rows.filter(function (r) { return tier(r) === 2; }), no = rows.filter(function (r) { return tier(r) >= 3; });
    var sum = yes.reduce(function (a, r) { return a + r.ev.addCmd; }, 0);
    $('spVerdict').className = 'verdict ' + (yes.length ? 'l0' : 'l2');
    $('spVerdict').innerHTML = '<div class="stamp">여유 댐 ' + yes.length + '곳</div><div class="title">' + (S.spRiver || '전국') + ' · ' + (S.spKind || '다목적·용수댐') + ' ' + rows.length + '곳 중 · 여유량 합계 ' + man(sum) + '만㎥/일</div><ul>' +
      (yes.length ? '<li>여유가 큰 댐: ' + yes.slice(0, 3).map(function (r) { return '<b>' + esc(r.d.name) + '</b> +' + man(r.ev.addCmd) + '만'; }).join(', ') + '</li>' : '<li>기존 공급을 유지하면서 더 낼 수 있는 댐이 없습니다.</li>') +
      (unk.length ? '<li>기존 공급량 미상(확인 필요): ' + unk.map(function (r) { return esc(r.d.name); }).join(', ') + '</li>' : '') +
      '<li>판정 기준: ' + crit().label + ' · 댐 단독, 매일 같은 양 공급 가정 · 여유량 합계는 연계를 고려하지 않은 단순 합</li></ul>';
    var row = function (r) {
      var d = r.d, ev = r.ev, m = ev.m, t = tier(r), base = m.annualMcm * 1e6 / 365, np = nearPlants(d, R, 3);
      return '<tr' + (t >= 3 ? ' class="dim"' : '') + '><td><b>' + esc(d.name) + '</b><div class="small muted">' + esc(d.river || '') + ' · ' + d.kind + '</div></td>' +
        '<td>' + (ev.unknown ? '<span class="muted">미상</span>' : man(base)) + '</td>' +
        '<td class="' + (ev.addCmd > 0 ? 'down' : 'muted') + '"><b>' + (ev.external ? '-' : (ev.addCmd > 0 ? '+' : '') + man(ev.addCmd)) + '</b></td>' +
        '<td>' + (ev.external || ev.unknown || !(base > 0) ? '-' : pct(ev.addCmd / base, 0)) + '</td>' +
        '<td>' + stageCell(d) + '</td><td>' + (r.obs && m.sMax ? pct(r.obs.s / m.sMax, 0) : '-') + '</td>' +
        '<td class="l small">' + (np.length ? np.map(function (x) { return '<span class="plink" data-p="' + esc(x.p.id) + '" data-dam="' + esc(d.name) + '">' + esc(x.p.name) + '</span> ' + fmt(x.km, 0) + 'km' + (x.p.cap ? ' · ' + man(x.p.cap) + '만' : ''); }).join('<br>') : '<span class="muted">반경 안 없음</span>') + '</td>' +
        '<td><span class="pill ' + GRADE[ev.grade][1] + '">' + GRADE[ev.grade][0] + '</span></td></tr>';
    };
    var head = '<tr><th>댐</th><th>계획 공급량<br>(일평균 만㎥)</th><th>추가 여유<br>(만㎥/일)</th><th>계획 대비</th><th>현재 대응단계</th><th>저수율</th><th>가까운 정수장 (직선거리 · 시설용량)</th><th>평가</th></tr>';
    var h = '<table class="t">' + head + yes.concat(unk).map(row).join('') + '</table>';
    if (no.length) h += '<details style="margin-top:8px"><summary class="small">여유 없는 댐 ' + no.length + '곳 보기</summary><table class="t">' + head + no.map(row).join('') + '</table></details>';
    $('spTable').innerHTML = h;
    $('spHint').innerHTML = '추가 공급 가능 = MyWater 연간 용수공급용량(기존 공급)을 유지한 채 판정 기준을 만족하며 더 낼 수 있는 일정 공급량입니다. 다목적댐의 음수는 실제 물 부족이 아니라 계획량(하천유지·농업 포함)을 댐 하나로 다 낼 수 없다는 뜻입니다(종합 현황 표 설명 참고). 현재 대응단계는 MyWater 오늘 값입니다. 정수장 이름을 누르면 아래 ‘특정 정수장에 공급 검토’가 그 정수장·댐으로 열립니다.';
    qsa('#spTable .plink').forEach(function (a) { a.onclick = function () { S.plant = a.dataset.p; plSelDam = a.dataset.dam; save(); var dt = $('plCheck'); if (dt.open) renderPlant(); else dt.open = true; dt.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
    $('plCheck').open = !!S.plOpen;
  }

  /* ================= 정수장 공급 검토 ================= */
  var PR = null, plSelDam = null;
  function routeOptions(dam, plant) {
    var a = coordOf(dam.name);
    if (!a || plant.lat == null) return [];
    var cp = Object.assign({}, COST.DEF, costParams());
    var km = COST.haversine(a, [plant.lat, plant.lon]) * cp.detour;
    return [{ dam: dam.name, plant: plant.id, name: '자동(직선×' + cp.detour + ')', lengthKm: km, tunnelKm: 0, zHigh: null, auto: true }];
  }
  function evalPlant() {
    var p = plantById(S.plant) || plants()[0]; if (!p) return null;
    S.plant = p.id;
    var Q = S.plantQ[p.id] != null ? +S.plantQ[p.id] : (+p.demand || 10000);
    var cp = costParams();
    var cands = [];
    DAMS.forEach(function (dam) {
      var ropts = routeOptions(dam, p); if (!ropts.length) return;
      var minKm = Math.min.apply(null, ropts.map(function (r) { return r.lengthKm; }));
      if (!ropts[0].manual && minKm > S.radius) return;
      var ev = evalDam(dam), m = ev.m;
      var mtQ = WB.metrics(m, WB.run(m, Q / 86400));
      var qtyOk = !ev.external && ev.addCmd != null && ev.addCmd >= Q;
      var qtyLv = ev.external ? 2 : !qtyOk ? 2 : ev.unknown ? 1 : 0;
      var stg = hasStage(dam.name) ? stageVerdictFor(dam.name, Q) : null;
      var stLv = stg ? stg.v.level : 0;
      // 수리종단 노선(data/routes)이 있으면 그 설계 결과를 쓰고, 없으면 연장·최고점 기반 개략 산정
      var prof = window.Hydro ? routesFor(dam.name, p) : [];
      var est = prof.length ? prof.map(function (r) { return profEst(rtDesign(r, Q, dam, p, rtParams(), dam.name + '|' + p.id)); }) : ropts.map(function (r) {
        var e = COST.estimate(Q, { lengthKm: r.lengthKm, tunnelKm: r.tunnelKm || 0, zStart: dam.basic.lwl != null ? dam.basic.lwl : 0, zEnd: hwlOf(p) != null ? hwlOf(p) : 50, zHigh: r.zHigh, lHighKm: r.lHighKm, jackSites: r.jackSites, prvSites: r.prvSites }, cp);
        return { r: r, e: e };
      });
      if (prof.length) minKm = Math.min.apply(null, est.map(function (x) { return x.r.lengthKm; }));
      var best = est.slice().sort(function (a, b) { return a.e.unitCost - b.e.unitCost; })[0];
      var level = Math.max(qtyLv, stLv);
      var notes = [];
      if (ev.external) notes.push('외부 도수 의존 댐(단독 평가 부적합)');
      if (ev.unknown) notes.push('MyWater 연간 용수공급용량 0(기존 공급량 미상)' + (LINKED[dam.name] ? ' – 연계 가뭄관리 댐: ' + LINKED[dam.name] : '') + ': [댐 평가]에서 실제 기존 공급량을 입력해야 함');
      else if (!qtyOk) notes.push(ev.addCmd < 0 ? '기존 공급량도 기준 미충족' : '여유량 ' + man(ev.addCmd) + '만㎥/일 < 요청');
      if (stg) notes.push('가뭄단계: ' + stg.v.label + ' (주의이상 +' + fmt(stg.v.dWarn, 0) + '일/년)');
      if (best.r.auto) notes.push('노선 자동 산정(지형 최고점 미반영)');
      if (best.r.profile) notes.push('노선 수리종단 검토 결과 사용: ' + best.r.name + (best.r.method === 'auto' ? ' (자동 탐색)' : ' (CAD 노선)') + (best.e.ok ? '' : ' – 가압 배치 실패, 조건 확인 필요'));
      if (hwlOf(p) == null) notes.push(prof.length ? '정수장 HWL 미입력(노선 끝 지반고 + 5m 가정)' : '정수장 HWL 미입력(50m 가정)');
      cands.push({ dam: dam, ev: ev, mtQ: mtQ, qtyOk: qtyOk, stg: stg, est: est, best: best, level: level, notes: notes, km: minKm });
    });
    // 기존 공급량 미상(U) 댐은 여유량이 과대 산정되므로 같은 등급 안에서도 맨 뒤로, 최우선 후보에서 제외
    cands.sort(function (a, b) { return a.level - b.level || ((a.ev.unknown ? 1 : 0) - (b.ev.unknown ? 1 : 0)) || (a.best.e.unitCost - b.best.e.unitCost); });
    return { p: p, Q: Q, cands: cands };
  }
  var plBound = false;
  function renderPlant() {
    if (!plBound) {
      plBound = true;
      $('plSel').onchange = function () { S.plant = this.value; plSelDam = null; save(); renderPlant(); };
      var gp = gisPlants(), label = function (p) { return p.name + ' · ' + p.kind + (p.capacity ? ' · ' + man(p.capacity) + '만㎥/일' : ''); };
      $('plList').innerHTML = gp.map(function (p) { return '<option value="' + esc(label(p)) + '">'; }).join('');
      $('plSearch').onchange = function () {
        var v = this.value, hit = gp.filter(function (p) { return label(p) === v; })[0] || gp.filter(function (p) { return p.name === v; })[0];
        if (!hit) return;
        S.plant = hit.id; plSelDam = null; save(); this.value = ''; renderPlant();
      };
      $('plAddReg').onclick = function () {
        var p = plantById(S.plant); if (!p || !p.fromGis) { alert('이미 검토 목록에 있는 정수장입니다.'); return; }
        regPlants().push({ id: p.id, name: p.name, gis: p.name, region: p.region, capacity: p.capacity, source: '', demand: S.plantQ[p.id] != null ? S.plantQ[p.id] : 10000, hwl: null, lat: p.lat, lon: p.lon, note: p.note });
        GPL = null; invalidate(); renderPlant();
        alert(p.name + '을(를) 검토 목록에 추가했습니다. 위 칸에서 요청량·HWL을 입력하세요.');
      };
      $('plDelReg').onclick = function () {
        var i = plants().map(function (p) { return p.id; }).indexOf(S.plant); if (i < 0 || plants().length < 2) return;
        if (!confirm(plants()[i].name + '을(를) 검토 목록에서 뺄까요?')) return;
        regPlants().splice(i, 1); S.plant = plants()[0].id; plSelDam = null; invalidate(); renderPlant();
      };
      $('plHwl').onchange = function () { if (!S.plantHwl) S.plantHwl = {}; S.plantHwl[S.plant] = this.value === '' ? null : +this.value; RTC = {}; save(); renderPlant(); };
      $('plQ').oninput = function () { S.plantQ[S.plant] = this.value === '' ? null : +this.value; save(); clearTimeout(rz); rz = setTimeout(renderPlant, 300); };
      $('plR').oninput = function () { S.radius = +this.value || 120; save(); clearTimeout(rz); rz = setTimeout(renderPlant, 300); };
    }
    var cur = plantById(S.plant);
    $('plSel').innerHTML = '<optgroup label="검토 목록">' + plants().map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' (' + esc(p.region || '') + ')</option>'; }).join('') + '</optgroup>' +
      (cur && cur.fromGis ? '<optgroup label="전국 검색"><option value="' + esc(cur.id) + '">' + esc(cur.name) + ' (' + esc(cur.region) + ')</option></optgroup>' : '');
    $('plAddReg').style.display = cur && cur.fromGis ? '' : 'none';
    $('plDelReg').style.display = cur && !cur.fromGis && plants().length > 1 ? '' : 'none';
    PR = evalPlant(); if (!PR) return;
    $('plSel').value = PR.p.id; $('plQ').value = PR.Q; $('plR').value = S.radius; $('plHwl').value = hwlOf(PR.p) != null ? hwlOf(PR.p) : '';
    var gcap = PR.p.fromGis ? PR.p.capacity : gisCapOf(PR.p);
    var ok = PR.cands.filter(function (c) { return c.level === 0; }), mid = PR.cands.filter(function (c) { return c.level === 1; });
    var top = PR.top = PR.cands.filter(function (c) { return !c.ev.unknown; })[0];
    var unk = PR.cands.filter(function (c) { return c.ev.unknown && c.qtyOk; });
    var lv = ok.length ? 0 : mid.length ? 1 : 2;
    $('plVerdict').className = 'verdict l' + lv;
    $('plVerdict').innerHTML = '<div class="stamp">' + (ok.length ? '공급 가능 수원 ' + ok.length + '곳' : mid.length ? '조건부 가능' : '단독 공급 곤란') + '</div><div class="title">' + esc(PR.p.name) + ' · 요청 ' + man(PR.Q) + '만㎥/일 · 후보 ' + PR.cands.length + '개 댐 (반경 ' + S.radius + 'km)</div><ul>' +
      ((gcap || PR.p.note) ? '<li class="muted">' + esc(PR.p.region || '') + (gcap ? ' · 시설용량 ' + man(gcap) + '만㎥/일(MyWater GIS)' : '') + (PR.p.note ? ' · ' + esc(PR.p.note) : '') + '</li>' : '') +
      (top && top.level < 2 ? '<li>최우선 후보: <b>' + esc(top.dam.name) + '</b> — ' + (top.level === 0 ? '수량 충족' : top.notes[0] || '수량·가뭄단계 제약') + ', 개략 총사업비 ' + eok(top.best.e.cost.total) + '억원, 단위원가 ' + fmt(top.best.e.unitCost, 0) + '원/㎥</li>' : (PR.cands.length ? (top ? '' : '<li>기존 공급량이 확인된 후보 댐이 없습니다.</li>') : '<li>반경 안에 좌표가 등록된 댐이 없습니다.</li>')) +
      (unk.length ? '<li class="muted">기존 공급량 미상 댐(' + unk.map(function (c) { return esc(c.dam.name); }).join(', ') + ')은 MyWater 연간 용수공급용량이 0이라 여유량이 실제보다 크게 나옵니다. 실제 공급량을 [댐 평가]에 입력하기 전까지 최우선 후보에서 뺍니다.</li>' : '') +
      (!ok.length && PR.cands.length ? '<li>단일 댐으로 요청량을 충족하는 수원이 없습니다. 여러 수원을 조합하거나 요청량을 줄이는 방안, 또는 하천수·광역 연계를 검토해야 합니다.</li>' : '') +
      '<li>판정 기준: ' + crit().label + (PR.cands.some(function (c) { return c.stg; }) ? ' + 가뭄단계(조정기준) 영향' : '') + '</li></ul>';
    var h = '<table class="t"><tr><th>댐</th><th>추가 공급 가능<br>(만㎥/일)</th><th>공급 후<br>연 부족</th><th>가뭄단계 영향</th><th>노선<br>(km)</th><th>관경</th><th>양정<br>(m)</th><th>총사업비<br>(억원)</th><th>단위원가<br>(원/㎥)</th><th>판정</th></tr>';
    PR.cands.forEach(function (c, i) {
      var e = c.best.e;
      h += '<tr class="click' + (plSelDam === c.dam.name || (!plSelDam && PR.top && c.dam === PR.top.dam) ? ' sel' : '') + '" data-dam="' + esc(c.dam.name) + '"><td><b>' + esc(c.dam.name) + '</b><div class="small muted">' + c.dam.kind + '</div></td>' +
        '<td class="' + (c.qtyOk ? 'down' : 'up') + '">' + (c.ev.external ? '-' : man(c.ev.addCmd)) + '</td><td>' + c.mtQ.year.def + '/' + c.mtQ.year.n + '</td>' +
        '<td>' + (c.stg ? '<span class="pill l' + c.stg.v.level + '">' + c.stg.v.label + '</span><div class="small muted">주의이상 +' + fmt(c.stg.v.dWarn, 0) + '일</div>' : '<span class="muted small">기준선 없음</span>') + '</td>' +
        '<td>' + fmt(c.best.r.lengthKm, 1) + (c.best.r.auto ? '*' : '') + (c.best.r.profile ? '<div class="small muted">수리종단</div>' : '') + '</td><td>D' + e.D + '</td><td>' + fmt(e.hNeed, 0) + '</td><td>' + (c.best.r.report ? '<b>' + fmt(c.best.r.report.total2026, 0) + '</b>' : eok(e.cost.total)) + '</td><td>' + fmt(e.unitCost, 0) + '</td>' +
        '<td><span class="pill l' + c.level + '">' + ['가능', '조건부', '곤란'][c.level] + '</span></td></tr>';
    });
    h += '</table>';
    $('plTable').innerHTML = PR.cands.length ? h : '<p class="hint">후보가 없습니다. 검토 반경을 넓히거나 [정수장·노선 관리]에서 좌표·노선을 입력하세요.</p>';
    $('plHint').innerHTML = '* 자동 노선 = 직선거리 × 우회계수(' + (Object.assign({}, COST.DEF, costParams()).detour) + '), 지형 최고점 미반영으로 양정·사업비가 과소일 수 있습니다. ‘수리종단’ 표시는 아래 노선 수리종단 검토(DEM 지반고·가압장 자동 배치) 결과이며, 그 쌍은 이 값이 개략 산정보다 우선합니다. 자동 노선(*)의 양정은 ‘시종점 고저차 + 동수경사 × 연장’만 반영해, 중간 산지를 넘는 노선이면 실제보다 작습니다. 용지보상비는 예타 방식대로 관로 전 연장(터널 제외)에 m당 단가를 곱합니다. 도로 아래 구간도 따로 빼지 않으므로 보수적인 값이며, 도로구간 비율은 공사비 단가에만 반영됩니다. 굵은 사업비는 보고서 값(2026년 단가)입니다. 단위원가 = (총사업비 연등가 4.5%·30년 + 전력비) ÷ 연간 공급량.';
    qsa('#plTable tr.click').forEach(function (tr) { tr.onclick = function () { plSelDam = tr.dataset.dam; delete rtParams().sel[PR.p.id]; save(); renderPlant(); }; });   // 댐을 바꾸면 노선 검토도 그 댐의 최적 노선으로
    drawMap($('plMap'), { ratio: [0.45, 0.55], maxH: 320, dams: PR.cands.length ? PR.cands.map(function (c) { return c.dam; }) : null, extraPlants: PR.p.fromGis ? [PR.p] : [], selPlant: PR.p.id, selDam: plSelDam || (top && top.dam.name), links: PR.cands.map(function (c) { return { dam: c.dam.name, plant: PR.p, level: c.level }; }),
      onDam: function (n) { plSelDam = n; renderPlant(); }, onPlant: function (id) { S.plant = id; plSelDam = null; save(); renderPlant(); } });
    renderPlantDetail();
    renderRoute();
  }
  function renderPlantDetail() {
    var c = PR.cands.filter(function (x) { return x.dam.name === plSelDam; })[0] || PR.top || PR.cands[0];
    if (!c) { $('plDetailCard').style.display = 'none'; return; }
    $('plDetailCard').style.display = '';
    $('plDetailTitle').textContent = '상세: ' + c.dam.name + ' → ' + PR.p.name + ' (' + man(PR.Q) + '만㎥/일)';
    var ev = c.ev;
    var h = '<div class="row2"><div><h4>① 수량 · 이수안전도</h4><table class="t">' +
      '<tr><td>기존 공급량</td><td>' + man(ev.m.annualMcm * 1e6 / 365) + ' 만㎥/일</td></tr>' +
      '<tr><td>추가 공급 가능량 (' + esc(crit().label) + ')</td><td>' + (ev.external ? '평가 부적합' : man(ev.addCmd) + ' 만㎥/일') + '</td></tr>' +
      '<tr><td>요청량 공급 시 연 부족</td><td>' + c.mtQ.year.def + ' / ' + c.mtQ.year.n + '년 (기존 ' + ev.mt0.year.def + ')</td></tr>' +
      '<tr><td>요청량 공급 시 일 신뢰도</td><td>' + pct(c.mtQ.stepRel, 2) + ' (기존 ' + pct(ev.mt0.stepRel, 2) + ')</td></tr>' +
      '<tr><td>최저 저수량</td><td>' + fmt(c.mtQ.minS, 1) + ' 백만㎥ (' + c.mtQ.minDate + ')</td></tr></table>';
    if (c.stg) h += '<h4>② 가뭄단계(조정기준) 영향</h4><table class="t"><tr><td>연평균 관심 이상</td><td>' + fmt(c.stg.cur.drought, 0) + ' → ' + fmt(c.stg.sup.drought, 0) + '일</td></tr><tr><td>연평균 주의 이상</td><td>' + fmt(c.stg.cur.warn, 0) + ' → ' + fmt(c.stg.sup.warn, 0) + '일</td></tr><tr><td>비상공급</td><td>' + fmt(c.stg.cur.emergency, 1) + ' → ' + fmt(c.stg.sup.emergency, 1) + '일</td></tr><tr><td>판정</td><td><span class="pill l' + c.stg.v.level + '">' + c.stg.v.label + '</span></td></tr></table>';
    h += '<h4>유의사항</h4><ul class="small">' + c.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div><div><h4>③ 노선·수리·사업비</h4>';
    h += '<table class="t"><tr><th>노선</th>' + c.est.map(function (x) { return '<th>' + esc(x.r.name) + '</th>'; }).join('') + '</tr>';
    var row = function (lab, fn) { return '<tr><td>' + lab + '</td>' + c.est.map(function (x) { return '<td>' + fn(x) + '</td>'; }).join('') + '</tr>'; };
    h += row('연장 (터널)', function (x) { return fmt(x.r.lengthKm, 2) + 'km' + (x.r.tunnelKm ? ' (' + fmt(x.r.tunnelKm, 2) + ')' : ''); });
    h += row('관경 / 유속', function (x) { return 'D' + x.e.D + ' / ' + fmt(x.e.v, 2) + 'm/s'; });
    h += row('동수경사', function (x) { return fmt(x.e.slope, 3) + ' m/km'; });
    h += row('경유 최고점', function (x) { return x.r.zHigh != null ? 'EL.' + x.r.zHigh : '<span class="muted">미입력</span>'; });
    h += row('총양정 / 가압장', function (x) { return fmt(x.e.hNeed, 0) + 'm / ' + x.e.stations + '개소'; });
    h += row('소요동력', function (x) { return fmt(x.e.kW, 0) + ' kW'; });
    h += row('관로', function (x) { return eok(x.e.cost.pipe + x.e.cost.jack + x.e.cost.prv); });
    h += row('터널', function (x) { return eok(x.e.cost.tunnel); });
    h += row('취수·가압장', function (x) { return eok(x.e.cost.intake + x.e.cost.booster); });
    h += row('용지보상', function (x) { return eok(x.e.cost.land); });
    h += row('부대경비·예비비', function (x) { return eok(x.e.cost.overhead + x.e.cost.contingency); });
    h += row('<b>총사업비 (본 모형)</b>', function (x) { return '<b>' + eok(x.e.cost.total) + '</b>'; });
    if (c.est.some(function (x) { return x.r.report; })) h += row('<b>총사업비 (보고서, 2026)</b>', function (x) { return x.r.report ? '<b>' + fmt(x.r.report.total2026, 0) + '</b>' : '-'; });
    h += row('연간 전력비', function (x) { return eok(x.e.powerYr); });
    h += row('단위원가 (원/㎥)', function (x) { return fmt(x.e.unitCost, 0); });
    if (c.est.some(function (x) { return x.r.report; })) h += row('비고', function (x) { return x.r.report ? '<span class="small">' + esc(x.r.report.note) + '</span>' : ''; });
    h += '</table><p class="hint">단위: 억원. K-water 개략공사비 산정 프로그램의 2026년 1월 단가를 쓰고, 관경별 단가는 D700·D900 단가로 내삽·외삽했습니다. 용지보상 단가는 한 지역의 공시지가 사례값이라 지역에 따라 달라집니다.</p></div></div>';
    $('plDetail').innerHTML = h;
  }

  /* ================= 노선 수리종단 검토 ================= */
  var rtBound = false, RTC = {};
  var RULE_LB = { avoid: '통과 금지', avoid_tunnel: '터널 통과 금지', penalty: '저촉 최소화', note: '저촉 집계' };
  // 보호구역: 노선검토 CAD 자료(CONSTRAINTS, KDPA 2025)가 있는 범위는 그 자료를, 범위 밖은 브이월드 공간정보(PROTECT)를 씀
  var CADBB, PCX = {};
  function cadBox() {
    if (CADBB !== undefined) return CADBB;
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    (window.CONSTRAINTS || []).forEach(function (cn) { cn.parts.forEach(function (pp) { pp.forEach(function (rg) { rg.forEach(function (q) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); }); }); }); });
    return (CADBB = b[0] < Infinity ? b : null);
  }
  function inCad(lo, la) { var b = cadBox(); return !!b && lo >= b[0] && lo <= b[2] && la >= b[1] && la <= b[3]; }
  function featBox(f) {
    if (f._bb) return f._bb; var b = [Infinity, Infinity, -Infinity, -Infinity];
    f.parts.forEach(function (pp) { pp[0].forEach(function (q) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); }); });
    return (f._bb = b);
  }
  function inFeat(f, lo, la) {
    var b = featBox(f); if (lo < b[0] || lo > b[2] || la < b[1] || la > b[3]) return false;
    return f.parts.some(function (pp) {   // 바깥 고리와 구멍을 짝홀 규칙으로
      var c = false;
      pp.forEach(function (rg) { for (var i = 0, j = rg.length - 1; i < rg.length; j = i++) { var xi = rg[i][0], yi = rg[i][1], xj = rg[j][0], yj = rg[j][1]; if ((yi > la) !== (yj > la) && lo < (xj - xi) * (la - yi) / (yj - yi) + xi) c = !c; } });
      return c;
    });
  }
  function protCross(r) {
    if (PCX[r.name]) return PCX[r.name];
    var acc = {};
    var fs = (window.CONSTRAINTS || []).map(function (f) { return [f, true]; }).concat((window.PROTECT || []).map(function (f) { return [f, false]; }));
    fs.forEach(function (ff) {
      var f = ff[0];
      for (var i = 1; i < r.pts.length; i++) {
        var a = r.pts[i - 1], z = r.pts[i], lo = (a[1] + z[1]) / 2, la = (a[2] + z[2]) / 2;
        if (inCad(lo, la) !== ff[1] || !inFeat(f, lo, la)) continue;
        var o = acc[f.name] || (acc[f.name] = { name: f.name, cat: f.cat, rule: f.rule, surfaceM: 0, tunnelM: 0, src: ff[1] ? 'CAD' : '브이월드' });
        if (r.segments[z[4]].kind === 'TUNNEL') o.tunnelM += z[0] - a[0]; else o.surfaceM += z[0] - a[0];
      }
    });
    return (PCX[r.name] = Object.keys(acc).map(function (k) { return acc[k]; }));
  }
  function crossOf(r) { return protCross(r).filter(function (x) { return x.surfaceM + x.tunnelM >= 1; }); }
  function routesFor(damName, p) {
    var keys = [p.gis, p.name].filter(Boolean);
    return (window.ROUTES || []).filter(function (r) { return r.method === 'auto' && (!damName || r.dam === damName) && keys.indexOf(r.plant) >= 0; });
  }
  function rtParams() {
    if (!S.rt) S.rt = {};
    var d = { sel: {}, D: 'route', lwl: {}, hwl: {}, pMin: 1, pMax: 70, hMax: 100 };
    if (S.rt.v !== 2) { S.rt.v = 2; if (S.rt.pMax === 120) S.rt.pMax = 70; }   // 관로 최대 수두 기본값 120 → 70m
    Object.keys(d).forEach(function (k) { if (S.rt[k] == null) S.rt[k] = d[k]; });
    return S.rt;
  }
  function rtDesign(r, Q, dam, p, pr, key) {
    var cp = Object.assign({}, COST.DEF, costParams()), qd = Q * cp.peak / 86400;
    var lwl = pr.lwl[key] != null ? pr.lwl[key] : (dam && dam.basic.lwl != null ? dam.basic.lwl : 0);
    var hwl = pr.hwl[key] != null ? pr.hwl[key] : (hwlOf(p) != null ? hwlOf(p) : Math.round(r.pts[r.pts.length - 1][3] + 5));   // HWL 미입력: 노선 끝 지반고 + 5m
    var ck = [r.name, Q, lwl, hwl, dam && dam.basic.nwl, pr.D, pr.pMin, pr.pMax, pr.hMax, JSON.stringify(costParams())].join('|');
    if (RTC[ck]) return RTC[ck];
    var Dm = {}, autoD = COST.chooseD(qd, cp.vMax, cp.C, cp.sMax);
    r.segments.forEach(function (s, k) {
      if (pr.D !== 'route') { Dm[k] = +pr.D; return; }
      var m = /D(\d+)/.exec(s.kind); if (m) Dm[k] = +m[1]; else if (s.kind !== 'TUNNEL') Dm[k] = autoD;
    });
    var d = Hydro.design(r, { q: qd, C: cp.C, lwl: lwl, hwl: hwl, cover: 2, pMin: pr.pMin, pMax: pr.pMax, hMax: pr.hMax, arrive: 6, intakeAt: r.intakeKm || 0, autoIntake: 2, srcMax: dam && dam.basic.nwl != null ? dam.basic.nwl : null, tunnelInv: r.tunnelInv || {}, D: Dm });
    var c = COST.fromDesign(Q, r, d, costParams());
    var tun = [];
    r.segments.forEach(function (s, k) { if (s.kind !== 'TUNNEL') return; var a = Infinity, b = -Infinity; for (var i = 0; i < d.x.length; i++) if (d.seg[i] === k) { a = Math.min(a, d.x[i]); b = Math.max(b, d.x[i]); } if (a < b) tun.push([a, b]); });
    var prot = crossOf(r).filter(function (x) { return x.rule !== 'note'; }).reduce(function (s, x) { return s + x.surfaceM + x.tunnelM; }, 0);
    return (RTC[ck] = { r: r, d: d, c: c, lwl: lwl, hwl: hwl, qd: qd, tun: tun, prot: prot });
  }
  // 수리종단 설계 결과를 순위표·상세표 형식(COST.estimate 결과와 같은 필드)으로 바꿈
  function profEst(x) {
    var d = x.d, c = x.c, r = x.r;
    var Ds = r.segments.map(function (s, k) { return s.kind === 'TUNNEL' ? null : d.segD[k]; }).filter(Boolean);
    var D = Ds.length ? Math.max.apply(null, Ds) : d.segD[0];
    var C0 = Object.assign({}, COST.DEF, costParams()).C;
    return {
      r: { name: r.name, dam: r.dam, method: r.method, profile: true, lengthKm: d.lengthKm, tunnelKm: c.tunnelKm, zHigh: Math.round(Math.max.apply(null, d.ground.filter(function (g, i) { return r.segments[d.seg[i]].kind !== 'TUNNEL'; }))),   // 터널 위 산지는 제외
        report: r.reportTotal ? { total2026: r.reportTotal, note: '' } : null },
      e: { D: D, v: x.qd / (Math.PI * Math.pow(D / 1000, 2) / 4), slope: Hydro.slopePerKm(x.qd, D, C0), hNeed: d.hTot, stations: d.pumps.length, kW: d.kW,
        cost: c.cost, powerYr: c.powerYr, unitCost: c.unitCost, lcc: c.lcc, ok: d.ok }
    };
  }
  function renderRoute() {
    var card = $('rtCard'); if (!PR || !window.Hydro) { card.style.display = 'none'; return; }
    var p = PR.p, cand = PR.cands.filter(function (x) { return x.dam.name === plSelDam; })[0] || PR.top || PR.cands[0];
    var damName = cand ? cand.dam.name : null;
    // 이 정수장으로 가는 모든 댐의 노선 (선택한 댐 먼저)
    var list = routesFor(null, p).sort(function (a, b) { return (b.dam === damName) - (a.dam === damName); });
    card.style.display = '';
    var pr = rtParams(), key = p.id;
    if (!rtBound) {
      rtBound = true;
      var re = function () { RTC = {}; save(); renderPlant(); };   // 순위표도 같은 설계 결과를 쓰므로 함께 갱신
      $('rtSel').onchange = function () { var v = this.value, rr = (window.ROUTES || []).filter(function (q) { return q.name === v; })[0]; rtParams().sel[this.dataset.key] = v; save(); if (rr && PR.cands.some(function (c) { return c.dam.name === rr.dam; })) plSelDam = rr.dam; renderPlant(); };
      $('rtD').onchange = function () { rtParams().D = this.value; re(); };
      [['rtPmin', 'pMin'], ['rtPmax', 'pMax'], ['rtHmax', 'hMax']].forEach(function (a) { $(a[0]).onchange = function () { if (this.value !== '') rtParams()[a[1]] = +this.value; re(); }; });
      [['rtLwl', 'lwl'], ['rtHwl', 'hwl']].forEach(function (a) { $(a[0]).onchange = function () { rtParams()[a[1]][this.dataset.key] = this.value === '' ? null : +this.value; re(); }; });
    }
    if (!list.length) {
      $('rtSub').textContent = '— ' + (damName || '') + ' → ' + p.name;
      ['rtKpis', 'rtCmp', 'rtFac', 'rtCross', 'rtMap'].forEach(function (id) { $(id).innerHTML = ''; });
      $('cRt').getContext('2d').clearRect(0, 0, 9999, 9999);
      $('rtCtl').style.display = 'none';
      $('rtNote').innerHTML = '이 댐–정수장 쌍은 수리종단 노선 자료가 없어, 위 후보 표의 개략 산정(직선거리 × 우회계수)으로 관경·양정·사업비를 봅니다. 수리종단 예시 노선은 소양정수장에서 볼 수 있습니다.';
      return;
    }
    $('rtCtl').style.display = '';
    var all = list.map(function (r) { return rtDesign(r, PR.Q, damByName(r.dam), p, pr, r.dam + '|' + p.id); });
    var selName = pr.sel[key] && list.some(function (r) { return r.name === pr.sel[key] && (!damName || r.dam === damName); }) ? pr.sel[key] : cand && cand.best.r.profile ? cand.best.r.name : list[0].name;
    var cur = all.filter(function (x) { return x.r.name === selName; })[0];
    $('rtSel').dataset.key = key; $('rtLwl').dataset.key = $('rtHwl').dataset.key = cur.r.dam + '|' + p.id;
    $('rtSel').innerHTML = list.map(function (r) { return '<option' + (r.name === selName ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('');
    $('rtD').value = pr.D; $('rtPmin').value = pr.pMin; $('rtPmax').value = pr.pMax; $('rtHmax').value = pr.hMax;
    $('rtLwl').value = cur.lwl; $('rtHwl').value = cur.hwl;
    var d = cur.d, c = cur.c, r = cur.r;
    $('rtSub').textContent = '— ' + cur.r.dam + ' → ' + p.name + ' · 평균 ' + man(PR.Q) + '만㎥/일, 시설 ' + man(cur.qd * 86400) + '만㎥/일 · 노선 ' + list.length + '개';
    var segD = r.segments.map(function (s, k) { return s.kind === 'TUNNEL' ? null : d.segD[k]; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    $('rtKpis').innerHTML = [
      ['노선 연장', fmt(d.lengthKm, 2) + ' <small>km</small>', '터널 ' + fmt(c.tunnelKm, 2) + 'km · 도로 ' + (r.roadShare != null ? pct(r.roadShare, 0) : '미상') + ' · D' + segD.join('/D')],
      ['가압장', d.pumps.length + ' <small>개소</small> ' + fmt(d.hTot, 0) + ' <small>m</small>', '동력 ' + fmt(d.kW, 0) + 'kW'],
      ['감압밸브', d.prv.length + ' <small>개소</small> ' + fmt(d.prvTot, 0) + ' <small>m</small>', (d.prv.some(function (v) { return v.dHmax != null; }) ? '만수위 때 ' + fmt(d.prvTot + d.srcRise, 0) + 'm · ' : '') + '도달 EL.' + fmt(d.arrive, 1)],
      ['관로 수두', fmt(d.maxRes, 0) + ' <small>m 최대</small>', (d.maxRes > pr.pMax + 0.5 ? '상한 ' + fmt(pr.pMax, 0) + 'm 초과(' + fmt(d.maxResX, 1) + 'km, 급경사·터널 출구) · ' : '상한 ' + fmt(pr.pMax, 0) + 'm 이내 · ') + '최소 ' + fmt(d.minRes, 1) + 'm' + (d.ok ? '' : ' · 배치 실패')],
      ['총사업비', eok(c.cost.total) + ' <small>억원</small>', r.reportTotal ? '보고서 ' + fmt(r.reportTotal, 0) + '억 (' + (c.cost.total / 1e8 >= r.reportTotal ? '+' : '') + fmt((c.cost.total / 1e8 / r.reportTotal - 1) * 100, 1) + '%)' : '2026년 단가'],
      ['30년 총비용', eok(c.lcc) + ' <small>억원</small>', '전력비 현가 ' + eok(c.powerPV) + '억 · ' + fmt(c.unitCost, 0) + '원/㎥']
    ].map(function (k) { return '<div class="kpi"><div class="k">' + k[0] + '</div><div class="v">' + k[1] + '</div><div class="d muted">' + k[2] + '</div></div>'; }).join('');
    C.drawProfile($('cRt'), d, { tunnels: cur.tun, hwl: cur.hwl, lwl: cur.lwl });
    // 비교
    $('rtCmp').innerHTML = '<table class="t"><tr><th>노선</th><th>연장<br>(터널)</th><th>가압장</th><th>감압</th><th>최대<br>수두</th><th>보호구역<br>저촉(km)</th><th>총사업비<br>(억원)</th><th>30년 총비용<br>(억원)</th></tr>' + all.map(function (x) {
      return '<tr class="click' + (x === cur ? ' sel' : '') + '" data-r="' + esc(x.r.name) + '"><td class="l">' + esc(x.r.name) + '<div class="small muted">' + esc(x.r.dam) + ' · ' + (x.r.method === 'auto' ? '자동 탐색' : 'CAD 노선') + ' · 취수 EL.' + fmt(x.lwl, 1) + '</div></td><td>' + fmt(x.d.lengthKm, 1) + ' (' + fmt(x.c.tunnelKm, 1) + ')</td><td>' + x.d.pumps.length + '개 ' + fmt(x.d.hTot, 0) + 'm</td><td>' + x.d.prv.length + '개 ' + fmt(x.d.prvTot, 0) + 'm</td><td>' + fmt(x.d.maxRes, 0) + '</td><td>' + fmt(x.prot / 1000, 2) + '</td><td>' + eok(x.c.cost.total) + (x.r.reportTotal ? '<div class="small muted">보고서 ' + fmt(x.r.reportTotal, 0) + '</div>' : '') + '</td><td><b>' + eok(x.c.lcc) + '</b></td></tr>';
    }).join('') + '</table>';
    qsa('#rtCmp tr.click').forEach(function (tr) { tr.onclick = function () { var rr = list.filter(function (q) { return q.name === tr.dataset.r; })[0]; rtParams().sel[key] = tr.dataset.r; save(); if (rr && rr.dam !== damName && PR.cands.some(function (c) { return c.dam.name === rr.dam; })) { plSelDam = rr.dam; renderPlant(); } else renderRoute(); }; });
    // 시설
    var fac = (d.pumps.some(function (q) { return q.intake; }) ? [] : ['<tr><td>취수 (자연유하)</td><td>' + fmt(d.intakeX, 2) + '</td><td class="muted">–</td><td>' + fmt(cur.lwl, 1) + '</td><td class="small muted">취수 수위 그대로 유하</td></tr>'])
      .concat(d.pumps.map(function (q, k) { return '<tr><td>P' + (k + 1) + ' ' + (q.intake ? '취수가압장' : '가압장') + '</td><td>' + fmt(q.x, 2) + '</td><td>' + fmt(q.ground, 0) + '</td><td>' + fmt(q.hIn, 1) + ' → ' + fmt(q.hOut, 1) + '</td><td>' + fmt(q.H, 1) + 'm · ' + fmt(q.kW, 0) + 'kW</td></tr>'; }))
      .concat(d.prv.map(function (q, k) { return '<tr><td>V' + (k + 1) + ' 감압밸브</td><td>' + fmt(q.x, 2) + '</td><td>' + fmt(q.ground, 0) + '</td><td>' + fmt(q.hIn, 1) + ' → ' + fmt(q.hOut, 1) + '</td><td>−' + fmt(q.dH, 1) + 'm' + (q.dHmax != null ? '<div class="small muted">만수위 때 −' + fmt(q.dHmax, 1) + 'm</div>' : '') + '</td></tr>'; }))
      .sort(function (a, b) { var xa = +(/<td>([\d.]+)<\/td>/.exec(a) || [0, 0])[1], xb = +(/<td>([\d.]+)<\/td>/.exec(b) || [0, 0])[1]; return xa - xb; });
    $('rtFac').innerHTML = '<table class="t"><tr><th>시설</th><th>위치(km)</th><th>지반 EL.</th><th>동수두 EL.</th><th>양정·감압</th></tr>' + (fac.join('') || '<tr><td colspan="5" class="muted">가압·감압 없이 자연유하</td></tr>') + '</table>';
    // 저촉
    var cr = crossOf(r);
    $('rtCross').innerHTML = cr.length ? '<table class="t"><tr><th>구역</th><th>검토 규칙</th><th>지표(m)</th><th>터널(m)</th><th>자료</th></tr>' + cr.map(function (x) {
      return '<tr><td class="l">' + esc(x.name) + '</td><td>' + (RULE_LB[x.rule] || x.rule) + '</td><td>' + fmt(x.surfaceM, 0) + '</td><td>' + fmt(x.tunnelM, 0) + '</td><td class="small muted">' + x.src + '</td></tr>'; }).join('') + '</table>' : '<p class="hint">저촉 구역 없음 (국립공원·상수원보호구역·자연환경보전지역·산림보호구역 기준. 도립·군립공원 자료는 없음)</p>';
    drawRouteMap($('rtMap'), all, cur, damByName(cur.r.dam), p);
    var s = r.search;
    $('rtNote').innerHTML = (r.method === 'auto' ? '자동 탐색 노선: ' + fmt(s.res, 0) + 'm 격자에서 관로 공사비(도로 ' + fmt(s.uRoad / 1e6, 2) + '·도로 밖 ' + fmt(s.uOff / 1e6, 2) + '백만원/m)와 오르막 양수 비용(1m당 ' + fmt(s.lam / 1e8, 2) + '억원)의 합이 가장 작은 경로이며, 터널은 1개(최대 ' + fmt(s.tunnelMax / 1000, 0) + 'km)까지 고려했습니다. 지장물·지질·민원·하천 횡단 공법은 반영하지 않습니다. ' :
      '') +
      '보호구역은 브이월드 공간정보(국립공원·상수원보호구역·자연환경보전지역·산림보호구역)입니다. 지반고는 Copernicus 30m DEM(수목·건물 포함 표면고)이라 ±5~10m 개략값입니다. 관저고 = 지반 − 2m, 터널은 갱구 관저고를 직선으로 잇습니다. 수압은 전 구간에서 최소 잔류수두 이상·관로 최대 수두(기본 70m, 약 700kPa) 이하로 맞춥니다. 취수 수위로 자연유하할 수 있는 데까지 보내고, 내려가다 최대 수두를 넘는 곳 직전에 감압밸브를 두며, 가압장은 수두가 바닥나는 지점(오르막 앞)에 두어 다음 고점을 넘을 만큼만 올립니다. 올린 물이 하류 저지대에서 최대 수두를 넘게 되면 덜 올리고 여러 단으로 나눕니다(정수장 도달 여유 6m). 댐 바로 아래 감압밸브는 저수위 기준 감압량과 만수위 때 감압량을 함께 적었습니다. 댐체 통과(취수탑·취수터널)는 노선이 취수 수위 아래로 내려오는 지점까지로 보고 수압 검토에서 뺐고, 터널 안은 최대 수두 검토에서 뺐습니다. 고압관을 쓰는 구간은 최대 수두를 올려서 검토하면 됩니다. 사업비는 2026년 단가, 30년 총비용 = 총사업비 + 전력비 현가(4.5%).';
  }
  function drawRouteMap(el, all, cur, dam, p) {
    var b = [Infinity, -Infinity, Infinity, -Infinity];
    // 고른 노선에 맞춰 보여 줌(길이가 크게 다른 노선과 함께 맞추면 짧은 노선이 점처럼 보임). 다른 노선은 범위 안에 들어오는 만큼만 보임
    cur.r.pts.forEach(function (q) { b[0] = Math.min(b[0], q[2]); b[1] = Math.max(b[1], q[2]); b[2] = Math.min(b[2], q[1]); b[3] = Math.max(b[3], q[1]); });
    var cLa = (b[0] + b[1]) / 2, k = Math.cos(cLa * Math.PI / 180), spLa = (b[1] - b[0]) * 1.15 + 0.02, spLo = (b[3] - b[2]) * 1.35 + 0.03;
    var Wd = 600, ratio = Math.min(1.1, Math.max(0.55, spLa / (spLo * k))), Hd = Math.round(Wd * ratio);
    if (spLa / (spLo * k) > ratio) spLo = spLa / (ratio * k); else spLa = spLo * k * ratio;
    var minLa = cLa - spLa / 2, maxLa = cLa + spLa / 2, minLo = (b[2] + b[3]) / 2 - spLo / 2, maxLo = minLo + spLo;
    var X = function (lo) { return ((lo - minLo) / spLo * Wd).toFixed(1); }, Y = function (la) { return ((maxLa - la) / spLa * Hd).toFixed(1); };
    var col = { avoid: '#c9472b', avoid_tunnel: '#8e2f6b', penalty: '#e0a12b', note: '#9fb7cc' };
    var s = '<svg viewBox="0 0 ' + Wd + ' ' + Hd + '"><rect width="' + Wd + '" height="' + Hd + '" fill="#f6f4ee"/>';
    // 배경지도: OpenStreetMap 간선도로·호소·하천·지명 (data/routebase.js, tools/build_routebase.py)
    var RB = window.ROUTEBASE, maxLo = minLo + spLo, minLaV = maxLa - spLa;
    var inView = function (pts) { for (var i = 0; i < pts.length; i++) { var q = pts[i]; if (q[0] >= minLo && q[0] <= maxLo && q[1] >= minLaV && q[1] <= maxLa) return true; } return false; };
    var line = function (pts) { return 'M' + pts.map(function (q) { return X(q[0]) + ' ' + Y(q[1]); }).join('L'); };
    if (RB) {
      RB.water.forEach(function (w) { if (inView(w[1])) s += '<path d="' + line(w[1]) + 'Z" fill="#c9def0" stroke="#9cc1e0" stroke-width=".6"><title>' + esc(w[0] || '호소') + '</title></path>'; });
      RB.rivers.forEach(function (r) { if (inView(r[2])) s += '<path d="' + line(r[2]) + '" fill="none" stroke="#8fbfe6" stroke-width="' + (r[0] === 'river' ? 1.6 : 0.9) + '"><title>' + esc(r[1] || '') + '</title></path>'; });
      var rw = { 1: 2.4, 2: 2.0, 3: 1.5, 4: 1.0 };
      RB.roads.slice().sort(function (a, b) { return b[0] - a[0]; }).forEach(function (r) { if (inView(r[1])) s += '<path d="' + line(r[1]) + '" fill="none" stroke="' + (r[0] <= 2 ? '#e3b27a' : '#cdbfae') + '" stroke-width="' + rw[r[0]] + '" stroke-linecap="round"/>'; });
      var showVil = spLo < 0.35;
      RB.places.forEach(function (pl) {
        if (pl[3] === 'village' && !showVil) return;
        if (!(pl[1] >= minLo && pl[1] <= maxLo && pl[2] >= minLaV && pl[2] <= maxLa)) return;
        s += '<text x="' + X(pl[1]) + '" y="' + Y(pl[2]) + '" text-anchor="middle" font-size="' + (pl[3] === 'village' ? 9 : pl[3] === 'town' ? 11 : 12.5) + '" fill="#6b6255" font-weight="' + (pl[3] === 'village' ? 400 : 600) + '" paint-order="stroke" stroke="#f6f4ee" stroke-width="2.5">' + esc(pl[0]) + '</text>';
      });
    }
    var pPath = function (cn) {
      var dd = cn.parts.map(function (pp) { return pp.map(function (rg) { return 'M' + rg.map(function (q) { return X(q[0]) + ' ' + Y(q[1]); }).join('L') + 'Z'; }).join(''); }).join('');
      return '<path d="' + dd + '" fill="' + (col[cn.rule] || '#ccc') + '" fill-opacity="' + (cn.rule === 'note' ? 0.12 : 0.28) + '" fill-rule="evenodd" stroke="' + (col[cn.rule] || '#ccc') + '" stroke-width=".6"><title>' + esc(cn.name) + ' · ' + (RULE_LB[cn.rule] || cn.rule) + '</title></path>';
    };
    var vis = (window.PROTECT || []).filter(function (f) { var b = featBox(f); return b[2] >= minLo && b[0] <= maxLo && b[3] >= minLaV && b[1] <= maxLa; });
    if (vis.length) {
      var cb = cadBox();
      s += '<defs><mask id="rtCadMask"><rect width="' + Wd + '" height="' + Hd + '" fill="#fff"/>' + (cb ? '<rect x="' + X(cb[0]) + '" y="' + Y(cb[3]) + '" width="' + (X(cb[2]) - X(cb[0])).toFixed(1) + '" height="' + (Y(cb[1]) - Y(cb[3])).toFixed(1) + '" fill="#000"/>' : '') + '</mask></defs><g mask="url(#rtCadMask)">' + vis.map(pPath).join('') + '</g>';
    }
    (window.CONSTRAINTS || []).forEach(function (cn) {
      var dd = cn.parts.map(function (pp) { return pp.map(function (rg) { return 'M' + rg.map(function (q) { return X(q[0]) + ' ' + Y(q[1]); }).join('L') + 'Z'; }).join(''); }).join('');
      s += '<path d="' + dd + '" fill="' + (col[cn.rule] || '#ccc') + '" fill-opacity="' + (cn.rule === 'note' ? 0.12 : 0.28) + '" fill-rule="evenodd" stroke="' + (col[cn.rule] || '#ccc') + '" stroke-width=".6"><title>' + esc(cn.name) + ' · ' + (RULE_LB[cn.rule] || cn.rule) + '</title></path>';
    });
    var path = function (x, w, color, op) {
      var r = x.r, segs = {}, out = '';
      r.pts.forEach(function (q) { (segs[q[4]] = segs[q[4]] || []).push(q); });
      Object.keys(segs).forEach(function (kk) {
        var tun = r.segments[kk].kind === 'TUNNEL';
        out += '<path d="M' + segs[kk].map(function (q) { return X(q[1]) + ' ' + Y(q[2]); }).join('L') + '" fill="none" stroke="' + color + '" stroke-width="' + w + '" stroke-opacity="' + op + '"' + (tun ? ' stroke-dasharray="5 3"' : '') + ' stroke-linecap="round"/>';
      });
      return out;
    };
    all.forEach(function (x) { if (x !== cur) s += path(x, 1.6, '#7b8794', 0.7); });
    s += path(cur, 3.2, '#1d4f86', 1);
    cur.d.pumps.forEach(function (q, i) { var pt = cur.r.pts[q.i]; s += '<path d="M' + X(pt[1]) + ' ' + (Y(pt[2]) - 7) + 'l6 10h-12z" fill="#1d4f86" stroke="#fff"/><text x="' + (+X(pt[1]) + 8) + '" y="' + (+Y(pt[2]) - 6) + '" class="ml">P' + (i + 1) + '</text>'; });
    cur.d.prv.forEach(function (q, i) { var pt = cur.r.pts[q.i]; s += '<circle cx="' + X(pt[1]) + '" cy="' + Y(pt[2]) + '" r="4.5" fill="#2f9e6e" stroke="#fff"/><text x="' + (+X(pt[1]) + 7) + '" y="' + (+Y(pt[2]) + 4) + '" class="ml">V' + (i + 1) + '</text>'; });
    var a = cur.r.pts[0], z = cur.r.pts[cur.r.pts.length - 1];
    s += '<circle cx="' + X(a[1]) + '" cy="' + Y(a[2]) + '" r="6" fill="#4f8fd6" stroke="#111" stroke-width="1.5"/><text x="' + (+X(a[1]) + 9) + '" y="' + (+Y(a[2]) + 4) + '" class="ml">' + esc((dam ? dam.name : cur.r.dam) || '') + '</text>';
    s += '<rect x="' + (+X(z[1]) - 5) + '" y="' + (+Y(z[2]) - 5) + '" width="10" height="10" fill="#e0662b" stroke="#1d4f86" stroke-width="1.5"/><text x="' + (+X(z[1]) + 9) + '" y="' + (+Y(z[2]) + 4) + '" class="ml pl">' + esc(p.name) + '</text>';
    var lg = [['#1d4f86', '선택 노선(점선=터널)'], ['#7b8794', '다른 노선'], [col.avoid, '통과 금지'], [col.avoid_tunnel, '터널 통과 금지'], [col.penalty, '저촉 최소화'], [col.note, '저촉 집계']];
    s += '<g class="mlegend"><rect x="6" y="' + (Hd - 18 * lg.length - 10) + '" width="150" height="' + (18 * lg.length + 6) + '" rx="4"/>' + lg.map(function (l, i) { var y = Hd - 18 * lg.length - 4 + i * 18; return '<rect x="12" y="' + (y + 3) + '" width="12" height="8" fill="' + l[0] + '" fill-opacity=".8"/><text x="30" y="' + (y + 11) + '">' + l[1] + '</text>'; }).join('') + '</g>';
    // 축척 막대와 출처
    var kmPerPx = spLo * 111.32 * k / Wd, nice = [0.5, 1, 2, 5, 10, 20], sb = nice.filter(function (v) { return v / kmPerPx <= 140; }).pop() || 0.5, sw = sb / kmPerPx;
    s += '<g font-size="10" fill="#4a5664"><rect x="' + (Wd - sw - 16) + '" y="10" width="' + (sw + 10) + '" height="22" rx="3" fill="rgba(255,255,255,.85)"/><path d="M' + (Wd - sw - 11) + ' 26h' + sw + '" stroke="#333" stroke-width="2"/><text x="' + (Wd - sw / 2 - 11) + '" y="21" text-anchor="middle">' + sb + ' km</text></g>';
    if (RB) s += '<text x="' + (Wd - 6) + '" y="' + (Hd - 6) + '" text-anchor="end" font-size="9" fill="#7b8794">© OpenStreetMap 기여자' + ((window.PROTECT || []).length ? ' · 보호구역 브이월드' : '') + '</text>';
    el.innerHTML = s + '</svg>';
  }

  /* ================= 사업비 산정 변수 (공급 검토 탭 아래) ================= */
  function regPlants() { if (!S.reg.plants) S.reg.plants = clone(REG.plants); return S.reg.plants; }
  function invalidate() { EC = {}; GPL = null; RTC = {}; save(); }
  var costBound = false;
  function renderCost() {
    var cdef = COST.DEF, cp = costParams();
    var ck = [['detour', '우회계수(직선거리 배수)'], ['vMax', '최대 유속(m/s)'], ['sMax', '최대 동수경사(m/km)'], ['peak', '시설용량/평균 배수'], ['roadShare', '도로구간 비율'], ['powerPrice', '전력단가(원/kWh)'], ['landPerM', '용지보상비(원/m)'], ['tunnelPerM', '터널 단가(원/m)'], ['rate', '할인율'], ['years', '분석기간(년)'], ['maxStageHead', '가압장 1개소 최대양정(m)']];
    $('regCost').innerHTML = '<table class="t edit"><tr><th>변수</th><th>값</th><th>기본값</th></tr>' + ck.map(function (k) { return '<tr><td>' + k[1] + '</td><td><input type="number" step="any" data-k="' + k[0] + '" value="' + (cp[k[0]] != null ? cp[k[0]] : '') + '" placeholder="' + cdef[k[0]] + '"></td><td>' + fmt(cdef[k[0]], 3) + '</td></tr>'; }).join('') + '</table>';
    if (costBound) return; costBound = true;
    $('regCost').addEventListener('change', function (e) {
      var t = e.target, k = t.dataset.k; if (!k) return;
      if (t.value === '') delete S.reg.cost[k]; else S.reg.cost[k] = +t.value;
      invalidate(); renderPlant();
    });
    $('regReset').onclick = function () { if (!confirm('사업비 산정 변수를 기본값으로 되돌릴까요?')) return; S.reg.cost = {}; invalidate(); renderCost(); renderPlant(); };
  }

  /* ================= 가뭄단계 기준선 불러오기 ================= */
  var upBound = false;
  function blankMd() { var o = [], d = new Date(2001, 0, 1); for (var i = 0; i < 365; i++, d.setDate(d.getDate() + 1)) o.push(('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)); return o; }
  function renderUpload() {
    $('upList').textContent = Object.keys(BASES).length ? '불러온 기준선: ' + Object.keys(BASES).join(', ') : '';
    if (upBound) return; upBound = true;
    $('tplBase').onclick = function () { download('가뭄기준선_양식.csv', '﻿월일,관심,주의,심각,가동기준,정상환원\n' + (P ? P.unmun.baseline.map(function (b) { return [b.md, b.gs, b.js, b.ss, b.es, b.ns].join(','); }) : blankMd().map(function (md) { return md + ',,,,,'; })).join('\n'), 'text/csv;charset=utf-8'); };
    $('upGo').onclick = function () {
      var f = $('upBase').files[0], name = S.st.dam, msg = $('upMsg');
      if (!f) { msg.textContent = '파일을 선택하세요.'; return; }
      var rd = new FileReader();
      rd.onload = function () {
        var buf = new Uint8Array(rd.result), txt;
        try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { txt = new TextDecoder('euc-kr').decode(buf); }
        var rows = txt.replace(/^﻿/, '').split(/\r?\n/).map(function (l) { return l.split(/,|\t/).map(function (c) { return c.trim(); }); });
        var base = rows.map(function (r) { var m = String(r[0]).match(/(\d{1,2})\D+(\d{1,2})/); var g = parseFloat(r[1]); if (!m || isNaN(g)) return null;
          var n = function (x) { var v = parseFloat(x); return isNaN(v) ? null : v; };
          return { md: ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2), gs: g, js: n(r[2]), ss: n(r[3]), es: n(r[4]), ns: n(r[5]) != null ? n(r[5]) : g }; }).filter(Boolean);
        if (base.length < 365) { msg.textContent = '오류: 1.1~12.31 일별 365행 이상이 필요합니다 (' + base.length + '행).'; return; }
        BASES[name] = base; try { localStorage.setItem(STORE_BASE, JSON.stringify(BASES)); } catch (e) { /* 용량 */ }
        SDS = {}; S.st.dam = name; save();
        msg.textContent = name + ' 기준선을 불러왔습니다.';
        renderStage(); renderUpload();
      };
      rd.readAsArrayBuffer(f);
    };
  }

  /* ================= 내보내기 ================= */
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function printReport() {
    var cur = S.tab, pr = $('printReport');
    S.tab = 'overview'; renderOverview(); var ov = $('ovTable').innerHTML;
    S.tab = 'dam'; renderDam(); var dv = $('damVerdict').innerHTML, dr = $('damRel').innerHTML;
    S.tab = 'plant'; renderPlant(); var pv = $('plVerdict').innerHTML, pt = $('plTable').innerHTML, pd = $('plDetail').innerHTML;
    S.tab = cur; showTab();
    pr.innerHTML = '<h1>물담 · 댐 용수공급 평가 결과</h1><div class="small">작성 ' + new Date().toLocaleDateString('ko-KR') + ' · 판정 기준: ' + esc(crit().label) + '</div>' +
      '<h2>1. 댐별 평가 총괄</h2>' + ov + '<h2>2. 댐 평가: ' + esc(S.dam) + '</h2><div>' + dv + '</div>' + dr +
      '<h2>3. 정수장 공급 검토</h2><div>' + pv + '</div>' + pt + pd;
    window.print();
  }

  /* ================= 시작 ================= */
  // 바로가기 주소: index.html#tab=plant&dam=소양강댐&plant=cheonsang&open=1 (설명서·공유용)
  (function () {
    var h = location.hash.slice(1); if (h.indexOf('=') < 0) return;
    var q = {}; h.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); });
    if (q.tab && $('tab-' + q.tab)) S.tab = q.tab;
    if (q.dam && damByName(q.dam)) { S.dam = q.dam; S.lv = Object.assign(S.lv || { crit: 'y95', peak: 1 / 0.7 }, { dam: q.dam, p: null }); S.st.dam = q.dam; }
    if (q.plant && plantById(q.plant)) { S.plant = q.plant; plSelDam = null; }
    if (q.open) S.plOpen = q.open === '1';
    if (q.crit && CRIT_SEL.indexOf(q.crit) >= 0) S.crit = q.crit;
  })();
  if (!$('tab-' + S.tab)) S.tab = 'overview';   // 없어진 탭(정수장·노선 관리, 자료·방법론)이 저장돼 있던 브라우저
  initControls();
  showTab();
})();
