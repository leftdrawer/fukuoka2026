/* 후쿠오카 순례 — 동선을 따라 퀘스트를 깨는 지도. 일정·경로·가이드는 data.js(window.TRIP), 실행 중 외부 API 호출 없음 (타일 제외) */
(function () {
  'use strict';
  var T = window.TRIP, G = T.guide;
  var RATE = T.rate;
  var TZ = 'Asia/Tokyo';
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var MODE = {
    flight:     { c: '#1DB898', label: '비행기',       icon: '✈️', gm: null },
    shuttle:    { c: '#595959', label: '공항 연결버스', icon: '🚌', gm: 'transit' },
    subway:     { c: '#F08300', label: '지하철',       icon: '🚇', gm: 'transit' },
    jr:         { c: '#E60012', label: 'JR',           icon: '🚆', gm: 'transit' },
    nishitetsu: { c: '#1B5AA8', label: '니시테츠',     icon: '🚃', gm: 'transit' },
    bus:        { c: '#DD873D', label: '버스',         icon: '🚌', gm: 'transit' },
    krail:      { c: '#0090D2', label: '전철',         icon: '🚆', gm: 'transit' },
    walk:       { c: 'var(--walk)', label: '도보',     icon: '🚶', gm: 'walking', dash: '1 9' }
  };
  var CAT = {
    shrine: { c: '#B22222', icon: '⛩️', label: '신사' },
    temple: { c: '#7B4B94', icon: '🪷', label: '절' },
    hotel:  { c: '#2F5597', icon: '🏨', label: '숙소' },
    food:   { c: '#16833F', icon: '🍜', label: '식당' },
    bath:   { c: '#1F6FB2', icon: '♨️', label: '목욕탕' },
    bar:    { c: '#C2255C', icon: '🏳️‍🌈', label: '바' },
    money:  { c: '#B08900', icon: '💴', label: '환전' },
    shop:   { c: '#E8590C', icon: '🛍️', label: '쇼핑' },
    pharmacy: { c: '#2B8A3E', icon: '💊', label: '약국' }
  };
  var QTYPE = {
    main:   { tag: '기도터',   c: 'var(--red)' },
    side:   { tag: '들를 곳',  c: 'var(--green)' },
    rest:   { tag: '숙소',     c: 'var(--blue)' },
    travel: { tag: '이동',     c: 'var(--ink2)' },
    task:   { tag: '할 일',    c: 'var(--mute)' }
  };
  var WD = ['일', '월', '화', '수', '목', '금', '토'];

  // ------------------------------------------------------------ 유틸
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hm(s) { if (!s) return null; var p = s.split(':'); return +p[0] * 60 + +p[1]; }
  function fmtMin(m) { m = Math.round(m); if (m < 60) return m + '분'; return Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : ''); }
  function fmtDist(d) { return d >= 1000 ? (d / 1000).toFixed(d >= 10000 ? 0 : 1) + 'km' : Math.round(d / 10) * 10 + 'm'; }
  function fmtTime(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.round(m % 60)).padStart(2, '0'); }
  function yen(v) { return v.toLocaleString('ko-KR') + '엔'; }
  function won(v) { return Math.round(v * RATE).toLocaleString('ko-KR') + '원'; }
  function krw(v) { return Math.round(v).toLocaleString('ko-KR') + '원'; }
  function tokyoNow() {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    var o = {}; parts.forEach(function (p) { o[p.type] = p.value; });
    return { date: o.year + '-' + o.month + '-' + o.day, min: +o.hour * 60 + +o.minute + (+o.second) / 60 };
  }
  function dayLabel(date) { var d = new Date(date + 'T12:00:00+09:00'); return { md: (d.getUTCMonth() + 1) + '/' + d.getUTCDate(), wd: WD[d.getUTCDay()] }; }
  function hav(a, b) {
    var R = 6371000, r = Math.PI / 180, dla = (b[0] - a[0]) * r, dlo = (b[1] - a[1]) * r;
    var h = Math.sin(dla / 2) * Math.sin(dla / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dlo / 2) * Math.sin(dlo / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function segDist(p, a, b) {
    var k = Math.cos(p[0] * Math.PI / 180) * 111320, K = 110540;
    var ax = (a[1] - p[1]) * k, ay = (a[0] - p[0]) * K, bx = (b[1] - p[1]) * k, by = (b[0] - p[0]) * K;
    var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    var t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    var x = ax + t * dx, y = ay + t * dy;
    return { d: Math.sqrt(x * x + y * y), t: t };
  }
  function project(p, parts) {
    var best = { d: Infinity, remain: 0 }, total = 0, lens = [];
    parts.forEach(function (pl) { for (var i = 0; i < pl.length - 1; i++) { var l = hav(pl[i], pl[i + 1]); lens.push(l); total += l; } });
    var acc = 0, idx = 0;
    parts.forEach(function (pl) {
      for (var i = 0; i < pl.length - 1; i++) {
        var s = segDist(p, pl[i], pl[i + 1]), l = lens[idx++];
        if (s.d < best.d) best = { d: s.d, remain: total - acc - s.t * l };
        acc += l;
      }
    });
    return best;
  }

  // ------------------------------------------------------------ 진행 저장 (이 폰에만)
  var P = { done: {}, obj: {}, pack: {}, intro: {} };
  try { var saved = JSON.parse(localStorage.getItem('fk-progress-v1') || 'null'); if (saved) P = Object.assign(P, saved); } catch (e) {}
  function save() { try { localStorage.setItem('fk-progress-v1', JSON.stringify(P)); } catch (e) {} }
  if (!P.objv2) { // 이동 할 일 순서를 [타기, 내리기, 표] → [표, 타기, 내리기]로 바꾼 뒤 이미 누른 체크를 옮김
    T.days.forEach(function (d) { d.steps.forEach(function (s) {
      var o = P.obj[s.key]; if (s.kind !== 'move' || !o || s.mode === 'walk' || s.mode === 'flight' || !s.board || !s.off || !(s.pay === 'card' || s.fare_jpy)) return;
      P.obj[s.key] = [o[2], o[0], o[1]];
    }); });
    P.objv2 = 1; save();
  }

  // ------------------------------------------------------------ 하루 타임라인 = 퀘스트 목록
  var DAYS = T.days.map(function (d, di) {
    var list = [];
    (T.pre[d.date] || []).forEach(function (x) { list.push({ type: 'task', text: x.text, start: hm(x.time), end: hm(x.end), key: d.date + '|' + x.time + '|task' }); });
    (T.tasks[d.date] || []).forEach(function (x) { list.push({ type: 'task', text: x.text, start: hm(x.time), end: hm(x.end), key: d.date + '|' + x.time + '|task' }); });
    d.steps.forEach(function (s) {
      if (s.kind === 'move') list.push({ type: 'move', step: s, start: hm(s.dep), end: hm(s.arr), key: s.key });
      else list.push({ type: 'place', step: s, start: hm(s.start), end: hm(s.end), key: s.key });
    });
    list.forEach(function (e, i) { e.ord = i; });
    list.sort(function (a, b) { return (a.start - b.start) || (a.ord - b.ord); });
    list.forEach(function (e, i) { if (e.end == null) e.end = i + 1 < list.length ? list[i + 1].start : 24 * 60 - 1; e.day = di; e.idx = i; });
    return { d: d, list: list };
  });
  function qtype(e) { return e.type === 'place' ? ((e.step.quest && e.step.quest.type) || 'side') : e.type === 'move' ? 'travel' : 'task'; }
  function objectives(e) {
    if (e.type === 'place') return (e.step.quest && e.step.quest.objectives) || [];
    if (e.type === 'task') return [e.text];
    var s = e.step, m = MODE[s.mode];
    if (s.mode === 'flight') return ['탑승 수속 · 여권 확인', s.to + ' 도착'];
    if (s.mode === 'walk') return (s.board ? ['출발: ' + s.board] : []).concat(s.off ? ['도착: ' + s.off + ' (' + fmtDist(s.dist_m) + ')'] : [s.to + '까지 걷기 (' + fmtDist(s.dist_m) + ')']);
    var o = []; // 일어나는 순서대로: 표 사기·카드 터치 → 타기 → 내리기 (9/30 요청)
    if (s.pay === 'card') o.push(yen(s.fare_jpy) + ' · 실물 카드를 개찰구에 터치');
    else if (s.fare_jpy) o.push(yen(s.fare_jpy) + ' · 현금' + (s.mode === 'bus' ? ' (탈 때 번호표, 내릴 때 요금함)' : '으로 표 사기'));
    if (s.board) o.push('타기: ' + s.board);
    if (s.off) o.push('내리기: ' + s.off);
    if (!s.board) o.push(s.from + '에서 ' + m.label + ' 탑승');
    if (!s.off) o.push(s.to + '에서 내리기');
    return o;
  }
  // 지갑 한 줄: 이 퀘스트에 어떤 돈이 필요한지 (버스는 동전·천엔권, 새전은 5엔 등)
  function coinTip(e) {
    if (!e || !e.step) return '';
    var s = e.step;
    if (s.pay_how) return s.pay_how; // 결제마다 어떤 돈으로 낼지 (9/30 요청: 실제 지갑 기준 가이드)
    if (e.type === 'move') {
      if (s.mode === 'bus') return '버스: ' + yen(s.fare_jpy || 0) + ' 딱 맞게 — 동전·천엔권만 (1만엔·5천엔권은 교환기에서 안 바뀜)';
      if (s.pay === 'cash' && (s.mode === 'jr' || s.mode === 'nishitetsu' || s.mode === 'subway'))
        return '표 ' + yen(s.fare_jpy || 0) + ' — 작은 역 매표기는 천엔권·동전, 큰 역은 1만엔권도 OK';
      return '';
    }
    if (e.type !== 'place' || s.lon < 128) return '';
    if (s.category === 'shrine' || s.category === 'temple') return '새전 5엔(ご縁) — 사랑·인연 기도엔 5·15·25·45엔, 10엔(遠縁)은 피하기' + (s.cost_jpy ? ' · 입장·참배 ' + yen(s.cost_jpy) : '');
    if (s.category === 'bath') return '현금 ' + yen(s.cost_jpy || 550) + ' + 옷장용 100엔 동전';
    if (s.pay === 'cash') return '현금만 — 천엔권·동전으로 (1만엔권은 편의점에서 미리 깨기)';
    return '';
  }
  // 개찰구에서 카드를 찍는지 표를 사는지 (9/30 요청: 역에서 바로 보이게 카드에 한 줄)
  function gateTip(e) {
    if (!e || e.type !== 'move') return '';
    var s = e.step;
    if (s.mode === 'subway' && s.pay === 'card') return '🎫 개찰구에서 실물 카드 터치 — 표 안 사도 됨 (나올 때도 같은 카드로 · 삼성페이는 9/30에 안 됨)';
    if (s.mode === 'bus') return '🎫 뒷문으로 타며 번호표 뽑기 → 내릴 때 앞문 요금함에 현금 ' + yen(s.fare_jpy || 0);
    if (s.pay === 'cash' && (s.mode === 'jr' || s.mode === 'nishitetsu' || s.mode === 'subway')) return '🎫 매표기에서 ' + yen(s.fare_jpy || 0) + ' 표 사기 (현금) → 개찰구에 표 넣기';
    return '';
  }
  function entryPoint(e, which) {
    if (e.type === 'place') return [e.step.lat, e.step.lon];
    if (e.type === 'move') return which === 'end' ? e.step.b : e.step.a;
    return null;
  }
  function entryTitle(e, short) {
    if (e.type === 'task') return e.text;
    var s = e.step;
    if (e.type === 'place') return s.name;
    return short ? s.to + '까지' : s.from + ' → ' + s.to;
  }
  function payChip(x) {
    var p = x.type ? (x.step && x.step.pay) : x;
    return p === 'card' ? '<span class="pay card">카드</span>' : p === 'cash' ? '<span class="pay cash">현금</span>' : p === 'free' ? '<span class="pay">무료</span>' : '';
  }
  function modeChip(e) {
    if (e.type !== 'move') return '';
    var m = MODE[e.step.mode], col = m.c.indexOf('var(') === 0 ? '#6b7280' : m.c;
    return '<span class="mode" style="--mc:' + col + '">' + m.label + '</span>';
  }
  function entryTime(e) { return fmtTime(e.start) + (e.end > e.start ? '–' + fmtTime(e.end) : ''); }
  // 완료 판정: 장소는 직접 완료, 이동·할 일은 시간이 지나면 자동
  function isDone(e) {
    if (P.done[e.key]) return true;
    if (e.type === 'place' || e === cur) return false; // 지금 퀘스트는 늦어도 자동 완료하지 않음
    var now = tokyoNow(), dd = DAYS[e.day].d.date;
    return dd < now.date || (dd === now.date && e.end <= now.min);
  }

  // ------------------------------------------------------------ 날씨: 빌드 때 받은 예보 + 온라인이면 1시간마다 새로
  var W = T.weather;
  try { var wc = JSON.parse(localStorage.getItem('fk-wx') || 'null'); if (wc && (!W || wc.fetched > W.fetched)) W = wc; } catch (e) {}
  function WXI(c) { return c === 0 ? '☀️' : c <= 2 ? '🌤' : c === 3 ? '☁️' : c <= 48 ? '🌫' : c <= 57 ? '🌦' : c <= 67 ? '🌧' : c <= 77 ? '🌨' : c <= 82 ? '🌧' : '⛈'; }
  function wxIdx(date, min) { if (!W) return -1; return W.time.indexOf(date + 'T' + String(Math.floor(min / 60)).padStart(2, '0') + ':00'); }
  function wxAt(date, min) { var i = wxIdx(date, min); return i < 0 ? null : { pp: W.pp[i] || 0, pr: W.pr[i] || 0, code: W.code[i], temp: W.temp[i] }; }
  function wxRange(date, a, b) { // 시간대 안 최대 강수확률·강수량
    var r = null;
    for (var m = Math.floor(a / 60) * 60; m <= Math.max(a, b); m += 60) { var x = wxAt(date, m); if (!x) continue; r = r || { pp: 0, pr: 0 }; r.pp = Math.max(r.pp, x.pp); r.pr = Math.max(r.pr, x.pr); }
    return r;
  }
  function dayWx(date) {
    if (!W) return null;
    var tmin = 99, tmax = -99, pp = 0, pr = 0, codes = {}, best = null, n = 0;
    for (var hr = 7; hr <= 23; hr++) {
      var x = wxAt(date, hr * 60); if (!x) continue; n++;
      tmin = Math.min(tmin, x.temp); tmax = Math.max(tmax, x.temp); pr += x.pr;
      if (x.pp > pp) { pp = x.pp; best = hr; }
      codes[x.code] = (codes[x.code] || 0) + 1;
    }
    if (!n) return null;
    var code = +Object.keys(codes).sort(function (a, b) { return codes[b] - codes[a]; })[0];
    return { tmin: tmin, tmax: tmax, pp: pp, ppHour: best, pr: pr, code: code };
  }
  function wxLine(date) {
    var d = dayWx(date);
    if (!d) { var D = DAYS.find(function (x) { return x.d.date === date; }); return esc(D ? D.d.weather : ''); }
    var s = WXI(d.code) + ' ' + Math.round(d.tmin) + '–' + Math.round(d.tmax) + '°';
    return s + (d.pp >= 40 || d.pr >= 0.5 ? ' · <span class="rainy">☔ ' + d.ppHour + '시 ' + d.pp + '%</span>' : ' · 비 ' + d.pp + '%');
  }
  function wxStamp() { return W ? '예보 ' + W.fetched.slice(5, 16).replace('T', ' ') + ' 기준 · ' + (W.source || 'Open-Meteo') : '예보 없음'; }
  function wxSec(e) {
    var r = wxRange(DAYS[e.day].d.date, e.start, e.end);
    if (!r || (r.pp < 40 && r.pr < 0.2)) return '';
    return '<div class="sh-h rain">비 예보</div><ul class="sh-list"><li>이 시간 강수확률 최대 ' + r.pp + '%' + (r.pr ? ', ' + r.pr.toFixed(1) + 'mm' : '') + '. 우산 챙기기</li></ul>';
  }
  var wxBusy = false;
  function refreshWx() {
    if (wxBusy || !navigator.onLine) return;
    var age = W ? Date.now() - new Date(W.fetched.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')).getTime() : Infinity;
    if (age < 3600e3) return;
    wxBusy = true;
    var dates = T.days.map(function (d) { return d.date; });
    fetch('https://api.open-meteo.com/v1/forecast?latitude=33.59&longitude=130.40&timezone=Asia%2FTokyo&hourly=precipitation_probability,precipitation,weather_code,temperature_2m&start_date=' + dates[0] + '&end_date=' + dates[dates.length - 1])
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.hourly) return;
        var h = j.hourly, t = new Date(), off = -t.getTimezoneOffset();
        var iso = new Date(t.getTime() + off * 6e4).toISOString().slice(0, 19) + (off >= 0 ? '+' : '-') + String(Math.floor(Math.abs(off) / 60)).padStart(2, '0') + String(Math.abs(off) % 60).padStart(2, '0');
        W = { fetched: iso, source: 'Open-Meteo', time: h.time, pp: h.precipitation_probability, pr: h.precipitation, code: h.weather_code, temp: h.temperature_2m };
        try { localStorage.setItem('fk-wx', JSON.stringify(W)); } catch (e) {}
        renderHud(); drawRainFor(); if (lastState) renderQuest(lastState);
      })
      .catch(function () {})
      .then(function () { wxBusy = false; });
  }
  // 지도 위에 비 내리기: 보고 있는 챕터가 오늘이면 지금 시각, 아니면 그날 가장 비 올 확률 높은 때 기준
  var rainRAF = null, drops = [], rainLevel = 0;
  function rainIntensity() {
    var date = DAYS[selDay].d.date, now = tokyoNow(), x;
    if (date === now.date) x = wxRange(date, now.min, now.min + 60);
    else { var d = dayWx(date); x = d && { pp: d.pp, pr: d.pr / 4 }; }
    if (!x) return 0;
    var lv = Math.max(x.pp >= 50 ? (x.pp - 40) / 60 : 0, Math.min(1, x.pr / 3));
    return Math.max(0, Math.min(1, lv));
  }
  function drawRainFor() {
    rainLevel = rainIntensity();
    var cv = $('rain'), ctx = cv.getContext('2d');
    cancelAnimationFrame(rainRAF);
    if (rainLevel <= 0.03) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    var n = Math.round(40 + 180 * rainLevel);
    drops = [];
    for (var i = 0; i < n; i++) drops.push({ x: Math.random() * cv.width, y: Math.random() * cv.height, l: (10 + Math.random() * 16) * dpr, v: (9 + Math.random() * 9) * dpr });
    var col = isDark() ? 'rgba(160,190,255,' : 'rgba(40,80,160,';
    if (REDUCED) { // 움직임 줄이기: 정지된 빗줄기만
      ctx.clearRect(0, 0, cv.width, cv.height); ctx.strokeStyle = col + '0.25)'; ctx.lineWidth = dpr;
      drops.forEach(function (d) { ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.25, d.y + d.l); ctx.stroke(); });
      return;
    }
    var last = 0;
    function frame(ts) {
      rainRAF = requestAnimationFrame(frame);
      if (ts - last < 33 || document.visibilityState !== 'visible') return; // 30fps, 화면 꺼지면 쉼
      last = ts;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = col + (0.25 + 0.2 * rainLevel) + ')'; ctx.lineWidth = dpr; ctx.beginPath();
      drops.forEach(function (d) {
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.25, d.y + d.l);
        d.y += d.v; d.x -= d.v * 0.25;
        if (d.y > cv.height) { d.y = -d.l; d.x = Math.random() * cv.width * 1.2; }
      });
      ctx.stroke();
    }
    rainRAF = requestAnimationFrame(frame);
  }
  window.addEventListener('resize', function () { drawRainFor(); });

  // ------------------------------------------------------------ 지도
  var map = L.map('map', { zoomControl: false, attributionControl: true, tap: true }).setView([33.59, 130.41], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  map.attributionControl.setPrefix(false);

  var selDay = 0, cur = null, gps = null, follow = false, lastState = null;
  var lineLayers = [], pinLayers = {}, stopLayer = L.layerGroup().addTo(map);

  function isDark() { return document.documentElement.dataset.theme === 'dark'; }
  function styleFor(e, state) {
    var m = MODE[e.step.mode];
    var col = m.c.indexOf('var(') === 0 ? getComputedStyle(document.documentElement).getPropertyValue('--walk').trim() : m.c;
    if (state === 'dim') return { color: col, weight: 3, opacity: 0.22, dashArray: m.dash || null };
    if (state === 'cur') return { color: col, weight: 9, opacity: 1, dashArray: m.dash ? '1 12' : null, lineCap: 'round' };
    return { color: col, weight: 5, opacity: 0.9, dashArray: m.dash || null, lineCap: 'round' };
  }
  function drawLines() {
    lineLayers.forEach(function (l) { l.forEach(function (x) { map.removeLayer(x); }); });
    lineLayers = [];
    var order = [];
    DAYS.forEach(function (D, di) { if (di !== selDay) D.list.forEach(function (e) { if (e.type === 'move') order.push([e, 'dim']); }); });
    DAYS[selDay].list.forEach(function (e) { if (e.type === 'move' && e !== cur) order.push([e, 'day']); });
    if (cur && cur.type === 'move' && cur.day === selDay) order.push([cur, 'cur']);
    order.forEach(function (o) {
      var e = o[0], st = styleFor(e, o[1]), lines = [];
      if (o[1] !== 'dim') lines.push(L.polyline(e.step.geom, { color: isDark() ? '#0b0d10' : '#ffffff', weight: st.weight + 4, opacity: e.step.mode === 'walk' ? 0 : 0.85, interactive: false }).addTo(map));
      lines.push(L.polyline(e.step.geom, Object.assign({ interactive: false }, st)).addTo(map));
      var hit = L.polyline(e.step.geom, { weight: 24, opacity: 0, interactive: true }).addTo(map);
      hit.on('click', function () { openSheet(e); });
      lines.push(hit);
      lineLayers.push(lines);
    });
  }
  function pinIcon(cat, cls) {
    var c = CAT[cat] || CAT.food;
    return L.divIcon({ className: 'pin ' + (cls || ''), iconSize: [40, 40], iconAnchor: [18, 40], html: '<div class="b" style="background:' + c.c + '"><span>' + c.icon + '</span></div>' });
  }
  function drawPins() {
    Object.keys(pinLayers).forEach(function (k) { map.removeLayer(pinLayers[k]); });
    pinLayers = {}; stopLayer.clearLayers();
    var used = {};
    DAYS[selDay].list.forEach(function (e) {
      if (e.type === 'place') used[e.step.pt] = true;
      if (e.type === 'move') { used[e.step.from_pt] = true; used[e.step.to_pt] = true; }
    });
    var seen = {};
    DAYS[selDay].list.concat([].concat.apply([], DAYS.map(function (D) { return D.list; }))).forEach(function (e) {
      if (e.type !== 'place' || seen[e.step.pt]) return;
      seen[e.step.pt] = true;
      var isCur = cur && cur.type === 'place' && cur.step.pt === e.step.pt && cur.day === selDay;
      var cls = (used[e.step.pt] ? '' : 'dim') + (isCur ? ' cur' : '') + (isDone(e) ? ' done' : '');
      var mk = L.marker([e.step.lat, e.step.lon], { icon: pinIcon(e.step.category, cls), zIndexOffset: used[e.step.pt] ? 500 : 0, keyboard: false }).addTo(map);
      mk.on('click', function () { snapZoom([e.step.lat, e.step.lon]); openSheet(e); });
      pinLayers[e.step.pt] = mk;
    });
    var stops = {};
    DAYS[selDay].list.forEach(function (e) {
      if (e.type !== 'move' || e.step.mode === 'flight') return;
      [['from_pt', 'a', 'from'], ['to_pt', 'b', 'to']].forEach(function (k) {
        var pt = e.step[k[0]];
        if (seen[pt] || stops[pt]) return;
        stops[pt] = true;
        var col = MODE[e.step.mode].c.indexOf('var(') === 0 ? '#777' : MODE[e.step.mode].c;
        var m = L.marker(e.step[k[1]], { icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: '<div class="stop" style="border-color:' + col + '"></div>' }), zIndexOffset: 300 })
          .bindTooltip(e.step[k[2]], { className: 'lbl', direction: 'top', offset: [0, -8] });
        m.on('click', function () { snapZoom(e.step[k[1]]); openSheet(e); });
        stopLayer.addLayer(m);
      });
    });
  }
  function regionOf(e) { // 장소 없는 할 일은 앞(없으면 뒤) 항목의 나라
    var list = DAYS[e.day].list, i, p;
    for (i = e.idx; i >= 0; i--) if (list[i].step && list[i].step.mode !== 'flight' && (p = entryPoint(list[i], 'end'))) return isKorea(p);
    for (i = e.idx; i < list.length; i++) if (list[i].step && list[i].step.mode !== 'flight' && (p = entryPoint(list[i], 'start'))) return isKorea(p);
    return false;
  }
  function dayBounds(di) { // 그날 한국·일본 중 지금 있는 쪽(아니면 일본)만 맞춤
    var b = L.latLngBounds([]), kr = cur && cur.day === di ? regionOf(cur) : false;
    DAYS[di].list.forEach(function (e) {
      var p = e.step && e.step.mode !== 'flight' ? entryPoint(e, 'start') : null;
      if (p && isKorea(p) !== kr) return;
      if (e.type === 'move' && e.step.mode !== 'flight') e.step.geom.forEach(function (p) { b.extend(p); });
      if (e.type === 'place') b.extend([e.step.lat, e.step.lon]);
    });
    return b;
  }
  function dockH() { return window.innerHeight - $('quest').getBoundingClientRect().top; }
  function fitDay(di) { var b = dayBounds(di); if (b.isValid()) map.fitBounds(b, { paddingTopLeft: [20, 90], paddingBottomRight: [20, dockH() + 20], maxZoom: 16 }); }

  // ------------------------------------------------------------ 연출: 휩 팬 · 스냅 줌 · 펀치 인 · 스피드 램핑
  var whipT = null;
  function whipTo(latlng, zoom) { // 새 퀘스트로 카메라가 확 쏠림
    if (!latlng) return;
    if (REDUCED) { map.setView(latlng, zoom || map.getZoom()); return; }
    var el = $('map'); el.classList.add('whip');
    clearTimeout(whipT);
    map.flyTo(latlng, zoom || Math.max(map.getZoom(), 15), { duration: 0.45, easeLinearity: 0.05 });
    whipT = setTimeout(function () { el.classList.remove('whip'); }, 480);
  }
  function whipCard() { var q = $('quest'); q.classList.remove('whip-in'); void q.offsetWidth; q.classList.add('whip-in'); }
  function banner(text) {
    var b = $('banner'); $('bannerText').textContent = text;
    b.classList.remove('go'); void b.offsetWidth; b.classList.add('go');
  }
  function snapZoom(latlng) { // 한 프레임 만에 확 당김
    map.setView(latlng, Math.max(map.getZoom() + 2, 17), { animate: false });
    if (REDUCED) return;
    var f = $('flash'), m = $('map');
    f.classList.remove('on'); m.classList.remove('snap'); void f.offsetWidth; f.classList.add('on'); m.classList.add('snap');
  }
  var punchT = null;
  function punchIn(e) { // 줌인 과정 없이 바로 찍히는 도장(기도터) / 하트
    var p = $('punch'), l = dayLabel(DAYS[e.day].d.date);
    $('punchMark').innerHTML = qtype(e) === 'main'
      ? '<div class="big-stamp"><div class="k">参拝</div><div class="n">' + esc(e.step.name) + '</div><div class="d">2026 · ' + l.md + '</div></div>'
      : '<svg class="big-heart" viewBox="0 0 24 24" width="46vw" height="46vw"><path fill="currentColor" d="M12 21s-7.6-4.7-9.7-9.3C.8 8.3 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 6 3.8 4.5 7.2C19.6 16.3 12 21 12 21z"/></svg>';
    clearTimeout(punchT); p.classList.remove('out'); p.classList.add('on');
    punchT = setTimeout(function () { p.classList.add('out'); p.classList.remove('on'); }, 30);
  }
  // 천천히 가속 → 한순간 확 → 스르륵 멈춤
  function ramp(t) {
    if (t < 0.55) return 0.22 * Math.pow(t / 0.55, 2);
    if (t < 0.7) return 0.22 + 0.63 * ((t - 0.55) / 0.15);
    var u = (t - 0.7) / 0.3; return 0.85 + 0.15 * (1 - Math.pow(1 - u, 3));
  }
  var runner = null, runRAF = null;
  function runRoute(e) {
    var pts = [].concat.apply([], e.step.geom); if (pts.length < 2) return;
    var cum = [0]; for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
    var total = cum[cum.length - 1];
    map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [30, 100], paddingBottomRight: [30, dockH() + 30], maxZoom: 16, animate: !REDUCED });
    if (runner) map.removeLayer(runner);
    runner = L.marker(pts[0], { icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], html: '<div class="runner"></div>' }), interactive: false, zIndexOffset: 1500 }).addTo(map);
    cancelAnimationFrame(runRAF);
    var t0 = null, dur = REDUCED ? 1 : 2400;
    function step(ts) {
      if (t0 == null) t0 = ts;
      var t = Math.min(1, (ts - t0) / dur), d = ramp(t) * total, j = 1;
      while (j < cum.length - 1 && cum[j] < d) j++;
      var seg = cum[j] - cum[j - 1] || 1, f = (d - cum[j - 1]) / seg;
      runner.setLatLng([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f]);
      if (t < 1) runRAF = requestAnimationFrame(step); else setTimeout(function () { if (runner) { map.removeLayer(runner); runner = null; } }, 900);
    }
    setTimeout(function () { runRAF = requestAnimationFrame(step); }, REDUCED ? 0 : 420);
  }
  // 챕터 인트로 (2.5D 퍼스펙티브 틸트)
  var introT = null;
  function showIntro(di) {
    var d = DAYS[di].d, l = dayLabel(d.date), it = $('intro');
    $('introNum').textContent = (di + 1) + '일차 · ' + l.md + ' (' + l.wd + ')';
    $('introTitle').textContent = d.theme;
    $('introSub').innerHTML = wxLine(d.date);
    $('introSlots').innerHTML = DAYS[di].list.filter(function (e) { return qtype(e) === 'main'; }).map(function (e) { return '<span>' + esc(e.step.name) + '</span>'; }).join('');
    it.classList.remove('hide'); it.classList.add('show'); it.setAttribute('aria-hidden', 'false');
    clearTimeout(introT); introT = setTimeout(hideIntro, 2600);
  }
  function hideIntro() { var it = $('intro'); if (!it.classList.contains('show')) return; it.classList.add('hide'); it.classList.remove('show'); it.setAttribute('aria-hidden', 'true'); }
  $('intro').addEventListener('click', hideIntro);

  // ------------------------------------------------------------ HUD · 하단 챕터 탭
  function stampCount() {
    var all = 0, done = 0;
    DAYS.forEach(function (D) { D.list.forEach(function (e) { if (qtype(e) === 'main') { all++; if (isDone(e)) done++; } }); });
    return { all: all, done: done };
  }
  function renderHud() {
    var d = DAYS[selDay].d, l = dayLabel(d.date);
    $('chap').textContent = (selDay + 1) + '일차';
    $('dayTitle').textContent = d.theme;
    $('dayMeta').innerHTML = l.md + ' (' + l.wd + ') · ' + wxLine(d.date);
    var dots = [];
    DAYS.forEach(function (D) { D.list.forEach(function (e) { if (qtype(e) === 'main') dots.push('<span class="stamp-dot' + (isDone(e) ? ' on' : '') + '" title="' + esc(e.step.name) + '">印</span>'); }); });
    $('stamps').innerHTML = dots.join('');
    var list = DAYS[selDay].list.filter(function (e) { return e.type !== 'task'; });
    var dn = list.filter(isDone).length, pct = list.length ? Math.round(dn / list.length * 100) : 0;
    $('xpFill').style.width = pct + '%';
    $('xpText').textContent = '오늘 ' + dn + '/' + list.length;
  }
  function drawDock() {
    var today = tokyoNow().date;
    $('dock').innerHTML = DAYS.map(function (D, i) {
      var l = dayLabel(D.d.date);
      return '<button role="tab" data-i="' + i + '" aria-selected="' + (i === selDay) + '"><b>' + (i + 1) + '일차</b><small>' + l.md + ' ' + l.wd + '</small>' + (D.d.date === today ? '<i class="today"></i>' : '') + '</button>';
    }).join('') + '<button class="menu-btn" data-menu="1" aria-label="메뉴"><svg class="ic"><use href="#i-menu"/></svg><small>메뉴</small></button>';
  }
  $('dock').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.menu) return openMenu('log');
    var i = +b.dataset.i;
    selectDay(i, true);
    showIntro(i);
  });
  function selectDay(i, fit) {
    selDay = i; drawDock(); drawLines(); drawPins(); renderHud(); drawRainFor();
    if (lastState) renderQuest(lastState);
    if (fit) fitDay(i);
  }

  // ------------------------------------------------------------ 지금 퀘스트 판단
  function tripDayIndex(date) { for (var i = 0; i < DAYS.length; i++) if (DAYS[i].d.date === date) return i; return -1; }
  function distToEntry(p, e) {
    if (e.type === 'move') return e.step.mode === 'flight' ? Infinity : project(p, e.step.geom).d;
    if (e.type === 'place') return Math.max(0, hav(p, [e.step.lat, e.step.lon]) - e.step.radius);
    return Infinity;
  }
  function isKorea(p) { return p[1] < 128; }
  function inArea(p) { // 후쿠오카 또는 인천공항~소새울 (한국 쪽 이동)
    return (p[0] > 33.3 && p[0] < 33.95 && p[1] > 130.0 && p[1] < 130.8) || (p[0] > 37.35 && p[0] < 37.7 && p[1] > 126.3 && p[1] < 126.95);
  }
  function computeCurrent() {
    var now = tokyoNow(), di = tripDayIndex(now.date);
    if (di < 0) return { di: di, now: now, e: null };
    var list = DAYS[di].list, t = now.min, byTime = null;
    for (var i = 0; i < list.length; i++) if (list[i].start <= t && t < list[i].end) byTime = list[i];
    if (!byTime) byTime = list.find(function (e) { return e.start > t; }) || list[list.length - 1];
    var best = byTime;
    // 위치가 있으면 거리+시각 점수로 (100m = 1점, 앞뒤 15분 여유 밖 10분 = 1점), 비슷하면 시각 기준 우선
    // 입국 수속·탑승 수속 같은 할 일은 장소가 없으니 시각이 우선 (GPS로 옆 구간에 뺏기지 않게)
    if (gps && byTime.type !== 'task' && gps.acc < 500 && inArea([gps.lat, gps.lon])) {
      var p = [gps.lat, gps.lon], bs = Infinity;
      list.forEach(function (e) {
        var d = distToEntry(p, e); if (!isFinite(d)) return;
        var gap = t < e.start - 15 ? e.start - 15 - t : t > e.end + 15 ? t - e.end - 15 : 0;
        var raw = t < e.start ? e.start - t : t > e.end ? t - e.end : 0;
        var s = d / 100 + gap / 10 + raw / 100 - (e === byTime ? 0.5 : 0);
        if (s < bs) { bs = s; best = e; }
      });
      if (bs > 12) best = byTime;
      // GPS로 앞으로 건너뛸 땐 그 사이 안 끝낸 할 일(입국심사·세관 등)부터 — 장소 없는 할 일은 GPS로 못 잡으니 건너뛰면 안 됨
      if (best.idx > byTime.idx) for (var j = byTime.idx + 1; j < best.idx; j++) if (list[j].type === 'task' && !P.done[list[j].key]) { best = list[j]; break; }
      if (best.type === 'move' && best.step.mode !== 'flight' && list[best.idx + 1]) {
        var pr = project(p, best.step.geom);
        if (pr.d < 80 && pr.remain < 50) best = list[best.idx + 1];
      }
    }
    // 이미 완료한 퀘스트면 곧 시작할 다음 퀘스트로 (90분 이내)
    while (P.done[best.key] && list[best.idx + 1] && list[best.idx + 1].start - t < 90) best = list[best.idx + 1];
    return { di: di, now: now, e: best, waiting: t < best.start };
  }

  // ------------------------------------------------------------ 퀘스트 카드
  function renderQuest(st) {
    var now = st.now, e = st.e;
    if (st.di < 0) {
      var first = DAYS[0].d.date, before = now.date < first;
      var dd = Math.round((new Date(first + 'T00:00:00+09:00') - new Date(now.date + 'T00:00:00+09:00')) / 86400000);
      setQType(before ? 'task' : 'rest'); $('qStamp').className = 'slot hide'; $('qTimer').classList.remove('late');
      $('qType').textContent = before ? '출발 전' : '여행 끝';
      $('qTimer').textContent = before ? 'D-' + dd : '';
      $('qTitle').textContent = before ? '준비물부터 챙겨요' : '수고하셨습니다';
      $('qObjs').innerHTML = before ? G.packing[0].items.slice(0, 3).map(function (x, i) { return objLi(x, !!P.pack['0.' + i], 'pack', '0.' + i); }).join('') : '';
      $('qReward').textContent = before ? '첫 일정 ' + dayLabel(first).md + ' ' + fmtTime(DAYS[0].list[0].start) + ' ' + entryTitle(DAYS[0].list[0]) : '';
      $('qDist').textContent = ''; $('qNext').textContent = '';
      $('qDone').textContent = before ? '준비물 보기' : '일정 보기'; $('qDone').classList.remove('done'); $('qDetail').textContent = '일정';
      $('qDone').onclick = function () { openMenu(before ? 'bag' : 'log'); };
      $('qDetail').onclick = function () { openMenu('log'); };
      $('qCoin').textContent = ''; $('qGate').textContent = '';
      setOrb(before ? 'shaping' : 'breathing');
      return;
    }
    var list = DAYS[st.di].list, next = list[e.idx + 1], qt = qtype(e), done = isDone(e);
    setQType(qt);
    $('qType').innerHTML = esc(QTYPE[qt].tag) + (e.type === 'place' && e.step.quest && e.step.quest.optional ? ' · 선택' : '') + (e.type === 'move' ? ' ' + modeChip(e) + ' ' + payChip(e) : '');
    var slot = $('qStamp');
    slot.className = 'slot' + (qt === 'main' ? (done ? ' on' : '') : ' hide');
    slot.textContent = done ? '参拝' : '印';
    setOrb(qt === 'main' ? null : st.waiting ? 'breathing' : ORB[qt]);
    $('qTimer').classList.toggle('late', !done && !st.waiting && now.min > e.end);
    $('qTimer').textContent = done ? '완료함' : st.waiting ? fmtMin(e.start - now.min) + ' 뒤 시작'
      : now.min > e.end ? '⚠ 예정보다 ' + fmtMin(now.min - e.end) + ' 늦음' : entryTime(e) + ' · ' + fmtMin(e.end - now.min) + ' 남음';
    $('qTitle').textContent = entryTitle(e, true);
    var ob = objectives(e); // 카드엔 3개까지, 나머지는 상세에서
    $('qObjs').innerHTML = ob.slice(0, 3).map(function (o, i) { return objLi(o, !!(P.obj[e.key] || [])[i], 'obj', e.key + '#' + i); }).join('') +
      (ob.length > 3 ? '<li class="more">할 일 ' + (ob.length - 3) + '개 더 보기</li>' : '');
    var ct = coinTip(e); $('qCoin').textContent = ct ? '🪙 ' + ct : '';
    var gt = gateTip(e); if (!gt && e.type === 'move' && e.step.mode === 'walk' && next && next.type === 'move') { gt = gateTip(next); if (gt) gt = '다음 ' + MODE[next.step.mode].label + ' · ' + gt; }
    $('qGate').textContent = gt;
    var q = e.type === 'place' && e.step.quest;
    $('qReward').textContent = q && qt === 'main' ? '기도 · ' + q.reward : e.type === 'move' && e.step.line ? e.step.line : '';
    $('qReward').style.color = q && qt === 'main' ? '' : 'var(--ink2)';
    // 남은 거리·시간
    var here = gps && inArea([gps.lat, gps.lon]) ? [gps.lat, gps.lon] : null, txt = '';
    if (e.type === 'move' && !st.waiting && e.step.mode !== 'flight') {
      var rem = here ? project(here, e.step.geom) : null;
      var dist = rem && rem.d < 300 ? rem.remain : here ? hav(here, e.step.b) : e.step.dist_m;
      txt = esc(e.step.to) + '까지 <b>' + fmtDist(dist) + '</b> · ' + fmtTime(e.end) + ' 도착 예정';
    } else {
      var target = st.waiting ? e : next, tp = target ? entryPoint(target, 'start') : null, from = here || entryPoint(e, 'end');
      if (target && tp) {
        var d2 = from ? hav(from, tp) : null, name = target.type === 'move' ? target.step.from : target.step.name;
        txt = (d2 != null && d2 > 30 ? esc(name) + '까지 <b>' + fmtDist(d2) + '</b> · ' : '') + fmtTime(target.start) + ' 출발까지 <b>' + fmtMin(Math.max(0, target.start - now.min)) + '</b>';
      }
    }
    if (!gps && txt) txt += ' · <span style="opacity:.75">GPS 꺼짐</span>';
    var wr = wxRange(DAYS[st.di].d.date, e.start, e.end);
    if (wr && (wr.pp >= 40 || wr.pr >= 0.2)) txt = '<span class="rain">☔ 이 시간 비 ' + wr.pp + '%' + (wr.pr ? ' · ' + wr.pr.toFixed(1) + 'mm' : '') + '</span> · ' + txt;
    $('qDist').innerHTML = txt;
    $('qNext').innerHTML = next ? '<span class="lb">다음</span><span class="tm">' + fmtTime(next.start) + '</span>' + modeChip(next) + '<span class="nm">' + esc(entryTitle(next, true)) + '</span>'
      : '<span class="lb">다음</span><span class="nm">' + (st.di + 1 < DAYS.length ? '내일 ' + esc(DAYS[st.di + 1].d.theme) : '여행 마지막 일정') + '</span>';
    $('qDone').textContent = done ? '✓ 완료함 (취소)' : qt === 'main' ? '참배 완료' : e.type === 'move' ? '도착' : '완료';
    $('qDone').classList.toggle('done', done);
    $('qDone').onclick = function () { toggleDone(e); };
    var isQR = e.type === 'task' && /QR/.test(e.text);
    $('qDetail').textContent = isQR ? '입국 QR 보기' : '자세히';
    $('qDetail').onclick = function () { if (isQR) openQR(); else openSheet(e); };
  }
  // 지금 상태 구슬 (thinking-orbs): 이동 = 궤도, 수속 = 맞춰지는 큐브, 들를 곳 = 물결 띠, 쉬기·기다림 = 숨쉬는 고리. 기도터는 도장 자리라 없음
  var ORB = { travel: 'working', task: 'solving', side: 'composing', rest: 'breathing' };
  function setOrb(state) { $('qOrb').classList.toggle('hide', !state); if (window.Orb) Orb.set($('qOrb'), state, 64); }
  function setQType(qt) { $('quest').style.setProperty('--qc', QTYPE[qt].c); }
  function objLi(text, on, kind, id) { return '<li class="' + (on ? 'on' : '') + '" data-kind="' + kind + '" data-id="' + esc(id) + '"><span class="box">' + (on ? '✓' : '') + '</span><span>' + esc(text) + '</span></li>'; }
  function toggleObj(kind, id) {
    if (kind === 'pack') { P.pack[id] = !P.pack[id]; }
    else { var k = id.split('#'), i = +k[1]; var a = P.obj[k[0]] || []; a[i] = !a[i]; P.obj[k[0]] = a; }
    save();
  }
  $('qObjs').addEventListener('click', function (ev) {
    var li = ev.target.closest('li'); if (!li) return;
    if (li.classList.contains('more')) return lastState && lastState.e && openSheet(lastState.e);
    toggleObj(li.dataset.kind, li.dataset.id); update(false);
  });
  function toggleDone(e) {
    var was = !!P.done[e.key];
    P.done[e.key] = !was; save();
    if (!was) punchIn(e);
    update(false);
    drawPins(); renderHud();
  }
  // 카드 2.5D 기울기 (손가락 따라)
  (function () {
    var q = $('quest').querySelector('.q-inner');
    function tilt(x, y) { var r = q.getBoundingClientRect(); q.style.setProperty('--ty', ((x - r.left) / r.width - 0.5) * 10 + 'deg'); q.style.setProperty('--tx', (3 - ((y - r.top) / r.height - 0.5) * 8) + 'deg'); }
    q.addEventListener('touchmove', function (e) { if (!REDUCED) tilt(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    q.addEventListener('pointermove', function (e) { if (!REDUCED && e.pointerType === 'mouse') tilt(e.clientX, e.clientY); });
    function reset() { q.style.removeProperty('--tx'); q.style.removeProperty('--ty'); }
    q.addEventListener('touchend', reset); q.addEventListener('pointerleave', reset);
  })();
  // 카드 접기 (9/30 요청): 아래로 밀면 제목 한 줄만 남기고 지도를 비움, 위로 밀거나 접힌 카드를 톡 누르면 다시 펼침
  (function () {
    var q = $('quest'), y0 = null, x0 = 0, moved = false;
    function setMin(on) { q.classList.toggle('min', on); try { localStorage.setItem('fk-qmin', on ? '1' : ''); } catch (e) {} }
    try { if (localStorage.getItem('fk-qmin')) q.classList.add('min'); } catch (e) {}
    q.addEventListener('pointerdown', function (e) { y0 = e.clientY; x0 = e.clientX; moved = false; });
    q.addEventListener('pointermove', function (e) { if (y0 != null && Math.abs(e.clientY - y0) > 10) moved = true; });
    q.addEventListener('pointerup', function (e) {
      if (y0 == null) return;
      var dy = e.clientY - y0, dx = e.clientX - x0; y0 = null;
      if (Math.abs(dy) >= 40 && Math.abs(dy) > Math.abs(dx)) setMin(dy > 0);
    });
    q.addEventListener('pointercancel', function () { y0 = null; });
    q.addEventListener('click', function (e) { // 민 뒤의 클릭, 접힌 카드의 클릭은 안쪽 버튼·체크칸으로 안 보냄
      if (moved || q.classList.contains('min')) { e.stopPropagation(); e.preventDefault(); if (!moved) setMin(false); moved = false; }
    }, true);
  })();

  // ------------------------------------------------------------ 갱신 루프
  var lastKey = null;
  function update(refit) {
    var st = computeCurrent();
    lastState = st;
    var prev = cur; cur = st.e;
    if (refit && st.di >= 0 && st.di !== selDay) selectDay(st.di, false);
    if (prev !== cur) { drawLines(); drawPins(); }
    renderQuest(st); renderHud();
    $('bQR').style.display = qrNeeded(st.now) ? '' : 'none';
    var key = cur ? cur.key : null;
    if (key !== lastKey) {
      if (lastKey !== null && cur) { banner(entryTitle(cur, true)); whipCard(); if (cur.day === selDay && !follow) whipTo(entryPoint(cur, 'start')); }
      lastKey = key;
    }
    checkOffRoute(st);
    checkAlerts(st);
  }

  // ------------------------------------------------------------ 상세 시트
  var sheetEntry = null;
  function gmapsUrl(e) {
    var s = e.step, u = 'https://www.google.com/maps/dir/?api=1';
    if (e.type === 'place') return u + '&destination=' + s.lat + ',' + s.lon;
    var m = MODE[s.mode];
    return u + '&origin=' + s.a[0] + ',' + s.a[1] + '&destination=' + s.b[0] + ',' + s.b[1] + (m.gm ? '&travelmode=' + m.gm : '');
  }
  function sec(cls, title, items, raw) {
    if (!items || !items.length) return '';
    return '<div class="sh-h ' + cls + '">' + title + '</div><ul class="' + (raw ? 'obj-list' : 'sh-list') + '">' + items.join('') + '</ul>';
  }
  function openSheet(e) {
    if (!e) return;
    sheetEntry = e;
    var h = '', s = e.step, qt = qtype(e), done = isDone(e);
    var objs = objectives(e).map(function (o, i) { return objLi(o, !!(P.obj[e.key] || [])[i], 'obj', e.key + '#' + i); });
    h += '<span class="sh-kind" style="color:' + QTYPE[qt].c + '">' + QTYPE[qt].tag + (done ? ' · 완료' : '') + '</span> ' + modeChip(e);
    if (e.type === 'task') {
      h += '<div class="sh-title">' + esc(e.text) + '</div><div class="sh-time">' + entryTime(e) + '</div>';
      if (/QR/.test(e.text)) h += '<div class="sh-actions"><button data-qr="1" class="wide">입국 QR 보기</button></div>';
    } else if (e.type === 'place') {
      var c = CAT[s.category] || CAT.food, q = s.quest || {};
      var kr = isKorea([s.lat, s.lon]); // 한국 장소엔 일본어 이름·복사 없음
      h += '<div class="sh-title">' + esc(s.name) + '</div>' + (kr ? '' : '<div class="sh-ja" lang="ja">' + esc(s.name_ja) + '</div>');
      h += '<div class="sh-time">' + entryTime(e) + '</div>';
      h += wxSec(e);
      if (q.reward && qt === 'main') h += '<div class="sh-h">기도 제목</div><div class="sh-pray">' + esc(q.reward) + '</div>';
      h += sec('', '할 일', objs, true);
      if (coinTip(e)) h += sec('', '🪙 지갑', ['<li>' + esc(coinTip(e)) + '</li>']);
      h += sec('teacher', '진홍 선생님', (s.teacher || []).map(function (n) { return '<li>' + esc(n) + '</li>'; }));
      h += sec('warn', '주의할 것', (q.cautions || []).map(function (n) { return '<li>' + esc(n) + '</li>'; }));
      h += '<dl class="sh-grid">';
      if (s.address) h += '<dt>주소</dt><dd lang="ja">' + esc(s.address) + '</dd>';
      if (s.cost_jpy) h += '<dt>예상 비용</dt><dd>' + yen(s.cost_jpy) + ' <span style="color:var(--sub)">≈ ' + won(s.cost_jpy) + '</span>' + (s.cost_est ? '<span class="badge">추정</span>' : '') + '</dd>';
      h += '</dl>';
      if (s.notes.length) h += '<ul class="sh-notes">' + s.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
      h += '<div class="sh-actions"><button data-done="1">' + (done ? '완료 취소' : qt === 'main' ? '참배 완료' : '완료') + '</button>' + (kr ? '' : '<button data-copy="' + esc(s.name_ja) + '">일본어 이름 복사</button>') +
        (s.address ? '<button data-copy="' + esc(s.address) + '">주소 복사</button>' : '') + '<button data-fly="1">지도에서 보기</button><button data-exp="1">지출 기록</button>' +
        '<a class="primary wide" href="' + gmapsUrl(e) + '" target="_blank" rel="noopener">구글 지도 길찾기</a></div>';
      h += '<div class="sh-src">위치: ' + esc(s.coord_src) + '</div>';
    } else {
      var m = MODE[s.mode];
      h += '<div class="sh-title">' + esc(s.from) + ' → ' + esc(s.to) + '</div>';
      if (s.to_ja) h += '<div class="sh-ja" lang="ja">' + esc(s.from_ja || '') + ' → ' + esc(s.to_ja) + '</div>';
      h += '<div class="sh-time">' + s.dep + ' 출발 → ' + s.arr + ' 도착 <span style="font-weight:500;color:var(--sub)">(' + fmtMin(e.end - e.start) + ')</span>' + (s.est || s.est_time ? '<span class="badge">시각 추정</span>' : '') + '</div>';
      h += sec('', '할 일', objs, true);
      if (coinTip(e)) h += sec('', '🪙 지갑', ['<li>' + esc(coinTip(e)) + '</li>']);
      h += '<dl class="sh-grid">';
      if (s.line) h += '<dt>노선</dt><dd lang="ja">' + esc(s.line) + '</dd>';
      if (s.pay) h += '<dt>결제</dt><dd>' + payChip(e) + ' ' + (s.pay === 'card' ? esc(G.payment.card) + ' 터치' : s.pay === 'cash' ? '현금' : '무료') + '</dd>';
      if (s.fare_jpy != null) h += '<dt>운임</dt><dd>' + (s.fare_jpy ? yen(s.fare_jpy) + ' <span style="color:var(--sub)">≈ ' + won(s.fare_jpy) + '</span>' : '무료') + (s.est_fare ? '<span class="badge">운임 추정</span>' : '') + '</dd>';
      if (s.mode !== 'flight') h += '<dt>거리</dt><dd>' + fmtDist(s.dist_m) + ' (지도 경로)</dd>';
      if (s.note) h += '<dt>메모</dt><dd>' + esc(s.note) + '</dd>';
      h += '</dl>';
      h += '<div class="sh-actions">' + (s.mode !== 'flight' ? '<button data-run="1">경로 미리보기</button>' : '') + (s.to_ja ? '<button data-copy="' + esc(s.to_ja) + '">' + esc(s.to_ja) + ' 복사</button>' : '') +
        '<button data-done="1">' + (done ? '도착 취소' : '도착') + '</button>' + (s.mode !== 'flight' ? '<button data-exp="1">운임 기록</button>' : '') +
        (m.gm ? '<a class="primary wide" href="' + gmapsUrl(e) + '" target="_blank" rel="noopener">구글 지도 길찾기 (' + (m.gm === 'walking' ? '도보' : '대중교통') + ')</a>' : '') + '</div>';
      h += '<div class="sh-src">출처: ' + esc(s.source || (s.est || s.est_time ? '추정 (엑셀 파란 글씨)' : '엑셀 일정')) + '</div>';
    }
    $('sheetBody').innerHTML = h; $('sheetBody').scrollTop = 0;
    var list = DAYS[e.day].list;
    $('sPos').textContent = (e.idx > 0 ? '‹ ' : '') + (e.idx + 1) + ' / ' + list.length + (e.idx < list.length - 1 ? ' ›' : '') + ' · 좌우로 밀어 이전·다음';
    closeMenu(true);
    $('sheet').classList.add('show'); $('sheet').setAttribute('aria-hidden', 'false'); $('scrim').classList.add('show');
    if (e.day !== selDay) selectDay(e.day, false);
  }
  function closeSheet() { $('sheet').classList.remove('show'); $('sheet').setAttribute('aria-hidden', 'true'); if (!$('menu').classList.contains('show')) $('scrim').classList.remove('show'); }
  function flyTo(e) {
    closeSheet();
    if (e.type === 'place') whipTo([e.step.lat, e.step.lon], 17);
    else if (e.type === 'move') map.flyToBounds(L.latLngBounds([].concat.apply([], e.step.geom)), { paddingTopLeft: [30, 100], paddingBottomRight: [30, dockH() + 30], maxZoom: 17 });
  }
  $('scrim').addEventListener('click', function () { closeSheet(); closeMenu(); closeExp(); });
  $('sClose').addEventListener('click', closeSheet);
  function stepSheet(dir) {
    if (!sheetEntry) return;
    var n = DAYS[sheetEntry.day].list[sheetEntry.idx + dir]; if (!n) return;
    openSheet(n); var p = entryPoint(n, 'start'); if (p) whipTo(p);
    var b = $('sheetBody'); b.classList.remove('slide-l', 'slide-r'); void b.offsetWidth; b.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
  }
  $('sheetBody').addEventListener('click', function (ev) {
    var li = ev.target.closest('li[data-kind]');
    if (li) { toggleObj(li.dataset.kind, li.dataset.id); openSheet(sheetEntry); update(false); return; }
    var b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.qr) { closeSheet(); return openQR(); }
    if (b.dataset.exp) return openExp(expPrefill(sheetEntry, true));
    if (b.dataset.fly) return flyTo(sheetEntry);
    if (b.dataset.run) { closeSheet(); return runRoute(sheetEntry); }
    if (b.dataset.done) { toggleDone(sheetEntry); return openSheet(sheetEntry); }
    if (b.dataset.copy != null) copy(b.dataset.copy, b);
  });
  (function () { // 시트 아래로 끌어내리기
    [['sheet', 'sheetBody', closeSheet], ['menu', 'menuBody', function () { closeMenu(); }]].forEach(function (c) {
      var y0 = null, x0 = null, sy = null, sh = $(c[0]);
      sh.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; sy = e.touches[0].clientY; y0 = $(c[1]).scrollTop <= 0 ? sy : null; }, { passive: true });
      sh.addEventListener('touchmove', function (e) { if (y0 != null) { var dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0; if (dy > 0 && dy > Math.abs(dx)) sh.style.transform = 'translateY(' + dy + 'px)'; } }, { passive: true });
      sh.addEventListener('touchend', function (e) {
        var t = e.changedTouches[0], dx = x0 == null ? 0 : t.clientX - x0, dys = sy == null ? 0 : t.clientY - sy;
        sh.style.transform = '';
        if (c[0] === 'sheet' && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dys) * 1.5) { y0 = x0 = null; return stepSheet(dx < 0 ? 1 : -1); } // 왼쪽으로 밀면 다음, 오른쪽으로 밀면 이전
        if (y0 == null) return; var dy = t.clientY - y0; y0 = null; if (dy > 90 && dy > Math.abs(dx)) c[2]();
      });
    });
  })();
  function copy(text, btn) {
    function done() { var o = btn.innerHTML; btn.innerHTML = '복사했어요'; setTimeout(function () { btn.innerHTML = o; }, 1400); }
    function fallback() { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} document.body.removeChild(ta); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }

  // ------------------------------------------------------------ 메뉴: 퀘스트 로그 · 가방 · 상점 · 예절 · 예산
  var menuTab = 'log';
  function openMenu(tab) {
    menuTab = tab || menuTab; closeSheet();
    $('menu').querySelectorAll('.m-tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === menuTab); });
    renderMenu();
    $('menu').classList.add('show'); $('menu').setAttribute('aria-hidden', 'false'); $('scrim').classList.add('show');
  }
  function closeMenu(keepScrim) { $('menu').classList.remove('show'); $('menu').setAttribute('aria-hidden', 'true'); if (!keepScrim) $('scrim').classList.remove('show'); }
  $('mClose').addEventListener('click', function () { closeMenu(); });
  $('menu').querySelector('.m-tabs').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (b) openMenu(b.dataset.tab); });
  function renderMenu() {
    var h = '';
    if (menuTab === 'log') {
      var np = window.Notification ? Notification.permission : 'none';
      h += '<div class="m-h">출발 알림</div><p class="small">장소 끝나기 10분 전·끝날 때, 전철·버스 출발 5분 전, 공항 절차마다 진동과 알림. 앱이 열려 있을 때만 울려요 — 확실하게 하려면 캘린더에 넣기.</p>' +
        '<div class="sh-actions"><button data-notify="1">' + (np === 'granted' ? '폰 알림 켜짐 ✓' : '폰 알림 켜기') + '</button><button data-ics="1" class="primary">캘린더에 알림 넣기</button></div>';
      DAYS.forEach(function (D, di) {
        var l = dayLabel(D.d.date);
        h += '<div class="m-h">' + (di + 1) + '일차 ' + esc(D.d.theme) + ' <span class="small">' + l.md + ' ' + l.wd + '</span></div>';
        D.list.forEach(function (e) {
          if (e.type === 'task') return;
          var qt = qtype(e), dn = isDone(e), isCur = cur === e;
          h += '<div class="log-row ' + (dn ? 'done ' : '') + (isCur ? 'cur ' : '') + qt + '" data-d="' + di + '" data-i="' + e.idx + '"><span class="st">' + (dn ? (qt === 'main' ? '印' : '✓') : '') + '</span>' +
            '<span class="tx"><b>' + esc(entryTitle(e, true)) + '</b><small>' + entryTime(e) + ' ' + QTYPE[qt].tag + ' ' + modeChip(e) + '</small></span></div>';
        });
      });
    } else if (menuTab === 'bag') {
      G.packing.forEach(function (g, gi) {
        h += '<div class="m-h">' + esc(g.title) + '</div>';
        g.items.forEach(function (it, ii) { var id = gi + '.' + ii, on = !!P.pack[id]; h += '<div class="chk ' + (on ? 'on' : '') + '" data-pack="' + id + '"><span class="box">' + (on ? '✓' : '') + '</span><span>' + esc(it) + '</span></div>'; });
      });
      h += '<div class="m-h">입국 QR (9/29 입국 때만)</div><div class="sh-actions"><button data-qr="1" class="wide">입국 QR 열기</button></div>';
      h += '<div class="m-h">수하물 (이스타)</div><ul class="sh-notes">' + G.baggage.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    } else if (menuTab === 'shop') {
      h += '<div class="m-h">사 올 것</div><div class="cards">' + G.shop.map(function (s) {
        return '<div class="card"><b>' + esc(s.name) + '</b><div class="ja" lang="ja">' + esc(s.ja) + '</div><div class="pr">' + esc(s.price) + '</div><div class="who">' + esc(s.who) + '에게</div><div class="nt">' + esc(s.note) + '</div></div>';
      }).join('') + '</div>';
      h += '<div class="avoid"><b>사지 말 것 (한국 반입 금지)</b><ul class="sh-list">' + G.shop_avoid.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
      h += '<div class="m-h">먹어 볼 것</div>' + G.food.map(function (f) { return '<div class="log-row"><span class="tx"><b>' + esc(f.name) + '</b><small>' + esc(f.where) + '</small></span></div>'; }).join('');
    } else if (menuTab === 'rule') {
      G.etiquette.forEach(function (g) { h += '<div class="m-h">' + esc(g.title) + '</div><ul class="sh-notes">' + g.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; });
      h += '<p class="small">조사 출처: ' + esc(G.sources.join(' · ')) + '</p>';
    } else if (menuTab === 'wx') {
      h += '<div class="m-h">날씨 예보 (후쿠오카 시내)</div><p class="small">' + esc(wxStamp()) + '</p>';
      DAYS.forEach(function (D, di) {
        var l = dayLabel(D.d.date), dw = dayWx(D.d.date);
        h += '<div class="m-h">' + (di + 1) + '일차 ' + l.md + ' ' + l.wd + ' <span class="small">' + (dw ? esc(wxLine(D.d.date).replace(/<[^>]+>/g, '')) : '') + '</span></div>';
        for (var hr = 6; hr <= 23; hr += 2) {
          var x = wxAt(D.d.date, hr * 60); if (!x) continue;
          h += '<div class="wx-row"><span>' + String(hr).padStart(2, '0') + ':00</span><span class="bar"><i style="width:' + x.pp + '%"></i></span><span>☔ ' + x.pp + '%</span><span>' + WXI(x.code) + ' ' + Math.round(x.temp) + '°</span></div>';
        }
      });
    } else if (menuTab === 'money') {
      var fixed = 0, rows = '';
      G.budget.forEach(function (b) { fixed += b.krw; rows += '<tr><td>' + esc(b.name) + (b.est ? ' <span class="badge">예정</span>' : '') + '</td><td>' + krw(b.krw) + '</td></tr>'; });
      var fares = 0, costs = 0;
      DAYS.forEach(function (D) { D.list.forEach(function (e) {
        if (e.type === 'move' && e.step.fare_jpy) fares += e.step.fare_jpy;
        if (e.type === 'place' && e.step.cost_jpy) costs += e.step.cost_jpy;
      }); });
      rows += '<tr><td>현지 교통비 (일정 합계)</td><td>' + yen(fares) + ' ≈ ' + won(fares) + '</td></tr>';
      rows += '<tr><td>식비·새전·입장료 (엑셀 추정)</td><td>' + yen(costs) + ' ≈ ' + won(costs) + '</td></tr>';
      var total = fixed + (fares + costs) * RATE;
      rows += '<tr class="total"><td>합계</td><td>' + krw(total) + '</td></tr>';
      h += walletHtml(total);
      h += '<div class="m-h">예산 (계획)</div><table class="money">' + rows + '</table><p class="small">1엔 = ' + RATE + '원 (' + esc(T.rate_note) + ') · 기념품·간식 제외</p>';
      // 현지에서 카드로 낼 돈 / 현금으로 낼 돈
      var cardAll = 0, cashAll = 0, prow = '';
      DAYS.forEach(function (D, di) {
        var sub = 0, cashT = 0, cashP = 0, l = dayLabel(D.d.date);
        D.list.forEach(function (e) {
          var s2 = e.step; if (!s2) return;
          if (e.type === 'move' && s2.fare_jpy) { if (s2.pay === 'card') sub += s2.fare_jpy; else if (s2.pay === 'cash') cashT += s2.fare_jpy; }
          if (e.type === 'place' && s2.pay === 'cash' && s2.cost_jpy) cashP += s2.cost_jpy;
        });
        var card = Math.min(sub, 640);
        cardAll += card; cashAll += cashT + cashP;
        prow += '<tr><td>' + (di + 1) + '일차 ' + l.md + '<br><span class="small">카드 ' + yen(card) + (sub > 640 ? ' (지하철 ' + yen(sub) + ' → 하루 상한 640엔)' : '') + ' · 현금 교통 ' + yen(cashT) + ' · 현금 식비·새전 ' + yen(cashP) + '</span></td><td>' + yen(cashT + cashP) + '</td></tr>';
      });
      var need = Math.ceil(cashAll * 1.3 / 1000) * 1000;
      h += '<div class="m-h">현금과 카드</div><table class="money">' + prow +
        '<tr><td>' + esc(G.payment.card) + ' (지하철)</td><td>' + yen(cardAll) + '</td></tr>' +
        '<tr class="total"><td>현금 필요</td><td>' + yen(cashAll) + '</td></tr></table>' +
        '<p class="small">여유 30%를 더하면 약 <b>' + yen(need) + '</b>. 여기에 카드 안 받는 식당·야타이·기념품까지 생각하면 <b>총 3만 엔</b> 권장.</p>' +
        '<div class="m-h">카드로 되는 곳</div><ul class="sh-list">' + G.payment.card_rules.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
        '<div class="m-h">현금이 필요한 곳</div><ul class="sh-list">' + G.payment.cash_rules.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    }
    $('menuBody').innerHTML = h; $('menuBody').scrollTop = 0;
  }
  $('menuBody').addEventListener('click', function (ev) {
    var r = ev.target.closest('.log-row[data-d]');
    if (r) { var e = DAYS[+r.dataset.d].list[+r.dataset.i]; closeMenu(true); openSheet(e); var p = entryPoint(e, 'start'); if (p) whipTo(p); return; }
    if (ev.target.closest('[data-qr]')) { closeMenu(); return openQR(); }
    if (ev.target.closest('[data-notify]')) return askNotify();
    if (ev.target.closest('[data-ics]')) return downloadIcs();
    var x = ev.target.closest('[data-exp]');
    if (x) { var it = expLoad().find(function (y) { return y.id === x.dataset.exp; }); if (it) openExp(it); return; }
    if (ev.target.closest('[data-exp-new]')) return openExp(expPrefill(lastState && lastState.e, false));
    if (ev.target.closest('[data-exp-share]')) {
      var txt = expText() || '기록 없음';
      if (navigator.share) navigator.share({ title: '후쿠오카 여행 지출', text: txt }).catch(function () {});
      else copy(txt, ev.target.closest('button'));
      return;
    }
    var c = ev.target.closest('.chk'); if (c) { toggleObj('pack', c.dataset.pack); renderMenu(); if (lastState) renderQuest(lastState); }
  });

  // ------------------------------------------------------------ GPS
  var watchId = null, meMarker = null, accCircle = null, compassOn = false, lastCompass = null, firstFix = null;
  var meIcon = L.divIcon({ className: '', iconSize: [60, 60], iconAnchor: [30, 30],
    html: '<div class="me"><svg class="cone" viewBox="0 0 60 60"><defs><radialGradient id="cg" cx="50%" cy="100%" r="100%"><stop offset="0" stop-color="#1a73e8" stop-opacity=".55"/><stop offset="1" stop-color="#1a73e8" stop-opacity="0"/></radialGradient></defs><path d="M30 30 L16 2 A30 30 0 0 1 44 2 Z" fill="url(#cg)"/></svg><div class="dot"></div></div>' });
  function setBtn(id, on, label) { var b = $(id); b.setAttribute('aria-pressed', on ? 'true' : 'false'); if (label) b.querySelector('.t').textContent = label; }
  function seeking(on) { $('bLocate').classList.toggle('seeking', on); if (window.Orb) Orb.set($('locOrb'), on ? 'searching' : null, 20); }
  function gpsStart() {
    if (watchId != null) return;
    if (!('geolocation' in navigator)) { toast('이 브라우저는 위치를 지원하지 않아요'); return; }
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
    setBtn('bGpsOff', true, 'GPS 끄기'); compassStart(); seeking(true);
  }
  function gpsStop() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null; gps = null; seeking(false);
    if (meMarker) { map.removeLayer(meMarker); map.removeLayer(accCircle); meMarker = accCircle = null; }
    setBtn('bGpsOff', false, 'GPS 켜기'); follow = false; setBtn('bFollow', false); compassStop();
    offState = { count: 0, shown: false }; update(false);
  }
  function onPos(p) {
    var c = p.coords, gh = (c.heading != null && !isNaN(c.heading) && (c.speed || 0) > 0.7) ? c.heading : null;
    gps = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, gpsHeading: gh, heading: gh != null ? gh : lastCompass, t: Date.now() };
    var ll = [gps.lat, gps.lon];
    seeking(false);
    if (!meMarker) {
      accCircle = L.circle(ll, { radius: gps.acc, color: '#1a73e8', weight: 1, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { icon: meIcon, zIndexOffset: 2000, interactive: false }).addTo(map);
    } else { meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(gps.acc); }
    drawHeading();
    if (firstFix) { var f = firstFix; firstFix = null; f(); }
    if (follow) map.setView(ll, Math.max(map.getZoom(), 16), { animate: true });
    update(false);
  }
  function onPosErr(err) { if (err.code === 1) { toast('위치 권한이 꺼져 있어요 — 브라우저 설정에서 허용해 주세요'); gpsStop(); } else toast('위치를 아직 못 잡았어요'); }
  function drawHeading() {
    if (!meMarker) return; var el = meMarker.getElement(); if (!el) return;
    var me = el.querySelector('.me'), cone = el.querySelector('.cone'), h = gps && gps.heading;
    me.classList.toggle('has-heading', h != null); if (h != null) cone.style.transform = 'rotate(' + h + 'deg)';
  }
  function onOrient(ev) {
    var h = null;
    if (ev.webkitCompassHeading != null) h = ev.webkitCompassHeading; else if (ev.absolute && ev.alpha != null) h = (360 - ev.alpha) % 360;
    if (h == null) return;
    lastCompass = (h + ((screen.orientation && screen.orientation.angle) || 0)) % 360;
    if (gps && gps.gpsHeading == null) { gps.heading = lastCompass; drawHeading(); }
  }
  function compassStart() { if (compassOn) return; compassOn = true; window.addEventListener('ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation', onOrient); }
  function compassStop() { compassOn = false; lastCompass = null; window.removeEventListener('deviceorientationabsolute', onOrient); window.removeEventListener('deviceorientation', onOrient); }
  $('bLocate').addEventListener('click', function () {
    if (gps) { snapZoom([gps.lat, gps.lon]); return; }
    firstFix = function () { snapZoom([gps.lat, gps.lon]); }; gpsStart(); toast('위치 찾는 중…');
  });
  $('bFollow').addEventListener('click', function () {
    follow = !follow; setBtn('bFollow', follow);
    if (follow) { if (!gps) { gpsStart(); toast('위치 찾는 중…'); } else map.setView([gps.lat, gps.lon], Math.max(map.getZoom(), 16)); }
  });
  $('bGpsOff').addEventListener('click', function () { if (watchId != null) { gpsStop(); toast('GPS 껐어요'); } else { gpsStart(); toast('위치 찾는 중…'); } });
  map.on('dragstart', function () { if (follow) { follow = false; setBtn('bFollow', false); } });

  // 경로 이탈 200m — 조용히
  var offState = { count: 0, shown: false };
  function checkOffRoute(st) {
    if (!gps || st.di < 0 || gps.acc > 100 || !inArea([gps.lat, gps.lon])) return;
    var p = [gps.lat, gps.lon], d = Infinity;
    DAYS[st.di].list.forEach(function (e) { d = Math.min(d, distToEntry(p, e)); });
    if (d > 200) { offState.count++; if (offState.count >= 2 && !offState.shown) { offState.shown = true; toast('경로에서 ' + fmtDist(d) + ' 벗어났어요', 6000); } }
    else if (d < 150) offState = { count: 0, shown: false };
  }

  // 화면 꺼짐 방지
  var wakeLock = null, wakeWanted = false;
  async function wakeOn() {
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', function () { wakeLock = null; if (!wakeWanted) setBtn('bWake', false); }); setBtn('bWake', true); }
    catch (e) { wakeWanted = false; setBtn('bWake', false); toast('화면 켜둠을 쓸 수 없어요 (절전 모드?)'); }
  }
  $('bWake').addEventListener('click', function () {
    if (!('wakeLock' in navigator)) { toast('이 브라우저는 화면 켜둠을 지원하지 않아요'); return; }
    wakeWanted = !wakeWanted; if (wakeWanted) wakeOn(); else { if (wakeLock) wakeLock.release(); setBtn('bWake', false); }
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { if (wakeWanted && !wakeLock) wakeOn(); update(false); } });

  // 테마
  function themeUI() {
    var d = isDark();
    $('themeIc').setAttribute('href', d ? '#i-sun' : '#i-moon');
    $('bTheme').querySelector('.t').textContent = d ? '낮 모드' : '밤 모드';
    document.querySelector('meta[name=theme-color]').content = d ? '#07090f' : '#eef0f5';
  }
  $('bTheme').addEventListener('click', function () {
    var t = isDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch (e) {}
    themeUI(); drawLines();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (ev) {
    var saved = null; try { saved = localStorage.getItem('theme'); } catch (e) {}
    if (saved) return;
    document.documentElement.dataset.theme = ev.matches ? 'dark' : 'light'; themeUI(); drawLines(); drawRainFor();
  });

  var toastT = null;
  function toast(msg, ms) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, ms || 2500); }

  // ------------------------------------------------------------ 입국 QR: 캡처를 이 폰(localStorage)에만 저장, 오프라인에서도 표시
  function qrLoad() { try { return JSON.parse(localStorage.getItem('fk-qr') || '[]'); } catch (e) { return []; } }
  function qrRender() {
    var imgs = qrLoad();
    $('qrImgs').innerHTML = imgs.length ? imgs.map(function (u) { return '<img src="' + u + '" alt="입국 QR">'; }).join('')
      : '<div class="qr-empty">아직 저장한 캡처가 없어요.<br>Visit Japan Web에서 QR 화면을 캡처한 뒤<br>"QR 캡처 불러오기"를 누르세요.</div>';
  }
  // 입국 QR 버튼은 출발 전 ~ 첫날 입국 수속 끝나고 90분(연착 여유)까지만. 그 뒤엔 가방 탭에서
  var QR_TASK = (function () { var d = DAYS[0].d.date, t = (T.tasks[d] || []).filter(function (x) { return /QR/.test(x.text); }).pop(); return t && { date: d, end: hm(t.end) }; })();
  function qrNeeded(now) { return !!QR_TASK && (now.date < QR_TASK.date || (now.date === QR_TASK.date && now.min < QR_TASK.end + 90)); }
  function openQR() { qrRender(); $('qr').classList.add('show'); $('qr').setAttribute('aria-hidden', 'false'); }
  function closeQR() { $('qr').classList.remove('show'); $('qr').setAttribute('aria-hidden', 'true'); }
  function shrink(file, max, type, q) { // 큰 사진은 줄여서 저장 (QR: 1200px PNG, 영수증: JPEG)
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onerror = rej;
      fr.onload = function () {
        var im = new Image();
        im.onerror = rej;
        im.onload = function () {
          var k = Math.min(1, (max || 1200) / Math.max(im.width, im.height)), cv = document.createElement('canvas');
          cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
          cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
          res(cv.toDataURL(type || 'image/png', q));
        };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  $('bQR').addEventListener('click', openQR);
  $('qrClose').addEventListener('click', closeQR);
  $('qrDel').addEventListener('click', function () { if (confirm('저장한 QR 캡처를 지울까요?')) { try { localStorage.removeItem('fk-qr'); } catch (e) {} qrRender(); } });
  $('qrFile').addEventListener('change', function (ev) {
    var files = [].slice.call(ev.target.files || []);
    Promise.all(files.map(function (f) { return shrink(f); })).then(function (urls) {
      var all = qrLoad().concat(urls).slice(-3);
      try { localStorage.setItem('fk-qr', JSON.stringify(all)); toast('QR 캡처 저장했어요'); } catch (e) { toast('저장 공간이 부족해요 — 캡처를 줄여서 다시 해 주세요'); }
      qrRender(); ev.target.value = '';
    }, function () { toast('이미지를 읽지 못했어요'); });
  });
  window.__openQR = openQR;

  // ------------------------------------------------------------ 출발 알림: 장소 끝나기 10분 전·끝날 때, 전철·버스 출발 5분 전, 공항 절차 시작 때
  // 앱이 열려 있을 때만 울림 (웹의 한계) → 확실하게 하려면 캘린더(.ics)로 폰 캘린더 알람에 넣기
  var TRANSIT = { jr: 1, subway: 1, nishitetsu: 1, bus: 1, krail: 1, shuttle: 1 };
  function alertPoints(di) {
    var list = DAYS[di].list, pts = [];
    list.forEach(function (e, i) {
      var nx = list[i + 1];
      if (e.type === 'place' && nx && e.end - e.start >= 15) {
        var body = e.step.name + ' → 다음: ' + entryTitle(nx, true) + ' (' + fmtTime(nx.start) + ')';
        pts.push({ id: e.key + '|-10', at: e.end - 10, title: '10분 뒤 출발', body: body });
        pts.push({ id: e.key + '|0', at: e.end, title: '지금 출발할 시간', body: body });
      }
      if (e.type === 'move' && TRANSIT[e.step.mode]) pts.push({ id: e.key + '|dep', at: e.start - 5, title: '5분 뒤 ' + MODE[e.step.mode].label + ' 출발', body: fmtTime(e.start) + ' ' + e.step.from + ' → ' + e.step.to + (e.step.line ? ' · ' + e.step.line : '') });
      if (e.type === 'task' && e.end - e.start >= 5) pts.push({ id: e.key + '|task', at: e.start, title: '지금 할 일', body: e.text });
    });
    return pts.filter(function (a) { return a.at >= 0; });
  }
  var fired = {};
  try { fired = JSON.parse(localStorage.getItem('fk-alert') || '{}'); } catch (e) {}
  function checkAlerts(st) {
    if (st.di < 0) return;
    alertPoints(st.di).forEach(function (a) {
      if (fired[a.id] || st.now.min < a.at || st.now.min > a.at + 3) return; // 늦게 열었으면 지난 알림은 안 울림
      fired[a.id] = 1;
      try { localStorage.setItem('fk-alert', JSON.stringify(fired)); } catch (e) {}
      notify(a.title, a.body);
    });
    checkAlight(st);
  }
  // 내리기 2정거장 전 알림 (9/30 요청): GPS로 노선 위 남은 거리를 재고, 지하라 GPS가 끊기면 시간으로
  function stopNames(s) { var m = (s.off || '').match(/\(([^()]*→[^()]*)\)|: ([^·]*→[^·]*)/); return m ? (m[1] || m[2]).split('→').map(function (x) { return x.trim(); }) : null; }
  function pathLen(parts) { var t = 0; parts.forEach(function (pl) { for (var i = 0; i < pl.length - 1; i++) t += hav(pl[i], pl[i + 1]); }); return t; }
  function checkAlight(st) {
    var nowm = st.now.min, fresh = gps && gps.t && Date.now() - gps.t < 90000 && inArea([gps.lat, gps.lon]) ? [gps.lat, gps.lon] : null;
    DAYS[st.di].list.forEach(function (e) {
      if (e.type !== 'move' || !TRANSIT[e.step.mode] || e.step.mode === 'shuttle' || !e.step.geom) return;
      if (nowm < e.start - 15 || nowm > e.end + 60) return;
      var id = e.key + '|off2'; if (fired[id]) return;
      var s = e.step, names = stopNames(s), n = names ? names.length - 1 : 0, total = pathLen(s.geom), th;
      if (n >= 3) th = total * 2 / n + 150;           // 역 간격을 고르게 봤을 때 2정거장 남은 거리 (+조금 일찍)
      else if (s.mode === 'bus') th = 700;             // 버스는 정류장 목록이 없어 700m 전에 "하차 벨"
      else if (!names) th = Math.min(2500, total * 0.3);
      else return;                                     // 1~2정거장짜리는 탈 때 이미 2정거장 전
      var hit = false;
      if (fresh) { var r = project(fresh, s.geom); hit = r.d < 500 && r.remain <= th && r.remain > 60; }
      else if (n >= 3 && (watchId == null || gps)) hit = nowm >= e.end - (e.end - e.start) * 2 / n && nowm <= e.end; // GPS를 껐거나, 잡혔다가 끊겼을 때만 (처음 잡는 중엔 기다림)
      if (!hit) return;
      fired[id] = 1;
      try { localStorage.setItem('fk-alert', JSON.stringify(fired)); } catch (x) {}
      var off = (s.off || '').split(' · ').slice(1).join(' · ');
      if (n >= 3) notify('2정거장 뒤 내려요', names[n - 1] + ' 다음 ' + names[n] + '에서 내리기' + (off ? ' · ' + off : ''));
      else if (s.mode === 'bus') notify('곧 내려요 — 하차 벨 누르기', s.to + (off ? ' · ' + off : ''));
      else notify('곧 내려요', s.to + '에서 내리기' + (off ? ' · ' + off : ''));
    });
  }
  function notify(title, body) {
    toast(title + ' · ' + body, 9000); banner(title);
    if (navigator.vibrate) navigator.vibrate([250, 120, 250]);
    if (window.Notification && Notification.permission === 'granted' && navigator.serviceWorker)
      navigator.serviceWorker.ready.then(function (r) { r.showNotification(title, { body: body, icon: 'icon-192.png', tag: 'fk-alert', renotify: true, vibrate: [250, 120, 250] }); }).catch(function () {});
  }
  function icsUtc(date, min) { return new Date(new Date(date + 'T00:00:00+09:00').getTime() + min * 60000).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'; }
  function icsEsc(s) { return String(s).replace(/[\\;,]/g, function (c) { return '\\' + c; }).replace(/\n/g, '\\n'); }
  function icsFold(line) { // 75바이트마다 접기 (한글은 3바이트)
    var out = '', n = 0, enc = new TextEncoder();
    for (var ch of line) { var b = enc.encode(ch).length; if (n + b > 73) { out += '\r\n '; n = 1; } out += ch; n += b; }
    return out;
  }
  function icsFile() {
    var now = tokyoNow(), stamp = icsUtc(now.date, Math.floor(now.min)), L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fukuoka2026//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    DAYS.forEach(function (D, di) {
      alertPoints(di).forEach(function (a) {
        if (D.d.date < now.date || (D.d.date === now.date && a.at <= now.min)) return; // 이미 지난 건 빼기
        L.push('BEGIN:VEVENT', 'UID:' + a.id.replace(/[^\w-]/g, '_') + '@fukuoka2026', 'DTSTAMP:' + stamp, 'DTSTART:' + icsUtc(D.d.date, a.at), 'DTEND:' + icsUtc(D.d.date, a.at + 5),
          'SUMMARY:' + icsEsc(a.title + ' · ' + a.body), 'DESCRIPTION:' + icsEsc(a.body),
          'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc(a.title), 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
      });
    });
    L.push('END:VCALENDAR');
    return L.map(icsFold).join('\r\n') + '\r\n';
  }
  function downloadIcs() {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([icsFile()], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'fukuoka-alerts.ics'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    toast('파일을 열어서 캘린더에 저장하세요', 5000);
  }
  function askNotify() {
    if (!window.Notification) { toast('이 브라우저는 알림을 지원하지 않아요 — 캘린더에 넣기를 쓰세요'); return; }
    Notification.requestPermission().then(function (p) { toast(p === 'granted' ? '폰 알림 켜졌어요' : '알림이 막혀 있어요 — 브라우저 설정에서 허용'); renderMenu(); });
  }

  // ------------------------------------------------------------ 지출 기록: 금액·현금/카드·분류·메모·영수증 사진 — 전부 이 폰에만 (목록 localStorage, 사진 IndexedDB)
  var CAT_OF = { shrine: '입장·새전', temple: '입장·새전', food: '식비', bar: '식비', bath: '목욕탕', shop: '쇼핑·선물', pharmacy: '쇼핑·선물' };
  function expLoad() { try { return JSON.parse(localStorage.getItem('fk-exp') || '[]'); } catch (e) { return []; } }
  function expStore(list) { try { localStorage.setItem('fk-exp', JSON.stringify(list)); return true; } catch (e) { toast('저장 공간이 부족해요'); return false; } }
  (function () { // 대화로 전해 받은 지출(data.js)을 폰 목록에 한 번만 넣기 — 지우면 다시 안 들어옴
    var seeded = {}; try { seeded = JSON.parse(localStorage.getItem('fk-exp-seed') || '{}'); } catch (e) {}
    var add = (G.seed_exp || []).filter(function (x) { return !seeded[x.id]; }), w = G.seed_wallet;
    if (w && !seeded[w.id]) { seeded[w.id] = 1; try { localStorage.setItem('fk-wallet', String(w.jpy)); localStorage.setItem('fk-exp-seed', JSON.stringify(seeded)); } catch (e) {} }
    if (!add.length) return;
    var list = expLoad();
    add.forEach(function (x) { seeded[x.id] = 1; if (!list.some(function (y) { return y.id === x.id; })) list.push(Object.assign({}, x)); });
    list.sort(function (p, q) { return p.t < q.t ? -1 : p.t > q.t ? 1 : 0; });
    if (expStore(list)) try { localStorage.setItem('fk-exp-seed', JSON.stringify(seeded)); } catch (e) {}
  })();
  function walletLoad() { try { var v = localStorage.getItem('fk-wallet'); return v == null ? null : +v; } catch (e) { return null; } }
  var rdb = null;
  function rstore(mode) {
    return new Promise(function (res, rej) {
      function go(db) { res(db.transaction('r', mode).objectStore('r')); }
      if (rdb) return go(rdb);
      var q = indexedDB.open('fk-receipts', 1);
      q.onupgradeneeded = function () { q.result.createObjectStore('r'); };
      q.onsuccess = function () { rdb = q.result; go(rdb); };
      q.onerror = function () { rej(q.error); };
    });
  }
  function rreq(mode, fn) { return rstore(mode).then(function (s) { return new Promise(function (res, rej) { var r = fn(s); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }); }
  function rput(id, url) { return rreq('readwrite', function (s) { return s.put(url, id); }); }
  function rget(id) { return rreq('readonly', function (s) { return s.get(id); }); }
  function rdel(id) { return rreq('readwrite', function (s) { return s.delete(id); }).catch(function () {}); }
  function segSet(id, v) { $(id).querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false'); }); }
  function segGet(id) { var b = $(id).querySelector('[aria-pressed="true"]'); return b && b.dataset.v; }
  function expWon() { var a = +$('expAmt').value || 0; $('expWon').textContent = a && segGet('expCur') === 'jpy' ? '≈ ' + won(a) : ''; }
  ['expCur', 'expPay', 'expCat'].forEach(function (id) {
    $(id).addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (b) { segSet(id, b.dataset.v); expWon(); } });
  });
  $('expAmt').addEventListener('input', expWon);
  // 퀘스트에서 미리 채우기: 장소는 입장료·분류, 이동은 운임·교통. 한국에선 원·카드
  function expPrefill(e, withAmt) {
    if (!e || e.type === 'task') return {};
    var s = e.step, place = e.type === 'place', p = entryPoint(e, 'start'), kr = p && isKorea(p);
    return { amt: withAmt ? (place ? s.cost_jpy : s.fare_jpy) || '' : '', cur: kr ? 'krw' : 'jpy', pay: kr || s.pay === 'card' ? 'card' : 'cash',
      cat: place ? (CAT_OF[s.category] || '기타') : '교통', memo: place ? s.name : s.from + ' → ' + s.to, key: e.key };
  }
  var expEdit = null, expPhoto = null, expKey = null, expBack = false;
  function openExp(pre) {
    pre = pre || {};
    expEdit = pre.id ? pre : null; expPhoto = null; expKey = pre.key || null;
    $('expTitle').textContent = expEdit ? '지출 고치기' : '지출 기록';
    $('expAmt').value = pre.amt || '';
    segSet('expCur', pre.cur || 'jpy'); segSet('expPay', pre.pay || 'cash'); segSet('expCat', pre.cat || '기타');
    $('expMemo').value = pre.memo || '';
    $('expDel').hidden = !expEdit;
    var img = $('expImg'); img.hidden = true; img.removeAttribute('src');
    if (expEdit && expEdit.rid) rget(expEdit.id).then(function (u) { if (u) { img.src = u; img.hidden = false; } }, function () {});
    expWon();
    expBack = $('menu').classList.contains('show') && menuTab === 'money';
    closeSheet(); closeMenu(true);
    $('exp').classList.add('show'); $('exp').setAttribute('aria-hidden', 'false'); $('scrim').classList.add('show');
    if (!pre.amt) setTimeout(function () { $('expAmt').focus(); }, 380);
  }
  function closeExp(back) {
    $('exp').classList.remove('show'); $('exp').setAttribute('aria-hidden', 'true');
    if (back) openMenu('money'); else $('scrim').classList.remove('show');
  }
  $('expClose').addEventListener('click', function () { closeExp(); });
  $('bExp').addEventListener('click', function () { openExp(expPrefill(lastState && lastState.e, false)); });
  $('expFile').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0]; if (!f) return;
    shrink(f, 1400, 'image/jpeg', 0.72).then(function (u) { expPhoto = u; $('expImg').src = u; $('expImg').hidden = false; }, function () { toast('사진을 읽지 못했어요'); });
    ev.target.value = '';
  });
  $('expImg').addEventListener('click', function () { $('rcptImg').src = $('expImg').src; $('rcpt').classList.add('show'); });
  $('rcpt').addEventListener('click', function () { $('rcpt').classList.remove('show'); });
  $('expSave').addEventListener('click', function () {
    var amt = Math.round(+$('expAmt').value || 0);
    if (amt <= 0) { toast('금액을 넣어 주세요'); return; }
    var now = tokyoNow(), list = expLoad(), wasEdit = !!expEdit;
    var e = expEdit || { id: 'x' + Date.now().toString(36), t: now.date + ' ' + fmtTime(Math.floor(now.min)), key: expKey };
    e.amt = amt; e.cur = segGet('expCur'); e.pay = segGet('expPay'); e.cat = segGet('expCat'); e.memo = $('expMemo').value.trim();
    var photo = expPhoto ? rput(e.id, expPhoto).then(function () { e.rid = true; }, function () { toast('영수증 사진은 저장 못 했어요'); }) : Promise.resolve();
    photo.then(function () {
      list = wasEdit ? list.map(function (x) { return x.id === e.id ? e : x; }) : list.concat([e]);
      if (!expStore(list)) return;
      toast((wasEdit ? '고쳤어요 · ' : '기록했어요 · ') + (e.cur === 'jpy' ? yen(amt) : krw(amt)));
      closeExp(expBack);
    });
  });
  $('expDel').addEventListener('click', function () {
    if (!expEdit || !confirm('이 지출 기록을 지울까요?')) return;
    var id = expEdit.id;
    expStore(expLoad().filter(function (x) { return x.id !== id; })); rdel(id);
    closeExp(expBack);
  });
  function expText() { // 공유·백업용 텍스트
    return expLoad().map(function (x) { return [x.t, x.cat, x.memo, (x.cur === 'jpy' ? x.amt + '엔' : x.amt + '원'), x.pay === 'cash' ? '현금' : '카드'].join(' | '); }).join('\n');
  }
  function walletHtml(total) {
    var ex = expLoad(), cashJ = 0, cardJ = 0, cashK = 0, cardK = 0, prepaid = 0, have = walletLoad();
    ex.forEach(function (x) { if (x.cur === 'jpy') { if (x.pay === 'cash') cashJ += x.amt; else cardJ += x.amt; } else { if (x.pay === 'cash') cashK += x.amt; else cardK += x.amt; } });
    G.budget.forEach(function (b) { if (!b.est) prepaid += b.krw; });
    var spent = (cashJ + cardJ) * RATE + cashK + cardK, left = have == null ? null : have - cashJ;
    var h = '<div class="m-h">지갑</div><div class="wallet">' +
      '<label class="w-row"><span>가진 현금 (환전한 엔 전부)</span><span><input id="walletJpy" type="number" inputmode="numeric" min="0" value="' + (have == null ? '' : have) + '" placeholder="30000"> 엔</span></label>' +
      '<div class="w-row"><span>현금으로 쓴 돈</span><b>' + yen(cashJ) + (cashK ? ' + ' + krw(cashK) : '') + '</b></div>' +
      '<div class="w-row big"><span>남은 현금</span><b class="' + (left != null && left < 0 ? 'neg' : '') + '">' + (left == null ? '위에 가진 현금 입력' : yen(left) + ' <span class="small">≈ ' + won(left) + '</span>') + '</b></div>' +
      '<div class="w-row"><span>카드로 쓴 돈</span><b>' + yen(cardJ) + (cardK ? ' + ' + krw(cardK) : '') + '</b></div></div>' +
      (G.seed_wallet ? '<p class="small">처음 가진 현금: ' + esc(G.seed_wallet.note) + '</p>' : '') +
      (G.exchanges || []).map(function (x) { return '<p class="small">환전 ' + esc(x.t.slice(5)) + ' ' + esc(x.where) + ': ' + yen(x.jpy) + ' = ' + krw(x.krw) + ' (1엔 ' + (x.krw / x.jpy).toFixed(2) + '원)</p>'; }).join('') +
      '<div class="m-h">동전·지폐 가이드</div><ul class="sh-list">' + (G.coin_guide || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    h += '<div class="m-h">계획 vs 실제</div><table class="money">' +
      '<tr><td>미리 낸 돈 (항공·숙소·eSIM·보험·한국 교통)</td><td>' + krw(prepaid) + '</td></tr>' +
      '<tr><td>여행 중 기록한 지출 (' + ex.length + '건)</td><td>≈ ' + krw(spent) + '</td></tr>' +
      '<tr class="total"><td>지금까지 쓴 돈</td><td>' + krw(prepaid + spent) + '</td></tr>' +
      '<tr><td>계획 합계 (아래 예산)</td><td>' + krw(total) + '</td></tr>' +
      '<tr><td>남은 예산</td><td>' + krw(total - prepaid - spent) + '</td></tr></table>' +
      '<div class="sh-actions"><button data-exp-new="1" class="primary">+ 지출 기록</button><button data-exp-share="1">기록 내보내기</button></div>';
    h += '<div class="m-h">지출 기록</div>';
    if (!ex.length) h += '<p class="small">아직 기록이 없어요. 돈 낼 때마다 왼쪽 "지출" 버튼이나 장소 상세의 "지출 기록"으로 남기세요.</p>';
    ex.slice().reverse().forEach(function (x) {
      h += '<div class="log-row exp" data-exp="' + esc(x.id) + '"><span class="tx"><b>' + esc(x.memo || x.cat) + '</b><small>' + esc(x.t.slice(5)) + ' · ' + esc(x.cat) + (x.rid ? ' · 📷' : '') + '</small></span>' +
        '<span class="amt">' + (x.cur === 'jpy' ? yen(x.amt) : krw(x.amt)) + '<small>' + (x.pay === 'cash' ? '현금' : '카드') + (x.cur === 'jpy' ? ' · ≈ ' + won(x.amt) : '') + '</small></span></div>';
    });
    return h;
  }
  $('menuBody').addEventListener('change', function (ev) {
    if (ev.target.id !== 'walletJpy') return;
    try { if (ev.target.value === '') localStorage.removeItem('fk-wallet'); else localStorage.setItem('fk-wallet', String(Math.max(0, Math.round(+ev.target.value)))); } catch (e) {}
    renderMenu();
  });

  // ------------------------------------------------------------ 시작
  function layout() { document.documentElement.style.setProperty('--dock', dockH() + 'px'); }
  window.addEventListener('resize', layout);
  new ResizeObserver(layout).observe($('quest'));
  themeUI();
  var st0 = computeCurrent();
  selDay = st0.di >= 0 ? st0.di : 0;
  selectDay(selDay, false);
  update(false);
  layout();
  fitDay(selDay);
  // 오늘 챕터 인트로는 하루 한 번
  var today = tokyoNow().date;
  if (st0.di >= 0 && !P.intro[today]) { P.intro[today] = 1; save(); showIntro(st0.di); }
  setInterval(function () { update(false); if (document.visibilityState === 'visible') refreshWx(); }, 30000);
  refreshWx(); drawRainFor();

  window.__app = { ics: function () { return icsFile(); }, state: function () { return lastState && { di: lastState.di, idx: lastState.e && lastState.e.idx, title: lastState.e && entryTitle(lastState.e), waiting: lastState.waiting }; }, selDay: function () { return selDay; } };
})();
