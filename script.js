// ============================================================
//  SpendLog PWA – Mobile-First Expense + Income Tracker v2.0
// ============================================================

// ==================== MIGRATION (जुना data → नवीन format) ====================
(function migrateOldData() {
  try {
    // 1. expenses मध्ये tags नसतील तर add करा
    const rawExp = localStorage.getItem('sl_expenses');
    if (rawExp) {
      let exps = JSON.parse(rawExp);
      let changed = false;
      exps = exps.map(e => {
        if (!e.tags) { e.tags = []; changed = true; }
        if (!e.id)   { e.id = Date.now().toString(36) + Math.random().toString(36).slice(2,6); changed = true; }
        return e;
      });
      if (changed) localStorage.setItem('sl_expenses', JSON.stringify(exps));
    }

    // 2. जुना theme 'dark'/'light' असेल तर ठेवा, नाहीतर 'auto'
    const oldTheme = localStorage.getItem('sl_theme');
    if (!oldTheme) localStorage.setItem('sl_theme', 'dark');

    // 3. goal मधून income असेल तर profile बनवा (onboarding skip करण्यासाठी)
    const rawGoal    = localStorage.getItem('sl_goal');
    const rawProfile = localStorage.getItem('sl_profile');
    const rawBudget  = localStorage.getItem('sl_budget');
    const hasOldData = rawExp && JSON.parse(rawExp).length > 0;

    if (hasOldData && !rawProfile) {
      // जुना user आहे — profile बनवा जेणेकरून onboarding येणार नाही
      let incomeVal = 0;
      if (rawGoal) {
        const g = JSON.parse(rawGoal);
        incomeVal = g.income || 0;
      }
      const autoProfile = { name: 'User', income: incomeVal, migrated: true };
      localStorage.setItem('sl_profile', JSON.stringify(autoProfile));
    }

    // 4. sl_incomes नसेल तर empty array set करा
    if (!localStorage.getItem('sl_incomes')) {
      localStorage.setItem('sl_incomes', '[]');
    }

    // 5. sl_customCats नसेल तर empty array set करा
    if (!localStorage.getItem('sl_customCats')) {
      localStorage.setItem('sl_customCats', '[]');
    }

    console.log('SpendLog: Migration complete ✅');
  } catch(e) {
    console.warn('SpendLog: Migration error (non-fatal)', e);
  }
})();

// ==================== STATE ====================
let expenses   = JSON.parse(localStorage.getItem('sl_expenses'))   || [];
let incomes    = JSON.parse(localStorage.getItem('sl_incomes'))    || [];
let recurring  = JSON.parse(localStorage.getItem('sl_recurring'))  || [];
let budget     = parseFloat(localStorage.getItem('sl_budget'))     || 0;
let goal       = JSON.parse(localStorage.getItem('sl_goal'))       || { income: 0, target: 0 };
let theme      = localStorage.getItem('sl_theme')                  || 'auto';
let profile    = JSON.parse(localStorage.getItem('sl_profile'))    || null;
let customCats = JSON.parse(localStorage.getItem('sl_customCats')) || [];
let editingId  = null;
let activeChart = 'donut';
let activeTrend = 'expense';
let selectedCat = '';
let selectedTags = [];
let entryType = 'expense'; // 'expense' or 'income'
let calYear, calMonth;
let deferredPrompt = null;
let currentExpTab = 'expenses';

// ==================== BASE CATEGORIES ====================
const BASE_CATS = [
  { name:'Food',     icon:'🍔', color:'#f0c040' },
  { name:'Travel',   icon:'✈️', color:'#4ab4f0' },
  { name:'Bills',    icon:'💡', color:'#e07b39' },
  { name:'Shopping', icon:'🛍️', color:'#b06cf0' },
  { name:'Other',    icon:'📦', color:'#4cc97a' },
];

function getAllCats() {
  return [...BASE_CATS, ...customCats];
}

function getCatColor(name) {
  const c = getAllCats().find(c => c.name === name);
  return c ? c.color : '#888';
}
function getCatIcon(name) {
  const c = getAllCats().find(c => c.name === name);
  return c ? c.icon : '📦';
}

// ==================== PWA ====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('SW registered'))
      .catch(e => console.log('SW error', e));
  });
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById('installBanner');
  banner.style.display = 'flex';
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
  // Auto theme
  if (theme === 'auto') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  applyTheme(theme);

  // Show onboarding if first time
  if (!profile) {
    document.getElementById('onboardingOverlay').style.display = 'flex';
  } else {
    document.getElementById('greetingRow').innerHTML = buildGreeting();
  }

  const now = new Date();
  calYear  = now.getFullYear();
  calMonth = now.getMonth();

  document.getElementById('date').value        = todayStr();
  document.getElementById('budgetInput').value = budget > 0 ? budget : '';
  document.getElementById('goalIncome').value  = goal.income || '';
  document.getElementById('goalTarget').value  = goal.target || '';

  renderCatGrid();
  populateCatFilter();
  applyRecurringDue();
  refresh();

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', () => {
    const stored = localStorage.getItem('sl_theme') || 'dark';
    const next = stored === 'dark' ? 'light' : 'dark';
    theme = next;
    localStorage.setItem('sl_theme', next);
    applyTheme(next);
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

