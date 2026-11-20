/* 도수관로 수리종단 엔진
 *  - 노선 종단(누적거리·지반고·구간)과 유량·관경으로 동수경사선(HGL)을 계산하고
 *    가압장(양정·위치)과 감압밸브(위치·감압량)를 자동 배치합니다.
 *  - 손실수두: Hazen-Williams (cost.js와 같은 식). 관저고 = 지반고 − 매설깊이, 터널은 양 갱구 관저고를 직선으로 잇습니다.
 *  - 가압장 배치: 상류에서부터 한 가압장이 올릴 수 있는 만큼(양정 상한, 토출 직후 최대수두 상한) 올리고,
 *    그 물로 버틸 수 있는 데까지 간 뒤(최소 잔류수두 아래로 떨어지기 직전) 다음 가압장을 둡니다.
 *    필요한 총양정은 '하류 모든 지점을 자연유하로 넘는 데 필요한 동수두'로 구하므로 쓸데없이 더 올리지 않습니다.
 *  - 감압밸브: 남는 수두(도달 동수두 − 정수장 HWL − 여유)를 없애야 하므로, 잔류수두가 감압 기준을 넘는 지점에서
 *    설정 수두까지 낮춥니다(남는 수두 한도 안에서).
 *  브라우저(window.Hydro) / Node(module.exports)
 */
