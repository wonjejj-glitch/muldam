/* 경량 캔버스 차트 (외부 라이브러리 없이 오프라인 동작) */
(function (root) {
  'use strict';

  var STAGE_COLORS = ['#e7ecef', '#4f8fd6', '#e8b416', '#e0662b', '#8e2f6b'];

  function css(name, fb) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fb;
  }

  function setup(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function niceTicks(min, max, n) {
    var span = max - min || 1, step = Math.pow(10, Math.floor(Math.log10(span / n)));
    var err = span / n / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var t = [], v = Math.ceil(min / step) * step;
    for (; v <= max + 1e-9; v += step) t.push(+v.toFixed(10));
    return t;
  }

  function fmt(v, d) { return v == null || isNaN(v) ? '-' : v.toLocaleString('ko-KR', { maximumFractionDigits: d == null ? 1 : d, minimumFractionDigits: d == null ? 0 : d }); }

  /* ---------- 시계열 차트 ---------- */
  function TimeSeries(canvas, tip) {
    this.canvas = canvas; this.tip = tip; this.opt = null;
    var self = this;
    canvas.addEventListener('mousemove', function (e) { self.hover(e); });
    canvas.addEventListener('mouseleave', function () { self.hoverIdx = null; self.draw(); tip.style.display = 'none'; });
    if (window.ResizeObserver) new ResizeObserver(function () { self.draw(); }).observe(canvas);
  }
  TimeSeries.prototype.set = function (opt) { this.opt = opt; this.draw(); };
  TimeSeries.prototype.draw = function () {
    var o = this.opt; if (!o || !this.canvas.clientWidth) return;
    var S = setup(this.canvas), ctx = S.ctx;
    var stripH = 14, nStrip = (o.strips || []).length;
    var pad = { l: 56, r: 16, t: 12, b: 26 + nStrip * (stripH + 4) };
    var W = S.w - pad.l - pad.r, H = S.h - pad.t - pad.b;
    var t = o.t, n = t.length; if (!n) return;
    var t0 = t[0], t1 = t[n - 1] || t0 + 1;
    var ymin = Infinity, ymax = -Infinity;
    o.series.forEach(function (s) { if (s.hidden) return; s.data.forEach(function (v) { if (v != null) { if (v < ymin) ymin = v; if (v > ymax) ymax = v; } }); });
    if (o.yMin != null) ymin = Math.min(ymin, o.yMin);
    var padY = (ymax - ymin) * 0.06 || 1; ymin -= padY; ymax += padY;
    var X = function (v) { return pad.l + (v - t0) / (t1 - t0) * W; };
    var Y = function (v) { return pad.t + (1 - (v - ymin) / (ymax - ymin)) * H; };
    this.geom = { pad: pad, W: W, X: X, t0: t0, t1: t1 };
    var grid = css('--grid', '#e5e9ee'), muted = css('--muted', '#6b7785');
    ctx.font = '11px ' + css('--font', 'sans-serif');
    // y grid
    ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    niceTicks(ymin, ymax, 6).forEach(function (v) {
      var y = Math.round(Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + W, y); ctx.stroke();
      ctx.fillText(fmt(v, 0), pad.l - 6, y);
    });
    ctx.save(); ctx.translate(12, pad.t + H / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(o.yLabel || '', 0, 0); ctx.restore();
    // x ticks (월/년)
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var spanDays = (t1 - t0) / 864e5, d0 = new Date(t0);
    var monthStep = spanDays > 900 ? 12 : spanDays > 400 ? 3 : 1;
    var cur = new Date(d0.getFullYear(), monthStep === 12 ? 0 : d0.getMonth(), 1), lastR = -Infinity;
    while (cur.getTime() <= t1) {
      if (cur.getTime() >= t0) {
        var x = Math.round(X(cur.getTime())) + 0.5;
        ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + H); ctx.stroke();
        ctx.fillStyle = muted;
        // 연도 표시('1995.1')가 붙은 첫 달은 글자가 길어 다음 달과 겹치므로, 앞 글자와 겹치는 눈금 글자는 생략(눈금선은 그대로)
        var lab = monthStep === 12 ? cur.getFullYear() + '' : (cur.getMonth() === 0 ? cur.getFullYear() + '.1' : (cur.getMonth() + 1) + '월');
        var hw = ctx.measureText(lab).width / 2;
        if (x - hw >= lastR + 6) { ctx.fillText(lab, x, pad.t + H + 4 + nStrip * (stripH + 4)); lastR = x + hw; }
      }
      cur = new Date(cur.getFullYear(), cur.getMonth() + monthStep, 1);
    }
    // series
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, W, H); ctx.clip();
    o.series.forEach(function (s) {
      if (s.hidden) return;
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.5; ctx.setLineDash(s.dash || []);
      ctx.beginPath(); var started = false;
      for (var i = 0; i < n; i++) {
        var v = s.data[i]; if (v == null) { started = false; continue; }
        var x = X(t[i]), y = Y(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    ctx.setLineDash([]); ctx.restore();
    // stage strips
    (o.strips || []).forEach(function (st, k) {
      var y = pad.t + H + 4 + k * (stripH + 4);
      for (var i = 0; i < n; i++) {
        var x0 = X(t[i]), x1 = i + 1 < n ? X(t[i + 1]) : x0 + W / n;
        ctx.fillStyle = STAGE_COLORS[st.data[i]] || STAGE_COLORS[0];
        ctx.fillRect(x0, y, Math.max(1, x1 - x0 + 0.3), stripH);
      }
      ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(st.name, pad.l - 6, y + stripH / 2);
    });
    // hover
    if (this.hoverIdx != null) {
      var hx = X(t[this.hoverIdx]);
      ctx.strokeStyle = css('--ink', '#1d2733'); ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(hx, pad.t); ctx.lineTo(hx, pad.t + H + nStrip * (stripH + 4)); ctx.stroke(); ctx.globalAlpha = 1;
      var hi = this.hoverIdx;
      o.series.forEach(function (s) {
        if (s.hidden || s.data[hi] == null || s.dash) return;
        ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(hx, Y(s.data[hi]), 3.5, 0, 7); ctx.fill();
      });
    }
  };
  TimeSeries.prototype.hover = function (e) {
    var o = this.opt, g = this.geom; if (!o || !g) return;
    var r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left;
    if (x < g.pad.l || x > g.pad.l + g.W) { this.hoverIdx = null; this.tip.style.display = 'none'; this.draw(); return; }
    var tv = g.t0 + (x - g.pad.l) / g.W * (g.t1 - g.t0), t = o.t, lo = 0, hi = t.length - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (t[m] <= tv) lo = m; else hi = m; }
    var idx = (tv - t[lo] < t[hi] - tv) ? lo : hi;
    this.hoverIdx = idx; this.draw();
    var html = '<b>' + o.labels[idx] + '</b>';
    o.series.forEach(function (s) { if (!s.hidden && s.data[idx] != null) html += '<div><i style="background:' + s.color + '"></i>' + s.name + ' <b>' + fmt(s.data[idx], 2) + '</b></div>'; });
    (o.strips || []).forEach(function (s) { html += '<div><i style="background:' + STAGE_COLORS[s.data[idx]] + '"></i>' + s.name + ' <b>' + o.stageLabel[s.data[idx]] + '</b></div>'; });
    if (o.extra) html += o.extra(idx);
    this.tip.innerHTML = html; this.tip.style.display = 'block';
    var tw = this.tip.offsetWidth, px = e.clientX - r.left + 14;
    if (px + tw > r.width) px = e.clientX - r.left - tw - 14;
    this.tip.style.left = px + 'px'; this.tip.style.top = Math.max(0, e.clientY - r.top - 20) + 'px';
  };

  /* ---------- 연도별 누적 막대 (현재/공급 쌍) ---------- */
  function drawYearBars(canvas, groups, labels) {
    var S = setup(canvas), ctx = S.ctx, pad = { l: 44, r: 10, t: 10, b: 40 };
    var W = S.w - pad.l - pad.r, H = S.h - pad.t - pad.b;
    var max = 0; groups.forEach(function (g) { g.bars.forEach(function (b) { var s = b.c[1] + b.c[2] + b.c[3] + b.c[4]; if (s > max) max = s; }); });
    max = Math.max(30, max * 1.1);
    var muted = css('--muted', '#6b7785'), grid = css('--grid', '#e5e9ee');
    ctx.font = '11px ' + css('--font', 'sans-serif');
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    niceTicks(0, max, 5).forEach(function (v) {
      var y = Math.round(pad.t + H - v / max * H) + 0.5;
      ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + W, y); ctx.stroke();
      ctx.fillStyle = muted; ctx.fillText(v + '', pad.l - 6, y);
    });
    var gw = W / groups.length, bw = Math.min(26, gw / 3);
    groups.forEach(function (g, gi) {
      var cx = pad.l + gw * gi + gw / 2;
      g.bars.forEach(function (b, bi) {
        var x = cx + (bi === 0 ? -bw - 2 : 2), y = pad.t + H;
        for (var k = 1; k <= 4; k++) {
          var h = b.c[k] / max * H; if (!h) continue;
          ctx.fillStyle = STAGE_COLORS[k]; ctx.globalAlpha = bi === 0 ? 0.55 : 1;
          ctx.fillRect(x, y - h, bw, h); y -= h;
        }
        ctx.globalAlpha = 1;
        var tot = b.c[1] + b.c[2] + b.c[3] + b.c[4];
        ctx.fillStyle = css('--ink', '#1d2733'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(tot, x + bw / 2, y - 2);
      });
      ctx.fillStyle = muted; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      ctx.fillText(g.label, cx, pad.t + H + 6);
      ctx.fillText(labels[0] + ' | ' + labels[1], cx, pad.t + H + 21);
    });
  }

  /* ---------- 공급량 민감도 곡선 ---------- */
  function drawSensitivity(canvas, pts, marks) {
    var S = setup(canvas), ctx = S.ctx, pad = { l: 44, r: 14, t: 14, b: 34 };
    var W = S.w - pad.l - pad.r, H = S.h - pad.t - pad.b;
    var qmax = pts[pts.length - 1].q, ymax = 0;
    pts.forEach(function (p) { ymax = Math.max(ymax, p.drought, p.warn); });
    ymax = Math.min(366, Math.max(60, ymax * 1.08));
    var X = function (q) { return pad.l + q / qmax * W; }, Y = function (v) { return pad.t + H - v / ymax * H; };
    var muted = css('--muted', '#6b7785'), grid = css('--grid', '#e5e9ee');
    ctx.font = '11px ' + css('--font', 'sans-serif');
    // 판정 영역
    if (marks && marks.zones) marks.zones.forEach(function (z) {
      ctx.fillStyle = z.color; ctx.fillRect(X(z.from), pad.t, X(z.to) - X(z.from), H);
    });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    niceTicks(0, ymax, 5).forEach(function (v) {
      var y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + W, y); ctx.stroke();
      ctx.fillStyle = muted; ctx.fillText(v, pad.l - 6, y);
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    niceTicks(0, qmax, 6).forEach(function (v) { ctx.fillStyle = muted; ctx.fillText((v / 1000) + '천', X(v), pad.t + H + 5); });
    ctx.fillText('추가 공급량 (㎥/일)', pad.l + W / 2, pad.t + H + 19);
    [['drought', '#4f8fd6', '관심 이상'], ['warn', '#e0662b', '주의 이상'], ['em', '#8e2f6b', '비상공급']].forEach(function (s) {
      ctx.strokeStyle = s[1]; ctx.lineWidth = 2; ctx.beginPath();
      pts.forEach(function (p, i) { var x = X(p.q), y = Y(p[s[0]]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    });
    if (marks && marks.q != null) {
      var x = X(Math.min(marks.q, qmax));
      ctx.strokeStyle = css('--ink', '#1d2733'); ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + H); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = css('--ink', '#1d2733'); ctx.textAlign = x > pad.l + W - 80 ? 'right' : 'left'; ctx.textBaseline = 'top';
      ctx.fillText(' 검토 공급량 ' + fmt(marks.q, 0), x, pad.t + 2);
    }
  }

  /* ---------- 가로 막대 (댐별 여력) ---------- */
  function drawHBars(canvas, items, unit) {
    var S = setup(canvas), ctx = S.ctx, pad = { l: 70, r: 70, t: 8, b: 8 };
    ctx.font = '12px ' + css('--font', 'sans-serif');
    // 양수 막대 끝에 붙는 글자가 잘리지 않게 오른쪽 여백을 글자 폭만큼 확보
    var tw = 0; items.forEach(function (it) { if (it.v >= 0) tw = Math.max(tw, ctx.measureText(it.text != null ? it.text : fmt(it.v, 1) + ' ' + unit).width); });
    pad.r = Math.min(S.w * 0.35, Math.max(70, tw + 12));
    var W = S.w - pad.l - pad.r, H = S.h - pad.t - pad.b, n = items.length, bh = H / n;
    var max = 0; items.forEach(function (it) { max = Math.max(max, Math.abs(it.v)); }); max = max || 1;
    var zx = pad.l + W / 2;
    ctx.strokeStyle = css('--grid', '#e5e9ee'); ctx.beginPath(); ctx.moveTo(zx + 0.5, pad.t); ctx.lineTo(zx + 0.5, pad.t + H); ctx.stroke();
    items.forEach(function (it, i) {
      var y = pad.t + i * bh + bh * 0.2, h = bh * 0.6, w = it.v / max * W / 2;
      ctx.fillStyle = it.color || (it.v >= 0 ? '#2f9e6e' : '#d0573a');
      ctx.fillRect(w >= 0 ? zx : zx + w, y, Math.abs(w), h);
      ctx.fillStyle = css('--ink', '#1d2733'); ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      ctx.fillText(it.label, pad.l - 8, y + h / 2);
      ctx.textAlign = 'left';
      ctx.fillStyle = it.textColor || css('--ink', '#1d2733');
      ctx.fillText(it.text != null ? it.text : fmt(it.v, 1) + ' ' + unit, w >= 0 ? zx + w + 6 : zx + 6, y + h / 2);
    });
  }

  /* ---------- 범용 꺾은선 (x 숫자) ---------- */
  function drawLines(canvas, xs, series, o) {
    o = o || {};
    var S = setup(canvas), ctx = S.ctx, pad = { l: 48, r: 14, t: 14, b: 34 };
    var W = S.w - pad.l - pad.r, H = S.h - pad.t - pad.b;
    if (!xs.length || W <= 0) return;
    var x0 = xs[0], x1 = xs[xs.length - 1] || 1, ymin = o.yMin != null ? o.yMin : Infinity, ymax = o.yMax != null ? o.yMax : -Infinity;
    if (o.yMin == null || o.yMax == null) series.forEach(function (s) { s.data.forEach(function (v) { if (v == null) return; if (o.yMin == null && v < ymin) ymin = v; if (o.yMax == null && v > ymax) ymax = v; }); });
    if (ymax === ymin) ymax = ymin + 1;
    var X = function (v) { return pad.l + (v - x0) / (x1 - x0 || 1) * W; }, Y = function (v) { return pad.t + H - (v - ymin) / (ymax - ymin) * H; };
    var muted = css('--muted', '#6b7785'), grid = css('--grid', '#e5e9ee');
    ctx.font = '11px ' + css('--font', 'sans-serif');
    (o.zones || []).forEach(function (z) { ctx.fillStyle = z.color; ctx.fillRect(X(Math.max(x0, z.from)), pad.t, X(Math.min(x1, z.to)) - X(Math.max(x0, z.from)), H); });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    niceTicks(ymin, ymax, 5).forEach(function (v) { var y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + W, y); ctx.stroke(); ctx.fillStyle = muted; ctx.fillText(fmt(v, o.yDec == null ? 0 : o.yDec), pad.l - 6, y); });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    niceTicks(x0, x1, 6).forEach(function (v) { ctx.fillStyle = muted; ctx.fillText(o.xFmt ? o.xFmt(v) : fmt(v, 0), X(v), pad.t + H + 5); });
    if (o.xLabel) ctx.fillText(o.xLabel, pad.l + W / 2, pad.t + H + 19);
    series.forEach(function (s) {
      if (s.points) {
        ctx.fillStyle = s.color; ctx.globalAlpha = s.alpha == null ? 0.6 : s.alpha;
        xs.forEach(function (x, i) { var v = s.data[i]; if (v == null) return; ctx.beginPath(); ctx.arc(X(x), Y(v), s.r || 2.2, 0, Math.PI * 2); ctx.fill(); });
        ctx.globalAlpha = 1; return;
      }
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []); ctx.beginPath(); var st = false;
      xs.forEach(function (x, i) { var v = s.data[i]; if (v == null) { st = false; return; } if (st) ctx.lineTo(X(x), Y(v)); else { ctx.moveTo(X(x), Y(v)); st = true; } });
      ctx.stroke();
    });
    ctx.setLineDash([]);
    (o.vlines || []).forEach(function (vl) {
      if (vl.x < x0 || vl.x > x1) return;
      var x = X(vl.x); ctx.strokeStyle = vl.color || css('--ink', '#1d2733'); ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + H); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = vl.color || css('--ink', '#1d2733'); ctx.textAlign = x > pad.l + W - 90 ? 'right' : 'left'; ctx.textBaseline = 'top'; ctx.fillText(' ' + vl.label + ' ', x, pad.t + 2 + (vl.row || 0) * 13);
    });
  }

  /* ---------- 수리종단도 ----------
   * d: Hydro.design 결과, o: { tunnels:[[x0,x1]], hwl, lwl, title } */
  function drawProfile(canvas, d, o) {
    o = o || {};
    var S = setup(canvas), ctx = S.ctx, pad = { l: 52, r: 16, t: 16, b: 36 };
    var W = S.w - pad.l - pad.r, H = S.h - pad.t - pad.b;
    if (!d || !d.x.length || W <= 0) return;
    var n = d.x.length, x0 = 0, x1 = d.x[n - 1];
    var hv = d.hgl.filter(function (v) { return isFinite(v); });
    var ymax = Math.max(Math.max.apply(null, hv), o.lwl || 0) + 30, ymin = Math.min(Math.min.apply(null, d.ground), o.hwl != null ? o.hwl : Infinity) - 15;
    ymin = Math.max(0, Math.floor(ymin / 10) * 10);
    var X = function (v) { return pad.l + (v - x0) / (x1 - x0 || 1) * W; }, Y = function (v) { return pad.t + H - (v - ymin) / (ymax - ymin) * H; };
    var muted = css('--muted', '#6b7785'), grid = css('--grid', '#e5e9ee');
    ctx.font = '11px ' + css('--font', 'sans-serif');
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, W, H); ctx.clip();
    (o.tunnels || []).forEach(function (t) { ctx.fillStyle = 'rgba(120,135,150,.13)'; ctx.fillRect(X(t[0]), pad.t, X(t[1]) - X(t[0]), H); });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    niceTicks(ymin, ymax, 6).forEach(function (v) { var y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + W, y); ctx.stroke(); });
    // 지반
    ctx.beginPath(); ctx.moveTo(X(d.x[0]), Y(ymin));
    for (var i = 0; i < n; i++) ctx.lineTo(X(d.x[i]), Y(d.ground[i]));
    ctx.lineTo(X(d.x[n - 1]), Y(ymin)); ctx.closePath(); ctx.fillStyle = '#ece6dc'; ctx.fill();
    var line = function (arr, col, w, dash) { ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); var st = false; for (var j = 0; j < n; j++) { var v = arr[j]; if (!isFinite(v)) { st = false; continue; } if (st) ctx.lineTo(X(d.x[j]), Y(v)); else { ctx.moveTo(X(d.x[j]), Y(v)); st = true; } } ctx.stroke(); ctx.setLineDash([]); };
    line(d.ground, '#7a6650', 1);
    line(d.inv, '#7a6650', 1, [2, 3]);
    if (o.hwl != null) { ctx.strokeStyle = '#8e2f6b'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(X(x1 * 0.85), Y(o.hwl)); ctx.lineTo(X(x1), Y(o.hwl)); ctx.stroke(); ctx.setLineDash([]); }
    line(d.hgl, '#1d4f86', 2.2);
    ctx.restore();
    // 시설
    var arrow = function (x, y0, y1, col) { ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(X(x), Y(y0)); ctx.lineTo(X(x), Y(y1)); ctx.stroke(); var dir = y1 > y0 ? -1 : 1; ctx.beginPath(); ctx.moveTo(X(x), Y(y1)); ctx.lineTo(X(x) - 4, Y(y1) + dir * 7); ctx.lineTo(X(x) + 4, Y(y1) + dir * 7); ctx.closePath(); ctx.fill(); };
    ctx.font = '600 11px ' + css('--font', 'sans-serif'); ctx.textBaseline = 'bottom';
    d.pumps.forEach(function (p, k) { arrow(p.x, p.hIn, p.hOut, '#1d4f86'); ctx.textAlign = X(p.x) > pad.l + W - 80 ? 'right' : 'left'; ctx.fillText(' P' + (k + 1) + ' ' + fmt(p.H, 0) + 'm', X(p.x), Y(p.hOut) - 3); });
    d.prv.forEach(function (p, k) { arrow(p.x, p.hIn, p.hOut, '#2f9e6e'); ctx.fillStyle = '#2f9e6e'; ctx.textAlign = 'left'; ctx.fillText(' V' + (k + 1) + ' −' + fmt(p.dH, 0), X(p.x), Y(p.hIn) - 3); });
    // 축
    ctx.font = '11px ' + css('--font', 'sans-serif'); ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    niceTicks(ymin, ymax, 6).forEach(function (v) { ctx.fillText(fmt(v, 0), pad.l - 6, Y(v)); });
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    niceTicks(x0, x1, 10).forEach(function (v) { ctx.fillText(fmt(v, 0), X(v), pad.t + H + 5); });
    ctx.fillText('누적거리 (km)', pad.l + W / 2, pad.t + H + 19);
    ctx.save(); ctx.translate(13, pad.t + H / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('EL. (m)', 0, 0); ctx.restore();
    (o.tunnels || []).forEach(function (t) { ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('터널 ' + fmt(t[1] - t[0], 2) + 'km', X((t[0] + t[1]) / 2), pad.t + H - 16); });
  }

  root.Charts = { drawProfile: drawProfile, drawLines: drawLines, TimeSeries: TimeSeries, drawYearBars: drawYearBars, drawSensitivity: drawSensitivity, drawHBars: drawHBars, STAGE_COLORS: STAGE_COLORS, fmt: fmt };
})(window);