// ==================== ONBOARDING ====================
function completeOnboarding() {
  const name   = document.getElementById('onboardName').value.trim();
  const income = parseFloat(document.getElementById('onboardIncome').value) || 0;
  const bgt    = parseFloat(document.getElementById('onboardBudget').value) || 0;

  if (!name) { toast('Please enter your name', 'error'); return; }

  profile = { name, income };
  localStorage.setItem('sl_profile', JSON.stringify(profile));

  if (income > 0) {
    goal.income = income;
    localStorage.setItem('sl_goal', JSON.stringify(goal));
    document.getElementById('goalIncome').value = income;
  }
  if (bgt > 0) {
    budget = bgt;
    localStorage.setItem('sl_budget', bgt);
    document.getElementById('budgetInput').value = bgt;
  }

  document.getElementById('onboardingOverlay').style.display = 'none';
  document.getElementById('greetingRow').innerHTML = buildGreeting();
  refresh();
  toast(`Welcome, ${name}! 🎉`, 'success');
}

function buildGreeting() {
  if (!profile) return '';
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  if (profile.migrated || profile.name === 'User') {
    return `<div class="greeting">${g}! 👋 <span style="font-size:11px;color:var(--muted)">— <a href="#" onclick="openProfileEdit()" style="color:var(--accent);text-decoration:none">Set your name</a></span></div>`;
  }
  return `<div class="greeting">${g}, <strong>${profile.name}</strong> 👋</div>`;
}

function openProfileEdit() {
  const name = prompt('Enter your name:', profile && profile.name !== 'User' ? profile.name : '');
  if (name && name.trim()) {
    profile.name     = name.trim();
    profile.migrated = false;
    localStorage.setItem('sl_profile', JSON.stringify(profile));
    document.getElementById('greetingRow').innerHTML = buildGreeting();
    toast(`Welcome, ${profile.name}! 🎉`, 'success');
  }
  return false;
}

// ==================== THEME ====================
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('themeToggle').textContent = t === 'dark' ? '🌙' : '☀️';
}

// ==================== HELPERS ====================
function uid()       { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function fmt(n)      { return '₹' + parseFloat(n||0).toFixed(2); }
function fmtShort(n) {
  n = parseFloat(n||0);
  return n >= 100000 ? '₹'+(n/100000).toFixed(1)+'L' : n >= 1000 ? '₹'+(n/1000).toFixed(1)+'k' : '₹'+n.toFixed(0);
}
function todayStr()  { return new Date().toISOString().split('T')[0]; }
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
  localStorage.setItem('sl_expenses',   JSON.stringify(expenses));
  localStorage.setItem('sl_incomes',    JSON.stringify(incomes));
  localStorage.setItem('sl_recurring',  JSON.stringify(recurring));
  localStorage.setItem('sl_customCats', JSON.stringify(customCats));
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
  document.querySelector('.main-content').scrollTop = 0;

  if (name === 'Expenses') renderTable();
  if (name === 'Home')     refresh();
  if (name === 'Calendar') renderCalendar();
  if (name === 'Goals')    { renderInsights(); updateProfileDisplay(); }
}

// ==================== REFRESH ====================
function refresh() {
  updateStats();
  drawChart();
  drawTrend();
  renderRecurring();
  updateGoalResult();
}

// ==================== STATS ====================
function updateStats() {
  const today = todayStr(), month = thisMonth();
  let total=0, todays=0, monthly=0, monthlyInc=0, totalInc=0;

  expenses.forEach(e => {
    total   += e.amount;
    if (e.date === today)         todays   += e.amount;
    if (e.date.startsWith(month)) monthly  += e.amount;
  });
  incomes.forEach(i => {
    totalInc += i.amount;
    if (i.date.startsWith(month)) monthlyInc += i.amount;
  });

  document.getElementById('totalExpenses').textContent   = fmt(total);
  document.getElementById('todayExpenses').textContent   = fmt(todays);
  document.getElementById('monthlyExpenses').textContent = fmt(monthly);

  // Net balance card
  const monthIncomeSrc = goal.income > 0 ? goal.income : monthlyInc;
  if (monthIncomeSrc > 0) {
    const nb = document.getElementById('netBalanceCard');
    nb.style.display = 'flex';
    document.getElementById('nbIncome').textContent  = fmt(monthIncomeSrc);
    document.getElementById('nbSpent').textContent   = fmt(monthly);
    const bal = monthIncomeSrc - monthly;
    const balEl = document.getElementById('nbBalance');
    balEl.textContent = fmt(Math.abs(bal));
    balEl.style.color = bal >= 0 ? 'var(--success)' : 'var(--danger)';
    if (bal < 0) balEl.textContent = '-' + fmt(Math.abs(bal));
  }

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
  const incSrc = goal.income > 0 ? goal.income : monthlyInc;
  if (incSrc > 0) {
    const cs = incSrc - monthly;
    document.getElementById('canSave').textContent = fmt(Math.max(cs,0));
    document.getElementById('canSave').style.color = cs >= 0 ? 'var(--success)' : 'var(--danger)';
  } else {
    document.getElementById('canSave').textContent = '—';
    document.getElementById('canSave').style.color = '';
  }
}

