(() => {
'use strict';

/* =====================================================================
   Utilidades
   ===================================================================== */
const KEY = 'tatuador_v1';
const EVKEY = 'tatuador_agenda_v1';
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MES_C = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const keyOf = (y, m) => `${y}-${pad(m + 1)}`;
const inMonth = (ds, key) => !!ds && ds.slice(0, 7) === key;
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const nf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const round2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const money = v => 'R$ ' + nf.format(round2(v));
const moneyHtml = v => `<span class="cur">R$</span>${nf.format(round2(v))}`;
const fmtDate = ds => isDate(ds) ? `${ds.slice(8, 10)}/${ds.slice(5, 7)}/${ds.slice(0, 4)}` : '';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function parseMoney(s) {
  if (s == null) return 0;
  s = String(s).replace(/[^\d,.\-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
const moneyField = v => (v ? String(round2(v)).replace('.', ',') : '');

/* =====================================================================
   Dados
   ===================================================================== */
function defaultSettings() {
  return { proxyUrl: '', filtro: '', lastBackup: null, snoozeUntil: 0 };
}

function cleanProject(p) {
  if (!p || typeof p !== 'object') return null;
  const datas = Array.from(new Set((Array.isArray(p.datas) ? p.datas : []).filter(isDate))).sort();
  const num = v => { const n = Number(v); return isFinite(n) && n > 0 ? round2(n) : 0; };
  return {
    id: String(p.id || uid()),
    cliente: String(p.cliente || '').trim(),
    desenho: String(p.desenho || '').trim(),
    valor: num(p.valor),
    sinalData: isDate(p.sinalData) ? p.sinalData : '',
    sinalValor: num(p.sinalValor),
    pagData: isDate(p.pagData) ? p.pagData : '',
    datas
  };
}

function load() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY));
    if (j && Array.isArray(j.projects)) {
      return {
        projects: j.projects.map(cleanProject).filter(Boolean),
        settings: Object.assign(defaultSettings(), j.settings || {})
      };
    }
  } catch (e) { /* dados ausentes ou corrompidos */ }
  return { projects: [], settings: defaultSettings() };
}
let db = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('Não foi possível salvar neste aparelho'); }
}

/* =====================================================================
   Índices
   ===================================================================== */
function stats(key, today) {
  let received = 0, sessions = 0, clients = 0, pendSum = 0, pendCount = 0;
  for (const p of db.projects) {
    const sv = p.sinalValor || 0, valor = p.valor || 0;
    if (inMonth(p.sinalData, key)) received += sv;
    if (inMonth(p.pagData, key)) received += Math.max(0, valor - sv);

    const s = p.datas.filter(d => inMonth(d, key) && d <= today).length;
    if (s > 0) { sessions += s; clients += 1; }

    if (!p.pagData) {
      const relevant = p.datas.some(d => inMonth(d, key)) || (!p.datas.length && inMonth(p.sinalData, key));
      const saldo = Math.max(0, valor - sv);
      if (relevant && saldo > 0) { pendSum += saldo; pendCount += 1; }
    }
  }
  return {
    received, sessions, clients, pendSum, pendCount,
    perClient: clients ? received / clients : null,
    perSession: sessions ? received / sessions : null
  };
}

/* =====================================================================
   Agenda (iCal via proxy)
   ===================================================================== */
let agenda = loadAgenda();
function loadAgenda() {
  try {
    const j = JSON.parse(localStorage.getItem(EVKEY));
    if (j && Array.isArray(j.list)) return j;
  } catch (e) { /* ignora */ }
  return { at: 0, list: [], error: '' };
}
function saveAgenda() {
  try { localStorage.setItem(EVKEY, JSON.stringify(agenda)); } catch (e) { /* ignora */ }
}

function unescIcs(s) {
  return String(s || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

function parseICS(text) {
  const lines = [];
  String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').forEach(l => {
    if (/^[ \t]/.test(l) && lines.length) lines[lines.length - 1] += l.slice(1);
    else lines.push(l);
  });
  const evs = [];
  let cur = null, inAlarm = false;
  for (const line of lines) {
    const up = line.trim().toUpperCase();
    if (up === 'BEGIN:VEVENT') { cur = {}; inAlarm = false; continue; }
    if (up === 'END:VEVENT') { if (cur && cur.DTSTART) evs.push(cur); cur = null; continue; }
    if (!cur) continue;
    if (up === 'BEGIN:VALARM') { inAlarm = true; continue; }
    if (up === 'END:VALARM') { inAlarm = false; continue; }
    if (inAlarm) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const left = line.slice(0, idx), val = line.slice(idx + 1);
    const parts = left.split(';');
    const name = parts[0].toUpperCase();
    if (name === 'EXDATE') { (cur.EXDATE = cur.EXDATE || []).push(...val.split(',')); continue; }
    cur[name] = val;
  }
  return evs;
}

