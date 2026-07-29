/* ================= 报告台账（新增模块，独立挂接 app.js） ================= */
/* 数据存本机 localStorage；云端同步到 cloud-data/reports.json（机制同文案库） */
let reports = [];
let reportFilter = 'all';
let pendingReportDel = new Set();
const RT_COLOR = { '千川': '#3370ff', '销售': '#00b42a', '其他': '#8a90a0' };
const LS_KEY = 'wb_reports_v1';
const rUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function loadReports() {
  try { reports = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { reports = []; }
}
function saveReports() { localStorage.setItem(LS_KEY, JSON.stringify(reports)); }

/* ---- 注入导航 / 视图 / 弹层（不改动 index.html） ---- */
(function injectReportDOM() {
  const nav = document.querySelector('nav');
  if (nav && !document.querySelector('[data-view=report]')) {
    const b = document.createElement('button');
    b.className = 'n-item'; b.dataset.view = 'report';
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>报告';
    const mine = nav.querySelector('[data-view=mine]');
    nav.insertBefore(b, mine);
    b.onclick = () => {
      if (typeof curView === 'undefined') return;
      curView = 'report';
      document.querySelectorAll('nav .n-item').forEach(x => x.classList.toggle('on', x === b));
      document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-report'));
      const pt = document.getElementById('pageTitle'); if (pt) pt.textContent = '报告台账';
      const sw = document.getElementById('searchWrap'); if (sw) sw.style.display = 'flex';
      const fab = document.getElementById('fab'); if (fab) fab.style.display = 'flex';
      render();
    };
  }
  const main = document.querySelector('main');
  if (main && !document.getElementById('view-report')) {
    const sec = document.createElement('section');
    sec.className = 'view'; sec.id = 'view-report';
    sec.innerHTML = '<div class="chips" id="reportChips">' +
      '<div class="chip on" data-rt="all">全部</div>' +
      '<div class="chip" data-rt="千川">千川</div>' +
      '<div class="chip" data-rt="销售">销售</div>' +
      '<div class="chip" data-rt="其他">其他</div>' +
      '</div>' +
      '<button class="btn ghost" id="reportSync" style="margin:4px 0 10px">☁ 报告云同步</button>' +
      '<div id="reportList"></div>' +
      '<div class="empty hidden" id="reportEmpty"><div class="big">📊</div>还没有报告<br>点右侧 + 添加你的千川/销售日报</div>';
    main.appendChild(sec);
  }
  if (!document.getElementById('sheetReport')) {
    const sh = document.createElement('div');
    sh.className = 'sheet'; sh.id = 'sheetReport';
    sh.innerHTML = '<h3 id="reportSheetTitle">添加报告</h3>' +
      '<div class="f-label">标题</div>' +
      '<input class="f-input f-input-lg" id="rTitle" placeholder="例如：7月29日 千川日报">' +
      '<div class="f-row"><div><div class="f-label">日期</div><input class="f-input" type="date" id="rDate"></div>' +
      '<div><div class="f-label">类型</div><select class="f-select" id="rType"><option>千川</option><option>销售</option><option>其他</option></select></div></div>' +
      '<div class="f-label">报告链接（workbuddy.link 或网页地址）</div>' +
      '<input class="f-input" id="rLink" placeholder="https://workbuddy.link/p/... 或 https://...github.io/...">' +
      '<div class="f-label">备注（选填）</div>' +
      '<textarea class="f-area" id="rNote" placeholder="如：今日 ROI 提升，重点看调控计划"></textarea>' +
      '<button class="btn" id="rSave">保存</button>';
    document.body.appendChild(sh);
  }
})();

/* ---- 挂接 app.js 的 titles / render / fab 体系 ---- */
(function hookReport() {
  if (typeof titles !== 'undefined') titles.report = '报告台账';
  if (typeof render === 'function') {
    const _render = render;
    render = function () {
      if (typeof curView !== 'undefined' && curView === 'report') renderReports();
      else _render();
    };
  }
  /* 用 addEventListener 而非包裹 fab.onclick：避免与 app.js 初始化时序冲突
     （app.js 的 fab.onclick 对 'report' 视图本就是空操作，互不影响） */
  const fab = document.getElementById('fab');
  if (fab) fab.addEventListener('click', () => {
    if (typeof curView !== 'undefined' && curView === 'report') openReportSheet();
  });
  const rc = document.getElementById('reportChips');
  if (rc) rc.querySelectorAll('.chip').forEach(c => c.onclick = () => {
    reportFilter = c.dataset.rt;
    rc.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c));
    renderReports();
  });
  const rs = document.getElementById('reportSync');
  if (rs) rs.onclick = () => syncReports(false);
})();

