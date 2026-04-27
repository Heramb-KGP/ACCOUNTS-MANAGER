const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const themes = [
  { id: "aurora", name: "Teal Slate", colors: ["#14b8a6", "#2563eb", "#1e293b"] },
  { id: "plasma", name: "Rose Graphite", colors: ["#e879f9", "#fb7185", "#27272a"] },
  { id: "glacier", name: "Blue Steel", colors: ["#38bdf8", "#0f766e", "#1e293b"] },
  { id: "ember", name: "Amber Desk", colors: ["#f59e0b", "#ef4444", "#292524"] },
  { id: "sakura", name: "Violet Mint", colors: ["#a78bfa", "#5eead4", "#312e81"] }
];

const emptyData = {
  transactions: [],
  budgets: [],
  netWorth: [],
  categories: [],
  accounts: [],
  settings: {
    currency: "INR",
    monthlySavingsGoal: 0,
    emergencyFundTarget: 0,
    defaultAccount: "Bank"
  }
};

const state = {
  user: null,
  data: structuredClone(emptyData),
  activeView: "dashboard",
  selectedMonth: "All",
  search: "",
  typeFilter: "All",
  theme: localStorage.getItem("cura-theme") || "aurora",
  lastMetrics: null
};

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

const compactMoney = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function css(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed.");
  }
  return payload;
}

function body(payload) {
  return JSON.stringify(payload);
}

function setTheme(themeId) {
  const theme = themes.some((item) => item.id === themeId) ? themeId : "aurora";
  state.theme = theme;
  document.body.className = `theme-${theme}`;
  localStorage.setItem("cura-theme", theme);
  renderThemePicker();
  drawAllCharts();
}

function renderThemePicker() {
  const picker = $("#themePicker");
  picker.innerHTML = themes
    .map(
      (theme) => `
        <button
          class="theme-swatch ${theme.id === state.theme ? "active" : ""}"
          type="button"
          title="${escapeHtml(theme.name)}"
          aria-label="${escapeHtml(theme.name)}"
          data-theme="${theme.id}"
          style="background: linear-gradient(135deg, ${theme.colors[0]}, ${theme.colors[1]} 52%, ${theme.colors[2]});">
        </button>`
    )
    .join("");
}