// ==================== CATEGORY GRID ====================
function renderCatGrid() {
  const grid = document.getElementById('catGrid');
  const cats = getAllCats();
  grid.innerHTML = cats.map(c => `
    <button class="cat-btn${selectedCat===c.name?' selected':''}" data-cat="${c.name}" onclick="selectCat(this)">
      <span style="font-size:1.3rem">${c.icon}</span>
      <span>${c.name}</span>
    </button>
  `).join('');
}

function selectCat(btn) {
  document.querySelectorAll(".cat-btn").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  selectedCat = btn.dataset.cat;
  document.getElementById("category").value = selectedCat;
}

function populateCatFilter() {
  const sel = document.getElementById('filterCategory');
  sel.innerHTML = '<option value="All">All Categories</option>' +
    getAllCats().map(c => `<option value="${c.name}">${c.icon} ${c.name}</option>`).join('');
}

// ==================== CUSTOM CATEGORY ====================
function openCatModal() {
  document.getElementById('catModalOverlay').style.display = 'flex';
}
function closeCatModal() {
  document.getElementById('catModalOverlay').style.display = 'none';
  document.getElementById('newCatName').value = '';
  document.getElementById('newCatIcon').value = '';
}
function addCustomCategory() {
  const name  = document.getElementById('newCatName').value.trim();
  const icon  = document.getElementById('newCatIcon').value.trim() || '🏷️';
  const color = document.getElementById('newCatColor').value;
  if (!name) { toast('Enter category name', 'error'); return; }
  if (getAllCats().find(c => c.name.toLowerCase() === name.toLowerCase())) {
    toast('Category already exists', 'error'); return;
  }
  customCats.push({ name, icon, color });
  saveAll();
  renderCatGrid();
  populateCatFilter();
  closeCatModal();
  toast(`Category "${name}" added ✅`, 'success');
}

// ==================== ENTRY TYPE TOGGLE ====================
function setEntryType(type) {
  entryType = type;
  document.getElementById('typeExpenseBtn').classList.toggle('active', type === 'expense');
  document.getElementById('typeIncomeBtn').classList.toggle('active', type === 'income');
  document.getElementById('catSection').style.display       = type === 'expense' ? 'block' : 'none';
  document.getElementById('incomeSection').style.display    = type === 'income'  ? 'block' : 'none';
  document.getElementById('tagsSection').style.display      = type === 'expense' ? 'block' : 'none';
  document.getElementById('recurringToggleRow').style.display = 'flex';

  const title = type === 'expense' ? '➕ Add Expense' : '💰 Add Income';
  document.getElementById('formTitle').textContent  = title;
  document.getElementById('submitBtn').textContent  = type === 'expense' ? '+ Add Expense' : '+ Add Income';
  document.getElementById('submitBtn').className    = 'add-btn' + (type === 'income' ? ' income-btn' : '');
}

// ==================== TAGS ====================
function toggleTag(btn, tag) {
  if (selectedTags.includes(tag)) {
    selectedTags = selectedTags.filter(t => t !== tag);
    btn.classList.remove('active');
  } else {
    selectedTags.push(tag);
    btn.classList.add('active');
  }
}

// ==================== FORM ====================
function handleSubmit() {
  const amount = parseFloat(document.getElementById('amount').value);
  const date   = document.getElementById('date').value;
  const note   = document.getElementById('note').value.trim();
  const isRec  = document.getElementById('isRecurring').checked;
  const freq   = document.getElementById('recurringFreq').value;

  if (!amount || amount <= 0) { toast('Enter a valid amount ⚠️', 'error'); return; }
  if (!date)                   { toast('Pick a date ⚠️', 'error');           return; }

  if (entryType === 'income') {
    const source = document.getElementById('incomeSource').value;
    if (editingId) {
      const idx = incomes.findIndex(i => i.id === editingId);
      if (idx !== -1) incomes[idx] = { ...incomes[idx], amount, source, date, note };
      cancelEdit();
      toast('Income updated ✅', 'success');
    } else {
      incomes.push({ id: uid(), amount, source, date, note });
      toast('Income added 💰', 'success');
    }
    saveAll(); resetForm(); refresh();
    setTimeout(() => showPage('Home'), 300);
    return;
  }

  // Expense
  const category = document.getElementById('category').value || selectedCat;
  if (!category) { toast('Pick a category ⚠️', 'error'); return; }

  if (editingId) {
    const idx = expenses.findIndex(e => e.id === editingId);
    if (idx !== -1) expenses[idx] = { ...expenses[idx], amount, category, date, note, tags: [...selectedTags] };
    cancelEdit();
    toast('Expense updated ✅', 'success');
  } else {
    expenses.push({ id: uid(), amount, category, date, note, tags: [...selectedTags] });
    if (isRec) {
      recurring.push({ id: uid(), amount, category, note, freq, lastApplied: date });
      toast(`Added as ${freq} recurring 🔁`, 'success');
    } else {
      toast('Expense added ✅', 'success');
    }
  }

  saveAll(); resetForm(); refresh();
  setTimeout(() => showPage('Home'), 300);
}