let editReportId = null;
function openReportSheet() {
  editReportId = null;
  const t = document.getElementById('reportSheetTitle'); if (t) t.textContent = '添加报告';
  const a = document.getElementById('rTitle'); if (a) a.value = '';
  const d = document.getElementById('rDate'); if (d) d.value = (typeof todayStr === 'function') ? todayStr() : '';
  const ty = document.getElementById('rType'); if (ty) ty.value = '千川';
  const l = document.getElementById('rLink'); if (l) l.value = '';
  const n = document.getElementById('rNote'); if (n) n.value = '';
  if (typeof openSheet === 'function') openSheet('#sheetReport');
}

document.getElementById('rSave').onclick = () => {
  const title = document.getElementById('rTitle').value.trim();
  if (!title) return (typeof toast === 'function') ? toast('写个标题好找回来') : alert('写个标题好找回来');
  const link = document.getElementById('rLink').value.trim();
  const old = editReportId ? reports.find(r => r.id === editReportId) : null;
  const rec = {
    id: editReportId || rUid(), title,
    date: document.getElementById('rDate').value || ((typeof todayStr === 'function') ? todayStr() : ''),
    type: document.getElementById('rType').value, link,
    note: document.getElementById('rNote').value.trim(),
    created: old ? old.created : Date.now(), updated: Date.now()
  };
  if (editReportId) reports = reports.map(r => r.id === editReportId ? rec : r);
  else reports.push(rec);
  saveReports();
  if (typeof closeSheets === 'function') closeSheets();
  renderReports();
  if (typeof toast === 'function') toast('报告已保存');
};

function renderReports() {
  const kw = (typeof keyword !== 'undefined') ? keyword : '';
  const list = reports.filter(r => reportFilter === 'all' || r.type === reportFilter)
    .filter(r => !kw || (r.title + ' ' + (r.note || '') + ' ' + r.type).toLowerCase().includes(kw))
    .sort((a, b) => (b.date + a.title).localeCompare(a.date + b.title));
  const box = document.getElementById('reportList'); if (!box) return;
  box.innerHTML = '';
  const empty = document.getElementById('reportEmpty'); if (empty) empty.classList.toggle('hidden', reports.length > 0);
  list.forEach(r => {
    const d = document.createElement('div'); d.className = 'card';
    const badge = r.link
      ? '<a class="hot-plat" style="background:' + (RT_COLOR[r.type] || '#999') + ';text-decoration:none" href="' + esc(r.link) + '" target="_blank" rel="noopener">打开报告 ↗</a>'
      : '<span class="hot-plat" style="background:' + (RT_COLOR[r.type] || '#999') + '">' + esc(r.type) + '</span>';
    d.innerHTML = '<div class="copy-title"><span>' + esc(r.title) + '</span>' + badge + '</div>' +
      '<div style="font-size:12px;color:var(--sub)">' + esc(r.date || '') + ' · ' + esc(r.type) + '</div>' +
      (r.note ? '<div class="copy-body" style="margin-top:4px">' + esc(r.note) + '</div>' : '') +
      '<div class="row-actions"><span data-a="open">' + (r.link ? '▶️ 打开' : '🔗 无链接') + '</span><span data-a="copy">📋 复制链接</span><span data-a="edit">✏️ 编辑</span><span class="del" data-a="del">删除</span></div>';
    if (r.link) { const op = d.querySelector('[data-a=open]'); if (op) op.onclick = (e) => { e.stopPropagation(); window.open(r.link, '_blank'); }; }
    const cp = d.querySelector('[data-a=copy]'); if (cp) cp.onclick = async () => {
      if (r.link) { try { await navigator.clipboard.writeText(r.link); if (typeof toast === 'function') toast('链接已复制'); } catch (e) { if (typeof toast === 'function') toast('复制失败'); } }
      else if (typeof toast === 'function') toast('这条没有链接');
    };
    d.querySelector('[data-a=edit]').onclick = () => {
      editReportId = r.id;
      const t = document.getElementById('reportSheetTitle'); if (t) t.textContent = '编辑报告';
      document.getElementById('rTitle').value = r.title;
      document.getElementById('rDate').value = r.date;
      document.getElementById('rType').value = r.type;
      document.getElementById('rLink').value = r.link || '';
      document.getElementById('rNote').value = r.note || '';
      if (typeof openSheet === 'function') openSheet('#sheetReport');
    };
    d.querySelector('[data-a=del]').onclick = async () => {
      if (!confirm('删除这条报告？')) return;
      reports = reports.filter(x => x.id !== r.id);
      pendingReportDel.add(r.id);
      saveReports(); renderReports();
    };
    box.appendChild(d);
  });
  if (reports.length && !list.length) box.innerHTML = '<div class="empty">没有匹配的报告</div>';
}

