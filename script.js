// ============================================================
//  SpendLog PWA – Mobile-First Expense Tracker
// ============================================================

// ==================== STATE ====================
let expenses  = JSON.parse(localStorage.getItem('sl_expenses'))  || [];
let recurring = JSON.parse(localStorage.getItem('sl_recurring')) || [];
let budget    = parseFloat(localStorage.getItem('sl_budget'))    || 0;
let goal      = JSON.parse(localStorage.getItem('sl_goal'))      || { income: 0, target: 0 };
let theme     = localStorage.getItem('sl_theme')                 || 'dark';
let editingId = null;
let activeChart = 'donut';
let selectedCat = '';
let deferredPrompt = null; // for PWA install

const CAT_COLORS = {
  Food:'#f0c040', Travel:'#4ab4f0',
  Bills:'#e07b39', Shopping:'#b06cf0', Other:'#4cc97a'
};
const CAT_ICONS = {
  Food:'🍔', Travel:'✈️', Bills:'💡', Shopping:'🛍️', Other:'📦'
};

// ==================== PWA ====================
// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('SW registered'))
      .catch(e => console.log('SW error', e));
  });
}

// Capture install prompt
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById('installBanner');
  banner.style.display = 'flex';
  // Push main content down
  document.querySelector('.main-content').style.top = 'calc(var(--topbar-h) + 44px)';
});

document.getElementById('installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') toast('App installed! 🎉', 'success');
  deferredPrompt = null;
  hideBanner();
});

document.getElementById('dismissInstall').addEventListener('click', hideBanner);

function hideBanner() {
  document.getElementById('installBanner').style.display = 'none';
  document.querySelector('.main-content').style.top = 'var(--topbar-h)';
}

// ==================== INIT ====================
(function init() {
  applyTheme(theme);
  document.getElementById('date').value        = todayStr();
  document.getElementById('budgetInput').value = budget > 0 ? budget : '';
  document.getElementById('goalIncome').value  = goal.income || '';
  document.getElementById('goalTarget').value  = goal.target || '';

  applyRecurringDue();
  refresh();

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('sl_theme', theme);
    applyTheme(theme);
  });

  // Budget
  document.getElementById('budgetInput').addEventListener('change', function () {
    budget = parseFloat(this.value) || 0;
    localStorage.setItem('sl_budget', budget);
    updateStats();
  });

  // Export
  document.getElementById('exportCsvBtn').addEventListener('click', exportCSV);
  document.getElementById('exportPdfBtn').addEventListener('click', exportPDF);
})();

// ==================== THEME ====================
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('themeToggle').textContent = t === 'dark' ? '🌙' : '☀️';
}