function resetForm() {
  document.getElementById('amount').value   = '';
  document.getElementById('category').value = '';
  document.getElementById('date').value     = todayStr();
  document.getElementById('note').value     = '';
  document.getElementById('isRecurring').checked = false;
  document.getElementById('recurringFreq').style.display = 'none';
  selectedCat  = '';
  selectedTags = [];
  document.querySelectorAll('.tag-pill').forEach(b => b.classList.remove('active'));
  renderCatGrid();
}

function cancelEdit() {
  editingId = null;
  document.getElementById('submitBtn').textContent = entryType === 'income' ? '+ Add Income' : '+ Add Expense';
  document.getElementById('submitBtn').classList.remove('editing');
  document.getElementById('cancelBtn').style.display  = 'none';
  document.getElementById('formTitle').textContent    = entryType === 'income' ? '💰 Add Income' : '➕ Add Expense';
  resetForm();
}

function startEdit(id, type='expense') {
  if (type === 'income') {
    const inc = incomes.find(i => i.id === id);
    if (!inc) return;
    editingId = id;
    setEntryType('income');
    document.getElementById('amount').value = inc.amount;
    document.getElementById('date').value   = inc.date;
    document.getElementById('note').value   = inc.note;
    document.getElementById('incomeSource').value = inc.source || 'Salary';
  } else {
    const exp = expenses.find(e => e.id === id);
    if (!exp) return;
    editingId = id;
    setEntryType('expense');
    document.getElementById('amount').value   = exp.amount;
    document.getElementById('category').value = exp.category;
    document.getElementById('date').value     = exp.date;
    document.getElementById('note').value     = exp.note;
    selectedCat  = exp.category;
    selectedTags = exp.tags ? [...exp.tags] : [];
    document.querySelectorAll('.tag-pill').forEach(b => {
      if (selectedTags.includes(b.textContent)) b.classList.add('active');
    });
    renderCatGrid();
  }
  document.getElementById('submitBtn').textContent = '✔ Save Changes';
  document.getElementById('submitBtn').classList.add('editing');
  document.getElementById('cancelBtn').style.display = 'block';
  document.getElementById('formTitle').textContent   = '✏️ Edit';
  showPage('Add');
}

function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  expenses = expenses.filter(e => e.id !== id);
  if (editingId === id) cancelEdit();
  saveAll(); renderTable(); updateStats(); drawChart();
  toast('Deleted 🗑️', 'info');
}