/* ---- 云端同步：cloud-data/reports.json = {reports:[...], deleted:[id...]} ---- */
function utf8ToB64Rep(str) { const b = new TextEncoder().encode(str); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); }
function b64ToUtf8Rep(b64) { const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new TextDecoder().decode(arr); }
async function syncReports(silent) {
  const token = (typeof $ !== 'undefined') ? $('#ghToken').value.trim() : '';
  const tok = token || (await kvGet('gh_token'));
  if (!tok) { if (!silent) (typeof toast === 'function' ? toast('先在「我的」填 GitHub Token 才能同步报告') : alert('先填 Token')); return; }
  const path = 'cloud-data/reports.json';
  const api = 'https://api.github.com/repos/' + GH.owner + '/' + GH.repo + '/contents/' + path;
  if (!silent) (typeof toast === 'function') ? toast('报告云同步中…') : 0;
  try {
    let cloud = [], cloudDel = [], sha = null;
    const r1 = await fetch(api, { headers: { 'Authorization': 'Bearer ' + tok } });
    if (r1.ok) { const j = await r1.json(); sha = j.sha; const obj = JSON.parse(b64ToUtf8Rep(j.content)); cloud = Array.isArray(obj.reports) ? obj.reports : []; cloudDel = Array.isArray(obj.deleted) ? obj.deleted : []; }
    else if (r1.status !== 404) { const e = await r1.json().catch(() => ({})); throw new Error(e.message || ('HTTP ' + r1.status)); }
    const map = new Map();
    for (const c of cloud) map.set(c.id, c);
    for (const c of reports) map.set(c.id, c);
    const delSet = new Set([...cloudDel, ...pendingReportDel]);
    for (const id of delSet) map.delete(id);
    const merged = [...map.values()];
    const mergedDel = [...delSet];
    const localIds = new Set(reports.map(c => c.id));
    let added = 0, removed = 0;
    for (const c of merged) { if (!localIds.has(c.id)) { reports.push(c); added++; } }
    for (const c of reports.slice()) { if (!map.has(c.id)) { reports = reports.filter(x => x.id !== c.id); removed++; } }
    saveReports();
    const body = { message: 'sync reports ' + new Date().toISOString().slice(0, 19), content: utf8ToB64Rep(JSON.stringify({ reports: merged, deleted: mergedDel }, null, 1)), branch: GH.branch };
    if (sha) body.sha = sha;
    let r2 = await fetch(api, { method: 'PUT', headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r2.status === 409 && sha) {
      const r3 = await fetch(api, { headers: { 'Authorization': 'Bearer ' + tok } }); const j3 = await r3.json();
      body.sha = j3.sha; r2 = await fetch(api, { method: 'PUT', headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    if (!r2.ok) { const e = await r2.json().catch(() => ({})); throw new Error(e.message || ('HTTP ' + r2.status)); }
    pendingReportDel.clear(); saveReports();
    if (typeof curView !== 'undefined' && curView === 'report') renderReports();
    if (!silent) (typeof toast === 'function') ? toast('报告同步完成：新增 ' + added + ' 条、清理 ' + removed + ' 条') : 0;
  } catch (e) {
    if (!silent) (typeof toast === 'function') ? toast('报告同步失败：' + e.message) : 0;
    console.error('[syncReports failed]', e);
  }
}

/* 启动：载入本机数据 + 已配 Token 则静默同步 */
(function reportBoot() {
  loadReports();
  kvGet('gh_token').then(t => { if (t) syncReports(true); }).catch(() => {});
})();