function parseDT(val) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(val || '').trim());
  if (!m) return null;
  const Y = +m[1], Mo = +m[2] - 1, D = +m[3];
  if (m[4] === undefined) return { allDay: true, date: new Date(Y, Mo, D) };
  const h = +m[4], mi = +m[5], s = +(m[6] || 0);
  return { allDay: false, date: m[7] ? new Date(Date.UTC(Y, Mo, D, h, mi, s)) : new Date(Y, Mo, D, h, mi, s) };
}

function parseRule(r) {
  const o = {};
  String(r || '').split(';').forEach(kv => { const i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1); });
  return o;
}

// Gera as datas de início de um evento recorrente (aproximação: DAILY, WEEKLY(+BYDAY), MONTHLY, YEARLY)
function expandRule(start, rule, exdates, limit) {
  const out = [];
  const interval = Math.max(1, +rule.INTERVAL || 1);
  const count = rule.COUNT ? +rule.COUNT : Infinity;
  const untilP = rule.UNTIL ? parseDT(rule.UNTIL) : null;
  const untilStr = untilP ? ymd(untilP.date) : null;
  const ex = new Set(exdates);
  let n = 0;
  const h = start.getHours(), mi = start.getMinutes();
  const accept = d => {
    if (untilStr && ymd(d) > untilStr) return false;
    if (d > limit) return false;
    n++;
    if (!ex.has(ymd(d))) out.push(new Date(d));
    return n < count;
  };
  const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  let guard = 0;
  if (rule.FREQ === 'DAILY') {
    for (let i = 0; guard++ < 1500; i += interval) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, h, mi);
      if (!accept(d)) break;
    }
  } else if (rule.FREQ === 'WEEKLY') {
    const by = rule.BYDAY ? rule.BYDAY.split(',').map(x => DAYS.indexOf(x.replace(/[^A-Z]/g, ''))).filter(x => x >= 0) : [start.getDay()];
    const ws = new Date(start.getFullYear(), start.getMonth(), start.getDate() - start.getDay());
    for (let i = 0; guard++ < 3000; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, h, mi);
      if (d < start) continue;
      const weeks = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()) - ws) / 6048e5);
      if (weeks % interval !== 0 || !by.includes(d.getDay())) { if (d > limit) break; continue; }
      if (!accept(d)) break;
    }
  } else if (rule.FREQ === 'MONTHLY') {
    for (let i = 0; guard++ < 400; i += interval) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, start.getDate(), h, mi);
      if (d.getDate() !== start.getDate()) continue;
      if (!accept(d)) break;
    }
  } else if (rule.FREQ === 'YEARLY') {
    for (let i = 0; guard++ < 100; i += interval) {
      const d = new Date(start.getFullYear() + i, start.getMonth(), start.getDate(), h, mi);
      if (!accept(d)) break;
    }
  } else {
    out.push(new Date(start));
  }
  return out;
}

function icsToEvents(text) {
  const raw = parseICS(text);
  const list = [];
  const now = new Date();
  const lo = new Date(now.getFullYear(), now.getMonth() - 14, 1);
  const hi = new Date(now.getFullYear(), now.getMonth() + 14, 28);
  for (const ev of raw) {
    if (/CANCELLED/i.test(ev.STATUS || '')) continue;
    const st = parseDT(ev.DTSTART);
    if (!st) continue;
    const en = parseDT(ev.DTEND);
    const title = unescIcs(ev.SUMMARY) || '(sem título)';
    const exd = (ev.EXDATE || []).map(parseDT).filter(Boolean).map(x => ymd(x.date));
    const starts = ev.RRULE ? expandRule(st.date, parseRule(ev.RRULE), exd, hi) : [st.date];
    let spanDays = 1;
    if (st.allDay && en && en.date > st.date) spanDays = Math.max(1, Math.round((en.date - st.date) / 864e5));
    for (const s of starts) {
      if (s < lo || s > hi) continue;
      for (let k = 0; k < Math.min(spanDays, 14); k++) {
        const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + k);
        list.push({ date: ymd(d), time: st.allDay ? '' : `${pad(s.getHours())}:${pad(s.getMinutes())}`, title });
      }
    }
  }
  list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return list;
}