function deleteIncome(id) {
  if (!confirm('Delete this income?')) return;
  incomes = incomes.filter(i => i.id !== id);
  saveAll(); renderIncomeList(); updateStats();
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
        <div class="rec-name">${getCatIcon(r.category)} ${escHtml(r.note)||r.category}</div>
        <div class="rec-meta">${r.freq} · ${formatDate(r.lastApplied)}</div>
      </div>
      <span class="rec-amount">${fmt(r.amount)}</span>
      <button class="btn-rec-del" onclick="deleteRecurring('${r.id}')">✕</button>
    </div>
  `).join('');
}

function deleteRecurring(id) {
  recurring = recurring.filter(r => r.id !== id);
  saveAll(); renderRecurring();
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
      expenses.push({ id: uid(), amount: r.amount, category: r.category, note: (r.note||'')+ ' (auto)', date: today, tags:[] });
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
  if (profile && goal.income) { profile.income = goal.income; localStorage.setItem('sl_profile', JSON.stringify(profile)); }
  updateGoalResult(); updateStats();
  toast('Goal saved 🎯', 'success');
}

function updateGoalResult() {
  const box = document.getElementById('goalResult');
  if (!goal.income && !goal.target) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  const monthly  = expenses.filter(e=>e.date.startsWith(thisMonth())).reduce((s,e)=>s+e.amount,0);
  const canSave  = goal.income - monthly;
  const onTrack  = canSave >= goal.target;
  const savePct  = goal.income > 0 ? Math.round((Math.max(canSave,0)/goal.income)*100) : 0;
  box.innerHTML = `
    <div>💰 Income: <strong>${fmt(goal.income)}</strong></div>
    <div>📉 Spent this month: <strong>${fmt(monthly)}</strong></div>
    <div>💵 Remaining: <strong style="color:${canSave>=0?'var(--success)':'var(--danger)'}">${fmt(Math.max(canSave,0))}</strong></div>
    <div>🎯 Savings Target: <strong>${fmt(goal.target)}</strong></div>
    <div>📊 Savings Rate: <strong>${savePct}%</strong></div>
    <div class="${onTrack?'goal-good':'goal-bad'}" style="margin-top:8px">
      ${onTrack ? '✅ On track to meet your goal!' : `⚠️ Need ₹${Math.abs(goal.target-canSave).toFixed(2)} more in savings.`}
    </div>
  `;
}

// ==================== INSIGHTS ====================
function renderInsights() {
  const list = document.getElementById('insightsList');
  const month = thisMonth();
  const monthExp = expenses.filter(e => e.date.startsWith(month));
  const insights = [];

  // Top category
  const catTotals = {};
  monthExp.forEach(e => { catTotals[e.category] = (catTotals[e.category]||0) + e.amount; });
  const topCat = Object.entries(catTotals).sort((a,b)=>b[1]-a[1])[0];
  if (topCat) insights.push(`🏆 Highest spending: <strong>${getCatIcon(topCat[0])} ${topCat[0]}</strong> — ${fmt(topCat[1])} this month`);

  // Daily average
  const daysElapsed = new Date().getDate();
  const monthTotal  = monthExp.reduce((s,e)=>s+e.amount,0);
  if (monthTotal > 0) insights.push(`📅 Daily average: <strong>${fmt(monthTotal/daysElapsed)}</strong>/day`);

  // Budget advice
  if (budget > 0) {
    const pct = Math.round((monthTotal/budget)*100);
    if (pct > 90) insights.push(`🔴 You've used <strong>${pct}%</strong> of your budget!`);
    else if (pct < 50) insights.push(`🟢 Great! Only <strong>${pct}%</strong> of budget used — on track!`);
  }

  // Income vs expense
  if (goal.income > 0) {
    const savingsRate = Math.round(((goal.income - monthTotal) / goal.income) * 100);
    if (savingsRate >= 20) insights.push(`💚 Savings rate: <strong>${savingsRate}%</strong> — excellent!`);
    else if (savingsRate > 0) insights.push(`💛 Savings rate: <strong>${savingsRate}%</strong> — try to reach 20%`);
    else insights.push(`🔴 Spending exceeds income this month!`);
  }

  // Biggest expense
  const biggest = [...monthExp].sort((a,b)=>b.amount-a.amount)[0];
  if (biggest) insights.push(`💸 Biggest expense: <strong>${escHtml(biggest.note)||biggest.category}</strong> — ${fmt(biggest.amount)}`);

  if (!insights.length) insights.push('Add more expenses to see insights!');

  list.innerHTML = insights.map(i => `<div class="insight-item">${i}</div>`).join('');
}