function showAuth() {
  $("#authView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
}

function showApp() {
  $("#authView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}

function setSession(payload) {
  state.user = payload.user;
  state.data = payload.data || structuredClone(emptyData);
  $("#userEmail").textContent = state.user?.email || "Workspace";
  showApp();
  renderApp();
}

function sum(rows, predicate) {
  return rows.reduce((total, row) => total + (predicate(row) ? Number(row.amount || 0) : 0), 0);
}

function monthDate(label) {
  if (label === "All") return 0;
  const parsed = Date.parse(`01 ${label}`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function monthOptions() {
  const labels = new Set(["All"]);
  state.data.transactions.forEach((transaction) => transaction.month && labels.add(transaction.month));
  state.data.netWorth.forEach((row) => row.month && labels.add(row.month));
  return Array.from(labels).sort((a, b) => {
    if (a === "All") return -1;
    if (b === "All") return 1;
    return monthDate(b) - monthDate(a);
  });
}

function selectedTransactions() {
  return state.data.transactions.filter((transaction) => {
    const monthOk = state.selectedMonth === "All" || transaction.month === state.selectedMonth;
    const typeOk = state.typeFilter === "All" || transaction.type === state.typeFilter;
    const haystack = [
      transaction.date,
      transaction.type,
      transaction.category,
      transaction.account,
      transaction.description,
      transaction.notes,
      transaction.month,
      transaction.week
    ]
      .join(" ")
      .toLowerCase();
    return monthOk && typeOk && haystack.includes(state.search.toLowerCase());
  });
}

function transactionsForMetrics() {
  return state.data.transactions.filter((transaction) => state.selectedMonth === "All" || transaction.month === state.selectedMonth);
}

function groupAmounts(rows, typeFilter = null) {
  const groups = new Map();
  rows.forEach((row) => {
    if (typeFilter && row.type !== typeFilter) return;
    groups.set(row.category, (groups.get(row.category) || 0) + Number(row.amount || 0));
  });
  return Array.from(groups, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function accountBalances() {
  const balances = new Map((state.data.accounts || []).map((account) => [account, 0]));
  [...state.data.transactions]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((transaction) => {
      const account = transaction.account || "Bank";
      const amount = Number(transaction.amount || 0);
      if (!balances.has(account)) balances.set(account, 0);
      balances.set(account, balances.get(account) + (transaction.type === "Income" ? amount : -amount));
    });
  return Array.from(balances, ([label, value]) => ({ label, value })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function budgetAlerts() {
  const actuals = actualSpendByCategory();
  return state.data.budgets
    .map((budget) => {
      const budgeted = Number(budget.monthlyBudget || 0);
      const actual = actuals.get(budget.category) || 0;
      return {
        category: budget.category,
        budgeted,
        actual,
        ratio: budgeted ? actual / budgeted : 0
      };
    })
    .filter((row) => row.budgeted > 0 && row.ratio >= 0.85)
    .sort((a, b) => b.ratio - a.ratio);
}

function calcMetrics(rows = transactionsForMetrics()) {
  const income = sum(rows, (row) => row.type === "Income");
  const expenses = sum(rows, (row) => row.type === "Expense");
  const investments = sum(rows, (row) => row.type === "Investment");
  const netSavings = income - expenses - investments;
  const freeCash = income - expenses;
  const savingsRate = income ? netSavings / income : 0;
  const investmentRate = income ? investments / income : 0;
  const expenseRatio = income ? expenses / income : 0;
  const uniqueSpendDays = new Set(rows.filter((row) => row.type === "Expense").map((row) => row.date)).size || 1;
  const largestExpense = rows
    .filter((row) => row.type === "Expense")
    .reduce((best, row) => (Number(row.amount) > Number(best?.amount || 0) ? row : best), null);
  const topCategory = groupAmounts(
    rows.filter((row) => row.type !== "Income"),
    null
  )[0];
  const health =
    income === 0
      ? "Fresh Start"
      : savingsRate >= 0.25
        ? "Excellent"
        : savingsRate >= 0.1
          ? "Stable"
          : savingsRate >= 0
            ? "Watchlist"
            : "Needs Work";

  return {
    income,
    expenses,
    investments,
    netSavings,
    freeCash,
    savingsRate,
    investmentRate,
    expenseRatio,
    averageDailySpend: expenses / uniqueSpendDays,
    largestExpense,
    topCategory,
    transactionCount: rows.length,
    burnMultiple: income ? expenses / income : expenses ? 1 : 0,
    health
  };
}

function pct(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function renderMonthSelect() {
  const select = $("#monthSelect");
  const options = monthOptions();
  if (!options.includes(state.selectedMonth)) state.selectedMonth = "All";
  select.innerHTML = options.map((month) => `<option ${month === state.selectedMonth ? "selected" : ""}>${month}</option>`).join("");
}

function renderDatalists() {
  $("#categoryList").innerHTML = state.data.categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("");
  $("#accountList").innerHTML = state.data.accounts.map((account) => `<option value="${escapeHtml(account)}"></option>`).join("");
}

function renderMetrics() {
  const metrics = calcMetrics();
  state.lastMetrics = metrics;
  if ($("#healthBadge")) $("#healthBadge").textContent = metrics.health;

  const cards = [
    ["Total Income", money.format(metrics.income), `${metrics.transactionCount} entries`],
    ["Total Expenses", money.format(metrics.expenses), `${pct(metrics.expenseRatio)} of income`],
    ["Total Investments", money.format(metrics.investments), `${pct(metrics.investmentRate)} of income`],
    ["Net Savings", money.format(metrics.netSavings), `${pct(metrics.savingsRate)} savings rate`],
    ["Avg Daily Spend", money.format(metrics.averageDailySpend), state.selectedMonth],
    ["Largest Expense", metrics.largestExpense ? money.format(metrics.largestExpense.amount) : money.format(0), metrics.largestExpense?.category || "No expenses"],
    ["Most Used Category", metrics.topCategory?.label || "None yet", metrics.topCategory ? money.format(metrics.topCategory.value) : money.format(0)],
    ["Financial Health", metrics.health, `Burn ${metrics.burnMultiple.toFixed(2)}x`]
  ];

  $("#metricGrid").innerHTML = cards
    .map(
      ([label, value, note]) => `
        <article class="metric-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <small>${escapeHtml(note)}</small>
        </article>`
    )
    .join("");

}

function renderRatios() {
  const metrics = state.lastMetrics || calcMetrics();
  const latest = latestNetWorth();
  const emergencyTarget = Number(state.data.settings?.emergencyFundTarget || 0);
  const runwayMonths = metrics.expenses ? (latest?.cashBank || 0) / metrics.expenses : 0;
  const ratios = [
    ["Expense Ratio", pct(metrics.expenseRatio), "Expenses / income"],
    ["Investment Rate", pct(metrics.investmentRate), "Investments / income"],
    ["Free Cash", money.format(metrics.freeCash), "Income after expenses"],
    ["Burn Multiple", `${metrics.burnMultiple.toFixed(2)}x`, "Expenses against income"],
    ["Runway", runwayMonths ? `${runwayMonths.toFixed(1)} mo` : "n/a", "Cash / monthly expense"],
    ["Emergency Fund", emergencyTarget && latest ? pct(Math.min(latest.cashBank / emergencyTarget, 1)) : "Set target", "Cash reserve progress"]
  ];

  $("#ratioGrid").innerHTML = ratios
    .map(
      ([label, value, note]) => `
        <article class="ratio-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <small>${escapeHtml(note)}</small>
        </article>`
    )
    .join("");
}

function renderInsights() {
  const metrics = state.lastMetrics || calcMetrics();
  const balances = accountBalances();
  const topAccount = balances[0];
  const latest = latestNetWorth();
  const emergencyTarget = Number(state.data.settings?.emergencyFundTarget || 0);
  const monthlyGoal = Number(state.data.settings?.monthlySavingsGoal || 0);
  const emergencyProgress = emergencyTarget && latest ? Math.min(latest.cashBank / emergencyTarget, 1) : 0;
  const monthlyGoalProgress = monthlyGoal ? Math.min(Math.max(metrics.netSavings, 0) / monthlyGoal, 1) : 0;
  const alerts = budgetAlerts();

  $("#accountInsight").innerHTML = `
    <span>Primary Account</span>
    <strong>${escapeHtml(topAccount?.label || state.data.settings?.defaultAccount || "Bank")}</strong>
    <small>${topAccount ? money.format(topAccount.value) : "No balance yet"}</small>
  `;

  $("#goalInsight").innerHTML = `
    <span>Savings Target</span>
    <strong>${monthlyGoal ? pct(monthlyGoalProgress) : pct(metrics.savingsRate)}</strong>
    <small>${monthlyGoal ? `${money.format(Math.max(metrics.netSavings, 0))} of ${money.format(monthlyGoal)}` : "Set a monthly goal in settings"}</small>
  `;

  $("#riskInsight").innerHTML = `
    <span>Budget Watch</span>
    <strong>${alerts[0] ? escapeHtml(alerts[0].category) : emergencyTarget ? pct(emergencyProgress) : "Clear"}</strong>
    <small>${alerts[0] ? `${Math.round(alerts[0].ratio * 100)}% used this month` : emergencyTarget ? "Emergency fund progress" : "No budget alerts"}</small>
  `;
}

function renderEmptyState() {
  $("#emptyState").classList.toggle("hidden", state.data.transactions.length > 0);
}

function renderTransactionsTable() {
  const rows = selectedTransactions().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $("#transactionsTable").innerHTML =
    rows
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(row.date)}</td>
            <td><span class="type-chip ${row.type.toLowerCase()}">${escapeHtml(row.type)}</span></td>
            <td>${money.format(row.amount)}</td>
            <td>${escapeHtml(row.category)}</td>
            <td>${escapeHtml(row.account)}</td>
            <td>${escapeHtml(row.description || "-")}</td>
            <td>${escapeHtml(row.month)}</td>
            <td>${escapeHtml(row.week)}</td>
            <td>${money.format(row.runningBalance || 0)}</td>
            <td>
              <div class="row-actions">
                <button class="mini-btn" data-edit-transaction="${row.id}" type="button">Edit</button>
                <button class="mini-btn" data-delete-transaction="${row.id}" type="button">Delete</button>
              </div>
            </td>
          </tr>`
      )
      .join("") || `<tr><td colspan="10">No transactions found.</td></tr>`;
}

function actualSpendByCategory() {
  const map = new Map();
  transactionsForMetrics()
    .filter((row) => row.type === "Expense" || row.type === "Investment")
    .forEach((row) => {
      map.set(row.category, (map.get(row.category) || 0) + Number(row.amount || 0));
    });
  return map;
}

function renderBudgets() {
  const actuals = actualSpendByCategory();
  const budgets = [...state.data.budgets].sort((a, b) => a.category.localeCompare(b.category));
  const budgetTotal = budgets.reduce((total, row) => total + Number(row.monthlyBudget || 0), 0);
  const actualTotal = Array.from(actuals.values()).reduce((total, amount) => total + amount, 0);
  const usedPct = budgetTotal ? actualTotal / budgetTotal : 0;
  $("#budgetHealth").textContent = pct(usedPct);
  $("#budgetTotal").textContent = `${money.format(actualTotal)} / ${money.format(budgetTotal)}`;

  $("#budgetRows").innerHTML = budgets
    .map((budget) => {
      const actual = actuals.get(budget.category) || 0;
      const variance = Number(budget.monthlyBudget || 0) - actual;
      const rowPct = Number(budget.monthlyBudget) ? Math.min((actual / Number(budget.monthlyBudget)) * 100, 160) : 0;
      return `
        <div class="budget-row">
          <strong>${escapeHtml(budget.category)}</strong>
          <input
            class="budget-input"
            data-budget-id="${budget.id}"
            data-category="${escapeHtml(budget.category)}"
            type="number"
            min="0"
            step="0.01"
            value="${Number(budget.monthlyBudget || 0)}"
            aria-label="${escapeHtml(budget.category)} budget" />
          <div>
            <div class="progress-track"><span class="progress-bar" style="--pct: ${rowPct}%;"></span></div>
            <small>${money.format(actual)} actual</small>
          </div>
          <span class="${variance < 0 ? "danger-text" : "good-text"}">${money.format(variance)}</span>
        </div>`;
    })
    .join("");
}

function latestNetWorth() {
  return [...state.data.netWorth].sort((a, b) => monthDate(b.month) - monthDate(a.month))[0];
}

function renderNetWorth() {
  const rows = [...state.data.netWorth].sort((a, b) => monthDate(b.month) - monthDate(a.month));
  const latest = latestNetWorth();
  $("#netWorthTotal").textContent = latest ? money.format(latest.netWorth) : money.format(0);
  $("#netWorthTable").innerHTML =
    rows
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(row.month)}</td>
            <td>${money.format(row.cashBank)}</td>
            <td>${money.format(row.investments)}</td>
            <td>${money.format(row.assets)}</td>
            <td>${money.format(row.liabilities)}</td>
            <td>${money.format(row.netWorth)}</td>
            <td>
              <div class="row-actions">
                <button class="mini-btn" data-edit-networth="${row.id}" type="button">Edit</button>
                <button class="mini-btn" data-delete-networth="${row.id}" type="button">Delete</button>
              </div>
            </td>
          </tr>`
      )
      .join("") || `<tr><td colspan="7">No net worth entries found.</td></tr>`;
}

function renderSettings() {
  const settings = state.data.settings || emptyData.settings;
  const form = $("#settingsForm");
  if (form && document.activeElement?.form !== form) {
    form.elements.monthlySavingsGoal.value = Number(settings.monthlySavingsGoal || 0);
    form.elements.emergencyFundTarget.value = Number(settings.emergencyFundTarget || 0);
    form.elements.defaultAccount.value = settings.defaultAccount || "Bank";
  }
  const count = state.data.transactions.length + state.data.budgets.length + state.data.netWorth.length;
  $("#dataFootprint").textContent = `${count} entries`;
}

function renderReports() {
  const count = state.data.transactions.length + state.data.budgets.length + state.data.netWorth.length;
  $("#reportFootprint").textContent = `${count} entries`;
  const metrics = state.lastMetrics || calcMetrics();
  $("#reportSummary").innerHTML = `
    <div><span>Transactions</span><strong>${state.data.transactions.length}</strong></div>
    <div><span>Net savings</span><strong>${money.format(metrics.netSavings)}</strong></div>
    <div><span>Financial health</span><strong>${escapeHtml(metrics.health)}</strong></div>
    <div><span>Current month</span><strong>${escapeHtml(state.selectedMonth)}</strong></div>
  `;
}

function renderView() {
  $$(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.view === state.activeView));
  $$(".view").forEach((view) => view.classList.remove("active-view"));
  $(`#${state.activeView}View`).classList.add("active-view");
  $("#viewTitle").textContent = {
    dashboard: "Dashboard",
    addtransaction: "Add Transaction",
    transactions: "Transactions",
    budgets: "Budget Tracker",
    networth: "Net Worth",
    reports: "Reports",
    settings: "Settings"
  }[state.activeView];
}

function renderApp() {
  renderDatalists();
  renderMonthSelect();
  renderView();
  renderMetrics();
  renderInsights();
  renderRatios();
  renderEmptyState();
  renderTransactionsTable();
  renderBudgets();
  renderNetWorth();
  renderSettings();
  renderReports();
  drawAllCharts();
}

function resetTransactionForm() {
  const form = $("#transactionForm");
  form.reset();
  form.elements.id.value = "";
  form.elements.date.value = new Date().toISOString().slice(0, 10);
  form.elements.type.value = "Expense";
  form.elements.category.value = state.data.categories.includes("Food") ? "Food" : state.data.categories[0] || "Other";
  form.elements.account.value = state.data.settings?.defaultAccount || (state.data.accounts.includes("UPI") ? "UPI" : state.data.accounts[0] || "Bank");
  renderEntryPreview();
}

function resetNetWorthForm() {
  const form = $("#netWorthForm");
  form.reset();
  form.elements.id.value = "";
}

async function saveTransaction(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.amount = Number(payload.amount);
  const transactionId = payload.id;
  delete payload.id;

  const endpoint = transactionId ? `/api/transactions/${encodeURIComponent(transactionId)}` : "/api/transactions";
  const method = transactionId ? "PUT" : "POST";
  const result = await api(endpoint, { method, body: body(payload) });
  state.data = result.data;
  resetTransactionForm();
  renderApp();
  state.activeView = "transactions";
  renderView();
  toast("Transaction saved.");
}

function renderEntryPreview() {
  const form = $("#transactionForm");
  if (!form || !$("#entryPreview")) return;
  const amount = Number(form.elements.amount.value || 0);
  const type = form.elements.type.value;
  const category = form.elements.category.value || "Category";
  const account = form.elements.account.value || "Account";
  $("#entryModeLabel").textContent = type;
  $("#entryPreview").innerHTML = `
    <span>Preview</span>
    <strong>${amount ? money.format(amount) : money.format(0)}</strong>
    <small>${escapeHtml(type)} · ${escapeHtml(category)} · ${escapeHtml(account)}</small>
  `;
  $$(".quick-type").forEach((button) => button.classList.toggle("active", button.dataset.quickType === type));
}

async function saveNetWorth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  ["cashBank", "investments", "assets", "liabilities"].forEach((key) => {
    payload[key] = Number(payload[key]);
  });
  const netWorthId = payload.id;
  delete payload.id;

  const endpoint = netWorthId ? `/api/net-worth/${encodeURIComponent(netWorthId)}` : "/api/net-worth";
  const method = netWorthId ? "PUT" : "POST";
  const result = await api(endpoint, { method, body: body(payload) });
  state.data = result.data;
  resetNetWorthForm();
  renderApp();
  toast("Net worth entry saved.");
}

function editTransaction(id) {
  const row = state.data.transactions.find((transaction) => transaction.id === id);
  if (!row) return;
  state.activeView = "addtransaction";
  renderView();
  const form = $("#transactionForm");
  form.elements.id.value = row.id;
  form.elements.date.value = row.date;
  form.elements.type.value = row.type;
  form.elements.amount.value = row.amount;
  form.elements.category.value = row.category;
  form.elements.account.value = row.account;
  form.elements.description.value = row.description || "";
  form.elements.notes.value = row.notes || "";
  $("#transactionComposer").scrollIntoView({ behavior: "smooth", block: "start" });
}

function editNetWorth(id) {
  const row = state.data.netWorth.find((item) => item.id === id);
  if (!row) return;
  const form = $("#netWorthForm");
  form.elements.id.value = row.id;
  form.elements.month.value = row.month;
  form.elements.cashBank.value = row.cashBank;
  form.elements.investments.value = row.investments;
  form.elements.assets.value = row.assets;
  form.elements.liabilities.value = row.liabilities;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteTransaction(id) {
  const result = await api(`/api/transactions/${encodeURIComponent(id)}`, { method: "DELETE" });
  state.data = result.data;
  renderApp();
  toast("Transaction deleted.");
}

async function deleteNetWorth(id) {
  const result = await api(`/api/net-worth/${encodeURIComponent(id)}`, { method: "DELETE" });
  state.data = result.data;
  renderApp();
  toast("Net worth entry deleted.");
}

let budgetTimer = null;

function scheduleBudgetSave() {
  clearTimeout(budgetTimer);
  budgetTimer = setTimeout(saveBudgets, 550);
}

async function saveBudgets() {
  const budgets = $$(".budget-input").map((input) => ({
    id: input.dataset.budgetId,
    category: input.dataset.category,
    monthlyBudget: Number(input.value || 0)
  }));
  const result = await api("/api/budgets", { method: "PUT", body: body({ budgets }) });
  state.data = result.data;
  renderApp();
  toast("Budgets updated.");
}

async function saveSettings(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  payload.monthlySavingsGoal = Number(payload.monthlySavingsGoal || 0);
  payload.emergencyFundTarget = Number(payload.emergencyFundTarget || 0);
  const result = await api("/api/settings", { method: "PUT", body: body({ settings: payload }) });
  state.data = result.data;
  renderApp();
  toast("Settings saved.");
}

async function importCsvFile(file) {
  if (!file) return;
  const csvText = await file.text();
  const result = await api("/api/import/transactions", { method: "POST", body: body({ csvText }) });
  state.data = result.data;
  state.selectedMonth = "All";
  renderApp();
  toast(`Imported ${result.imported} transactions${result.skipped ? `, skipped ${result.skipped}` : ""}.`);
}

function confirmAction(message) {
  return new Promise((resolve) => {
    const dialog = $("#confirmDialog");
    $("#confirmMessage").textContent = message;
    dialog.classList.remove("hidden");

    const cleanup = (answer) => {
      dialog.classList.add("hidden");
      $("#confirmOk").removeEventListener("click", ok);
      $("#confirmCancel").removeEventListener("click", cancel);
      resolve(answer);
    };
    const ok = () => cleanup(true);
    const cancel = () => cleanup(false);
    $("#confirmOk").addEventListener("click", ok);
    $("#confirmCancel").addEventListener("click", cancel);
  });
}

function canvasContext(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function drawEmpty(ctx, width, height, label) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = css("--muted");
  ctx.font = "700 14px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, width / 2, height / 2);
}

function drawBars(canvas, rows, options = {}) {
  const { ctx, width, height } = canvasContext(canvas);
  ctx.clearRect(0, 0, width, height);
  const pad = { top: 28, right: 20, bottom: 44, left: 48 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const max = Math.max(...rows.map((row) => row.value), 1);

  if (!rows.length) {
    drawEmpty(ctx, width, height, "No data yet");
    return;
  }

  ctx.strokeStyle = css("--line");
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i += 1) {
    const y = pad.top + (chartH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  rows.slice(0, options.limit || 8).forEach((row, index, visibleRows) => {
    const gap = 10;
    const barW = Math.max(12, (chartW - gap * (visibleRows.length - 1)) / visibleRows.length);
    const x = pad.left + index * (barW + gap);
    const h = (row.value / max) * chartH;
    const y = pad.top + chartH - h;
    const gradient = ctx.createLinearGradient(0, y, 0, y + h);
    gradient.addColorStop(0, css("--accent"));
    gradient.addColorStop(1, css("--accent-2"));
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barW, h);
    ctx.fillStyle = css("--muted");
    ctx.font = "700 11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(row.label).slice(0, 10), x + barW / 2, height - 18);
  });
}

function drawMonthlyChart() {
  const canvas = $("#monthlyChart");
  const rowsByMonth = new Map();
  state.data.transactions.forEach((row) => {
    if (!rowsByMonth.has(row.month)) rowsByMonth.set(row.month, { label: row.month, income: 0, expenses: 0, investments: 0 });
    const bucket = rowsByMonth.get(row.month);
    if (row.type === "Income") bucket.income += row.amount;
    if (row.type === "Expense") bucket.expenses += row.amount;
    if (row.type === "Investment") bucket.investments += row.amount;
  });
  const rows = Array.from(rowsByMonth.values())
    .sort((a, b) => monthDate(a.label) - monthDate(b.label))
    .slice(-6);

  const { ctx, width, height } = canvasContext(canvas);
  if (!rows.length) {
    drawEmpty(ctx, width, height, "No monthly data yet");
    $("#monthlyTotal").textContent = money.format(0);
    return;
  }

  ctx.clearRect(0, 0, width, height);
  const pad = { top: 28, right: 20, bottom: 44, left: 46 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const max = Math.max(...rows.flatMap((row) => [row.income, row.expenses, row.investments]), 1);
  const colors = [css("--accent"), css("--danger"), css("--accent-2")];

  ctx.strokeStyle = css("--line");
  for (let i = 0; i <= 3; i += 1) {
    const y = pad.top + (chartH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  rows.forEach((row, index) => {
    const slot = chartW / rows.length;
    const x0 = pad.left + index * slot + slot * 0.2;
    const barW = Math.max(8, slot * 0.16);
    [row.income, row.expenses, row.investments].forEach((value, valueIndex) => {
      const h = (value / max) * chartH;
      ctx.fillStyle = colors[valueIndex];
      ctx.fillRect(x0 + valueIndex * (barW + 4), pad.top + chartH - h, barW, h);
    });
    ctx.fillStyle = css("--muted");
    ctx.font = "700 11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(row.label.replace(" 2026", ""), pad.left + index * slot + slot / 2, height - 18);
  });

  const metrics = calcMetrics(state.data.transactions);
  $("#monthlyTotal").textContent = money.format(metrics.netSavings);
}

function drawBudgetChart() {
  const actuals = actualSpendByCategory();
  const rows = state.data.budgets
    .map((budget) => ({
      label: budget.category,
      value: actuals.get(budget.category) || 0
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  drawBars($("#budgetChart"), rows, { limit: 8 });
}

function drawCashflowChart() {
  const canvas = $("#cashflowChart");
  if (!canvas) return;
  const metrics = state.lastMetrics || calcMetrics();
  const rows = [
    { label: "Income", value: metrics.income, color: css("--good") },
    { label: "Expenses", value: metrics.expenses, color: css("--danger") },
    { label: "Investments", value: metrics.investments, color: css("--accent-2") },
    { label: "Savings", value: Math.max(metrics.netSavings, 0), color: css("--accent") }
  ].filter((row) => row.value > 0);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  $("#cashflowMixTotal").textContent = money.format(total);
  const { ctx, width, height } = canvasContext(canvas);
  if (!rows.length) {
    drawEmpty(ctx, width, height, "No cashflow data yet");
    return;
  }
  ctx.clearRect(0, 0, width, height);
  const cx = width * 0.46;
  const cy = height * 0.48;
  const radius = Math.min(width, height) * 0.27;
  let start = -Math.PI / 2;
  rows.forEach((row) => {
    const angle = (row.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = row.color;
    ctx.fill();
    start += angle;
  });
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.58, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = css("--text");
  ctx.font = "760 16px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Mix", cx, cy + 5);

  rows.forEach((row, index) => {
    const x = width * 0.72;
    const y = height * 0.25 + index * 30;
    ctx.fillStyle = row.color;
    ctx.fillRect(x, y - 8, 10, 10);
    ctx.fillStyle = css("--muted");
    ctx.font = "700 11px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(row.label, x + 16, y);
    ctx.fillStyle = css("--text");
    ctx.fillText(compactMoney.format(row.value), x + 16, y + 14);
  });
}

function drawAccountChart() {
  const canvas = $("#accountChart");
  if (!canvas) return;
  const rows = accountBalances().filter((row) => row.value !== 0).slice(0, 8);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  $("#accountBalanceTotal").textContent = money.format(total);
  drawBars(canvas, rows.map((row) => ({ label: row.label, value: Math.abs(row.value) })), { limit: 8 });
}

function drawNetWorthChart() {
  const canvas = $("#netWorthChart");
  const rows = [...state.data.netWorth].sort((a, b) => monthDate(a.month) - monthDate(b.month));
  const { ctx, width, height } = canvasContext(canvas);
  if (!rows.length) {
    drawEmpty(ctx, width, height, "No net worth data yet");
    return;
  }

  ctx.clearRect(0, 0, width, height);
  const pad = { top: 30, right: 24, bottom: 42, left: 48 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const values = rows.map((row) => row.netWorth);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;

  ctx.strokeStyle = css("--line");
  for (let i = 0; i <= 3; i += 1) {
    const y = pad.top + (chartH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = pad.left + (chartW / Math.max(rows.length - 1, 1)) * index;
    const y = pad.top + chartH - ((row.netWorth - min) / span) * chartH;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = css("--accent");
  ctx.lineWidth = 3;
  ctx.stroke();

  rows.forEach((row, index) => {
    const x = pad.left + (chartW / Math.max(rows.length - 1, 1)) * index;
    const y = pad.top + chartH - ((row.netWorth - min) / span) * chartH;
    ctx.fillStyle = css("--accent-2");
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css("--muted");
    ctx.font = "700 11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(row.month.replace(" 2026", ""), x, height - 18);
  });
}

function drawAllCharts() {
  if (!state.user) return;
  const categoryRows = groupAmounts(
    transactionsForMetrics().filter((row) => row.type === "Expense" || row.type === "Investment")
  );
  const total = categoryRows.reduce((amount, row) => amount + row.value, 0);
  $("#categoryTotal").textContent = money.format(total);
  drawBars($("#categoryChart"), categoryRows, { limit: 8 });
  drawMonthlyChart();
  drawCashflowChart();
  drawAccountChart();
  drawBudgetChart();
  drawNetWorthChart();
}

let ledgerScene = null;

async function initLedgerScene() {
  const canvas = $("#ledgerScene");
  if (!canvas) {
    ledgerScene = null;
    return;
  }
  try {
    const THREE = await import("https://unpkg.com/three@0.160.0/build/three.module.js");
    ledgerScene = createThreeLedger(THREE, canvas);
  } catch {
    ledgerScene = createCanvasLedger(canvas);
  }
  ledgerScene.setPalette();
  ledgerScene.update(calcMetrics());
}

function createThreeLedger(THREE, canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 3.9, 6.1);
  camera.lookAt(0, 0.65, 0);
  const group = new THREE.Group();
  group.rotation.x = -0.08;
  group.scale.set(1.18, 1.18, 1.18);
  scene.add(group);

  const ambient = new THREE.AmbientLight(0xffffff, 0.62);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
  keyLight.position.set(-3.5, 6, 4);
  scene.add(keyLight);
  const fillLight = new THREE.PointLight(0xffffff, 8, 15);
  fillLight.position.set(4, 3, 5);
  scene.add(fillLight);

  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 0.08, 3.85),
    new THREE.MeshStandardMaterial({
      color: 0x111827,
      transparent: true,
      opacity: 0.72,
      metalness: 0.3,
      roughness: 0.42
    })
  );
  platform.position.y = -0.04;
  group.add(platform);

  const grid = new THREE.GridHelper(6.4, 12, 0x475569, 0x334155);
  grid.scale.z = 0.6;
  grid.position.y = 0.02;
  grid.material.transparent = true;
  grid.material.opacity = 0.34;
  group.add(grid);

  const bars = [
    { key: "income", label: "Income", x: -2.25, z: 0.52 },
    { key: "expenses", label: "Expenses", x: -0.75, z: -0.42 },
    { key: "investments", label: "Investments", x: 0.75, z: 0.1 },
    { key: "netSavings", label: "Net savings", x: 2.25, z: -0.28 }
  ].map((item) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 1, 0.34),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x111111,
        transparent: true,
        opacity: 0.9,
        roughness: 0.28,
        metalness: 0.24
      })
    );
    mesh.position.x = item.x;
    mesh.position.z = item.z;
    group.add(mesh);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.23, 0.025, 28),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.72, metalness: 0.2, roughness: 0.36 })
    );
    cap.position.set(item.x, 1, item.z);
    group.add(cap);

    return { ...item, mesh, cap };
  });

  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
  const trendGeometry = new THREE.BufferGeometry();
  const trendLine = new THREE.Line(trendGeometry, lineMaterial);
  group.add(trendLine);

  const nodes = bars.map((bar) => {
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.24, roughness: 0.32 })
    );
    node.position.set(bar.x, 0.25, bar.z);
    group.add(node);
    return node;
  });

  const labels = [];
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512;
  labelCanvas.height = 128;
  const labelCtx = labelCanvas.getContext("2d");
  for (const bar of bars) {
    const textureCanvas = labelCanvas.cloneNode();
    const textureCtx = textureCanvas.getContext("2d");
    textureCtx.fillStyle = "rgba(238, 243, 247, 0.82)";
    textureCtx.font = "600 34px Inter, Segoe UI, sans-serif";
    textureCtx.textAlign = "center";
    textureCtx.fillText(bar.label, 256, 70);
    const texture = new THREE.CanvasTexture(textureCanvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.84 }));
    sprite.position.set(bar.x, 0.12, bar.z + 0.62);
    sprite.scale.set(0.95, 0.24, 1);
    group.add(sprite);
    labels.push(sprite);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0.65, 0);
  }

  function setPalette() {
    const colors = [css("--good"), css("--danger"), css("--accent-2"), css("--accent")];
    bars.forEach((bar, index) => {
      const color = new THREE.Color(colors[index] || colors[0]);
      bar.mesh.material.color = color;
      bar.mesh.material.emissive = color.clone().multiplyScalar(0.13);
      bar.cap.material.color = color;
      bar.cap.material.emissive = color.clone().multiplyScalar(0.08);
      nodes[index].material.color = color;
      nodes[index].material.emissive = color.clone().multiplyScalar(0.12);
    });
    lineMaterial.color = new THREE.Color(css("--accent"));
  }

  function update(metrics) {
    const values = bars.map((bar) => Math.abs(metrics?.[bar.key] || 0));
    const max = Math.max(...values, 1);
    bars.forEach((bar) => {
      const raw = Math.abs(metrics?.[bar.key] || 0);
      const scale = 0.22 + (raw / max) * 2.25;
      bar.mesh.scale.y = scale;
      bar.mesh.position.y = scale / 2;
      bar.cap.position.y = scale + 0.04;
    });

    const points = bars.map((bar) => new THREE.Vector3(bar.x, bar.cap.position.y + 0.08, bar.z));
    trendGeometry.setFromPoints(points);
    nodes.forEach((node, index) => {
      node.position.copy(points[index]);
    });
  }

  function animate(time) {
    group.rotation.y = Math.sin(time * 0.00028) * 0.08;
    bars.forEach((bar, index) => {
      bar.mesh.material.opacity = 0.86 + Math.sin(time * 0.001 + index) * 0.04;
    });
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  resize();
  new ResizeObserver(resize).observe(canvas);
  requestAnimationFrame(animate);
  return { update, setPalette };
}

