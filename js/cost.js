/* 도수관로 개략 수리·사업비 모듈 (단가: K-water 개략공사비 산정 프로그램 2026년 1월 단가, 산정 방식: 예비타당성조사) */
(function (root) {
  'use strict';

  var DEF = {
    year: 2026,
    pipeRoad: { 700: 2055786, 900: 2806094 },
    pipeUnpaved: { 700: 1426287, 900: 2061981 },
    roadShare: 0.8,
    tunnelPerM: 16339922, tunnelFixed: 4353764277,
    jackPerSite: 720000000, jackPerKm: 0.32,
    prvPerSite: 337425478,
    intake: { q: 70000, h: 92, cost: 13111287329 },
    booster: { q: 70000, h: 90, cost: 7127663768 },
    scaleQ: 0.6, scaleH: 0.3,
    landPerM: 4.7 * 85843 * 2.71 * 1.1,
    overhead: 0.104, contingency: 0.10,
    peak: 1 / 0.7, vMax: 1.5, sMax: 3.0, C: 110,
    eff: 0.8, margin: 1.15, powerPrice: 129,
    maxStageHead: 100, residual: 5,
    rate: 0.045, years: 30,
    detour: 1.3
  };
  var SIZES = [200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1350, 1500, 1650, 1800, 2000, 2200, 2400];

  function pipeUnit(D, p) {
    var b = Math.log(p.pipeRoad[900] / p.pipeRoad[700]) / Math.log(900 / 700);
    var bu = Math.log(p.pipeUnpaved[900] / p.pipeUnpaved[700]) / Math.log(900 / 700);
    var road = p.pipeRoad[900] * Math.pow(D / 900, b), unp = p.pipeUnpaved[900] * Math.pow(D / 900, bu);
    return p.roadShare * road + (1 - p.roadShare) * unp;
  }
  function headLossPerM(qCms, Dmm, C) { var D = Dmm / 1000; return 10.67 * Math.pow(qCms, 1.852) / (Math.pow(C, 1.852) * Math.pow(D, 4.87)); }
  function chooseD(qCms, vMax, C, sMax) {
    var need = Math.sqrt(4 * qCms / (Math.PI * vMax)) * 1000;
    for (var i = 0; i < SIZES.length; i++) {
      if (SIZES[i] < need - 1) continue;
      if (sMax && C && headLossPerM(qCms, SIZES[i], C) * 1000 > sMax + 1e-6) continue;
      return SIZES[i];
    }
    return SIZES[SIZES.length - 1];
  }
  function haversine(a, b) {
    var R = 6371, t = Math.PI / 180, dLa = (b[0] - a[0]) * t, dLo = (b[1] - a[1]) * t;
    var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  /**
   * @param q   평균 공급량(㎥/일)
   * @param r   노선 { lengthKm, tunnelKm, zStart(취수 최저수위 EL.m), zEnd(정수장 HWL), zHigh(경유 최고 관저고), lHighKm, jackSites, prvSites, dMm }
   */
  function estimate(q, r, prm) {
    var p = Object.assign({}, DEF, prm || {});
    var qd = q * p.peak / 86400, qa = q / 86400;
    var L = r.lengthKm * 1000, Lt = (r.tunnelKm || 0) * 1000;
    var D = r.dMm || chooseD(qd, p.vMax, p.C, p.sMax);
    var S = headLossPerM(qd, D, p.C);
    var zS = r.zStart, zE = r.zEnd, zH = r.zHigh != null ? Math.max(r.zHigh, zS, zE) : Math.max(zS, zE);
    var lH = (r.lHighKm != null ? r.lHighKm : (zH > Math.max(zS, zE) ? r.lengthKm / 2 : r.lengthKm)) * 1000;
    var hNeed = Math.max(zH - zS + S * lH + p.residual, zE - zS + S * L + p.residual, 0);
    var nSt = hNeed > 0 ? Math.ceil(hNeed / p.maxStageHead) : 0;
    var hEach = nSt ? hNeed / nSt : 0;
    var drop = zH - zE - S * (L - lH);
    var prv = r.prvSites != null ? r.prvSites : Math.max(0, Math.ceil((drop - 110) / 40));
    var jack = r.jackSites != null ? r.jackSites : Math.round(r.lengthKm * p.jackPerKm);
    var unit = pipeUnit(D, p);
    var c = {};
    c.pipe = unit * (L - Lt);
    c.tunnel = Lt > 0 ? Lt * p.tunnelPerM + p.tunnelFixed : 0;
    c.jack = jack * p.jackPerSite * Math.pow(D / 900, 0.6);
    c.prv = prv * p.prvPerSite;
    var sf = function (base, h) { return base.cost * Math.pow(q * p.peak / base.q, p.scaleQ) * Math.pow(Math.max(h, 20) / base.h, p.scaleH); };
    c.intake = sf(p.intake, nSt ? hEach : 20);
    c.booster = nSt > 1 ? (nSt - 1) * sf(p.booster, hEach) : 0;
    c.works = c.pipe + c.tunnel + c.jack + c.prv + c.intake + c.booster;
    c.land = p.landPerM * (L - Lt);
    c.overhead = c.works * p.overhead;
    c.contingency = (c.works + c.land + c.overhead) * p.contingency;
    c.total = c.works + c.land + c.overhead + c.contingency;
    var kW = 9.8 * qd * hNeed / p.eff * p.margin, kWavg = 9.8 * qa * hNeed / p.eff;
    var power = kWavg * 8760 * p.powerPrice;
    var crf = p.rate * Math.pow(1 + p.rate, p.years) / (Math.pow(1 + p.rate, p.years) - 1);
    var annual = c.total * crf + power;
    return {
      q: q, qd: qd, D: D, v: qd / (Math.PI * Math.pow(D / 1000, 2) / 4), slope: S * 1000,
      hNeed: hNeed, stations: nSt, hEach: hEach, kW: kW, prv: prv, jack: jack, zHigh: zH,
      cost: c, powerYr: power, annual: annual, unitCost: q > 0 ? annual / (q * 365) : null, params: p
    };
  }

  /**
   * 수리종단 결과(js/hydro.js design)로 사업비 산정
   * @param q     평균 공급량(㎥/일)
   * @param route 노선 JSON (segments, roadShare)
   * @param d     Hydro.design 결과 (segD, pumps, prv, hTot, x, seg)
   */
  function fromDesign(q, route, d, prm) {
    var p = Object.assign({}, DEF, prm || {});
    var qd = q * p.peak / 86400, qa = q / 86400, rs = route.roadShare != null ? route.roadShare : p.roadShare;
    var segKm = route.segments.map(function () { return 0; });
    for (var i = 1; i < d.x.length; i++) segKm[d.seg[i]] += d.x[i] - d.x[i - 1];
    var c = { pipe: 0, tunnel: 0 }, pipeKm = 0, tunKm = 0, nT = 0, Dmax = 0;
    route.segments.forEach(function (s, k) {
      var D = d.segD[k]; Dmax = Math.max(Dmax, D);
      if (s.kind === 'TUNNEL') { c.tunnel += segKm[k] * 1000 * p.tunnelPerM + p.tunnelFixed; tunKm += segKm[k]; nT++; }
      else {
        var b = Math.log(p.pipeRoad[900] / p.pipeRoad[700]) / Math.log(900 / 700), bu = Math.log(p.pipeUnpaved[900] / p.pipeUnpaved[700]) / Math.log(900 / 700);
        c.pipe += segKm[k] * 1000 * (rs * p.pipeRoad[900] * Math.pow(D / 900, b) + (1 - rs) * p.pipeUnpaved[900] * Math.pow(D / 900, bu)); pipeKm += segKm[k];
      }
    });
    var L = pipeKm + tunKm, jack = Math.round(L * p.jackPerKm);
    c.jack = jack * p.jackPerSite * Math.pow(Dmax / 900, 0.6);
    c.prv = d.prv.length * p.prvPerSite;
    var sf = function (base, h) { return base.cost * Math.pow(q * p.peak / base.q, p.scaleQ) * Math.pow(Math.max(h, 20) / base.h, p.scaleH); };

    var ip = d.pumps.filter(function (pp) { return pp.intake; })[0];
    c.intake = sf(p.intake, ip ? ip.H : 20);
    c.booster = d.pumps.filter(function (pp) { return pp !== ip; }).reduce(function (s, pp) { return s + sf(p.booster, pp.H); }, 0);
    c.works = c.pipe + c.tunnel + c.jack + c.prv + c.intake + c.booster;
    c.land = p.landPerM * pipeKm * 1000;
    c.overhead = c.works * p.overhead;
    c.contingency = (c.works + c.land + c.overhead) * p.contingency;
    c.total = c.works + c.land + c.overhead + c.contingency;
    var kWavg = 9.8 * qa * d.hTot / p.eff, power = kWavg * 8760 * p.powerPrice;
    var crf = p.rate * Math.pow(1 + p.rate, p.years) / (Math.pow(1 + p.rate, p.years) - 1), annual = c.total * crf + power;
    var pvf = (1 - Math.pow(1 + p.rate, -p.years)) / p.rate;
    return { q: q, qd: qd, cost: c, jack: jack, pipeKm: pipeKm, tunnelKm: tunKm, roadShare: rs, kW: d.kW, powerYr: power, powerPV: power * pvf,
      annual: annual, unitCost: q > 0 ? annual / (q * 365) : null, lcc: c.total + power * pvf, params: p };
  }

  root.Cost = { DEF: DEF, SIZES: SIZES, estimate: estimate, fromDesign: fromDesign, haversine: haversine, chooseD: chooseD, headLossPerM: headLossPerM, pipeUnit: pipeUnit };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Cost;
})(typeof window !== 'undefined' ? window : this);