// ==================== EXPENSE LIST ====================
function switchExpTab(tab) {
  currentExpTab = tab;
  document.getElementById('subExpTab').classList.toggle('active', tab==='expenses');
  document.getElementById('subIncTab').classList.toggle('active', tab==='income');
  document.getElementById('expensesSection').style.display = tab==='expenses' ? 'block' : 'none';
  document.getElementById('incomeSection2').style.display  = tab==='income'  ? 'block' : 'none';
  if (tab === 'income') renderIncomeList();
  else renderTable();
}

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
      const tagsHtml = (exp.tags && exp.tags.length) ? `<div class="exp-tags">${exp.tags.map(t=>`<span class="exp-tag">${t}</span>`).join('')}</div>` : '';
      div.innerHTML = `
        <div class="exp-icon" style="background:${getCatColor(exp.category)}22">${getCatIcon(exp.category)}</div>
        <div class="exp-body">
          <div class="exp-top">
            <span class="exp-note">${escHtml(exp.note) || exp.category}${isAuto ? ' <span style="font-size:10px;color:var(--info)">🔁</span>':''}</span>
            <span class="exp-amount">${fmt(exp.amount)}</span>
          </div>
          <div class="exp-meta">
            <span class="category-badge" style="background:${getCatColor(exp.category)}22;color:${getCatColor(exp.category)}">${exp.category}</span>
            <span class="exp-date">${formatDate(exp.date)}</span>
          </div>
          ${tagsHtml}
          <div class="exp-actions">
            <button class="btn-edit"   onclick="startEdit('${exp.id}','expense')">✏️ Edit</button>
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

// ==================== INCOME LIST ====================
function renderIncomeList() {
  const list  = document.getElementById('incomeList');
  const empty = document.getElementById('incomeEmptyState');
  const bar   = document.getElementById('incomeSummaryBar');

  const month = thisMonth();
  const monthInc = incomes.filter(i => i.date.startsWith(month)).reduce((s,i)=>s+i.amount,0);
  const totalInc = incomes.reduce((s,i)=>s+i.amount,0);

  bar.innerHTML = `
    <div class="inc-sum-item"><span>This Month</span><strong style="color:var(--success)">${fmt(monthInc)}</strong></div>
    <div class="inc-sum-item"><span>All Time</span><strong>${fmt(totalInc)}</strong></div>
    <div class="inc-sum-item"><span>Entries</span><strong>${incomes.length}</strong></div>
  `;

  const sorted = [...incomes].sort((a,b) => a.date < b.date ? 1 : -1);
  if (!sorted.length) {
    empty.classList.add('visible'); list.innerHTML = ''; return;
  }
  empty.classList.remove('visible');
  const srcIcons = { Salary:'💼', Freelance:'💻', Business:'🏢', Investment:'📈', Gift:'🎁', Other:'📦' };
  list.innerHTML = sorted.map(inc => `
    <div class="expense-item income-item">
      <div class="exp-icon" style="background:var(--success)22">${srcIcons[inc.source]||'💰'}</div>
      <div class="exp-body">
        <div class="exp-top">
          <span class="exp-note">${escHtml(inc.note) || inc.source}</span>
          <span class="exp-amount" style="color:var(--success)">${fmt(inc.amount)}</span>
        </div>
        <div class="exp-meta">
          <span class="category-badge" style="background:var(--success)22;color:var(--success)">${inc.source}</span>
          <span class="exp-date">${formatDate(inc.date)}</span>
        </div>
        <div class="exp-actions">
          <button class="btn-edit"   onclick="startEdit('${inc.id}','income')">✏️ Edit</button>
          <button class="btn-delete" onclick="deleteIncome('${inc.id}')">🗑 Delete</button>
        </div>
      </div>
    </div>
  `).join('');
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
    ctx.fillStyle=getCatColor(cat); ctx.fill();
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
      <span class="legend-dot" style="background:${getCatColor(cat)}"></span>
      <span class="legend-label">${getCatIcon(cat)} ${cat}</span>
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
    ctx.fillStyle=getCatColor(cat);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x,y,bw,bh,[4,4,0,0]);
    else ctx.rect(x,y,bw,bh);
    ctx.fill();
    ctx.fillStyle=textC;
    ctx.font='11px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText(getCatIcon(cat)||cat.slice(0,3), x+bw/2, H-pB+14);
    ctx.font='bold 10px DM Mono,monospace';
    ctx.fillText(fmtShort(val), x+bw/2, y-5);
  });
}

// ==================== TREND CHART ====================
function switchTrend(type) {
  activeTrend = type;
  document.getElementById('tabTrendExp').classList.toggle('active', type==='expense');
  document.getElementById('tabTrendInc').classList.toggle('active', type==='income');
  document.getElementById('tabTrendBoth').classList.toggle('active', type==='both');
  drawTrend();
}

function drawTrend() {
  const canvas  = document.getElementById('trendChart');
  const noData  = document.getElementById('trendNoData');
  const ctx     = canvas.getContext('2d');

  // Build last 6 months data
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const label = d.toLocaleString('default',{month:'short'});
    const expTotal = expenses.filter(e=>e.date.startsWith(key)).reduce((s,e)=>s+e.amount,0);
    const incTotal = incomes.filter(i=>i.date.startsWith(key)).reduce((s,i)=>s+i.amount,0)
                     + (key === thisMonth() && goal.income > 0 ? 0 : 0);
    months.push({ label, expTotal, incTotal });
  }

  const hasExpData = months.some(m=>m.expTotal > 0);
  const hasIncData = months.some(m=>m.incTotal > 0);
  if (!hasExpData && !hasIncData) { noData.style.display='block'; canvas.style.display='none'; return; }
  noData.style.display='none'; canvas.style.display='block';

  const W = canvas.parentElement.offsetWidth - 4 || 290, H = 140;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  const pL=36, pR=10, pT=16, pB=28;
  const cW = W-pL-pR, cH = H-pT-pB;
  const n = months.length;

  const allVals = [];
  if (activeTrend !== 'income') months.forEach(m=>allVals.push(m.expTotal));
  if (activeTrend !== 'expense') months.forEach(m=>allVals.push(m.incTotal));
  const maxV = Math.max(...allVals, 1);

  const textC = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  const textMain = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();

  // Draw grid lines
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pT + (cH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(W-pR, y); ctx.stroke();
    ctx.fillStyle = textC;
    ctx.font = '9px DM Mono,monospace'; ctx.textAlign = 'right';
    ctx.fillText(fmtShort(maxV * (1 - i/4)), pL-3, y+3);
  }

  function drawLine(data, color, fill) {
    const pts = data.map((v, i) => ({
      x: pL + (i / (n-1)) * cW,
      y: pT + cH - (v / maxV) * cH
    }));

    if (fill) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pT+cH);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[pts.length-1].x, pT+cH);
      ctx.closePath();
      ctx.fillStyle = color + '22';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const cx1 = (pts[i-1].x + pts[i].x)/2;
      ctx.bezierCurveTo(cx1, pts[i-1].y, cx1, pts[i].y, pts[i].x, pts[i].y);
    }
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();

    pts.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, 2*Math.PI);
      ctx.fillStyle = color; ctx.fill();
    });
  }

  if (activeTrend !== 'income')  drawLine(months.map(m=>m.expTotal), 'var(--danger)',  true);
  if (activeTrend !== 'expense') drawLine(months.map(m=>m.incTotal), 'var(--success)', activeTrend==='income');

  // X labels
  ctx.fillStyle = textC; ctx.font = '10px DM Mono,monospace'; ctx.textAlign = 'center';
  months.forEach((m, i) => {
    const x = pL + (i / (n-1)) * cW;
    ctx.fillText(m.label, x, H-pB+16);
  });
}

// ==================== CALENDAR ====================
function changeCalMonth(dir) {
  calMonth += dir;
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0;  calYear++; }
  renderCalendar();
}

function renderCalendar() {
  const label = document.getElementById('calMonthLabel');
  const grid  = document.getElementById('calGrid');
  const mo    = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  label.textContent = `${mo[calMonth]} ${calYear}`;

  const monthKey = `${calYear}-${String(calMonth+1).padStart(2,'0')}`;
  const dayMap   = {};
  expenses.filter(e => e.date.startsWith(monthKey)).forEach(e => {
    const d = parseInt(e.date.split('-')[2]);
    dayMap[d] = (dayMap[d]||0) + e.amount;
  });

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysIn   = new Date(calYear, calMonth+1, 0).getDate();
  const today    = new Date();

  const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  let html = dayNames.map(d=>`<div class="cal-day-name">${d}</div>`).join('');

  for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell empty"></div>`;

  const maxAmt = Math.max(...Object.values(dayMap), 1);
  for (let d = 1; d <= daysIn; d++) {
    const isToday = today.getFullYear()===calYear && today.getMonth()===calMonth && today.getDate()===d;
    const amt = dayMap[d] || 0;
    const intensity = amt > 0 ? Math.min(0.85, 0.2 + (amt/maxAmt)*0.65) : 0;
    const bg = amt > 0 ? `rgba(240,192,64,${intensity})` : 'transparent';
    html += `
      <div class="cal-cell${isToday?' today':''}" style="background:${bg}" onclick="showCalDay(${d})">
        <span class="cal-day-num">${d}</span>
        ${amt > 0 ? `<span class="cal-amt">${fmtShort(amt)}</span>` : ''}
      </div>`;
  }
  grid.innerHTML = html;
  document.getElementById('calDayDetail').style.display = 'none';
}