function createCanvasLedger(canvas) {
  let metrics = calcMetrics();
  let frame = 0;

  function setPalette() {
    draw();
  }

  function update(next) {
    metrics = next || metrics;
    draw();
  }

  function draw() {
    const { ctx, width, height } = canvasContext(canvas);
    ctx.clearRect(0, 0, width, height);
    const left = width * 0.12;
    const right = width * 0.9;
    const top = height * 0.18;
    const base = height * 0.76;
    const values = [metrics.income, metrics.expenses, metrics.investments, Math.abs(metrics.netSavings)];
    const max = Math.max(...values, 1);
    const colors = [css("--good"), css("--danger"), css("--accent-2"), css("--accent")];
    const labels = ["Income", "Expenses", "Invest", "Savings"];

    ctx.strokeStyle = "rgba(148,163,184,0.22)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = top + ((base - top) / 4) * i;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y - 22);
      ctx.stroke();
    }

    const points = [];
    values.forEach((value, index) => {
      const slot = (right - left) / 4;
      const x = left + slot * index + slot * 0.35;
      const barW = Math.max(18, slot * 0.22);
      const h = 28 + (value / max) * (base - top - 30);
      const y = base - h;
      points.push([x + barW / 2, y]);
      const gradient = ctx.createLinearGradient(0, y, 0, base);
      gradient.addColorStop(0, colors[index]);
      gradient.addColorStop(1, "rgba(255,255,255,0.04)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barW, h);
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 10, y - 8);
      ctx.lineTo(x + barW + 10, y - 8);
      ctx.lineTo(x + barW, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = css("--muted");
      ctx.font = "700 11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(labels[index], x + barW / 2, base + 24);
    });

    ctx.strokeStyle = css("--accent");
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y - 8);
      else ctx.lineTo(x, y - 8);
    });
    ctx.stroke();

    points.forEach(([x, y]) => {
      ctx.fillStyle = css("--accent");
      ctx.beginPath();
      ctx.arc(x, y - 8, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function animate() {
    frame += 1;
    draw();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  new ResizeObserver(draw).observe(canvas);
  return { update, setPalette };
}

function bindEvents() {
  $$(".auth-tab").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".auth-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
      $$(".auth-form").forEach((form) => form.classList.toggle("active", form.id === `${button.dataset.authTab}Form`));
    });
  });

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      setSession(await api("/api/login", { method: "POST", body: body(payload) }));
      toast("Welcome back.");
    } catch (error) {
      toast(error.message);
    }
  });

  $("#demoLogin").addEventListener("click", async () => {
    try {
      setSession(await api("/api/login", { method: "POST", body: body({ email: "demo@cura.health", password: "demo123" }) }));
      toast("Demo account loaded.");
    } catch (error) {
      toast(error.message);
    }
  });

  $("#signupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      setSession(await api("/api/signup", { method: "POST", body: body(payload) }));
      resetTransactionForm();
      toast("Account created.");
    } catch (error) {
      toast(error.message);
    }
  });

  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    state.user = null;
    state.data = structuredClone(emptyData);
    showAuth();
    toast("Logged out.");
  });

  $$(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      renderView();
      drawAllCharts();
    });
  });

  $("#themePicker").addEventListener("click", (event) => {
    const swatch = event.target.closest("[data-theme]");
    if (swatch) setTheme(swatch.dataset.theme);
  });

  $("#monthSelect").addEventListener("change", (event) => {
    state.selectedMonth = event.target.value;
    renderApp();
  });

  $("#searchInput").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderTransactionsTable();
  });

  $("#typeFilter").addEventListener("change", (event) => {
    state.typeFilter = event.target.value;
    renderTransactionsTable();
  });

  $("#transactionForm").addEventListener("submit", (event) => {
    saveTransaction(event).catch((error) => toast(error.message));
  });

  $("#netWorthForm").addEventListener("submit", (event) => {
    saveNetWorth(event).catch((error) => toast(error.message));
  });

  $("#settingsForm").addEventListener("submit", (event) => {
    saveSettings(event).catch((error) => toast(error.message));
  });

  $("#clearTransactionForm").addEventListener("click", resetTransactionForm);
  $("#clearNetWorthForm").addEventListener("click", resetNetWorthForm);

  $("#addTransactionShortcut").addEventListener("click", () => {
    state.activeView = "addtransaction";
    renderView();
    resetTransactionForm();
    $("#transactionComposer").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#emptyAddIncome").addEventListener("click", () => {
    state.activeView = "addtransaction";
    renderView();
    resetTransactionForm();
    $("#transactionForm").elements.type.value = "Income";
    $("#transactionForm").elements.category.value = "Salary";
    $("#transactionComposer").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#emptyImportCsv").addEventListener("click", () => $("#csvFileInput").click());

  $("#importCsvBtn").addEventListener("click", () => $("#csvFileInput").click());
  $("#settingsImportCsvBtn").addEventListener("click", () => $("#csvFileInput").click());
  $("#reportsImportCsvBtn").addEventListener("click", () => $("#csvFileInput").click());
  $("#printReportBtn").addEventListener("click", () => window.print());
  $("#csvFileInput").addEventListener("change", (event) => {
    importCsvFile(event.target.files?.[0])
      .catch((error) => toast(error.message))
      .finally(() => {
        event.target.value = "";
      });
  });

  $("#loadDemoBtn").addEventListener("click", async () => {
    try {
      const confirmed = await confirmAction("This replaces the current workspace with sample data.");
      if (!confirmed) return;
      const result = await api("/api/demo/reset", { method: "POST", body: "{}" });
      state.data = result.data;
      state.selectedMonth = "All";
      resetTransactionForm();
      renderApp();
      toast("Demo data loaded.");
    } catch (error) {
      toast(error.message);
    }
  });

  document.addEventListener("click", (event) => {
    const editTransactionButton = event.target.closest("[data-edit-transaction]");
    const deleteTransactionButton = event.target.closest("[data-delete-transaction]");
    const editNetWorthButton = event.target.closest("[data-edit-networth]");
    const deleteNetWorthButton = event.target.closest("[data-delete-networth]");
    if (editTransactionButton) editTransaction(editTransactionButton.dataset.editTransaction);
    if (deleteTransactionButton) {
      confirmAction("Delete this transaction from the workspace?").then((confirmed) => {
        if (confirmed) deleteTransaction(deleteTransactionButton.dataset.deleteTransaction).catch((error) => toast(error.message));
      });
    }
    if (editNetWorthButton) editNetWorth(editNetWorthButton.dataset.editNetworth);
    if (deleteNetWorthButton) {
      confirmAction("Delete this net worth entry from the workspace?").then((confirmed) => {
        if (confirmed) deleteNetWorth(deleteNetWorthButton.dataset.deleteNetworth).catch((error) => toast(error.message));
      });
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.classList.contains("budget-input")) {
      scheduleBudgetSave();
    }
    if (event.target.closest("#transactionForm")) {
      renderEntryPreview();
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.closest("#transactionForm")) {
      renderEntryPreview();
    }
  });

  $$(".quick-type").forEach((button) => {
    button.addEventListener("click", () => {
      const form = $("#transactionForm");
      form.elements.type.value = button.dataset.quickType;
      if (button.dataset.quickType === "Income") form.elements.category.value = "Salary";
      if (button.dataset.quickType === "Investment") form.elements.category.value = "Investment";
      if (button.dataset.quickType === "Expense" && !form.elements.category.value) form.elements.category.value = "Food";
      renderEntryPreview();
    });
  });

  window.addEventListener("resize", () => {
    clearTimeout(window.__curaResize);
    window.__curaResize = setTimeout(drawAllCharts, 120);
  });
}

async function boot() {
  setTheme(state.theme);
  bindEvents();
  resetTransactionForm();
  await initLedgerScene();

  try {
    const payload = await api("/api/me");
    if (payload.user) {
      setSession(payload);
      resetTransactionForm();
    } else {
      showAuth();
    }
  } catch (error) {
    showAuth();
    toast(error.message);
  }
}

boot();
