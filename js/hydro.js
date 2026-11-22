/* 도수관로 수리종단 엔진
 *  - 노선 종단(누적거리·지반고·구간)과 유량·관경으로 동수경사선(HGL)을 계산하고
 *    가압장(양정·위치)과 감압밸브(위치·감압량)를 자동 배치합니다.
 *  - 손실수두: Hazen-Williams (cost.js와 같은 식). 관저고 = 지반고 − 매설깊이, 터널은 양 갱구 관저고를 직선으로 잇습니다.
 *  - 수압 범위: 전 구간에서 최소 잔류수두(pMin) 이상, 관로 최대 수두(pMax) 이하.
 *  - 가압장: 자연유하로 갈 수 있는 데까지 간 뒤 수두가 바닥나기 직전 지점에 두고, 다음 고점을 넘을 만큼만 올립니다.
 *    올린 물이 하류 저지대에서 최대 수두를 넘게 되면 덜 올리고 다음 가압장으로 나눕니다(다단 가압).
 *  - 감압밸브: 내려가다 최대 수두를 넘게 되는 곳 직전에 두어 낮춥니다. 정수장에 남는 수두도 마지막 가압장 뒤에서 처리합니다.
 *    터널 안은 최대 수두 검토와 시설 배치에서 뺍니다.
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
    var arrive = o.arrive == null ? 6 : o.arrive, pLim = pMax, pOut = o.prvOut == null ? 10 : o.prvOut, pSuc = Math.max(pMin, o.pSuc == null ? 5 : o.pSuc);
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
    // 수압 범위: 아래 Lw(최소 잔류수두, 끝점은 정수장 도달 수두) ~ 위 z + pLim(관로 최대 수두)
    var Lw = new Array(n), isT = new Array(n);
    for (i = 0; i < n; i++) { Lw[i] = z[i] + pMin; isT[i] = segs[sk[i]].kind === 'TUNNEL'; }
    Lw[n - 1] = Math.max(Lw[n - 1], endReq);
    // 취수 지점: 지정이 없으면 노선이 취수 수위 아래로 내려오는 첫 지점(autoIntake km 안)까지는 취수탑·취수터널로 댐체를 지난다고 봄
    var h0 = o.lwl, iStart = 0;
    if (o.intakeAt) { while (iStart < n - 1 && x[iStart] < o.intakeAt) iStart++; }
    else if (o.autoIntake && z[0] + pMin > h0) {
      for (i = 1; i < n && x[i] <= o.autoIntake; i++) if (z[i] + pMin <= h0 - (F[i] - F[0])) { iStart = i; break; }
    }
    /* 배치: 상류에서 내려가며
     *  - 자연유하로 갈 수 있는 데까지 가고(가압은 되도록 늦게 = 수두가 바닥나기 직전), 그 자리에서 다음 고점을 넘을 만큼만 올림.
     *    올린 물이 하류 저지대에서 최대 수두를 넘게 되면 그만큼 덜 올리고 다음 가압장으로 나눔(다단 가압).
     *  - 내려가다 수두가 최대 수두를 넘으면 그 직전에 감압밸브를 두어 낮춤. */
    function place(cap) {
      var pumps = [], prv = [], ex = {}, exL = {}, cur = iStart, H = h0 - (F[iStart] - F[0]), guard = 0, ok = false, failX = null, j, k;
      while (guard++ < 600) {
        var bad = -1, over = -1, hOver = 0;
        for (j = cur; j < n; j++) {
          var hj = H - (F[j] - F[cur]);
          if (!exL[j] && hj < Lw[j] - 1e-6) { bad = j; hOver = hj; break; }
          if (!isT[j] && !ex[j] && hj > z[j] + pLim + 1e-6) { over = j; hOver = hj; break; }
        }
        if (bad < 0 && over < 0) { ok = true; break; }
        if (over >= 0) {
          var p = Math.max(cur, over - 1); if (isT[p]) p = over;   // 터널 안에는 두지 않음 → 출구 쪽 첫 지점
          var Hp = H - (F[p] - F[cur]), req = Hp - (z[p] + pLim), slack = Infinity, kEnd = n;
          for (k = p + 1; k < n; k++) { var hk = Hp - (F[k] - F[p]); if (hk < Lw[k] - 1e-6) { kEnd = k; break; } if (!isT[k]) req = Math.max(req, hk - (z[k] + pLim)); slack = Math.min(slack, hk - Lw[k]); }
          var local = hOver - (z[over] + pLim), dmax = Math.min(req, Hp - z[p] - pOut);
          if (kEnd === n && slack >= 0.5) dmax = Math.min(dmax, slack);   // 하류에 가압 없이 갈 수 있으면 그 수두는 남김
          var dd = Math.min(Math.max(dmax, local), Hp - Lw[p]), last = prv[prv.length - 1];
          if (dd < local - 1e-6) ex[over] = true;       // 그 자리에서 더 낮출 수 없음(급경사) → 이 점은 넘어감
          if (dd < 0.05) { continue; }
          if (last && last.i === p) { last.dH += dd; last.hOut -= dd; }
          else prv.push({ i: p, x: x[p], ground: g[p], hIn: Hp, hOut: Hp - dd, dH: dd });
          H = Hp - dd; cur = p; continue;
        }
        // 가압: 수두가 바닥나기 직전 지점(흡입 수두 pSuc 이상, 터널 밖)
        var q = -1;
        for (j = bad - 1; j >= cur; j--) if (!isT[j] && H - (F[j] - F[cur]) - z[j] >= pSuc) { q = j; break; }
        if (q < 0) for (j = bad - 1; j >= cur; j--) if (!isT[j]) { q = j; break; }
        if (q < 0) q = Math.max(cur, bad - 1);
        if (bad === cur) q = cur;
        // 그 자리에서 올릴 수 없으면(바로 아래 저지대가 최대 수두에 걸림) 한 칸씩 하류로 옮겨 다시 시도
        var Hq = 0, T = 0, lp = pumps[pumps.length - 1], done = false;
        for (var qq = q; qq <= Math.max(q, bad - 1) && !done; qq++) {
          if (qq > q && isT[qq]) continue;
          Hq = H - (F[qq] - F[cur]); T = Math.min(need[qq], Hq + cap, Math.max(z[qq] + pLim, Hq));
          for (var it = 0; it < 60; it++) {
            var viol = -1;
            for (j = qq + 1; j < n; j++) { var lj = T - (F[j] - F[qq]); if (lj < Lw[j] - 1e-6) break; if (!isT[j] && !ex[j] && lj > z[j] + pLim + 1e-6) { viol = j; break; } }
            if (viol < 0) break;
            var Tv = z[viol] + pLim + F[viol] - F[qq], Tc = -Infinity;
            for (k = qq; k < viol; k++) Tc = Math.max(Tc, Lw[k] + F[k] - F[qq]);
            if (Tv >= Tc) T = Tv;                       // 덜 올려도 그 저지대까지 감 → 나머지는 다음 가압장
            else { T = Math.min(T, Tc); break; }        // 사이 고점은 넘어야 함 → 넘을 만큼만 올리고 그 뒤는 감압
          }
          if (T >= Hq + 0.5 && !(lp && lp.i === qq)) { q = qq; done = true; }
        }
        if (!done && bad < n - 1 && Lw[bad] - hOver < 0.5) { exL[bad] = true; continue; }   // 0.5m 안쪽 부족은 가압장을 두지 않고 넘어감
        if (!done) { failX = x[bad]; break; }
        pumps.push({ i: q, x: x[q], ground: g[q], inv: z[q], hIn: Hq, hOut: T, H: T - Hq, kW: power(o.q, T - Hq), intake: q === iStart && !pumps.length });
        H = T; cur = q;
      }
      return { ok: ok, pumps: pumps, prv: prv, failX: failX };
    }
    // 시설 목록으로 동수경사선 계산 (같은 지점이면 감압 → 가압 순)
    function lineOf(pl) {
      var h = new Array(n), ev = pl.pumps.map(function (p) { return [p.i, p.H]; }).concat(pl.prv.map(function (v) { return [v.i, -v.dH]; })).sort(function (a, b) { return a[0] - b[0]; }), add = 0, e = 0;
      for (var i2 = 0; i2 < n; i2++) { while (e < ev.length && ev[e][0] <= i2) { add += ev[e][1]; e++; } h[i2] = h0 - F[i2] + add; }
      if (!pl.ok) { var stop = iStart; pl.pumps.concat(pl.prv).forEach(function (d2) { stop = Math.max(stop, d2.i); }); for (i2 = stop; i2 < n; i2++) if (h[i2] < Lw[i2] - 1e-6) { for (var i3 = i2; i3 < n; i3++) h[i3] = NaN; break; } }
      return h;
    }
    var tot = function (pl2) { return pl2.pumps.reduce(function (s2, p2) { return s2 + p2.H; }, 0); };
    var pl = place(hMax);
    // 양정 균등화: 가압장 수·총양정·감압밸브 수가 늘지 않는 가장 작은 상한으로 다시 배치
    if (o.balance !== false && pl.ok && pl.pumps.length >= 2) {
      var N = pl.pumps.length, t0 = tot(pl), nv = pl.prv.length, lo = t0 / N, hi = hMax, good = function (pm) { return pm.ok && pm.pumps.length <= N && tot(pm) <= t0 + 0.5 && pm.prv.length <= nv; };
      for (var it2 = 0; it2 < 30; it2++) { var mid = (lo + hi) / 2; if (good(place(mid))) hi = mid; else lo = mid; }
      var pb = place(hi); if (good(pb)) pl = pb;
    }
    var pumps = pl.pumps, prv = pl.prv, hgl = lineOf(pl);
    // 정수장에 남는 수두: 마지막 가압장 뒤에서 처리(있는 감압밸브에 더하고, 5m 넘게 남으면 수두가 가장 큰 곳에 하나 추가)
    if (pl.ok) {
      var lastPump = pumps.length ? pumps[pumps.length - 1].i : iStart, sl2 = new Array(n);
      var suffix = function () { var mm = Infinity; for (var a2 = n - 1; a2 >= 0; a2--) { mm = Math.min(mm, hgl[a2] - Lw[a2]); sl2[a2] = mm; } };
      suffix();
      prv.forEach(function (v) {
        if (v.i <= lastPump) return;
        var room = Math.min(hgl[n - 1] - endReq, sl2[v.i], v.hOut - z[v.i] - pOut);
        if (room > 0.5) { v.dH += room; v.hOut -= room; hgl = lineOf(pl); suffix(); }
      });
      var E = hgl[n - 1] - endReq;
      if (E > 5) {
        var bi = -1, bc = 0, br = 0;
        for (i = Math.max(lastPump, iStart) + 1; i < n - 1; i++) {
          if (isT[i] || prv.some(function (v) { return v.i === i; })) continue;
          var cd = Math.min(E, sl2[i], hgl[i] - z[i] - pOut), rr = hgl[i] - z[i];
          if (cd >= 3 && (cd > bc + 0.5 || (cd > bc - 0.5 && rr > br))) { bi = i; bc = Math.max(bc, cd); br = rr; }
        }
        if (bi >= 0) { var cdd = Math.min(E, sl2[bi], hgl[bi] - z[bi] - pOut); prv.push({ i: bi, x: x[bi], ground: g[bi], hIn: hgl[bi], hOut: hgl[bi] - cdd, dH: cdd }); prv.sort(function (a3, b3) { return a3.i - b3.i; }); hgl = lineOf(pl); }
      }
    }
    // 수원 수위가 만수위(srcMax)로 오르면 첫 가압장 앞 구간은 그만큼 수두가 커짐 → 그 구간 감압밸브는 2차측 수두를 일정하게 잡는 것으로 보고
    // 만수위 때 감압량을 함께 냄. 감압밸브가 없는데 만수위 때 최대 수두를 넘으면 그 직전에 하나 둠(저수위 때는 열림).
    var firstPump = pumps.length ? pumps[0].i : n, dS = o.srcMax != null && o.srcMax > h0 ? o.srcMax - h0 : 0;
    prv.forEach(function (v) { v.src = v.i < firstPump; });
    if (pl.ok && dS > 0) {
      var fv = prv.filter(function (v) { return v.src; })[0], eI = Math.min(fv ? fv.i : n - 1, firstPump, n - 1);
      for (i = iStart; i <= eI; i++) if (!isT[i] && hgl[i] + dS - z[i] > pLim + 1e-6 && !(fv && fv.i === i)) {
        var pi = Math.max(iStart, i - 1); if (isT[pi]) pi = i;
        if (fv && fv.i === pi) break;
        // 이미 있는 첫 감압밸브를 이 자리로 당길 수 있으면(사이 구간 수두가 모자라지 않으면) 하나로 합침
        var mv = !!fv; if (fv) for (var k4 = pi; k4 <= fv.i; k4++) if (hgl[k4] - fv.dH < Lw[k4] - 1e-6 || hgl[pi] - fv.dH - z[pi] < pOut) { mv = false; break; }
        if (mv) { fv.i = pi; fv.x = x[pi]; fv.ground = g[pi]; fv.hIn = hgl[pi]; fv.hOut = hgl[pi] - fv.dH; hgl = lineOf(pl); }
        else { prv.push({ i: pi, x: x[pi], ground: g[pi], hIn: hgl[pi], hOut: hgl[pi], dH: 0, src: true }); prv.sort(function (a4, b4) { return a4.i - b4.i; }); }
        break;
      }
      fv = prv.filter(function (v) { return v.src; })[0];
      if (fv) fv.dHmax = fv.dH + dS;
    }
    var res = new Array(n), minR = Infinity, minRx = 0, maxR = -Infinity, maxRx = 0;
    for (i = 0; i < n; i++) { res[i] = hgl[i] - z[i]; }
    for (i = iStart; i < n; i++) { res[i] = hgl[i] - z[i]; if (res[i] < minR) { minR = res[i]; minRx = x[i]; } if (res[i] > maxR) { maxR = res[i]; maxRx = x[i]; } }
    var hTot = pumps.reduce(function (s, p) { return s + p.H; }, 0), kW = pumps.reduce(function (s, p) { return s + p.kW; }, 0);
    return {
      x: x, ground: g, inv: z, hgl: hgl, res: res, seg: sk, segD: segD, slope: segD.map(function (d) { return slopePerKm(o.q, d, C); }),
      ok: pl.ok, failX: pl.failX, intakeX: x[iStart], srcRise: dS, pumps: pumps, prv: prv, hTot: hTot, kW: kW, prvTot: prv.reduce(function (s, p) { return s + p.dH; }, 0),
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