function showCalDay(day) {
  const monthKey = `${calYear}-${String(calMonth+1).padStart(2,'0')}`;
  const dateStr  = `${monthKey}-${String(day).padStart(2,'0')}`;
  const dayExps  = expenses.filter(e => e.date === dateStr);
  const dayIncs  = incomes.filter(i => i.date === dateStr);
  const total    = dayExps.reduce((s,e)=>s+e.amount, 0);

  const detail = document.getElementById('calDayDetail');
  document.getElementById('calDayTitle').textContent = formatDate(dateStr);
  document.getElementById('calDayTotal').textContent = total > 0 ? fmt(total) : '';
  detail.style.display = 'block';

  let html = '';
  dayExps.forEach(e => {
    html += `<div class="cal-exp-item"><span>${getCatIcon(e.category)} ${escHtml(e.note)||e.category}</span><span style="color:var(--accent)">${fmt(e.amount)}</span></div>`;
  });
  dayIncs.forEach(i => {
    html += `<div class="cal-exp-item"><span>💰 ${escHtml(i.note)||i.source}</span><span style="color:var(--success)">${fmt(i.amount)}</span></div>`;
  });
  if (!html) html = '<div style="color:var(--muted);font-size:13px;padding:8px 0">No entries this day.</div>';
  document.getElementById('calDayList').innerHTML = html;
}