(function (root) {
  'use strict';

  function slopePerKm(qCms, Dmm, C) { var D = Dmm / 1000; return 10.67 * Math.pow(qCms, 1.852) / (Math.pow(C, 1.852) * Math.pow(D, 4.87)) * 1000; }
  function power(qCms, H, eff, margin) { return 9.8 * qCms * H / (eff || 0.8) * (margin || 1.15); }

  /**
   * prof: { pts: [[s(m), lon, lat, ground, segIdx], ...], segments: [{kind, lengthM}] }
   * o: { q(㎥/s), C, D: {segIdx: mm} 또는 dByKind, lwl, hwl, cover(2), pMin(1), pMax(100), hMax(100), arrive(6),
   *      prvOn(70), prvSet(35), intakeAt(km), tunnelInv: {segIdx: [입구 관저고, 출구 관저고]}, scale: [구간별 보정 길이 km] }
   */
  function design(prof, o) {
    o = o || {};
    var C = o.C || 110, cover = o.cover == null ? 2 : o.cover, pMin = o.pMin == null ? 1 : o.pMin, pMax = o.pMax || 120, hMax = o.hMax || 100, portalCut = o.portalCut == null ? 0.15 : o.portalCut;
    var arrive = o.arrive == null ? 6 : o.arrive, prvOn = o.prvOn || 70, prvSet = o.prvSet || 35;
    var segs = prof.segments, n = prof.pts.length;
    // 구간 관경
    var segD = segs.map(function (s, k) {
      if (o.D && o.D[k] != null) return o.D[k];
      var m = /D(\d+)/.exec(s.kind); if (m) return +m[1];
      return null;
    });
    // 터널은 앞 구간 관경을 따름(없으면 뒤 구간)
    segD = segD.map(function (d, k) { if (d != null) return d; for (var j = k - 1; j >= 0; j--) if (segD[j] != null) return segD[j]; for (j = k + 1; j < segD.length; j++) if (segD[j] != null) return segD[j]; return 900; });
    // 누적거리 보정(구간 길이를 보고서 값에 맞출 때)
    var segLen = segs.map(function (s) { return s.lengthM / 1000; }), scale = o.scale || segLen, off = [0];
    for (var k = 0; k < segs.length; k++) off.push(off[k] + scale[k]);
    var segStart = [0]; for (k = 0; k < segs.length; k++) segStart.push(segStart[k] + segLen[k]);
    var x = new Array(n), g = new Array(n), z = new Array(n), sk = new Array(n), F = new Array(n), sl = new Array(n);
    for (var i = 0; i < n; i++) {
      var p = prof.pts[i]; sk[i] = p[4];
      var t = (p[0] / 1000 - segStart[sk[i]]) / (segLen[sk[i]] || 1);
      x[i] = off[sk[i]] + t * scale[sk[i]]; g[i] = p[3];
      sl[i] = slopePerKm(o.q, segD[sk[i]], C);
    }
    // 관저고: 일반 = 지반 − cover, 터널 = 양 갱구 직선
    for (i = 0; i < n; i++) z[i] = g[i] - cover;
    segs.forEach(function (s, k) {
      if (s.kind !== 'TUNNEL') return;
      var idx = []; for (var j = 0; j < n; j++) if (sk[j] === k) idx.push(j);
      if (!idx.length) return;
      var a = idx[0], b = idx[idx.length - 1], ta = o.tunnelInv && o.tunnelInv[k] ? o.tunnelInv[k] : [g[a] - cover, g[b] - cover];
      idx.forEach(function (j) { z[j] = ta[0] + (ta[1] - ta[0]) * (x[j] - x[a]) / ((x[b] - x[a]) || 1); });
      // 갱구와 같은 위치의 앞·뒤 관로 점은 갱구 관저고에 맞춤(갱구부 절토)
      // 갱구 앞·뒤 portalCut(km) 안의 관로는 갱구 관저고까지 절토(갱구 접근부)
      for (var jj = 0; jj < n; jj++) if (sk[jj] !== k) {
        if (Math.abs(x[jj] - x[a]) <= portalCut + 1e-9) z[jj] = Math.min(z[jj], ta[0]);
        else if (Math.abs(x[jj] - x[b]) <= portalCut + 1e-9) z[jj] = Math.min(z[jj], ta[1]);
      }
    });
    // 누적 마찰손실
    F[0] = 0; for (i = 1; i < n; i++) F[i] = F[i - 1] + sl[i] * (x[i] - x[i - 1]);
    var endReq = o.hwl + arrive;
    // need[i]: i에서 하류 전부를 자연유하로 넘는 데 필요한 동수두
    // ctrl[i]: 그 동수두를 결정하는 하류 지배점(가장 넘기 어려운 고점). 지배점 너머의 남는 수두는 감압밸브가 처리
    var need = new Array(n), ctrl = new Array(n), m = endReq + F[n - 1], mi = n - 1;
    for (i = n - 1; i >= 0; i--) { if (z[i] + pMin + F[i] > m) { m = z[i] + pMin + F[i]; mi = i; } need[i] = m - F[i]; ctrl[i] = mi; }
    // 가압장 배치
    var h0 = o.lwl, iStart = 0;
    if (o.intakeAt != null) { while (iStart < n - 1 && x[iStart] < o.intakeAt) iStart++; }
    var hAt = function (i0, H0, i) { return H0 - (F[i] - F[i0]); };
    function place(cap) {
      var pumps = [], hgl = new Array(n), cur = iStart, Hcur = h0 - (F[iStart] - F[0]), guard = 0, ok = false;
      for (var i = 0; i < iStart; i++) hgl[i] = h0 - F[i];
      while (cur < n && guard++ < 60) {
        var T = Math.max(Hcur, Math.min(need[cur], z[cur] + pMax, Hcur + cap)), bad = -1;
        // 도달 구간 안에서 최대수두(pMax)를 넘지 않도록 토출 수두를 낮춤
        for (var it = 0; it < 20; it++) {
          var allow = Infinity; bad = -1;
          for (var j = cur + 1; j < n; j++) {
            var hj = hAt(cur, T, j);
            if (hj < z[j] + pMin - 1e-6) { bad = j; break; }
            if (j <= ctrl[cur]) allow = Math.min(allow, z[j] + pMax + (F[j] - F[cur]));
          }
          if (T <= allow + 1e-6) break;
          T = Math.max(Hcur, allow);
        }
        if (T > Hcur + 1e-6) pumps.push({ i: cur, x: x[cur], ground: g[cur], inv: z[cur], hIn: Hcur, hOut: T, H: T - Hcur, kW: power(o.q, T - Hcur) });
        Hcur = T;
        for (i = cur; i < (bad < 0 ? n : bad); i++) hgl[i] = hAt(cur, Hcur, i);
        if (bad < 0) { ok = true; break; }
        var q = bad - 1; if (q <= cur) return { ok: false, pumps: pumps, hgl: hgl, failX: x[bad] };   // 더 나아갈 수 없음(최대수두 제약)
        Hcur = hAt(cur, Hcur, q); cur = q;
      }
      return { ok: ok, pumps: pumps, hgl: hgl };
    }
    var pl = place(hMax);
    // 양정 균등화: 같은 가압장 수로 가능한 가장 작은 상한을 찾아 다시 배치
    if (o.balance !== false && pl.pumps.length >= 2) {
      var N = pl.pumps.length, tot = pl.pumps.reduce(function (s2, p2) { return s2 + p2.H; }, 0), lo = tot / N, hi = hMax;
      for (var it2 = 0; it2 < 30; it2++) { var mid = (lo + hi) / 2, pm = place(mid); if (pm.ok && pm.pumps.length <= N) hi = mid; else lo = mid; }
      var pb = place(hi); if (pb.ok && pb.pumps.length <= N) pl = pb;
    }
    var pumps = pl.pumps, hgl = pl.hgl, prv = [];
    if (!pl.ok) for (i = 0; i < n; i++) if (hgl[i] == null) hgl[i] = NaN;
    // 감압밸브: 남는 수두를 하류에서 처리
    var excess = hgl[n - 1] - endReq, drop = 0, base = hgl.slice(), lastPump = pumps.length ? pumps[pumps.length - 1].i : 0;
    // 하류 여유: slack[i] = min_{j≥i} (base[j] − z[j] − pMin)
    var slack = new Array(n), mm = Infinity;
    for (i = n - 1; i >= 0; i--) { mm = Math.min(mm, base[i] - z[i] - pMin); slack[i] = mm; }
    for (i = 0; i < n; i++) {
      var hNow = base[i] - drop;
      if (i > lastPump && excess - drop > 0.5 && hNow - z[i] > prvOn) {
        var d = Math.min(hNow - z[i] - prvSet, excess - drop, slack[i] - drop);   // 남는 수두·하류 최소수두 한도
        if (d > 0.5) { prv.push({ i: i, x: x[i], ground: g[i], hIn: hNow, hOut: hNow - d, dH: d }); drop += d; hNow -= d; }
      }
      hgl[i] = hNow;
    }
    var res = new Array(n), minR = Infinity, minRx = 0, maxR = -Infinity, maxRx = 0;
    for (i = 0; i < n; i++) { res[i] = hgl[i] - z[i]; }
    for (i = iStart; i < n; i++) { res[i] = hgl[i] - z[i]; if (res[i] < minR) { minR = res[i]; minRx = x[i]; } if (res[i] > maxR) { maxR = res[i]; maxRx = x[i]; } }
    var hTot = pumps.reduce(function (s, p) { return s + p.H; }, 0), kW = pumps.reduce(function (s, p) { return s + p.kW; }, 0);
    return {
      x: x, ground: g, inv: z, hgl: hgl, res: res, seg: sk, segD: segD, slope: segD.map(function (d) { return slopePerKm(o.q, d, C); }),
      ok: pl.ok, failX: pl.failX, pumps: pumps, prv: prv, hTot: hTot, kW: kW, prvTot: prv.reduce(function (s, p) { return s + p.dH; }, 0),
      arrive: hgl[n - 1], minRes: minR, minResX: minRx, maxRes: maxR, maxResX: maxRx, lengthKm: x[n - 1], need0: need[iStart]
    };
  }

  /** 정해진 가압장(위치 km·양정)과 감압밸브(위치 km·감압량)로 HGL만 계산 – 기존 설계 재현·비교용 */
  function evaluate(prof, o, fixed) {
    var d = design(prof, Object.assign({}, o, { pMin: -1e9, hMax: 0 }));   // 관저고·마찰만 얻음
    var n = d.x.length, F = [0];
    for (var i = 1; i < n; i++) F.push(F[i - 1] + d.slope[d.seg[i]] * (d.x[i] - d.x[i - 1]));
    var ev = (fixed.pumps || []).map(function (p) { return { x: p.x, dh: p.H }; }).concat((fixed.prv || []).map(function (p) { return { x: p.x, dh: -p.dH }; }))
      .sort(function (a, b) { return a.x - b.x; });
    var hgl = new Array(n), add = 0, k = 0;
    for (i = 0; i < n; i++) { while (k < ev.length && ev[k].x <= d.x[i]) { add += ev[k].dh; k++; } hgl[i] = o.lwl - F[i] + add; }
    var res = hgl.map(function (h, j) { return h - d.inv[j]; }), minR = Infinity, minRx = 0, maxR = -Infinity, maxRx = 0;
    res.forEach(function (r, j) { if (d.x[j] < (o.intakeAt || 0)) return; if (r < minR) { minR = r; minRx = d.x[j]; } if (r > maxR) { maxR = r; maxRx = d.x[j]; } });
    return { x: d.x, ground: d.ground, inv: d.inv, hgl: hgl, res: res, arrive: hgl[n - 1], minRes: minR, minResX: minRx, maxRes: maxR, maxResX: maxRx };
  }

  var api = { design: design, evaluate: evaluate, slopePerKm: slopePerKm, power: power };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Hydro = api;
})(this);