function matchesFilter(ev) {
  const terms = norm(db.settings.filtro).split(/[,;]/).map(t => t.trim()).filter(Boolean);
  if (!terms.length) return true;
  const t = norm(ev.title);
  return terms.some(x => t.includes(x));
}

async function refreshAgenda(opts = {}) {
  const url = (db.settings.proxyUrl || '').trim();
  if (!url) return;
  if (!opts.force && Date.now() - agenda.at < 15 * 60 * 1000) return;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) throw new Error(res.status === 403 ? 'Senha do proxy incorreta (erro 403).' : `O proxy respondeu com erro ${res.status}.`);
    const txt = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(txt)) throw new Error('O endereço respondeu, mas não é uma agenda iCal.');
    agenda = { at: Date.now(), list: icsToEvents(txt), error: '' };
    saveAgenda();
    if (!opts.silent) toast(`Agenda atualizada: ${agenda.list.length} eventos`);
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'A agenda demorou demais para responder.'
      : (e && e.message && !/Failed to fetch|Load failed|NetworkError/i.test(e.message) ? e.message : 'Não foi possível acessar a agenda. Confira o endereço e a conexão.');
    agenda.error = msg;
    saveAgenda();
    if (!opts.silent) toast('Agenda: ' + msg);
  } finally {
    if (timer) clearTimeout(timer);
  }
  renderCal();
  renderSettings();
}

/* =====================================================================
   Navegação
   ===================================================================== */
const now0 = new Date();
const state = { y: now0.getFullYear(), m: now0.getMonth(), selDay: null, chartSel: 11, stack: ['home'] };

function showView(n) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === n));
  window.scrollTo(0, 0);
}
function go(n) { state.stack.push(n); showView(n); }
function back() {
  if (state.stack.length > 1) state.stack.pop();
  showView(state.stack[state.stack.length - 1]);
  renderAll();
}
function slide(el, delta) {
  if (!el) return;
  el.classList.remove('slide-next', 'slide-prev');
  void el.offsetWidth;
  el.classList.add(delta > 0 ? 'slide-next' : 'slide-prev');
}
function shiftMonth(delta, el) {
  const d = new Date(state.y, state.m + delta, 1);
  state.y = d.getFullYear(); state.m = d.getMonth();
  state.chartSel = 11;
  const t = ymd(new Date());
  state.selDay = inMonth(t, keyOf(state.y, state.m)) ? t : null;
  renderHome(); renderCal();
  slide(el, delta);
}
function onSwipe(el, cb) {
  let sx = 0, sy = 0, t0 = 0, on = false;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { on = false; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now(); on = true;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (!on) return; on = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - t0 < 800) cb(dx < 0 ? 1 : -1);
  }, { passive: true });
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* =====================================================================
   Tela inicial
   ===================================================================== */
function renderHome() {
  const key = keyOf(state.y, state.m), today = ymd(new Date());
  const s = stats(key, today);
  $('#mName').textContent = MESES[state.m];
  $('#mYear').textContent = state.y;
  $('#m_received').innerHTML = moneyHtml(s.received);
  $('#m_clients').textContent = s.clients;
  $('#m_sessions').textContent = s.sessions;
  $('#m_perClient').innerHTML = s.perClient == null ? '—' : moneyHtml(s.perClient);
  $('#m_perSession').innerHTML = s.perSession == null ? '—' : moneyHtml(s.perSession);
  $('#m_pend').innerHTML = moneyHtml(s.pendSum);
  $('#m_pendClients').textContent = s.pendCount;
  renderChart();
  renderBanner();
}

function chartPoints() {
  const today = ymd(new Date());
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(state.y, state.m + i - 11, 1);
    const st = stats(keyOf(d.getFullYear(), d.getMonth()), today);
    pts.push({ y: d.getFullYear(), m: d.getMonth(), r: st.received, c: st.clients });
  }
  return pts;
}