// ==================== EXPORT CSV ====================
function exportCSV() {
  if (!expenses.length && !incomes.length) { toast('No data to export', 'error'); return; }
  const rows = [
    'Type,Amount,Category/Source,Date,Note',
    ...expenses.map(e=>['Expense',e.amount,e.category,e.date,`"${(e.note||'').replace(/"/g,'""')}"`].join(',')),
    ...incomes.map(i=>['Income',i.amount,i.source,i.date,`"${(i.note||'').replace(/"/g,'""')}"`].join(','))
  ];
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'}));
  a.download = `spendlog_${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('CSV exported ⬇️', 'success');
}

// ==================== EXPORT PDF ====================
function exportPDF() {
  if (!expenses.length) { toast('No expenses to export', 'error'); return; }
  const sorted  = [...expenses].sort((a,b)=>a.date<b.date?1:-1);
  const monthly = sorted.filter(e=>e.date.startsWith(thisMonth())).reduce((s,e)=>s+e.amount,0);
  const total   = sorted.reduce((s,e)=>s+e.amount,0);
  const totalInc = incomes.reduce((s,i)=>s+i.amount,0);
  const rows    = sorted.map(e=>`<tr><td style="color:#d4a017;font-weight:700">${fmt(e.amount)}</td><td>${e.category}</td><td>${formatDate(e.date)}</td><td>${escHtml(e.note)||'—'}</td></tr>`).join('');
  const w       = window.open('','_blank','width=800,height=600');
  w.document.write(`<!DOCTYPE html><html><head><title>SpendLog Report</title>
  <style>body{font-family:sans-serif;color:#1a1a2e;padding:24px}h1{margin-bottom:4px}
  .sub{color:#888;font-size:12px;margin-bottom:20px}.cards{display:flex;gap:20px;margin-bottom:20px}
  .c{background:#f5f5ff;border-radius:8px;padding:10px 16px}.c .l{font-size:11px;color:#888;text-transform:uppercase}
  .c .v{font-size:18px;font-weight:700}table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#f0f0f7;padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#888}
  td{padding:8px 10px;border-bottom:1px solid #eee}.foot{margin-top:20px;color:#aaa;font-size:11px;text-align:right}
  </style></head><body>
  <h1>💳 SpendLog – Expense Report</h1>
  <div class="sub">${profile ? profile.name + ' · ' : ''}${new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</div>
  <div class="cards">
    <div class="c"><div class="l">Total Expense</div><div class="v">${fmt(total)}</div></div>
    <div class="c"><div class="l">This Month</div><div class="v">${fmt(monthly)}</div></div>
    <div class="c"><div class="l">Total Income</div><div class="v" style="color:green">${fmt(totalInc)}</div></div>
    <div class="c"><div class="l">Entries</div><div class="v">${expenses.length}</div></div>
  </div>
  <table><thead><tr><th>Amount</th><th>Category</th><th>Date</th><th>Note</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <div class="foot">SpendLog Expense Tracker</div>
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
  toast('PDF opening 🖨️', 'success');
}

// ==================== DATA MANAGEMENT ====================

function clearAllData() {
  const confirmed = confirm(
    '⚠️ सगळा data DELETE होईल!\n\n' +
    '• सगळे expenses\n• सगळे income records\n• Budget & Goals\n• Custom categories\n\n' +
    'हे action UNDO होत नाही. खात्री आहे?'
  );
  if (!confirmed) return;

  const doubleConfirm = confirm('शेवटची खात्री — "OK" दाबल्यावर सगळं delete होईल.');
  if (!doubleConfirm) return;

  // सगळे SpendLog keys clear करा
  const keys = ['sl_expenses','sl_incomes','sl_recurring','sl_budget','sl_goal','sl_profile','sl_customCats','sl_theme'];
  keys.forEach(k => localStorage.removeItem(k));

  toast('सगळा data clear झाला 🗑️', 'info');
  setTimeout(() => location.reload(), 1200);
}

function exportBackup() {
  const backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    expenses,
    incomes,
    recurring,
    budget,
    goal,
    profile,
    customCats
  };
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'}));
  a.download = `spendlog_backup_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup downloaded 📥', 'success');
}

function importBackup(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.expenses && !data.incomes) {
        toast('Invalid backup file ⚠️', 'error'); return;
      }
      const ok = confirm(
        `Backup मिळाला!\n\n` +
        `• Expenses: ${(data.expenses||[]).length}\n` +
        `• Income: ${(data.incomes||[]).length}\n` +
        `• Export date: ${data.exportedAt ? new Date(data.exportedAt).toLocaleDateString() : 'Unknown'}\n\n` +
        `हे restore केल्यावर current data replace होईल. Continue?`
      );
      if (!ok) return;

      if (data.expenses)   localStorage.setItem('sl_expenses',   JSON.stringify(data.expenses));
      if (data.incomes)    localStorage.setItem('sl_incomes',    JSON.stringify(data.incomes));
      if (data.recurring)  localStorage.setItem('sl_recurring',  JSON.stringify(data.recurring));
      if (data.budget)     localStorage.setItem('sl_budget',     data.budget);
      if (data.goal)       localStorage.setItem('sl_goal',       JSON.stringify(data.goal));
      if (data.profile)    localStorage.setItem('sl_profile',    JSON.stringify(data.profile));
      if (data.customCats) localStorage.setItem('sl_customCats', JSON.stringify(data.customCats));

      toast('Backup restored ✅', 'success');
      setTimeout(() => location.reload(), 1200);
    } catch(err) {
      toast('File read error ⚠️', 'error');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function updateProfileDisplay() {
  const el = document.getElementById('profileNameDisplay');
  if (el && profile) {
    el.textContent = (profile.migrated || profile.name === 'User') ? 'Not set' : profile.name;
  }
}
