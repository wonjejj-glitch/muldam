/* 댐 가뭄단계·용수공급 모의 엔진
 * 「용수댐의 대응 단계별 용수공급 조정기준」 일별 기준저수량 판정 방식을 따른다.
 *  - 모의저수량 S'(t) = S(t) − Σ(공급량 × 단계별 공급비율)
 *  - 기준 이하 진입 시 해당 단계, 정상환원 기준 초과 시 정상 복귀 (단계 하향 없음)
 *  - 가동기준(비상공급)은 가동기준 도달 시 개시, 주의 기준 회복 시 종료(심각 유지)
 * 브라우저(window.DamEngine)와 Node(module.exports) 양쪽에서 사용.
 */
(function (root) {
  'use strict';

  var STAGES = ['정상', '관심', '주의', '심각', '가동기준'];
  var STAGE_LABEL = ['정상', '관심', '주의', '심각', '심각[비상공급]'];
  var STAGE_CODE = { '정상': 0, '관심': 1, '주의': 2, '심각': 3, '가동기준': 4, '경계': 3 };

  function stageCode(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    var s = String(v).trim();
    if (s in STAGE_CODE) return STAGE_CODE[s];
    if (s.indexOf('비상') >= 0 || s.indexOf('가동') >= 0) return 4;
    if (s.indexOf('심각') >= 0) return 3;
    if (s.indexOf('주의') >= 0) return 2;
    if (s.indexOf('관심') >= 0) return 1;
    return 0;
  }

  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  /** 기준선 배열(월일 키)을 맵으로 */
  function baselineMap(baseline) {
    var m = {};
    baseline.forEach(function (b) { m[b.md] = b; });
    if (!m['02-29'] && m['02-28']) m['02-29'] = m['02-28'];
    return m;
  }

  /** 수위-저수량 관계(H-V) 곡선 : 기준선·관측자료의 (저수량, 수위) 쌍으로 구성 */
  function buildHV(dataset) {
    var pts = [];
    dataset.baseline.forEach(function (b) {
      [['gs', 'gh'], ['js', 'jh'], ['ss', 'sh'], ['es', 'eh'], ['ns', 'nh']].forEach(function (k) {
        if (b[k[0]] != null && b[k[1]] != null) pts.push([b[k[0]], b[k[1]]]);
      });
    });
    dataset.daily.forEach(function (d) { if (d.h != null && d.s != null) pts.push([d.s, d.h]); });
    pts.sort(function (a, b) { return a[0] - b[0]; });
    // 저수량 구간(0.5백만㎥)별 평균으로 단조 곡선화
    var bins = [], cur = null;
    pts.forEach(function (p) {
      var k = Math.round(p[0] * 2) / 2;
      if (!cur || cur.k !== k) { cur = { k: k, s: 0, h: 0, n: 0 }; bins.push(cur); }
      cur.s += p[0]; cur.h += p[1]; cur.n++;
    });
    var curve = bins.map(function (b) { return [b.s / b.n, b.h / b.n]; });
    for (var i = 1; i < curve.length; i++) if (curve[i][1] < curve[i - 1][1]) curve[i][1] = curve[i - 1][1];
    function interp(x, xi, yi) {
      var n = curve.length;
      if (n === 0) return null;
      if (n === 1) return curve[0][yi];
      var a, b;
      if (x <= curve[0][xi]) { a = curve[0]; b = curve[Math.min(5, n - 1)]; }
      else if (x >= curve[n - 1][xi]) { a = curve[Math.max(0, n - 6)]; b = curve[n - 1]; }
      else {
        var lo = 0, hi = n - 1;
        while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (curve[mid][xi] <= x) lo = mid; else hi = mid; }
        a = curve[lo]; b = curve[hi];
      }
      if (b[xi] === a[xi]) return a[yi];
      return a[yi] + (x - a[xi]) * (b[yi] - a[yi]) / (b[xi] - a[xi]);
    }
    return {
      curve: curve,
      levelOf: function (s) { return interp(s, 0, 1); },
      storageOf: function (h) { return interp(h, 1, 0); }
    };
  }

  /** 원천 자료 → 내부 데이터셋 */
  function prepare(raw) {
    var bmap = baselineMap(raw.baseline);
    var daily = raw.daily.map(function (r) {
      var date = r.date || r[0];
      var md = date.slice(5, 10);
      var b = bmap[md] || {};
      return {
        date: date, year: +date.slice(0, 4), md: md,
        h: r.h != null ? r.h : r[1], s: r.s != null ? r.s : r[2],
        actual: stageCode(r.actual != null ? r.actual : r[3]),
        hasActual: (r.actual != null ? r.actual : r[3]) != null,
        ref: r[4] != null ? stageCode(r[4]) : null,
        b: b
      };
    });
    var ds = {
      name: raw.name || '댐', spec: raw.spec || {}, baseline: raw.baseline,
      daily: daily, lag: raw.lag || {},
      hasActual: daily.some(function (d) { return d.hasActual; })
    };
    ds.hv = buildHV(ds);
    return ds;
  }

  function rawLevel(sv, b) {
    if (b.es != null && sv <= b.es) return 4;
    if (sv <= b.ss) return 3;
    if (sv <= b.js) return 2;
    if (sv <= b.gs) return 1;
    return 0;
  }

  /** 가뭄단계 상태 판정 (히스테리시스) */
  function judge(svArr, daily, opt) {
    var st = new Array(svArr.length), state = 0, prevYear = null;
    for (var i = 0; i < svArr.length; i++) {
      var d = daily[i], b = d.b, sv = svArr[i];
      if (opt.resetStateYearly && d.year !== prevYear) state = 0;
      prevYear = d.year;
      var raw = rawLevel(sv, b);
      if (state === 0) state = raw;
      else if (sv > b.ns) state = 0;
      else if (state === 4) { if (sv >= b.js) state = 3; }
      else if (raw > state) state = raw;
      st[i] = state;
    }
    return st;
  }

  /** 에피소드(연속 가뭄구간) 목록 */
  function episodes(st) {
    var eps = [], s = -1;
    for (var i = 0; i <= st.length; i++) {
      var on = i < st.length && st[i] > 0;
      if (on && s < 0) s = i;
      if (!on && s >= 0) { eps.push([s, i - 1]); s = -1; }
    }
    return eps;
  }

  /** 단기 변동 제외 : minDays 이하 구간 제거 */
  function dropShort(st, minDays) {
    if (!minDays) return st;
    var out = st.slice();
    episodes(st).forEach(function (e) {
      if (e[1] - e[0] + 1 <= minDays) for (var i = e[0]; i <= e[1]; i++) out[i] = 0;
    });
    return out;
  }

  /** 실적 발령·해제 시차 반영 : 연도별 첫 가뭄구간에 단계 진입 지연·해제 지연 적용 */
  function applyLag(st, daily, lagTable) {
    if (!lagTable) return st;
    var out = st.slice(), seen = {};
    episodes(st).forEach(function (e) {
      var y = daily[e[0]].year;
      if (seen[y]) return; seen[y] = true;
      var L = lagTable[y] || lagTable[String(y)];
      if (!L) return;
      var end = e[1];
      // 해제 지연
      var rel = L['해제'] || 0, last = st[end];
      for (var k = 1; k <= rel && end + k < out.length; k++) {
        if (out[end + k] !== 0) break;
        out[end + k] = last;
      }
      // 단계 진입 지연 (관심·주의·심각)
      [1, 2, 3].forEach(function (code) {
        var lag = L[STAGES[code]] || 0;
        if (!lag) return;
        var first = -1;
        for (var i = e[0]; i <= end; i++) if (st[i] === code) { first = i; break; }
        if (first < 0) return;
        var prev = first === e[0] ? 0 : st[first - 1];
        for (var j = first; j < first + lag && j <= end; j++) out[j] = prev;
      });
    });
    return out;
  }

  /**
   * 공급 모의
   * @param ds  prepare() 결과
   * @param o   { q: 추가공급량(㎥/일), factors: [정상,관심,주의,심각,가동] 공급비율,
   *              carry: 연도 간 공급영향 이월 여부, spillReset: 이월 시 리셋 저수량(백만㎥),
   *              minDays: 단기변동 제외 일수, lag: 시차반영 여부, startDate, endDate }
   */
  function simulate(ds, o) {
    o = o || {};
    var q = (o.q || 0) / 1e6;                     // 백만㎥/일
    var f = o.factors || [1, 1, 1, 1, 1];
    var n = ds.daily.length, sv = new Array(n), cum = new Array(n), supplied = new Array(n);
    var c = 0, prevYear = null, state = 0;
    for (var i = 0; i < n; i++) {
      var d = ds.daily[i];
      if (d.year !== prevYear && !o.carry) { c = 0; state = 0; }
      if (o.carry && o.spillReset && d.s >= o.spillReset) { c = 0; }
      prevYear = d.year;
      var give = q * (f[state] != null ? f[state] : 1);
      c += give;
      sv[i] = d.s - c;
      cum[i] = c; supplied[i] = give;
      // 다음날 공급비율 결정을 위한 상태 추적(판정과 동일 규칙)
      var b = d.b, raw = rawLevel(sv[i], b);
      if (state === 0) state = raw;
      else if (sv[i] > b.ns) state = 0;
      else if (state === 4) { if (sv[i] >= b.js) state = 3; }
      else if (raw > state) state = raw;
    }
    var stRaw = judge(sv, ds.daily, { resetStateYearly: !o.carry });
    var st = dropShort(stRaw, o.minDays == null ? 1 : o.minDays);
    if (o.lag) st = applyLag(st, ds.daily, ds.lag);
    return { sv: sv, cum: cum, supplied: supplied, stRaw: stRaw, st: st };
  }

  /** 실적(현재기준) 단계 배열 – 실적이 없으면 실측저수량 기준 판정 */
  function currentStages(ds, o) {
    if (ds.hasActual && !(o && o.forceSim)) return ds.daily.map(function (d) { return d.actual; });
    var sv = ds.daily.map(function (d) { return d.s; });
    return dropShort(judge(sv, ds.daily, { resetStateYearly: true }), 1);
  }

  /** 연도별·연평균 집계 */
  function summarize(ds, st, sv) {
    var years = {}, order = [];
    ds.daily.forEach(function (d, i) {
      var y = years[d.year];
      if (!y) { y = years[d.year] = { year: d.year, days: 0, c: [0, 0, 0, 0, 0], minS: Infinity, minDate: null }; order.push(d.year); }
      y.days++; y.c[st[i]]++;
      var s = sv ? sv[i] : d.s;
      if (s < y.minS) { y.minS = s; y.minDate = d.date; }
    });
    var avg = [0, 0, 0, 0, 0], nYears = 0;
    order.forEach(function (yk) {
      var y = years[yk], full = isLeap(yk) ? 366 : 365;
      var scale = y.days >= full ? 1 : 365 / y.days;
      y.partial = y.days < full;
      for (var k = 0; k < 5; k++) avg[k] += y.c[k] * scale;
      nYears++;
    });
    avg = avg.map(function (v) { return v / Math.max(1, nYears); });
    var eps = episodes(st).map(function (e) {
      var maxStage = 0; for (var i = e[0]; i <= e[1]; i++) maxStage = Math.max(maxStage, st[i]);
      return { start: ds.daily[e[0]].date, end: ds.daily[e[1]].date, days: e[1] - e[0] + 1, maxStage: maxStage };
    });
    var drought = avg[1] + avg[2] + avg[3] + avg[4];
    var warn = avg[2] + avg[3] + avg[4];
    return {
      years: order.map(function (k) { return years[k]; }),
      avg: avg, nYears: nYears,
      drought: drought, warn: warn, emergency: avg[4],
      normal: 365 - drought,
      episodes: eps
    };
  }

  /** 이수안전도 지표 */
  function safety(ds, st, sv, spec) {
    var n = st.length, normal = 0, warnDays = 0, maxRun = 0, run = 0;
    var minMarginWarn = Infinity, minS = Infinity, minIdx = 0, belowLWL = 0, deficitMax = 0;
    var lwlS = spec && spec.lwlS != null ? spec.lwlS : null;
    for (var i = 0; i < n; i++) {
      if (st[i] === 0) normal++;
      if (st[i] >= 2) { warnDays++; run++; if (run > maxRun) maxRun = run; } else run = 0;
      var s = sv ? sv[i] : ds.daily[i].s, b = ds.daily[i].b;
      if (s < minS) { minS = s; minIdx = i; }
      var m = s - b.js; if (m < minMarginWarn) minMarginWarn = m;
      if (b.js - s > deficitMax) deficitMax = b.js - s;
      if (lwlS != null && s < lwlS) belowLWL++;
    }
    var eps = episodes(st.map(function (v) { return v >= 2 ? 1 : 0; }));
    return {
      reliability: normal / n,                                  // 시간신뢰도(정상)
      warnRatio: warnDays / n,                                  // 주의 이상(감량) 비율
      resilience: eps.length ? eps.length / Math.max(1, warnDays) : 1, // 회복도(Hashimoto)
      meanWarnDur: eps.length ? warnDays / eps.length : 0,
      maxWarnRun: maxRun,                                       // 최장 연속 주의이상 일수
      vulnerability: deficitMax,                                // 취약도: 주의기준 대비 최대 부족량
      minS: minS, minDate: ds.daily[minIdx].date, minH: ds.hv.levelOf(minS),
      belowLWL: belowLWL
    };
  }

  /** 공급 가능 판정 */
  function verdict(cur, sup, sfSup, crit) {
    var dWarn = sup.warn - cur.warn, dEm = sup.emergency - cur.emergency;
    var reasons = [], level = 0; // 0 가능, 1 조건부, 2 곤란
    function bump(l, msg) { if (l > level) level = l; reasons.push({ level: l, msg: msg }); }
    if (sfSup.belowLWL > 0) bump(2, '모의 저수량이 저수위(사수위) 이하로 하강 (' + sfSup.belowLWL + '일)');
    if (dEm > crit.maxEmergency + 1e-9) bump(2, '비상공급(가동기준) 일수 증가 연 ' + dEm.toFixed(1) + '일 (허용 ' + crit.maxEmergency + '일)');
    if (dWarn > crit.warnBad) bump(2, '주의 이상(감량) 연평균 ' + dWarn.toFixed(0) + '일 증가 (곤란 기준 ' + crit.warnBad + '일 초과)');
    else if (dWarn > crit.warnOk) bump(1, '주의 이상(감량) 연평균 ' + dWarn.toFixed(0) + '일 증가 (가능 기준 ' + crit.warnOk + '일 초과)');
    if (sup.normal / 365 < crit.minReliability) bump(1, '정상 공급가능일수 비율 ' + (sup.normal / 3.65).toFixed(1) + '% (기준 ' + (crit.minReliability * 100).toFixed(0) + '% 미만)');
    if (!reasons.length) reasons.push({ level: 0, msg: '모든 판정 기준 충족' });
    return { level: level, label: ['공급 가능', '조건부 가능', '공급 곤란'][level], dWarn: dWarn, dEm: dEm, reasons: reasons };
  }

  /** 판정 기준을 만족하는 최대 공급량 탐색 (이분법) */
  function maxFeasibleQ(ds, baseOpt, crit, targetLevel, cur) {
    var lo = 0, hi = baseOpt.qMax || 300000;
    function lvl(q) {
      var o = Object.assign({}, baseOpt, { q: q });
      var r = simulate(ds, o);
      var sup = summarize(ds, r.st, r.sv);
      var sf = safety(ds, r.st, r.sv, baseOpt.spec);
      return verdict(cur, sup, sf, crit).level;
    }
    if (lvl(0) > targetLevel) return 0;
    if (lvl(hi) <= targetLevel) return hi;
    for (var k = 0; k < 18; k++) {
      var mid = (lo + hi) / 2;
      if (lvl(mid) <= targetLevel) lo = mid; else hi = mid;
    }
    return Math.floor(lo / 100) * 100;
  }

  var api = {
    STAGES: STAGES, STAGE_LABEL: STAGE_LABEL, stageCode: stageCode,
    prepare: prepare, simulate: simulate, currentStages: currentStages,
    summarize: summarize, safety: safety, verdict: verdict, maxFeasibleQ: maxFeasibleQ,
    episodes: episodes, buildHV: buildHV
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DamEngine = api;
})(this);