function renderChart() {
  const pts = chartPoints();
  const W = 360, base = 104, top = 18, H = base - top, slot = W / 12, bw = 15;
  const maxR = Math.max(1, ...pts.map(p => p.r));
  const maxC = Math.max(0, ...pts.map(p => p.c));
  let bars = '', hits = '', labels = '', dots = '';
  const line = [];
  pts.forEach((p, i) => {
    const cx = slot * i + slot / 2;
    const sel = i === state.chartSel;
    const bh = p.r > 0 ? Math.max(2, (p.r / maxR) * H) : 0;
    if (bh) bars += `<rect class="bar${sel ? ' sel' : ''}" x="${(cx - bw / 2).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" rx="2"/>`;
    else bars += `<rect class="bar${sel ? ' sel' : ''}" x="${(cx - bw / 2).toFixed(1)}" y="${base - 1.5}" width="${bw}" height="1.5" rx=".75"/>`;
    if (maxC > 0) {
      const y = base - (p.c / maxC) * H;
      line.push(`${cx.toFixed(1)},${y.toFixed(1)}`);
      dots += `<circle class="pt${sel ? ' sel' : ''}" cx="${cx.toFixed(1)}" cy="${y.toFixed(1)}" r="${sel ? 3 : 2.2}"/>`;
    }
    labels += `<text class="ax${sel ? ' sel' : ''}" x="${cx.toFixed(1)}" y="${base + 16}">${MES_C[p.m]}</text>`;
    hits += `<rect data-i="${i}" x="${(slot * i).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${base + 24}" fill="transparent"/>`;
  });
  const path = line.length > 1 ? `<polyline class="trend" points="${line.join(' ')}"/>` : '';
  $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${base + 24}" role="img" aria-label="Valor recebido por mês, com a linha de clientes atendidos">${bars}${path}${dots}${labels}${hits}</svg>`;
  const p = pts[state.chartSel];
  $('#chartCaption').textContent = `${MES_C[p.m][0].toUpperCase()}${MES_C[p.m].slice(1)} ${p.y}: ${money(p.r)} recebidos, ${p.c} ${p.c === 1 ? 'cliente' : 'clientes'}`;
}

function renderBanner() {
  const b = $('#backupBanner');
  const lb = db.settings.lastBackup, nowMs = Date.now();
  let msg = '';
  if (db.projects.length) {
    if (!lb) msg = 'Você ainda não fez backup dos seus dados.';
    else {
      const days = Math.floor((nowMs - lb) / 864e5);
      if (days >= 7) msg = `Último backup há ${days} dias.`;
    }
  }
  if (msg && nowMs > (db.settings.snoozeUntil || 0)) { $('#backupMsg').textContent = msg; b.hidden = false; }
  else b.hidden = true;
}

/* =====================================================================
   Calendário do mês
   ===================================================================== */
let evRefs = [];

function dayMap(key) {
  const map = {};
  const slot = d => (map[d] = map[d] || { s: [], e: [] });
  for (const p of db.projects) {
    p.datas.forEach((d, i) => { if (inMonth(d, key)) slot(d).s.push({ p, n: i + 1 }); });
  }
  for (const ev of agenda.list) {
    if (inMonth(ev.date, key) && matchesFilter(ev)) slot(ev.date).e.push(ev);
  }
  for (const d in map) {
    map[d].e.forEach(ev => {
      ev.registered = map[d].s.some(x => x.p.cliente && norm(ev.title).includes(norm(x.p.cliente)));
    });
  }
  return map;
}

function renderCal() {
  const key = keyOf(state.y, state.m);
  $('#calTitle').textContent = `${MESES[state.m]} ${state.y}`;
  const map = dayMap(key);
  const lead = new Date(state.y, state.m, 1).getDay();
  const days = new Date(state.y, state.m + 1, 0).getDate();
  const today = ymd(new Date());
  let html = '';
  for (let i = 0; i < lead; i++) html += '<span class="cell empty"></span>';
  for (let d = 1; d <= days; d++) {
    const ds = `${key}-${pad(d)}`, info = map[ds];
    let dots = '';
    if (info) {
      dots += '<i class="dot s"></i>'.repeat(Math.min(2, info.s.length));
      if (info.e.some(e => !e.registered)) dots += '<i class="dot e"></i>';
    }
    const cls = ['cell'];
    if (ds === today) cls.push('today');
    if (ds === state.selDay) cls.push('sel');
    if (info && info.s.length) cls.push('on');
    html += `<button class="${cls.join(' ')}" data-day="${ds}" aria-label="${d} de ${MESES[state.m]}"><span class="n">${d}</span><span class="dots">${dots}</span></button>`;
  }
  $('#calGrid').innerHTML = html;
  renderDayPanel(map, key);
  renderMonthList(key);
}

