/* 저수지 물수지 모의 · 이수안전도 엔진
 *  S(t+1) = S(t) + (I − D)·Δt,  상한: 상시만수위(홍수기 홍수기제한수위) 저수량 → 초과분 무효방류
 *  하한: 용수공급가능(저수위) 저수량 → 부족 발생
 *  D05 「낙동강수계 기본계획공급량 용수공급능력」 엑셀과 같은 방식(증발 미고려).
 *  브라우저(window.WB) / Node(module.exports)
 */
(function (root) {
  'use strict';
  var SEC = 86400;

  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }

  /** 수위-저수량 곡선 [[H,V],...] 보간기 */
  function curveFns(curve) {
    var c = curve.slice().sort(function (a, b) { return a[0] - b[0]; });
    function ip(x, xi, yi) {
      var n = c.length; if (!n) return null;
      var a, b;
      if (x <= c[0][xi]) { a = c[0]; b = c[Math.min(1, n - 1)]; }
      else if (x >= c[n - 1][xi]) { a = c[Math.max(0, n - 2)]; b = c[n - 1]; }
      else { var lo = 0, hi = n - 1; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (c[m][xi] <= x) lo = m; else hi = m; } a = c[lo]; b = c[hi]; }
      return b[xi] === a[xi] ? a[yi] : a[yi] + (x - a[xi]) * (b[yi] - a[yi]) / (b[xi] - a[xi]);
    }
    return { vOfH: function (h) { return ip(h, 0, 1); }, hOfV: function (v) { return ip(v, 1, 0); } };
  }

  /**
   * 물수지 모의
   * @param m 모형 { dates[], dt[] (일), inflow[] (㎥/s), demand[] (㎥/s), flood[] (0/1),
   *                 sMax, sMaxFlood, sMin, s0 }
   * @param addCms 추가 공급량(㎥/s, 음수 가능)
   * @param o { cut: [단계별 비율] 미사용 시 생략 }
   */
  function run(m, addCms) {
    var n = m.dates.length, S = m.s0;
    var st = new Float64Array(n), sup = new Float64Array(n), def = new Float64Array(n), spill = new Float64Array(n), need = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var dt = m.dt[i] * SEC / 1e6;                       // ㎥/s → 백만㎥ 환산계수
      var D = Math.max(0, m.demand[i] + (addCms || 0));
      var I = m.inflow[i] == null ? 0 : m.inflow[i];
      var cap = m.flood && m.flood[i] && m.sMaxFlood != null ? m.sMaxFlood : m.sMax;
      var s1 = S + (I - D) * dt;
      var give = D;
      if (s1 < m.sMin) { give = Math.max(0, (S - m.sMin) / dt + I); if (give > D) give = D; s1 = S + (I - give) * dt; }
      if (s1 > cap) { spill[i] = (s1 - cap) / dt; s1 = cap; }
      S = s1; st[i] = S; sup[i] = give; def[i] = D - give; need[i] = D;
    }
    return { storage: st, supply: sup, deficit: def, spill: spill, need: need };
  }

  /** 신뢰도 지표 (기간신뢰도: 단위기간 / 순 / 월 / 년(수문년 10.1~9.30), 양적신뢰도, 회복도, 취약도) */
  function metrics(m, r, opt) {
    opt = opt || {};
    var n = m.dates.length, eps = 1e-6, wyStart = opt.wyMonth || 10;
    var stepDef = 0, run = 0, maxRun = 0, events = 0, defVol = 0, needVol = 0, maxDefStep = 0, meanNeed = 0;
    var ten = {}, mon = {}, yr = {}, yrDefVol = {};
    for (var i = 0; i < n; i++) {
      var d = m.dates[i], y = +d.slice(0, 4), mo = +d.slice(5, 7), day = +d.slice(8, 10);
      var dt = m.dt[i] * SEC / 1e6, isDef = r.deficit[i] > eps;
      var wy = mo >= wyStart ? y : y - 1;
      var mk = d.slice(0, 7), tk = mk + (day <= 10 ? 'a' : day <= 20 ? 'b' : 'c');
      if (!(mk in mon)) mon[mk] = 0; if (!(tk in ten)) ten[tk] = 0; if (!(wy in yr)) { yr[wy] = 0; yrDefVol[wy] = 0; }
      if (isDef) { stepDef++; run++; if (run === 1) events++; mon[mk] = 1; ten[tk] = 1; yr[wy] = 1; }
      else run = 0;
      if (run > maxRun) maxRun = run;
      defVol += r.deficit[i] * dt; needVol += r.need[i] * dt; yrDefVol[wy] += r.deficit[i] * dt;
      if (r.deficit[i] * dt > maxDefStep) maxDefStep = r.deficit[i] * dt;
      meanNeed += r.need[i] * dt;
    }
    meanNeed /= Math.max(1, n);
    function cnt(o) { var k = Object.keys(o), s = 0; k.forEach(function (x) { s += o[x]; }); return { n: k.length, def: s, rel: k.length ? 1 - s / k.length : 1 }; }
    var years = Object.keys(yr).map(Number).sort();
    // 부분 수문년(첫·마지막) 제외 옵션
    var yN = years.length, yDef = 0;
    years.forEach(function (y) { yDef += yr[y]; });
    var minS = Infinity, minI = 0;
    for (var j = 0; j < n; j++) if (r.storage[j] < minS) { minS = r.storage[j]; minI = j; }
    return {
      steps: n, stepDef: stepDef, stepRel: 1 - stepDef / n,
      ten: cnt(ten), mon: cnt(mon), year: { n: yN, def: yDef, rel: yN ? 1 - yDef / yN : 1 },
      qDef: defVol, qNeed: needVol, qRel: needVol ? 1 - defVol / needVol : 1,
      events: events, maxDefDur: maxRun, resilience: stepDef ? events / stepDef : 1,
      vulnerability: maxDefStep, vulnDimless: meanNeed ? maxDefStep / meanNeed : 0,
      minS: minS, minDate: m.dates[minI],
      yearDefVol: yrDefVol
    };
  }

  /** 기준 충족 여부 */
  function meets(mt, crit) {
    var v = crit.unit === 'year' ? mt.year.rel : crit.unit === 'month' ? mt.mon.rel : crit.unit === 'ten' ? mt.ten.rel : crit.unit === 'qty' ? mt.qRel : mt.stepRel;
    if (crit.maxDefYears != null && mt.year.def > crit.maxDefYears) return false;
    return v >= crit.target - 1e-9;
  }

  /** 기준을 만족하는 최대 추가 공급량(㎥/s) – 이분 탐색 */
  function maxAdd(m, crit, lo, hi) {
    lo = lo == null ? -(maxDemand(m)) : lo; hi = hi == null ? Math.max(5, maxDemand(m) * 2) : hi;
    if (!meets(metrics(m, run(m, lo)), crit)) return null;
    while (meets(metrics(m, run(m, hi)), crit)) { lo = hi; hi *= 2; if (hi > 1e5) return hi; }
    for (var k = 0; k < 40 && hi - lo > 1e-4; k++) {
      var mid = (lo + hi) / 2;
      if (meets(metrics(m, run(m, mid)), crit)) lo = mid; else hi = mid;
    }
    return lo;
  }
  function maxDemand(m) { var x = 0; for (var i = 0; i < m.demand.length; i++) if (m.demand[i] > x) x = m.demand[i]; return x; }

  /* ---------- 모형 생성 ---------- */

  /** D05 반순 자료 → 모형 */
  function fromD05(d, opts) {
    opts = opts || {};
    var dates = d.series.map(function (r) { return r[0]; });
    var dt = dates.map(function (x, i) { return i + 1 < dates.length ? diffDays(x, dates[i + 1]) : 5; });
    var mon = d.months;
    var demand = d.series.map(function (r) {
      if (opts.planFromSeries !== false && r[3] != null) return r[3];
      return mon[+r[0].slice(5, 7) - 1].tot;
    });
    return {
      name: d.name, source: 'D05', dates: dates, dt: dt,
      inflow: d.series.map(function (r) { return r[2]; }),
      demand: demand, flood: d.series.map(function (r) { return r[1]; }),
      sMax: d.nwlV, sMaxFlood: d.fwlV, sMin: opts.sMin != null ? opts.sMin : d.lwlV, s0: d.initV,
      curve: d.curve
    };
  }

  /** MyWater 일자료 → 모형 (수요: 연간 용수공급용량 균등 또는 사용자값) */
  function fromMyWater(dam, hv, opts) {
    opts = opts || {};
    var b = dam.basic || {}, n = dam.n, dates = new Array(n), dt = new Array(n), inflow = new Array(n), flood = new Array(n);
    var first = -1;
    for (var i = 0; i < n; i++) {
      dates[i] = addDays(dam.start, i); dt[i] = 1;
      inflow[i] = dam.qin[i];
      if (first < 0 && dam.qin[i] != null && dam.s[i] != null) first = i;
      var md = dates[i].slice(5);
      flood[i] = md >= '06-21' && md <= '09-20' ? 1 : 0;
    }
    // 결측 유입량: 앞뒤 평균 대신 0 처리 전 단순 선형보간
    var last = null;
    for (i = 0; i < n; i++) {
      if (inflow[i] == null) { var j = i; while (j < n && inflow[j] == null) j++; var a = last == null ? (j < n ? inflow[j] : 0) : last, bb = j < n ? inflow[j] : a; for (var k = i; k < j; k++) inflow[k] = a + (bb - a) * (k - i + 1) / (j - i + 1); i = j - 1; }
      else last = inflow[i];
    }
    var annual = opts.annualMcm != null ? opts.annualMcm : (b.annualSupply || 0);
    var dCms = annual * 1e6 / (365 * SEC);
    var demand = dates.map(function () { return dCms; });
    var sMax = opts.sMax != null ? opts.sMax : hv.vOfH(b.nwl);
    var sMaxFlood = opts.sMaxFlood != null ? opts.sMaxFlood : (b.fwl && b.fwl < b.nwl ? hv.vOfH(b.fwl) : null);
    var anchor = b.effStorage != null && sMax != null ? sMax - b.effStorage : null;
    var sMin = opts.sMin != null ? opts.sMin : (anchor != null && anchor > 0.5 ? anchor : Math.max(0, hv.vOfH(b.lwl) || 0));
    // 시작점: 정상 운영(상시만수위 저수량의 60% 이상) 도달 후 첫 수문년(10.1) – 담수기간 제외
    var s0i = first < 0 ? 0 : first;
    if (opts.skipFilling !== false && sMax) {
      var reach = -1;
      for (i = s0i; i < n; i++) if (dam.s[i] != null && dam.s[i] >= 0.6 * sMax) { reach = i; break; }
      if (reach > s0i) {
        for (i = reach; i < n; i++) if (dates[i].slice(5) === '10-01' && dam.s[i] != null) { s0i = i; break; }
      }
    }
    // 유입량 결측 비율
    var miss = 0; for (i = s0i; i < n; i++) if (dam.qin[i] == null) miss++;
    var m = {
      name: dam.name, source: 'MyWater', dates: dates.slice(s0i), dt: dt.slice(s0i), inflow: inflow.slice(s0i),
      demand: demand.slice(s0i), flood: flood.slice(s0i), sMax: sMax, sMaxFlood: sMaxFlood, sMin: sMin,
      s0: dam.s[s0i], observed: dam.s.slice(s0i), dCms: dCms, missing: miss / Math.max(1, n - s0i),
      meanInflow: (function () { var s = 0, k = 0; for (var j = s0i; j < n; j++) if (dam.qin[j] != null) { s += dam.qin[j]; k++; } return k ? s / k : 0; })()
    };
    return m;
  }

  /** 관측 수위·저수량 쌍으로 H-V 곡선 생성 (0.1m 구간 중앙값, 단조 보정) */
  function hvFromObs(h, s, extra) {
    var bins = {};
    for (var i = 0; i < h.length; i++) {
      if (h[i] == null || s[i] == null) continue;
      var k = Math.round(h[i] * 10) / 10;
      (bins[k] = bins[k] || []).push(s[i]);
    }
    var pts = Object.keys(bins).map(function (k) { var a = bins[k].sort(function (x, y) { return x - y; }); return [+k, a[a.length >> 1]]; });
    (extra || []).forEach(function (p) { if (p && p[0] != null && p[1] != null) pts.push(p); });
    pts.sort(function (a, b) { return a[0] - b[0]; });
    for (var j = 1; j < pts.length; j++) if (pts[j][1] < pts[j - 1][1]) pts[j][1] = pts[j - 1][1];
    return { curve: pts, fns: curveFns(pts) };
  }

  var api = { run: run, metrics: metrics, meets: meets, maxAdd: maxAdd, fromD05: fromD05, fromMyWater: fromMyWater,
              hvFromObs: hvFromObs, curveFns: curveFns, addDays: addDays, diffDays: diffDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WB = api;
})(this);
