/* 후쿠오카 동선 지도 — 일정·경로는 data.js(window.TRIP), 실행 중 외부 API 호출 없음 (타일 제외) */
(function () {
  'use strict';
  var T = window.TRIP;
  var RATE = T.rate;
  var TZ = 'Asia/Tokyo';

  var MODE = {
    flight:     { c: '#1DB898', label: '에어서울',     icon: '✈️', gm: null },
    shuttle:    { c: '#595959', label: '공항 연결버스', icon: '🚌', gm: 'transit' },
    subway:     { c: '#F08300', label: '지하철',       icon: '🚇', gm: 'transit' },
    jr:         { c: '#E60012', label: 'JR',           icon: '🚆', gm: 'transit' },
    nishitetsu: { c: '#1B5AA8', label: '니시테츠',     icon: '🚃', gm: 'transit' },
    bus:        { c: '#DD873D', label: '버스',         icon: '🚌', gm: 'transit' },
    walk:       { c: 'var(--walk)', label: '도보',     icon: '🚶', gm: 'walking', dash: '1 9' }
  };
  var CAT = {
    shrine: { c: '#B22222', icon: '⛩️', label: '신사' },
    temple: { c: '#7B4B94', icon: '🪷', label: '절' },
    hotel:  { c: '#2F5597', icon: '🏨', label: '숙소' },
    food:   { c: '#16833F', icon: '🍜', label: '식당' },
    bath:   { c: '#1F6FB2', icon: '♨️', label: '목욕탕' }
  };
  var WD = ['일', '월', '화', '수', '목', '금', '토'];

  // ------------------------------------------------------------ 유틸
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hm(s) { if (!s) return null; var p = s.split(':'); return +p[0] * 60 + +p[1]; }
  function fmtMin(m) { m = Math.round(m); if (m < 60) return m + '분'; return Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : ''); }
  function fmtDist(d) { return d >= 1000 ? (d / 1000).toFixed(d >= 10000 ? 0 : 1) + 'km' : Math.round(d / 10) * 10 + 'm'; }
  function yen(v) { return v.toLocaleString('ko-KR') + '엔'; }
  function won(v) { return Math.round(v * RATE).toLocaleString('ko-KR') + '원'; }
  function tokyoNow() {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    var o = {}; parts.forEach(function (p) { o[p.type] = p.value; });
    return { date: o.year + '-' + o.month + '-' + o.day, min: +o.hour * 60 + +o.minute + (+o.second) / 60 };
  }
  function dayLabel(date) {
    var d = new Date(date + 'T12:00:00+09:00');
    return { md: (d.getUTCMonth() + 1) + '/' + d.getUTCDate(), wd: WD[d.getUTCDay()] };
  }
  // 거리 (m)
  function hav(a, b) {
    var R = 6371000, r = Math.PI / 180;
    var dla = (b[0] - a[0]) * r, dlo = (b[1] - a[1]) * r;
    var h = Math.sin(dla / 2) * Math.sin(dla / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dlo / 2) * Math.sin(dlo / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // 점 p에서 선분 a-b까지 (국소 평면 근사): {d, t}
  function segDist(p, a, b) {
    var k = Math.cos(p[0] * Math.PI / 180) * 111320, K = 110540;
    var ax = (a[1] - p[1]) * k, ay = (a[0] - p[0]) * K, bx = (b[1] - p[1]) * k, by = (b[0] - p[0]) * K;
    var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    var t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    var x = ax + t * dx, y = ay + t * dy;
    return { d: Math.sqrt(x * x + y * y), t: t };
  }
  // 경로(여러 조각) 위 가장 가까운 지점과, 그 지점부터 끝까지 남은 길이
  function project(p, parts) {
    var best = { d: Infinity, remain: 0 };
    var total = 0, lens = [];
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

  // ------------------------------------------------------------ 일정 → 하루 타임라인
  var DAYS = T.days.map(function (d, di) {
    var list = [];
    (T.pre[d.date] || []).forEach(function (x) { list.push({ type: 'task', text: x.text, start: hm(x.time), end: hm(x.end) }); });
    (T.tasks[d.date] || []).forEach(function (x) { list.push({ type: 'task', text: x.text, start: hm(x.time), end: hm(x.end) }); });
    d.steps.forEach(function (s) {
      if (s.kind === 'move') list.push({ type: 'move', step: s, start: hm(s.dep), end: hm(s.arr) });
      else list.push({ type: 'place', step: s, start: hm(s.start), end: hm(s.end) });
    });
    list.forEach(function (e, i) { e.ord = i; });
    list.sort(function (a, b) { return (a.start - b.start) || (a.ord - b.ord); });
    list.forEach(function (e, i) {
      if (e.end == null) e.end = i + 1 < list.length ? list[i + 1].start : 24 * 60 - 1;
      e.day = di; e.idx = i;
    });
    return { d: d, list: list };
  });
  function entryPoint(e, which) { // 지점 좌표
    if (e.type === 'place') return [e.step.lat, e.step.lon];
    if (e.type === 'move') return which === 'end' ? e.step.b : e.step.a;
    return null;
  }
  function entryTitle(e, short) {
    if (e.type === 'task') return '📋 ' + e.text;
    var s = e.step;
    if (e.type === 'place') return (CAT[s.category] || CAT.food).icon + ' ' + s.name;
    var m = MODE[s.mode];
    return m.icon + ' ' + (short ? s.to + '까지 ' + m.label : s.from + ' → ' + s.to);
  }
  function entryTime(e) {
    function f(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.round(m % 60)).padStart(2, '0'); }
    return f(e.start) + (e.end > e.start ? '–' + f(e.end) : '');
  }

  // ------------------------------------------------------------ 지도
  var map = L.map('map', { zoomControl: false, attributionControl: true, tap: true, preferCanvas: false }).setView([33.59, 130.41], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  map.attributionControl.setPrefix(false);

  var selDay = 0;          // 보고 있는 날짜 탭
  var cur = null;          // 지금 구간 (entry)
  var gps = null;          // {lat, lon, acc, heading}
  var follow = false;
  var lineLayers = [];     // {e, lines:[casing, line, hit]}
  var pinLayers = {};      // pt -> marker
  var stopLayer = L.layerGroup().addTo(map);

  function styleFor(e, state) { // state: 'dim' | 'day' | 'cur'
    var m = MODE[e.step.mode];
    var col = m.c.indexOf('var(') === 0 ? getComputedStyle(document.documentElement).getPropertyValue('--walk').trim() : m.c;
    if (state === 'dim') return { color: col, weight: 3, opacity: 0.22, dashArray: m.dash || null };
    if (state === 'cur') return { color: col, weight: 9, opacity: 1, dashArray: m.dash ? '1 12' : null, lineCap: 'round' };
    return { color: col, weight: 5, opacity: 0.9, dashArray: m.dash || null, lineCap: 'round' };
  }

  function drawLines() {
    lineLayers.forEach(function (l) { l.lines.forEach(function (x) { map.removeLayer(x); }); });
    lineLayers = [];
    // 흐린 날 → 선택한 날 → 지금 구간 순서로 위에 쌓이게
    var order = [];
    DAYS.forEach(function (D, di) { if (di !== selDay) D.list.forEach(function (e) { if (e.type === 'move') order.push([e, 'dim']); }); });
    DAYS[selDay].list.forEach(function (e) { if (e.type === 'move' && e !== cur) order.push([e, 'day']); });
    if (cur && cur.type === 'move' && cur.day === selDay) order.push([cur, 'cur']);
    order.forEach(function (o) {
      var e = o[0], st = styleFor(e, o[1]), lines = [];
      if (o[1] !== 'dim') {
        var dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
        lines.push(L.polyline(e.step.geom, { color: dark ? '#0b0d10' : '#ffffff', weight: st.weight + 4, opacity: e.step.mode === 'walk' ? 0 : 0.85, interactive: false }).addTo(map));
      }
      lines.push(L.polyline(e.step.geom, Object.assign({ interactive: false }, st)).addTo(map));
      var hit = L.polyline(e.step.geom, { weight: 24, opacity: 0, interactive: true }).addTo(map);
      hit.on('click', function () { openSheet(e); });
      lines.push(hit);
      lineLayers.push({ e: e, lines: lines });
    });
  }

  function pinIcon(cat, cls) {
    var c = CAT[cat] || CAT.food;
    return L.divIcon({ className: 'pin ' + (cls || ''), iconSize: [40, 40], iconAnchor: [18, 40],
      html: '<div class="b" style="background:' + c.c + '"><span>' + c.icon + '</span></div>' });
  }
  function drawPins() {
    Object.keys(pinLayers).forEach(function (k) { map.removeLayer(pinLayers[k]); });
    pinLayers = {};
    stopLayer.clearLayers();
    // 장소는 모든 날짜 것을 그리되, 선택한 날짜에 쓰이는 지점만 진하게
    var used = {};
    DAYS[selDay].list.forEach(function (e) {
      if (e.type === 'place') used[e.step.pt] = true;
      if (e.type === 'move') { used[e.step.from_pt] = true; used[e.step.to_pt] = true; }
    });
    var seen = {};
    // 선택한 날 장소가 먼저 (같은 숙소가 여러 날에 나와도 선택한 날 것을 쓰도록)
    var all = DAYS[selDay].list.concat([].concat.apply([], DAYS.map(function (D) { return D.list; })));
    all.forEach(function (e) {
      if (e.type !== 'place' || seen[e.step.pt]) return;
      seen[e.step.pt] = true;
      var isCur = cur && cur.type === 'place' && cur.step.pt === e.step.pt && cur.day === selDay;
      var mk = L.marker([e.step.lat, e.step.lon], { icon: pinIcon(e.step.category, (used[e.step.pt] ? '' : 'dim') + (isCur ? ' cur' : '')),
        zIndexOffset: used[e.step.pt] ? 500 : 0, keyboard: false }).addTo(map);
      mk.on('click', function () { openSheet(e); });
      pinLayers[e.step.pt] = mk;
    });
    // 선택한 날의 역·정류장 (장소 핀이 없는 이동 끝점)
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
        m.on('click', function () { openSheet(e); });
        stopLayer.addLayer(m);
      });
    });
  }

  function dayBounds(di) {
    var b = L.latLngBounds([]);
    DAYS[di].list.forEach(function (e) {
      if (e.type === 'move' && e.step.mode !== 'flight') e.step.geom.forEach(function (p) { b.extend(p); });
      if (e.type === 'place') b.extend([e.step.lat, e.step.lon]);
    });
    return b;
  }
  function fitDay(di) {
    var b = dayBounds(di);
    if (b.isValid()) map.fitBounds(b, { paddingTopLeft: [20, 70], paddingBottomRight: [20, dockH() + 20], maxZoom: 16 });
  }
  function dockH() { return window.innerHeight - $('card').getBoundingClientRect().top; }

  // ------------------------------------------------------------ 탭
  function drawTabs() {
    var today = tokyoNow().date;
    $('tabs').innerHTML = DAYS.map(function (D, i) {
      var l = dayLabel(D.d.date);
      return '<button role="tab" data-i="' + i + '" aria-selected="' + (i === selDay) + '">' + l.md + '<small>' + l.wd + '요일</small>' + (D.d.date === today ? '<i class="today"></i>' : '') + '</button>';
    }).join('');
  }
  $('tabs').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    selectDay(+b.dataset.i, true);
  });
  function selectDay(i, fit) {
    selDay = i;
    var d = DAYS[i].d, l = dayLabel(d.date);
    $('dayTitle').textContent = l.md + ' (' + l.wd + ') ' + d.theme;
    $('dayMeta').innerHTML = esc(d.weather) + (d.alert ? ' · <span class="alert">' + esc(d.alert) + '</span>' : '');
    drawTabs(); drawLines(); drawPins();
    if (fit) fitDay(i);
  }

  // ------------------------------------------------------------ 지금 구간 판단
  function tripDayIndex(date) { for (var i = 0; i < DAYS.length; i++) if (DAYS[i].d.date === date) return i; return -1; }
  function distToEntry(p, e) {
    if (e.type === 'move') return e.step.mode === 'flight' ? Infinity : project(p, e.step.geom).d;
    if (e.type === 'place') return Math.max(0, hav(p, [e.step.lat, e.step.lon]) - e.step.radius);
    return Infinity;
  }
  function inFukuoka(p) { return p[0] > 33.3 && p[0] < 33.95 && p[1] > 130.0 && p[1] < 130.8; }
  function computeCurrent() {
    var now = tokyoNow(), di = tripDayIndex(now.date);
    if (di < 0) return { di: di, now: now, e: null };
    var list = DAYS[di].list, t = now.min;
    // 시각 기준 후보: 진행 중인 것, 없으면 다음 것
    var byTime = null;
    for (var i = 0; i < list.length; i++) if (list[i].start <= t && t < list[i].end) byTime = list[i];
    var waiting = false;
    if (!byTime) { byTime = list.find(function (e) { return e.start > t; }) || list[list.length - 1]; waiting = byTime.start > t; }
    var best = byTime;
    // 위치가 있으면 거리+시각 점수로 가장 그럴듯한 구간 (100m = 1점, 앞뒤 15분 여유 밖으로 10분 = 1점)
    // 비슷하면 시각 기준 구간을 우선 (역에 도착해 다음 버스를 기다리는 경우 등)
    if (gps && gps.acc < 500 && inFukuoka([gps.lat, gps.lon])) {
      var p = [gps.lat, gps.lon], bs = Infinity;
      list.forEach(function (e) {
        var d = distToEntry(p, e); if (!isFinite(d)) return;
        var gap = t < e.start - 15 ? e.start - 15 - t : t > e.end + 15 ? t - e.end - 15 : 0;
        var raw = t < e.start ? e.start - t : t > e.end ? t - e.end : 0;
        var s = d / 100 + gap / 10 + raw / 100 - (e === byTime ? 0.5 : 0);
        if (s < bs) { bs = s; best = e; }
      });
      if (bs > 12) best = byTime; // 어디에도 안 맞으면 시각 기준
      if (best !== byTime) waiting = false;
      // 이동 구간의 도착 지점에 이미 와 있으면 다음 구간으로
      if (best.type === 'move' && best.step.mode !== 'flight' && list[best.idx + 1]) {
        var pr = project(p, best.step.geom);
        if (pr.d < 80 && pr.remain < 50) { best = list[best.idx + 1]; waiting = t < best.start; }
      }
    }
    return { di: di, now: now, e: best, waiting: t < best.start };
  }

  // ------------------------------------------------------------ 지금/다음 카드
  var lastState = null;
  function update(refit) {
    var st = computeCurrent();
    lastState = st;
    var prev = cur;
    cur = st.e;
    if (prev !== cur) { drawLines(); drawPins(); }
    renderCard(st);
    if (refit && st.di >= 0 && st.di !== selDay) selectDay(st.di, true);
    checkOffRoute(st);
  }
  function renderCard(st) {
    var now = st.now;
    if (st.di < 0) {
      var first = DAYS[0].d.date, last = DAYS[DAYS.length - 1].d.date;
      if (now.date < first) {
        var dd = Math.round((new Date(first + 'T00:00:00+09:00') - new Date(now.date + 'T00:00:00+09:00')) / 86400000);
        $('nowText').textContent = '여행 전 · D-' + dd;
        $('nextText').textContent = dayLabel(first).md + ' ' + entryTime(DAYS[0].list[0]).slice(0, 5) + ' ' + entryTitle(DAYS[0].list[0]);
      } else {
        $('nowText').textContent = '여행 끝 — 수고하셨습니다 🙏';
        $('nextText').textContent = '—';
      }
      $('distText').textContent = '';
      return;
    }
    var e = st.e, list = DAYS[st.di].list, next = list[e.idx + 1];
    $('nowText').innerHTML = st.waiting
      ? '<span class="t">' + fmtMin(e.start - now.min) + '</span> 뒤 시작 · ' + esc(entryTitle(e, true))
      : '<span class="t">' + entryTime(e) + '</span> ' + esc(entryTitle(e, true));
    var nx = next;
    $('nextText').innerHTML = nx ? '<span class="t">' + entryTime(nx).slice(0, 5) + '</span> ' + esc(entryTitle(nx, true)) : (st.di + 1 < DAYS.length ? '내일 ' + esc(entryTitle(DAYS[st.di + 1].list[0], true)) : '—');

    // 남은 거리·시간
    var here = gps && inFukuoka([gps.lat, gps.lon]) ? [gps.lat, gps.lon] : null;
    var txt = '';
    if (e.type === 'move' && !st.waiting && e.step.mode !== 'flight') {
      var rem = here ? project(here, e.step.geom) : null;
      var dist = rem && rem.d < 300 ? rem.remain : here ? hav(here, e.step.b) : e.step.dist_m;
      txt = esc(e.step.to) + '까지 <b>' + fmtDist(dist) + '</b> · ' + fmtTime(e.end) + ' 도착 예정 (<b>' + fmtMin(Math.max(0, e.end - now.min)) + '</b> 남음)';
    } else {
      var target = st.waiting ? e : next, tp = target ? entryPoint(target, 'start') : null;
      var from = here || entryPoint(e, 'end');
      if (target && tp) {
        var d2 = from ? hav(from, tp) : null;
        var name = target.type === 'move' ? target.step.from : target.step.name;
        txt = (d2 != null && d2 > 30 ? esc(name) + '까지 <b>' + fmtDist(d2) + '</b> · ' : '') + fmtTime(target.start) + ' 출발까지 <b>' + fmtMin(Math.max(0, target.start - now.min)) + '</b>';
      } else if (target) {
        txt = fmtTime(target.start) + '까지 <b>' + fmtMin(Math.max(0, target.start - now.min)) + '</b>';
      }
    }
    if (!gps) txt += txt ? ' · <span style="opacity:.8">GPS 꺼짐</span>' : '';
    $('distText').innerHTML = txt;
  }
  function fmtTime(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.round(m % 60)).padStart(2, '0'); }
  $('card').addEventListener('click', function () {
    var st = lastState;
    if (st && st.e) { if (st.di !== selDay) selectDay(st.di, false); openSheet(st.e); }
    else openSheet(DAYS[selDay].list.find(function (e) { return e.type !== 'task'; }));
  });

  // ------------------------------------------------------------ 시트
  var sheetEntry = null;
  function gmapsUrl(e) {
    var s = e.step, u = 'https://www.google.com/maps/dir/?api=1';
    if (e.type === 'place') return u + '&destination=' + s.lat + ',' + s.lon;
    var m = MODE[s.mode];
    return u + '&origin=' + s.a[0] + ',' + s.a[1] + '&destination=' + s.b[0] + ',' + s.b[1] + (m.gm ? '&travelmode=' + m.gm : '');
  }
  function openSheet(e) {
    if (!e) return;
    sheetEntry = e;
    var h = '', s = e.step;
    if (e.type === 'task') {
      h = '<div class="sh-title">' + esc(e.text) + '</div><div class="sh-time">' + entryTime(e) + '</div>';
    } else if (e.type === 'place') {
      var c = CAT[s.category] || CAT.food;
      h += '<span class="sh-kind" style="background:' + c.c + '">' + c.icon + ' ' + c.label + '</span>';
      h += '<div class="sh-title">' + esc(s.name) + '</div><div class="sh-ja" lang="ja">' + esc(s.name_ja) + '</div>';
      h += '<div class="sh-time">' + entryTime(e) + '</div>';
      h += '<dl class="sh-grid">';
      if (s.address) h += '<dt>주소</dt><dd lang="ja">' + esc(s.address) + '</dd>';
      if (s.cost_jpy) h += '<dt>예상 비용</dt><dd>' + yen(s.cost_jpy) + ' <span style="color:var(--sub)">≈ ' + won(s.cost_jpy) + '</span>' + (s.cost_est ? '<span class="badge">추정</span>' : '') + '</dd>';
      h += '</dl>';
      if (s.notes.length) h += '<ul class="sh-notes">' + s.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
      h += '<div class="sh-actions"><button data-copy="' + esc(s.name_ja) + '">📋 일본어 이름 복사</button>' +
        (s.address ? '<button data-copy="' + esc(s.address) + '">📋 주소 복사</button>' : '<button data-fly="1">🗺️ 지도에서 보기</button>') +
        '<a class="primary wide" href="' + gmapsUrl(e) + '" target="_blank" rel="noopener">구글 지도 길찾기</a></div>';
      h += '<div class="sh-src">위치: ' + esc(s.coord_src) + '</div>';
    } else {
      var m = MODE[s.mode], col = m.c.indexOf('var(') === 0 ? '#6b6b6b' : m.c;
      h += '<span class="sh-kind" style="background:' + col + '">' + m.icon + ' ' + m.label + '</span>';
      h += '<div class="sh-title">' + esc(s.from) + ' → ' + esc(s.to) + '</div>';
      if (s.to_ja) h += '<div class="sh-ja" lang="ja">' + esc(s.from_ja || '') + ' → ' + esc(s.to_ja) + '</div>';
      h += '<div class="sh-time">' + s.dep + ' 출발 → ' + s.arr + ' 도착 <span style="font-weight:500;color:var(--sub)">(' + fmtMin(e.end - e.start) + ')</span>' +
        (s.est || s.est_time ? '<span class="badge">시각 추정</span>' : '') + '</div>';
      h += '<dl class="sh-grid">';
      if (s.line) h += '<dt>노선</dt><dd lang="ja">' + esc(s.line) + '</dd>';
      if (s.fare_jpy != null) h += '<dt>운임</dt><dd>' + (s.fare_jpy ? yen(s.fare_jpy) + ' <span style="color:var(--sub)">≈ ' + won(s.fare_jpy) + '</span>' : '무료') + (s.est_fare ? '<span class="badge">운임 추정</span>' : '') + '</dd>';
      if (s.mode !== 'flight') h += '<dt>거리</dt><dd>' + fmtDist(s.dist_m) + ' (지도 경로)</dd>';
      if (s.note) h += '<dt>메모</dt><dd>' + esc(s.note) + '</dd>';
      h += '</dl>';
      h += '<div class="sh-actions">' + (s.to_ja ? '<button data-copy="' + esc(s.to_ja) + '">📋 ' + esc(s.to_ja) + ' 복사</button>' : '') +
        '<button data-fly="1">🗺️ 지도에서 보기</button>' +
        (m.gm ? '<a class="primary wide" href="' + gmapsUrl(e) + '" target="_blank" rel="noopener">구글 지도 길찾기 (' + (m.gm === 'walking' ? '도보' : '대중교통') + ')</a>' : '') + '</div>';
      h += '<div class="sh-src">출처: ' + esc(s.source || (s.est || s.est_time ? '추정 (엑셀 파란 글씨)' : '엑셀 일정')) + '</div>';
    }
    $('sheetBody').innerHTML = h;
    $('sheetBody').scrollTop = 0;
    var list = DAYS[e.day].list;
    $('sPrev').disabled = e.idx === 0;
    $('sNext').disabled = e.idx === list.length - 1;
    $('sheet').classList.add('show'); $('sheet').setAttribute('aria-hidden', 'false');
    $('scrim').classList.add('show');
    if (e.day !== selDay) selectDay(e.day, false);
  }
  function closeSheet() { $('sheet').classList.remove('show'); $('sheet').setAttribute('aria-hidden', 'true'); $('scrim').classList.remove('show'); }
  function flyTo(e) {
    closeSheet();
    if (e.type === 'place') map.flyTo([e.step.lat, e.step.lon], 17);
    else if (e.type === 'move') map.flyToBounds(L.latLngBounds([].concat.apply([], e.step.geom)), { paddingTopLeft: [30, 80], paddingBottomRight: [30, dockH() + 30], maxZoom: 17 });
  }
  $('scrim').addEventListener('click', closeSheet);
  $('sClose').addEventListener('click', closeSheet);
  $('sPrev').addEventListener('click', function () { if (sheetEntry) openSheet(DAYS[sheetEntry.day].list[sheetEntry.idx - 1]); });
  $('sNext').addEventListener('click', function () { if (sheetEntry) openSheet(DAYS[sheetEntry.day].list[sheetEntry.idx + 1]); });
  $('sheetBody').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.fly) return flyTo(sheetEntry);
    if (b.dataset.copy != null) copy(b.dataset.copy, b);
  });
  // 시트 아래로 끌어내리기
  (function () {
    var y0 = null, sh = $('sheet');
    sh.addEventListener('touchstart', function (e) { if ($('sheetBody').scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
    sh.addEventListener('touchmove', function (e) { if (y0 != null) { var dy = e.touches[0].clientY - y0; if (dy > 0) sh.style.transform = 'translateY(' + dy + 'px)'; } }, { passive: true });
    sh.addEventListener('touchend', function (e) {
      if (y0 == null) return; var dy = e.changedTouches[0].clientY - y0; y0 = null; sh.style.transform = '';
      if (dy > 90) closeSheet();
    });
  })();
  function copy(text, btn) {
    function done() { var o = btn.innerHTML; btn.innerHTML = '✅ 복사됨'; setTimeout(function () { btn.innerHTML = o; }, 1400); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} document.body.removeChild(ta);
    }
  }

  // ------------------------------------------------------------ GPS
  var watchId = null, meMarker = null, accCircle = null, compassOn = false, lastCompass = null;
  var meIcon = L.divIcon({ className: '', iconSize: [60, 60], iconAnchor: [30, 30],
    html: '<div class="me"><svg class="cone" viewBox="0 0 60 60"><defs><radialGradient id="cg" cx="50%" cy="100%" r="100%"><stop offset="0" stop-color="#1a73e8" stop-opacity=".55"/><stop offset="1" stop-color="#1a73e8" stop-opacity="0"/></radialGradient></defs><path d="M30 30 L16 2 A30 30 0 0 1 44 2 Z" fill="url(#cg)"/></svg><div class="dot"></div></div>' });

  function setBtn(id, on, label) {
    var b = $(id); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (label) b.querySelector('.t').textContent = label;
  }
  function gpsStart() {
    if (watchId != null) return;
    if (!('geolocation' in navigator)) { toast('이 브라우저는 위치를 지원하지 않아요'); return; }
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
    setBtn('bGpsOff', true, 'GPS 끄기');
    compassStart();
  }
  function gpsStop() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null; gps = null;
    if (meMarker) { map.removeLayer(meMarker); map.removeLayer(accCircle); meMarker = accCircle = null; }
    setBtn('bGpsOff', false, 'GPS 켜기');
    follow = false; setBtn('bFollow', false);
    compassStop();
    offState = { count: 0, shown: false };
    update(false);
  }
  var firstFix = null;
  function onPos(p) {
    var c = p.coords;
    // 걷거나 탈 때는 GPS 진행 방향, 멈춰 있으면 나침반
    var gh = (c.heading != null && !isNaN(c.heading) && (c.speed || 0) > 0.7) ? c.heading : null;
    gps = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, gpsHeading: gh, heading: gh != null ? gh : lastCompass };
    var ll = [gps.lat, gps.lon];
    if (!meMarker) {
      accCircle = L.circle(ll, { radius: gps.acc, color: '#1a73e8', weight: 1, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { icon: meIcon, zIndexOffset: 2000, interactive: false }).addTo(map);
    } else { meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(gps.acc); }
    drawHeading();
    if (firstFix) { var f = firstFix; firstFix = null; f(); }
    if (follow) map.setView(ll, Math.max(map.getZoom(), 16), { animate: true });
    update(false);
  }
  function onPosErr(err) {
    if (err.code === 1) { toast('위치 권한이 꺼져 있어요 — 브라우저 설정에서 허용해 주세요'); gpsStop(); }
    else toast('위치를 아직 못 잡았어요');
  }
  function drawHeading() {
    if (!meMarker) return;
    var el = meMarker.getElement(); if (!el) return;
    var me = el.querySelector('.me'), cone = el.querySelector('.cone');
    var h = gps && gps.heading;
    me.classList.toggle('has-heading', h != null);
    if (h != null) cone.style.transform = 'rotate(' + h + 'deg)';
  }
  // 나침반 (멈춰 있을 때 방향) — GPS 켰을 때만
  function onOrient(ev) {
    var h = null;
    if (ev.webkitCompassHeading != null) h = ev.webkitCompassHeading;
    else if (ev.absolute && ev.alpha != null) h = (360 - ev.alpha) % 360;
    if (h == null) return;
    var so = (screen.orientation && screen.orientation.angle) || 0;
    lastCompass = (h + so) % 360;
    if (gps && gps.gpsHeading == null) { gps.heading = lastCompass; drawHeading(); }
  }
  function compassStart() {
    if (compassOn) return; compassOn = true;
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient);
    else window.addEventListener('deviceorientation', onOrient);
  }
  function compassStop() {
    compassOn = false; lastCompass = null;
    window.removeEventListener('deviceorientationabsolute', onOrient);
    window.removeEventListener('deviceorientation', onOrient);
  }

  $('bLocate').addEventListener('click', function () {
    if (gps) { map.setView([gps.lat, gps.lon], Math.max(map.getZoom(), 17)); return; }
    firstFix = function () { map.setView([gps.lat, gps.lon], 17); };
    gpsStart(); toast('위치 찾는 중…');
  });
  $('bFollow').addEventListener('click', function () {
    follow = !follow; setBtn('bFollow', follow);
    if (follow) { if (!gps) { gpsStart(); toast('위치 찾는 중…'); } else map.setView([gps.lat, gps.lon], Math.max(map.getZoom(), 16)); }
  });
  $('bGpsOff').addEventListener('click', function () { if (watchId != null) { gpsStop(); toast('GPS 껐어요'); } else { gpsStart(); toast('위치 찾는 중…'); } });
  map.on('dragstart', function () { if (follow) { follow = false; setBtn('bFollow', false); } });

  // ------------------------------------------------------------ 경로 이탈 (200m) — 조용히
  var offState = { count: 0, shown: false };
  function checkOffRoute(st) {
    if (!gps || st.di < 0 || gps.acc > 100 || !inFukuoka([gps.lat, gps.lon])) return;
    var p = [gps.lat, gps.lon], d = Infinity;
    DAYS[st.di].list.forEach(function (e) { d = Math.min(d, distToEntry(p, e)); });
    if (d > 200) {
      offState.count++;
      if (offState.count >= 2 && !offState.shown) { offState.shown = true; toast('경로에서 ' + fmtDist(d) + ' 벗어났어요', 6000); }
    } else if (d < 150) { offState = { count: 0, shown: false }; }
  }

  // ------------------------------------------------------------ 화면 꺼짐 방지
  var wakeLock = null, wakeWanted = false;
  async function wakeOn() {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', function () { wakeLock = null; if (!wakeWanted) setBtn('bWake', false); });
      setBtn('bWake', true);
    } catch (e) { wakeWanted = false; setBtn('bWake', false); toast('화면 켜둠을 쓸 수 없어요 (절전 모드?)'); }
  }
  $('bWake').addEventListener('click', function () {
    if (!('wakeLock' in navigator)) { toast('이 브라우저는 화면 켜둠을 지원하지 않아요'); return; }
    wakeWanted = !wakeWanted;
    if (wakeWanted) wakeOn(); else { if (wakeLock) wakeLock.release(); setBtn('bWake', false); }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { if (wakeWanted && !wakeLock) wakeOn(); update(false); }
  });

  // ------------------------------------------------------------ 테마
  function isDark() { var t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
  function themeUI() {
    var d = isDark();
    $('bTheme').querySelector('.i').textContent = d ? '☀️' : '🌙';
    $('bTheme').querySelector('.t').textContent = d ? '라이트' : '다크';
    document.querySelector('meta[name=theme-color]').content = d ? '#1b1f27' : '#ffffff';
  }
  $('bTheme').addEventListener('click', function () {
    var t = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch (e) {}
    themeUI(); drawLines();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { themeUI(); drawLines(); });

  // ------------------------------------------------------------ 토스트
  var toastT = null;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, ms || 2500);
  }

  // ------------------------------------------------------------ 시작
  function layout() { document.documentElement.style.setProperty('--dock', dockH() + 'px'); }
  window.addEventListener('resize', layout);
  themeUI();
  var st0 = computeCurrent();
  selDay = st0.di >= 0 ? st0.di : 0;
  selectDay(selDay, false);
  update(false);
  layout();
  fitDay(selDay);
  setInterval(function () { update(false); }, 30000);

  // 테스트용 노출
  window.__app = { state: function () { return lastState && { di: lastState.di, idx: lastState.e && lastState.e.idx, title: lastState.e && entryTitle(lastState.e), waiting: lastState.waiting }; }, selDay: function () { return selDay; } };
})();