function renderDayPanel(map, key) {
  const el = $('#dayPanel');
  const ds = state.selDay;
  evRefs = [];
  if (!ds || !inMonth(ds, key)) { el.innerHTML = ''; return; }
  const info = map[ds] || { s: [], e: [] };
  const title = new Date(ds + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  let html = `<h2>${esc(title)}</h2>`;
  info.s.forEach(({ p, n }) => {
    const per = p.datas.length ? p.valor / p.datas.length : 0;
    html += `<button class="item" data-edit="${esc(p.id)}"><strong>${esc(p.cliente)}</strong>` +
      (p.desenho ? `<span class="sub">${esc(p.desenho)}</span>` : '') +
      `<span class="meta"><span>Sessão ${n} de ${p.datas.length}</span><span>${per ? money(per) : ''}</span></span></button>`;
  });
  info.e.forEach(ev => {
    const i = evRefs.push(ev) - 1;
    html += `<div class="item event"><div><strong>${esc(ev.title)}</strong><span class="sub">${ev.time ? esc(ev.time) : 'Dia todo'} · agenda</span></div>` +
      (ev.registered ? '<span class="tag">Cadastrado</span>' : `<button class="mini-btn" data-ev="${i}">Cadastrar</button>`) + '</div>';
  });
  if (!info.s.length && !info.e.length) html += '<p class="empty-note">Nada marcado neste dia.</p>';
  html += `<button class="btn ghost" data-new-day="${ds}">Cadastrar neste dia</button>`;
  el.innerHTML = html;
}

function renderMonthList(key) {
  const el = $('#monthList');
  const rel = db.projects.filter(p => p.datas.some(d => inMonth(d, key)) || inMonth(p.sinalData, key) || inMonth(p.pagData, key));
  rel.sort((a, b) => {
    const fa = [...a.datas.filter(d => inMonth(d, key)), a.sinalData, a.pagData].filter(d => inMonth(d, key)).sort()[0] || '';
    const fb = [...b.datas.filter(d => inMonth(d, key)), b.sinalData, b.pagData].filter(d => inMonth(d, key)).sort()[0] || '';
    return fa.localeCompare(fb);
  });
  let html = '<h2>Cadastros do mês</h2>';
  if (!rel.length) html += '<p class="empty-note">Nenhum cadastro neste mês.</p>';
  rel.forEach(p => {
    const saldo = Math.max(0, p.valor - p.sinalValor);
    const status = p.pagData ? `Pago em ${fmtDate(p.pagData).slice(0, 5)}` : (saldo > 0 ? `Falta ${money(saldo)}` : 'Sem saldo');
    const sessions = p.datas.length ? p.datas.map(d => d.slice(8, 10) + '/' + d.slice(5, 7)).join(', ') : 'Sem datas de execução';
    html += `<button class="item" data-edit="${esc(p.id)}"><strong>${esc(p.cliente)}</strong>` +
      (p.desenho ? `<span class="sub">${esc(p.desenho)}</span>` : '') +
      `<span class="sub">${esc(sessions)}</span>` +
      `<span class="meta"><span>${money(p.valor)}</span><span class="${!p.pagData && saldo > 0 ? 'warn' : ''}">${esc(status)}</span></span></button>`;
  });
  el.innerHTML = html;
}

/* =====================================================================
   Cadastro / edição
   ===================================================================== */
let editingId = null;
let draft = { sinalData: '', pagData: '', datas: [] };
const CAL_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>';

function paintDates() {
  const set = (id, text) => {
    const b = $(id);
    b.classList.toggle('empty', !text);
    b.innerHTML = `<span>${esc(text || 'Selecionar data')}</span>${CAL_ICON}`;
  };
  set('#b_sinalData', fmtDate(draft.sinalData));
  set('#b_pagData', fmtDate(draft.pagData));
  const ds = draft.datas;
  set('#b_datas', ds.length ? ds.map(fmtDate).join(', ') : '');
  updateDerived();
}

function updateDerived() {
  const n = draft.datas.length;
  const valor = parseMoney($('#f_valor').value);
  $('#o_sessoes').textContent = n || '—';
  $('#o_porSessao').innerHTML = n && valor ? moneyHtml(valor / n) : '—';
}

function openForm(opts = {}) {
  const p = opts.id ? db.projects.find(x => x.id === opts.id) : null;
  editingId = p ? p.id : null;
  const src = p || opts.prefill || {};
  $('#f_cliente').value = src.cliente || '';
  $('#f_desenho').value = src.desenho || '';
  $('#f_valor').value = moneyField(src.valor);
  $('#f_sinalValor').value = moneyField(src.sinalValor);
  draft = { sinalData: src.sinalData || '', pagData: src.pagData || '', datas: Array.from(src.datas || []).sort() };
  $('#formTitle').textContent = p ? 'Editar cliente' : 'Novo cliente';
  $('#f_delete').hidden = !p;
  $('#f_error').hidden = true;
  paintDates();
  go('form');
}

function saveForm(e) {
  e.preventDefault();
  const err = msg => { const el = $('#f_error'); el.textContent = msg; el.hidden = false; };
  const cliente = $('#f_cliente').value.trim();
  const valor = parseMoney($('#f_valor').value);
  const sinalValor = parseMoney($('#f_sinalValor').value);
  if (!cliente) return err('Informe o nome do cliente.');
  if (!valor) return err('Informe o valor da tatuagem.');
  if (sinalValor > valor) return err('O sinal não pode ser maior que o valor.');
  if (sinalValor > 0 && !draft.sinalData) return err('Informe a data do sinal.');
  const proj = cleanProject({
    id: editingId || uid(), cliente, desenho: $('#f_desenho').value.trim(), valor, sinalValor,
    sinalData: sinalValor > 0 ? draft.sinalData : draft.sinalData, pagData: draft.pagData, datas: draft.datas
  });
  const i = db.projects.findIndex(x => x.id === proj.id);
  if (i >= 0) db.projects[i] = proj; else db.projects.push(proj);
  save();
  // mostra no calendário o mês da primeira sessão (ou do sinal) do cadastro salvo
  const ref = proj.datas[0] || proj.sinalData || proj.pagData;
  if (ref && !inMonth(ref, keyOf(state.y, state.m))) {
    state.y = +ref.slice(0, 4); state.m = +ref.slice(5, 7) - 1; state.chartSel = 11;
  }
  const t = ymd(new Date());
  state.selDay = inMonth(t, keyOf(state.y, state.m)) ? t : null;
  toast('Cadastro salvo');
  back();
}

function deleteForm() {
  const p = db.projects.find(x => x.id === editingId);
  if (!p) return;
  if (!confirm(`Excluir o cadastro de ${p.cliente}?`)) return;
  db.projects = db.projects.filter(x => x.id !== editingId);
  save();
  toast('Cadastro excluído');
  back();
}

/* =====================================================================
   Seletor de datas (único ou várias)
   ===================================================================== */
const pk = { mode: 'single', y: 0, m: 0, sel: new Set(), onDone: null };

function openPicker(o) {
  pk.mode = o.mode;
  pk.sel = new Set([].concat(o.selected || []).filter(Boolean));
  const first = Array.from(pk.sel).sort()[0];
  const base = first ? new Date(first + 'T12:00:00') : new Date(state.y, state.m, 1);
  pk.y = base.getFullYear(); pk.m = base.getMonth();
  pk.onDone = o.onDone;
  $('#pkTitle').textContent = o.title;
  const multi = o.mode === 'multi';
  $('#pkDone').hidden = !multi;
  $('#pkClear').hidden = false;
  const hint = $('#pkHint');
  hint.hidden = !multi;
  hint.textContent = 'Toque em vários dias. Toque de novo em um dia selecionado para remover.';
  $('#pk').hidden = false;
  renderPicker();
}
function closePicker() { $('#pk').hidden = true; pk.onDone = null; }

function renderPicker() {
  $('#pkMonth').textContent = `${MESES[pk.m]} ${pk.y}`;
  const key = keyOf(pk.y, pk.m);
  const lead = new Date(pk.y, pk.m, 1).getDay();
  const days = new Date(pk.y, pk.m + 1, 0).getDate();
  const today = ymd(new Date());
  let html = '';
  for (let i = 0; i < lead; i++) html += '<span class="cell empty"></span>';
  for (let d = 1; d <= days; d++) {
    const ds = `${key}-${pad(d)}`;
    const cls = ['cell'];
    if (ds === today) cls.push('today');
    if (pk.sel.has(ds)) cls.push('sel');
    html += `<button type="button" class="${cls.join(' ')}" data-pk="${ds}" aria-pressed="${pk.sel.has(ds)}"><span class="n">${d}</span></button>`;
  }
  $('#pkGrid').innerHTML = html;
  if (pk.mode === 'multi') {
    const n = pk.sel.size;
    $('#pkDone').textContent = n ? `Concluir (${n} ${n === 1 ? 'data' : 'datas'})` : 'Concluir';
  }
}
function pkShift(delta) {
  const d = new Date(pk.y, pk.m + delta, 1);
  pk.y = d.getFullYear(); pk.m = d.getMonth();
  renderPicker();
  slide($('#pkGrid'), delta);
}

/* =====================================================================
   Backup e restauração
   ===================================================================== */
function markBackup() {
  db.settings.lastBackup = Date.now();
  db.settings.snoozeUntil = 0;
  save();
  renderBanner();
  renderSettings();
}

async function doBackup() {
  const payload = {
    app: 'tatuador-registro', version: 1, exportedAt: new Date().toISOString(),
    projects: db.projects,
    settings: { proxyUrl: db.settings.proxyUrl, filtro: db.settings.filtro }
  };
  const name = `backup-tatuagens-${ymd(new Date())}.json`;
  const file = new File([JSON.stringify(payload, null, 2)], name, { type: 'application/json' });
  // O share precisa ser chamado direto do toque, antes de qualquer await.
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Backup do estúdio' });
      markBackup();
      toast('Backup enviado');
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // pessoa fechou o menu: não conta como backup
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  markBackup();
  toast('Arquivo de backup baixado');
}

function restoreFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(r.result);
      if (!j || !Array.isArray(j.projects)) throw new Error('formato');
      const list = j.projects.map(cleanProject).filter(p => p && p.cliente);
      if (!confirm(`Substituir os dados atuais por este backup (${list.length} cadastros)?`)) return;
      db.projects = list;
      if (j.settings) {
        if (typeof j.settings.proxyUrl === 'string') db.settings.proxyUrl = j.settings.proxyUrl;
        if (typeof j.settings.filtro === 'string') db.settings.filtro = j.settings.filtro;
      }
      save(); renderAll(); renderSettings();
      toast('Backup restaurado');
    } catch (e) {
      toast('Esse arquivo não parece um backup válido');
    }
  };
  r.readAsText(file);
}