// ==================== HELPERS ====================
function uid()      { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function fmt(n)     { return '₹' + parseFloat(n).toFixed(2); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function formatDate(str) {
  if (!str) return '—';
  const [y,m,d] = str.split('-');
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${mo[+m-1]} ${y}`;
}
function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function saveAll() {
  localStorage.setItem('sl_expenses',  JSON.stringify(expenses));
  localStorage.setItem('sl_recurring', JSON.stringify(recurring));
}

// ==================== TOAST ====================
function toast(msg, type='info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ==================== NAVIGATION ====================
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page'+name).classList.add('active');
  document.getElementById('nav-'+name.toLowerCase()).classList.add('active');
  // Scroll page to top
  document.querySelector('.main-content').scrollTop = 0;

  if (name === 'Expenses') renderTable();
  if (name === 'Home')     { refresh(); }
}

// ==================== REFRESH ====================
function refresh() {
  updateStats();
  drawChart();
  renderRecurring();
  updateGoalResult();
}

// ==================== STATS ====================
function updateStats() {
  const today = todayStr(), month = thisMonth();
  let total=0, todays=0, monthly=0;
  expenses.forEach(e => {
    total += e.amount;
    if (e.date === today)          todays   += e.amount;
    if (e.date.startsWith(month))  monthly  += e.amount;
  });
  document.getElementById('totalExpenses').textContent   = fmt(total);
  document.getElementById('todayExpenses').textContent   = fmt(todays);
  document.getElementById('monthlyExpenses').textContent = fmt(monthly);

  // Budget bar
  const wrap = document.getElementById('budgetBarWrap');
  if (budget > 0) {
    wrap.style.display = 'block';
    const pct  = Math.min((monthly/budget)*100, 100);
    const fill = document.getElementById('budgetBarFill');
    fill.style.width      = pct + '%';
    fill.style.background = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--orange)' : 'var(--success)';
    document.getElementById('budgetPct').textContent    = Math.round(pct) + '% used';
    document.getElementById('budgetRemain').textContent = 'Left: ' + fmt(Math.max(budget-monthly, 0));
  } else {
    wrap.style.display = 'none';
  }

  const warn = document.getElementById('budgetWarning');
  if (budget > 0 && monthly > budget) {
    warn.style.display = 'block';
    warn.textContent = `⚠️ Spent ${fmt(monthly)} — over budget by ${fmt(monthly-budget)}!`;
  } else {
    warn.style.display = 'none';
  }

  // Can Save
  if (goal.income > 0) {
    const cs = goal.income - monthly;
    document.getElementById('canSave').textContent = fmt(Math.max(cs,0));
    document.getElementById('canSave').style.color = cs >= 0 ? 'var(--success)' : 'var(--danger)';
  } else {
    document.getElementById('canSave').textContent = '—';
    document.getElementById('canSave').style.color = '';
  }
}

// ==================== CATEGORY SELECTOR ====================
function selectCat(btn) {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedCat = btn.dataset.cat;
  document.getElementById('category').value = selectedCat;
}

// ==================== FORM ====================
function handleSubmit() {
  const amount   = parseFloat(document.getElementById('amount').value);
  const category = document.getElementById('category').value || selectedCat;
  const date     = document.getElementById('date').value;
  const note     = document.getElementById('note').value.trim();
  const isRec    = document.getElementById('isRecurring').checked;
  const freq     = document.getElementById('recurringFreq').value;

  if (!amount || amount <= 0) { toast('Enter a valid amount ⚠️', 'error'); return; }
  if (!category)               { toast('Pick a category ⚠️', 'error');      return; }
  if (!date)                   { toast('Pick a date ⚠️', 'error');           return; }

  if (editingId) {
    const idx = expenses.findIndex(e => e.id === editingId);
    if (idx !== -1) expenses[idx] = { ...expenses[idx], amount, category, date, note };
    cancelEdit();
    toast('Expense updated ✅', 'success');
  } else {
    expenses.push({ id: uid(), amount, category, date, note });
    if (isRec) {
      recurring.push({ id: uid(), amount, category, note, freq, lastApplied: date });
      toast(`Added as ${freq} recurring 🔁`, 'success');
    } else {
      toast('Expense added ✅', 'success');
    }
  }

  saveAll();
  resetForm();
  refresh();
  // Switch to Expenses tab after adding
  setTimeout(() => showPage('Home'), 300);
}

function resetForm() {
  document.getElementById('amount').value   = '';
  document.getElementById('category').value = '';
  document.getElementById('date').value     = todayStr();
  document.getElementById('note').value     = '';
  document.getElementById('isRecurring').checked = false;
  document.getElementById('recurringFreq').style.display = 'none';
  selectedCat = '';
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
}

function cancelEdit() {
  editingId = null;
  document.getElementById('submitBtn').textContent = '+ Add Expense';
  document.getElementById('submitBtn').classList.remove('editing');
  document.getElementById('cancelBtn').style.display  = 'none';
  document.getElementById('formTitle').textContent    = '➕ Add Expense';
  resetForm();
}

function startEdit(id) {
  const exp = expenses.find(e => e.id === id);
  if (!exp) return;
  editingId = id;

  document.getElementById('amount').value   = exp.amount;
  document.getElementById('category').value = exp.category;
  document.getElementById('date').value     = exp.date;
  document.getElementById('note').value     = exp.note;
  selectedCat = exp.category;

  // Highlight category button
  document.querySelectorAll('.cat-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.cat === exp.category);
  });

  document.getElementById('submitBtn').textContent = '✔ Save Changes';
  document.getElementById('submitBtn').classList.add('editing');
  document.getElementById('cancelBtn').style.display = 'block';
  document.getElementById('formTitle').textContent   = '✏️ Edit Expense';

  showPage('Add');
}

function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  expenses = expenses.filter(e => e.id !== id);
  if (editingId === id) cancelEdit();
  saveAll();
  renderTable();
  updateStats();
  drawChart();
  toast('Deleted 🗑️', 'info');
}

// ==================== RECURRING ====================
function toggleRecurringFreq() {
  const show = document.getElementById('isRecurring').checked;
  document.getElementById('recurringFreq').style.display = show ? 'block' : 'none';
}

function renderRecurring() {
  const card = document.getElementById('recurringCard');
  const list = document.getElementById('recurringList');
  if (recurring.length === 0) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  list.innerHTML = recurring.map(r => `
    <div class="recurring-item">
      <div class="rec-info">
        <div class="rec-name">${CAT_ICONS[r.category]||''} ${escHtml(r.note)||r.category}</div>
        <div class="rec-meta">${r.freq} · ${formatDate(r.lastApplied)}</div>
      </div>
      <span class="rec-amount">${fmt(r.amount)}</span>
      <button class="btn-rec-del" onclick="deleteRecurring('${r.id}')">✕</button>
    </div>
  `).join('');
}

function deleteRecurring(id) {
  recurring = recurring.filter(r => r.id !== id);
  saveAll();
  renderRecurring();
  toast('Recurring removed.', 'info');
}

function applyRecurringDue() {
  const today = todayStr();
  let added = 0;
  recurring.forEach(r => {
    if (!r.lastApplied) return;
    const last = new Date(r.lastApplied), now = new Date(today);
    let due = false;
    if (r.freq === 'daily')   due = last.toDateString() !== now.toDateString();
    if (r.freq === 'weekly')  due = (now-last)/(86400000) >= 7;
    if (r.freq === 'monthly') due = last.getMonth() !== now.getMonth() || last.getFullYear() !== now.getFullYear();
    if (due) {
      expenses.push({ id: uid(), amount: r.amount, category: r.category, note: (r.note||'')+ ' (auto)', date: today });
      r.lastApplied = today;
      added++;
    }
  });
  if (added > 0) { saveAll(); toast(`${added} recurring added 🔁`, 'success'); }
}

// ==================== SAVINGS GOAL ====================
function saveGoal() {
  goal = {
    income: parseFloat(document.getElementById('goalIncome').value) || 0,
    target: parseFloat(document.getElementById('goalTarget').value) || 0
  };
  localStorage.setItem('sl_goal', JSON.stringify(goal));
  updateGoalResult();
  updateStats();
  toast('Goal saved 🎯', 'success');
}

function updateGoalResult() {
  const box = document.getElementById('goalResult');
  if (!goal.income && !goal.target) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  const monthly = expenses.filter(e=>e.date.startsWith(thisMonth())).reduce((s,e)=>s+e.amount,0);
  const canSave = goal.income - monthly;
  const onTrack = canSave >= goal.target;
  box.innerHTML = `
    <div>💰 Income: <strong>${fmt(goal.income)}</strong></div>
    <div>📉 Spent this month: <strong>${fmt(monthly)}</strong></div>
    <div>💵 Remaining: <strong>${fmt(Math.max(canSave,0))}</strong></div>
    <div>🎯 Savings Target: <strong>${fmt(goal.target)}</strong></div>
    <div class="${onTrack?'goal-good':'goal-bad'}" style="margin-top:8px">
      ${onTrack ? '✅ On track to meet your goal!' : `⚠️ Need ₹${Math.abs(goal.target-canSave).toFixed(2)} more in savings.`}
    </div>
  `;
}

// ==================== EXPENSE LIST (mobile cards) ====================
function renderTable() {
  const filterCat = document.getElementById('filterCategory').value;
  const search    = document.getElementById('searchInput').value.toLowerCase();
  const fromDate  = document.getElementById('filterFrom').value;
  const toDate    = document.getElementById('filterTo').value;
  const list      = document.getElementById('expenseList');
  const empty     = document.getElementById('emptyState');

  let filtered = [...expenses];
  if (filterCat !== 'All') filtered = filtered.filter(e => e.category === filterCat);
  if (search)              filtered = filtered.filter(e => (e.note||'').toLowerCase().includes(search) || e.category.toLowerCase().includes(search));
  if (fromDate)            filtered = filtered.filter(e => e.date >= fromDate);
  if (toDate)              filtered = filtered.filter(e => e.date <= toDate);
  filtered.sort((a,b) => a.date < b.date ? 1 : -1);

  list.innerHTML = '';
  if (filtered.length === 0) {
    empty.classList.add('visible');
  } else {
    empty.classList.remove('visible');
    filtered.forEach(exp => {
      const div = document.createElement('div');
      div.className = 'expense-item';
      const isAuto = (exp.note||'').includes('(auto)');
      div.innerHTML = `
        <div class="exp-icon">${CAT_ICONS[exp.category]||'📦'}</div>
        <div class="exp-body">
          <div class="exp-top">
            <span class="exp-note">${escHtml(exp.note) || exp.category}${isAuto ? ' <span style="font-size:10px;color:var(--info)">🔁</span>':''}</span>
            <span class="exp-amount">${fmt(exp.amount)}</span>
          </div>
          <div class="exp-meta">
            <span class="category-badge cat-${exp.category}">${exp.category}</span>
            <span class="exp-date">${formatDate(exp.date)}</span>
          </div>
          <div class="exp-actions">
            <button class="btn-edit"   onclick="startEdit('${exp.id}')">✏️ Edit</button>
            <button class="btn-delete" onclick="deleteExpense('${exp.id}')">🗑 Delete</button>
          </div>
        </div>
      `;
      list.appendChild(div);
    });
  }
}

function clearDateFilter() {
  document.getElementById('filterFrom').value = '';
  document.getElementById('filterTo').value   = '';
  renderTable();
}

// ==================== CHARTS ====================
function switchChart(type) {
  activeChart = type;
  document.getElementById('donutContainer').style.display = type==='donut'?'block':'none';
  document.getElementById('barContainer').style.display   = type==='bar'  ?'block':'none';
  document.getElementById('tabDonut').classList.toggle('active', type==='donut');
  document.getElementById('tabBar').classList.toggle('active',   type==='bar');
  drawChart();
}

function drawChart() {
  if (activeChart==='donut') drawDonut(); else drawBar();
}

function getCatTotals() {
  const t = {};
  expenses.forEach(e => { t[e.category]=(t[e.category]||0)+e.amount; });
  return Object.entries(t).filter(([,v])=>v>0);
}

function drawDonut() {
  const canvas = document.getElementById('spendingChart');
  const legend = document.getElementById('chartLegend');
  const noData = document.getElementById('chartNoData');
  const ctx    = canvas.getContext('2d');
  const entries = getCatTotals();

  if (!entries.length) {
    canvas.style.display='none'; legend.style.display='none'; noData.style.display='block'; return;
  }
  canvas.style.display='block'; legend.style.display='flex'; noData.style.display='none';

  const W=130,H=130,cx=65,cy=65,R=58,r=26;
  canvas.width=W; canvas.height=H;
  ctx.clearRect(0,0,W,H);
  const total=entries.reduce((s,[,v])=>s+v,0);
  let angle=-Math.PI/2;
  entries.forEach(([cat,val])=>{
    const slice=(val/total)*2*Math.PI;
    ctx.beginPath(); ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,R,angle,angle+slice); ctx.closePath();
    ctx.fillStyle=CAT_COLORS[cat]||'#888'; ctx.fill();
    angle+=slice;
  });
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  ctx.beginPath(); ctx.arc(cx,cy,r,0,2*Math.PI);
  ctx.fillStyle=bg; ctx.fill();
  ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
  ctx.font='bold 9px DM Mono,monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(fmt(total),cx,cy);

  legend.innerHTML='';
  entries.sort((a,b)=>b[1]-a[1]).forEach(([cat,val])=>{
    const item=document.createElement('div');
    item.className='legend-item';
    item.innerHTML=`
      <span class="legend-dot" style="background:${CAT_COLORS[cat]}"></span>
      <span class="legend-label">${CAT_ICONS[cat]||''} ${cat}</span>
      <span class="legend-amount">${fmt(val)}</span>`;
    legend.appendChild(item);
  });
}

function drawBar() {
  const canvas = document.getElementById('barChart');
  const noData = document.getElementById('chartNoData');
  const ctx    = canvas.getContext('2d');
  const entries = getCatTotals().sort((a,b)=>b[1]-a[1]);
  if (!entries.length) { noData.style.display='block'; return; }
  noData.style.display='none';

  const W = canvas.parentElement.offsetWidth-4||290, H=160;
  canvas.width=W; canvas.height=H;
  ctx.clearRect(0,0,W,H);
  const pL=6,pR=6,pT=22,pB=30;
  const cW=W-pL-pR, cH=H-pT-pB;
  const maxV=Math.max(...entries.map(([,v])=>v));
  const bW=cW/entries.length, bPad=bW*0.28;
  const textC=getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  entries.forEach(([cat,val],i)=>{
    const x=pL+i*bW+bPad/2, bw=bW-bPad;
    const bh=(val/maxV)*cH, y=pT+cH-bh;
    ctx.fillStyle=CAT_COLORS[cat]||'#888';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x,y,bw,bh,[4,4,0,0]);
    else ctx.rect(x,y,bw,bh);
    ctx.fill();
    ctx.fillStyle=textC;
    ctx.font='11px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText(CAT_ICONS[cat]||cat.slice(0,3), x+bw/2, H-pB+14);
    ctx.font='bold 10px DM Mono,monospace';
    ctx.fillText('₹'+(val>=1000?(val/1000).toFixed(1)+'k':Math.round(val)), x+bw/2, y-5);
  });
}

// ==================== EXPORT CSV ====================
function exportCSV() {
  if (!expenses.length) { toast('No expenses to export', 'error'); return; }
  const rows = expenses.map(e=>[e.amount,e.category,e.date,`"${(e.note||'').replace(/"/g,'""')}"`].join(','));
  const csv  = ['Amount,Category,Date,Note',...rows].join('\n');
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = `expenses_${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('CSV exported ⬇️', 'success');
}

// ==================== EXPORT PDF ====================
function exportPDF() {
  if (!expenses.length) { toast('No expenses to export', 'error'); return; }
  const sorted   = [...expenses].sort((a,b)=>a.date<b.date?1:-1);
  const monthly  = sorted.filter(e=>e.date.startsWith(thisMonth())).reduce((s,e)=>s+e.amount,0);
  const total    = sorted.reduce((s,e)=>s+e.amount,0);
  const rows     = sorted.map(e=>`<tr><td style="color:#d4a017;font-weight:700">${fmt(e.amount)}</td><td>${e.category}</td><td>${formatDate(e.date)}</td><td>${escHtml(e.note)||'—'}</td></tr>`).join('');
  const w        = window.open('','_blank','width=800,height=600');
  w.document.write(`<!DOCTYPE html><html><head><title>SpendLog Report</title>
  <style>body{font-family:sans-serif;color:#1a1a2e;padding:24px}h1{margin-bottom:4px}
  .sub{color:#888;font-size:12px;margin-bottom:20px}.cards{display:flex;gap:20px;margin-bottom:20px}
  .c{background:#f5f5ff;border-radius:8px;padding:10px 16px}.c .l{font-size:11px;color:#888;text-transform:uppercase}
  .c .v{font-size:18px;font-weight:700}table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#f0f0f7;padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#888}
  td{padding:8px 10px;border-bottom:1px solid #eee}.foot{margin-top:20px;color:#aaa;font-size:11px;text-align:right}
  </style></head><body>
  <h1>💳 SpendLog – Expense Report</h1>
  <div class="sub">${new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</div>
  <div class="cards">
    <div class="c"><div class="l">Total</div><div class="v">${fmt(total)}</div></div>
    <div class="c"><div class="l">This Month</div><div class="v">${fmt(monthly)}</div></div>
    <div class="c"><div class="l">Entries</div><div class="v">${expenses.length}</div></div>
  </div>
  <table><thead><tr><th>Amount</th><th>Category</th><th>Date</th><th>Note</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <div class="foot">SpendLog Expense Tracker</div>
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
  toast('PDF opening 🖨️', 'success');
}