/* =====================================================================
   Ajustes
   ===================================================================== */
function renderSettings() {
  const lb = db.settings.lastBackup;
  $('#lastBackupText').textContent = lb
    ? `Último backup: ${new Date(lb).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
    : 'Nenhum backup feito ainda.';
  const ps = $('#s_proxy'), fl = $('#s_filtro');
  if (document.activeElement !== ps) ps.value = db.settings.proxyUrl || '';
  if (document.activeElement !== fl) fl.value = db.settings.filtro || '';
  let st = '';
  if (!db.settings.proxyUrl) st = 'Agenda não configurada.';
  else if (agenda.error) st = agenda.error;
  else if (agenda.at) {
    const shown = agenda.list.filter(matchesFilter).length;
    st = `${shown} eventos exibidos de ${agenda.list.length}. Atualizada em ${new Date(agenda.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.`;
  } else st = 'Ainda não carregada.';
  $('#agendaStatus').textContent = st;
}

function saveAgendaSettings() {
  db.settings.proxyUrl = $('#s_proxy').value.trim();
  db.settings.filtro = $('#s_filtro').value.trim();
  save();
  if (!db.settings.proxyUrl) { agenda = { at: 0, list: [], error: '' }; saveAgenda(); renderSettings(); renderCal(); toast('Agenda removida'); return; }
  refreshAgenda({ force: true });
}

/* =====================================================================
   Render geral e eventos
   ===================================================================== */
function renderAll() { renderHome(); renderCal(); renderSettings(); }

function bind() {
  // Início
  $('#monthBtn').addEventListener('click', () => {
    const t = ymd(new Date());
    state.selDay = inMonth(t, keyOf(state.y, state.m)) ? t : state.selDay && inMonth(state.selDay, keyOf(state.y, state.m)) ? state.selDay : null;
    renderCal(); go('cal');
  });
  $('#fab').addEventListener('click', () => openForm());
  $('#backupBtn').addEventListener('click', doBackup);
  $('#bannerBackup').addEventListener('click', doBackup);
  $('#bannerSnooze').addEventListener('click', () => { db.settings.snoozeUntil = Date.now() + 864e5; save(); renderBanner(); });
  $('#settingsBtn').addEventListener('click', () => { renderSettings(); go('settings'); });
  onSwipe($('#swipeHome'), d => shiftMonth(d, $('#swipeHome')));
  $('#chart').addEventListener('click', e => {
    const hit = e.target.closest('[data-i]');
    if (!hit) return;
    state.chartSel = +hit.dataset.i;
    renderChart();
  });

  // Calendário
  $('#calBack').addEventListener('click', back);
  $('#calPrev').addEventListener('click', () => shiftMonth(-1, $('#swipeCal')));
  $('#calNext').addEventListener('click', () => shiftMonth(1, $('#swipeCal')));
  onSwipe($('#swipeCal'), d => shiftMonth(d, $('#swipeCal')));
  $('#swipeCal').addEventListener('click', e => {
    const day = e.target.closest('[data-day]');
    if (day) { state.selDay = state.selDay === day.dataset.day ? null : day.dataset.day; renderCal(); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) { openForm({ id: edit.dataset.edit }); return; }
    const evb = e.target.closest('[data-ev]');
    if (evb) {
      const ev = evRefs[+evb.dataset.ev];
      if (ev) openForm({ prefill: { cliente: ev.title, datas: [ev.date] } });
      return;
    }
    const nd = e.target.closest('[data-new-day]');
    if (nd) openForm({ prefill: { datas: [nd.dataset.newDay] } });
  });

  // Formulário
  $('#formBack').addEventListener('click', back);
  $('#projForm').addEventListener('submit', saveForm);
  $('#f_delete').addEventListener('click', deleteForm);
  $('#f_valor').addEventListener('input', updateDerived);
  $('#b_sinalData').addEventListener('click', () => openPicker({
    mode: 'single', title: 'Data do sinal', selected: draft.sinalData,
    onDone: v => { draft.sinalData = v; paintDates(); }
  }));
  $('#b_pagData').addEventListener('click', () => openPicker({
    mode: 'single', title: 'Data do pagamento', selected: draft.pagData,
    onDone: v => { draft.pagData = v; paintDates(); }
  }));
  $('#b_datas').addEventListener('click', () => openPicker({
    mode: 'multi', title: 'Datas de execução', selected: draft.datas,
    onDone: v => { draft.datas = v; paintDates(); }
  }));

  // Seletor
  $('#pkClose').addEventListener('click', closePicker);
  $('#pkBackdrop').addEventListener('click', closePicker);
  $('#pkPrev').addEventListener('click', () => pkShift(-1));
  $('#pkNext').addEventListener('click', () => pkShift(1));
  onSwipe($('#pkSwipe'), d => pkShift(d));
  $('#pkGrid').addEventListener('click', e => {
    const c = e.target.closest('[data-pk]');
    if (!c) return;
    const ds = c.dataset.pk;
    if (pk.mode === 'single') { const cb = pk.onDone; closePicker(); if (cb) cb(ds); return; }
    if (pk.sel.has(ds)) pk.sel.delete(ds); else pk.sel.add(ds);
    renderPicker();
  });
  $('#pkClear').addEventListener('click', () => {
    if (pk.mode === 'single') { const cb = pk.onDone; closePicker(); if (cb) cb(''); return; }
    pk.sel.clear(); renderPicker();
  });
  $('#pkDone').addEventListener('click', () => {
    const cb = pk.onDone, list = Array.from(pk.sel).sort();
    closePicker();
    if (cb) cb(list);
  });

  // Ajustes
  $('#setBack').addEventListener('click', back);
  $('#s_backup').addEventListener('click', doBackup);
  $('#s_restore').addEventListener('change', e => { restoreFile(e.target.files[0]); e.target.value = ''; });
  $('#s_agenda').addEventListener('click', saveAgendaSettings);
}

function init() {
  bind();
  renderAll();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  refreshAgenda({ silent: true });
}

// Exposto só para testes automatizados
window.__app = { stats, parseMoney, icsToEvents, db: () => db, state, renderAll };

init();
})();
