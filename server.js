const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const SESSION_COOKIE = "cura_session";
const WEEK = 7 * 24 * 60 * 60 * 1000;

const categories = [
  "Investment",
  "Food",
  "Travel",
  "Rent",
  "Utilities",
  "Shopping",
  "Entertainment",
  "Health",
  "Education",
  "Salary",
  "Bills",
  "Other"
];

const accounts = ["Cash", "Bank", "UPI", "Credit Card", "Savings", "Investment"];

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim().slice(0, 180);
}

function id() {
  return crypto.randomUUID();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, "sha512").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const next = hashPassword(password, user.salt).hash;
  return crypto.timingSafeEqual(Buffer.from(next, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function makeBudget(category, monthlyBudget = 0) {
  return {
    id: id(),
    category,
    monthlyBudget,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function starterNetWorth(demo = false) {
  const months = ["Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026"];
  return months.map((month, index) => {
    const base = demo ? 92000 + index * 10500 : 0;
    const investments = demo ? 28000 + index * 6200 : 0;
    const assets = demo ? 45000 + index * 3500 : 0;
    const liabilities = demo ? Math.max(42000 - index * 2800, 24000) : 0;
    return {
      id: id(),
      month,
      cashBank: base,
      investments,
      assets,
      liabilities,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  });
}

function starterTransactions(demo = false) {
  if (!demo) return [];

  return [
    ["2026-04-01", "Income", 185000, "Salary", "Bank", "Monthly salary", ""],
    ["2026-04-02", "Expense", 46000, "Rent", "Bank", "Apartment rent", ""],
    ["2026-04-03", "Investment", 35000, "Investment", "Investment", "Index fund SIP", ""],
    ["2026-04-05", "Expense", 4200, "Utilities", "UPI", "Power and internet", ""],
    ["2026-04-06", "Expense", 7800, "Food", "Credit Card", "Groceries", ""],
    ["2026-04-10", "Expense", 5600, "Travel", "UPI", "City travel", ""],
    ["2026-04-12", "Expense", 3800, "Health", "Credit Card", "Pharmacy", ""],
    ["2026-04-16", "Expense", 9200, "Shopping", "Credit Card", "Work essentials", ""],
    ["2026-04-18", "Expense", 4500, "Entertainment", "UPI", "Weekend outing", ""],
    ["2026-04-21", "Investment", 15000, "Investment", "Investment", "Emergency fund top-up", ""],
    ["2026-04-24", "Expense", 6800, "Education", "Bank", "Course subscription", ""],
    ["2026-03-01", "Income", 178000, "Salary", "Bank", "Monthly salary", ""],
    ["2026-03-03", "Expense", 45000, "Rent", "Bank", "Apartment rent", ""],
    ["2026-03-05", "Investment", 30000, "Investment", "Investment", "Mutual fund", ""],
    ["2026-03-14", "Expense", 9400, "Food", "Credit Card", "Groceries and dining", ""],
    ["2026-03-19", "Expense", 6200, "Travel", "UPI", "Fuel and transport", ""],
    ["2026-02-01", "Income", 172000, "Salary", "Bank", "Monthly salary", ""],
    ["2026-02-08", "Expense", 7400, "Food", "Credit Card", "Groceries", ""],
    ["2026-02-12", "Expense", 43000, "Rent", "Bank", "Apartment rent", ""],
    ["2026-02-20", "Investment", 28000, "Investment", "Investment", "SIP", ""]
  ].map(([date, type, amount, category, account, description, notes]) => ({
    id: id(),
    date,
    type,
    amount,
    category,
    account,
    description,
    notes,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }));
}

function starterData(demo = false) {
  const defaultBudgets = {
    Investment: demo ? 55000 : 0,
    Food: demo ? 18000 : 0,
    Travel: demo ? 12000 : 0,
    Rent: demo ? 46000 : 0,
    Utilities: demo ? 8000 : 0,
    Shopping: demo ? 14000 : 0,
    Entertainment: demo ? 8000 : 0,
    Health: demo ? 7000 : 0,
    Education: demo ? 9000 : 0,
    Bills: demo ? 6000 : 0,
    Other: demo ? 6000 : 0
  };

  return {
    transactions: starterTransactions(demo),
    budgets: Object.entries(defaultBudgets).map(([category, amount]) => makeBudget(category, amount)),
    netWorth: starterNetWorth(demo),
    categories,
    accounts,
    settings: {
      currency: "INR",
      monthlySavingsGoal: demo ? 75000 : 0,
      emergencyFundTarget: demo ? 600000 : 0,
      defaultAccount: "Bank"
    }
  };
}

function createUser({ name, email, password, demo = false }) {
  const { salt, hash } = hashPassword(password);
  return {
    id: id(),
    name: cleanText(name, "New User"),
    email: cleanText(email).toLowerCase(),
    salt,
    passwordHash: hash,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    data: starterData(demo)
  };
}

async function loadDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  let db;
  if (fsSync.existsSync(DB_PATH)) {
    db = JSON.parse(await fs.readFile(DB_PATH, "utf8"));
  } else {
    db = { users: [], sessions: [] };
  }

  db.users ||= [];
  db.sessions ||= [];
  db.users.forEach((user) => {
    user.data = migrateData(user.data);
  });

  if (!db.users.some((user) => user.email === "demo@cura.health")) {
    db.users.push(
      createUser({
        name: "Demo Finance Team",
        email: "demo@cura.health",
        password: "demo123",
        demo: true
      })
    );
  }

  await saveDb(db);
  return db;
}

async function saveDb(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

function migrateData(data = {}) {
  const next = {
    ...starterData(false),
    ...data,
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
    budgets: Array.isArray(data.budgets) && data.budgets.length ? data.budgets : starterData(false).budgets,
    netWorth: Array.isArray(data.netWorth) ? data.netWorth : [],
    categories: Array.isArray(data.categories) && data.categories.length ? data.categories : [...categories],
    accounts: Array.isArray(data.accounts) && data.accounts.length ? data.accounts : [...accounts],
    settings: {
      ...starterData(false).settings,
      ...(data.settings || {})
    }
  };

  for (const transaction of next.transactions) {
    if (transaction.category && !next.categories.includes(transaction.category)) next.categories.push(transaction.category);
    if (transaction.account && !next.accounts.includes(transaction.account)) next.accounts.push(transaction.account);
  }

  return next;
}

function touchUser(user) {
  user.updatedAt = nowIso();
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const index = cookie.indexOf("=");
        return [cookie.slice(0, index), decodeURIComponent(cookie.slice(index + 1))];
      })
  );
}

function setCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(WEEK / 1000)}`
  );
}

function clearCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions = db.sessions.filter((session) => new Date(session.expiresAt).getTime() > Date.now());
  db.sessions.push({
    token,
    userId,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + WEEK).toISOString()
  });
  return token;
}

function currentUser(req, db) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = db.sessions.find((item) => item.token === token && new Date(item.expiresAt).getTime() > Date.now());
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}

function monthLabel(date) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function weekLabel(date) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  const start = new Date(parsed.getFullYear(), 0, 1);
  const week = Math.ceil(((parsed - start) / 86400000 + start.getDay() + 1) / 7);
  return `W${String(week).padStart(2, "0")}`;
}

function enrichData(data) {
  const migrated = migrateData(data);
  const transactions = [...(migrated.transactions || [])].sort((a, b) => {
    const diff = String(a.date).localeCompare(String(b.date));
    return diff || String(a.createdAt).localeCompare(String(b.createdAt));
  });

  let runningBalance = 0;
  const enrichedTransactions = transactions.map((transaction) => {
    const amount = toNumber(transaction.amount);
    if (transaction.type === "Income") runningBalance += amount;
    if (transaction.type === "Expense" || transaction.type === "Investment") runningBalance -= amount;

    return {
      ...transaction,
      amount,
      month: monthLabel(transaction.date),
      week: weekLabel(transaction.date),
      runningBalance
    };
  });

  return {
    transactions: enrichedTransactions,
    budgets: migrated.budgets || [],
    netWorth: (migrated.netWorth || []).map((row) => ({
      ...row,
      cashBank: toNumber(row.cashBank),
      investments: toNumber(row.investments),
      assets: toNumber(row.assets),
      liabilities: toNumber(row.liabilities),
      netWorth: toNumber(row.cashBank) + toNumber(row.investments) + toNumber(row.assets) - toNumber(row.liabilities)
    })),
    categories: migrated.categories || categories,
    accounts: migrated.accounts || accounts,
    settings: migrated.settings
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
  });
}

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

function requireAuth(req, res, db) {
  const user = currentUser(req, db);
  if (!user) {
    json(res, 401, { error: "Please sign in first." });
    return null;
  }
  user.data = migrateData(user.data);
  return user;
}

function normalizeDateValue(value, fallback) {
  const raw = cleanText(value || fallback || new Date().toISOString().slice(0, 10));
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const dayFirst = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dayFirst) {
    const year = dayFirst[3].length === 2 ? `20${dayFirst[3]}` : dayFirst[3];
    return `${year}-${dayFirst[2].padStart(2, "0")}-${dayFirst[1].padStart(2, "0")}`;
  }

  const parsed = new Date(raw.replace(/-/g, " "));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return raw;
}

function normalizeTransaction(input, previous = {}) {
  const type = cleanText(input.type || previous.type || "Expense");
  const allowedType = ["Income", "Expense", "Investment"].includes(type) ? type : "Expense";
  const category = cleanText(input.category || previous.category || "Other");
  const account = cleanText(input.account || previous.account || "Bank");
  const date = normalizeDateValue(input.date, previous.date);
  const amount = Math.max(0, toNumber(input.amount ?? previous.amount));

  if (!date || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) {
    throw new Error("A valid date is required.");
  }
  if (!amount) {
    throw new Error("Amount must be greater than zero.");
  }

  return {
    ...previous,
    date,
    type: allowedType,
    amount,
    category,
    account,
    description: cleanText(input.description ?? previous.description),
    notes: cleanText(input.notes ?? previous.notes),
    updatedAt: nowIso()
  };
}

function normalizeNetWorth(input, previous = {}) {
  const month = cleanText(input.month || previous.month);
  if (!month) throw new Error("Month is required.");
  return {
    ...previous,
    month,
    cashBank: Math.max(0, toNumber(input.cashBank ?? previous.cashBank)),
    investments: Math.max(0, toNumber(input.investments ?? previous.investments)),
    assets: Math.max(0, toNumber(input.assets ?? previous.assets)),
    liabilities: Math.max(0, toNumber(input.liabilities ?? previous.liabilities)),
    updatedAt: nowIso()
  };
}

function normalizeSettings(input = {}, previous = {}) {
  return {
    ...previous,
    currency: "INR",
    monthlySavingsGoal: Math.max(0, toNumber(input.monthlySavingsGoal ?? previous.monthlySavingsGoal)),
    emergencyFundTarget: Math.max(0, toNumber(input.emergencyFundTarget ?? previous.emergencyFundTarget)),
    defaultAccount: cleanText(input.defaultAccount ?? previous.defaultAccount ?? "Bank")
  };
}

function syncTransactionLists(data, transaction) {
  if (transaction.category && !data.categories.includes(transaction.category)) data.categories.push(transaction.category);
  if (transaction.account && !data.accounts.includes(transaction.account)) data.accounts.push(transaction.account);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < String(text || "").length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  row.push(field);
  if (row.some((cell) => String(cell).trim())) rows.push(row);
  return rows;
}

function normalizeCsvHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s*\/\s*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function transactionsFromCsv(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeCsvHeader);
  const keyAt = (names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0);
  const columns = {
    date: keyAt(["date"]),
    type: keyAt(["type"]),
    amount: keyAt(["amount"]),
    category: keyAt(["category"]),
    account: keyAt(["account"]),
    description: keyAt(["description reason", "description", "reason"]),
    notes: keyAt(["notes"])
  };

  if ([columns.date, columns.type, columns.amount].some((index) => index === undefined)) {
    throw new Error("CSV must include Date, Type, and Amount columns.");
  }

  return rows.slice(1).map((row) =>
    normalizeTransaction({
      date: row[columns.date],
      type: row[columns.type],
      amount: row[columns.amount],
      category: row[columns.category] || "Other",
      account: row[columns.account] || "Bank",
      description: row[columns.description] || "",
      notes: row[columns.notes] || ""
    })
  );
}

function pdfEscape(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function formatInr(value) {
  return `INR ${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0
  }).format(toNumber(value))}`;
}

function reportMonthDate(value) {
  const parsed = Date.parse(`01 ${value}`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildSummary(data) {
  const enriched = enrichData(data);
  const income = enriched.transactions.filter((row) => row.type === "Income").reduce((sum, row) => sum + row.amount, 0);
  const expenses = enriched.transactions.filter((row) => row.type === "Expense").reduce((sum, row) => sum + row.amount, 0);
  const investments = enriched.transactions.filter((row) => row.type === "Investment").reduce((sum, row) => sum + row.amount, 0);
  const netSavings = income - expenses - investments;
  const latestWorth = [...enriched.netWorth].sort((a, b) => reportMonthDate(b.month) - reportMonthDate(a.month))[0];
  return {
    enriched,
    income,
    expenses,
    investments,
    netSavings,
    savingsRate: income ? netSavings / income : 0,
    expenseRatio: income ? expenses / income : 0,
    investmentRate: income ? investments / income : 0,
    latestWorth
  };
}

function makePdfDocument(lines) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const pages = [];
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  const pageLines = [];
  for (let index = 0; index < lines.length; index += 32) {
    pageLines.push(lines.slice(index, index + 32));
  }

  for (const chunk of pageLines) {
    const content = [
      "BT",
      "/F2 18 Tf",
      "56 785 Td",
      `(${pdfEscape(chunk[0] || "Cura Accounts Report")}) Tj`,
      "/F1 10 Tf",
      "0 -28 Td",
      ...chunk.slice(1).flatMap((line) => [`(${pdfEscape(line)}) Tj`, "0 -18 Td"]),
      "ET"
    ].join("\n");
    const streamId = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent PAGES_ID 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${streamId} 0 R >>`);
    pages.push(pageId);
  }

  const pagesId = add(`<< /Type /Pages /Kids [${pages.map((pageId) => `${pageId} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const replacedObjects = objects.map((object) => object.replaceAll("PAGES_ID", String(pagesId)));

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  replacedObjects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${replacedObjects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${replacedObjects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "binary");
}

function buildReportPdf(user) {
  const summary = buildSummary(user.data);
  const topCategories = groupReportRows(
    summary.enriched.transactions.filter((row) => row.type !== "Income"),
    "category"
  ).slice(0, 8);
  const lines = [
    "Cura Accounts Manager - Finance Report",
    `Generated: ${new Date().toLocaleString("en-IN")}`,
    `Workspace: ${user.name} (${user.email})`,
    "",
    "Executive Summary",
    `Total income: ${formatInr(summary.income)}`,
    `Total expenses: ${formatInr(summary.expenses)}`,
    `Total investments: ${formatInr(summary.investments)}`,
    `Net savings: ${formatInr(summary.netSavings)}`,
    `Savings rate: ${Math.round(summary.savingsRate * 100)}%`,
    `Expense ratio: ${Math.round(summary.expenseRatio * 100)}%`,
    `Investment rate: ${Math.round(summary.investmentRate * 100)}%`,
    "",
    "Top Categories",
    ...topCategories.map((row) => `${row.label}: ${formatInr(row.value)}`),
    "",
    "Data Coverage",
    `Transactions: ${summary.enriched.transactions.length}`,
    `Budget categories: ${summary.enriched.budgets.length}`,
    `Net worth entries: ${summary.enriched.netWorth.length}`,
    `Latest net worth: ${summary.latestWorth ? formatInr(summary.latestWorth.netWorth) : "Not available"}`
  ];
  return makePdfDocument(lines);
}

function groupReportRows(rows, key) {
  const groups = new Map();
  rows.forEach((row) => {
    const label = row[key] || "Other";
    groups.set(label, (groups.get(label) || 0) + toNumber(row.amount));
  });
  return Array.from(groups, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

async function handleApi(req, res, db, pathname) {
  try {
    if (req.method === "GET" && pathname === "/api/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/api/signup") {
      const body = await readBody(req);
      const name = cleanText(body.name);
      const email = cleanText(body.email).toLowerCase();
      const password = String(body.password || "");
      if (!name || !email.includes("@") || password.length < 6) {
        json(res, 400, { error: "Enter a name, valid email, and password with at least 6 characters." });
        return;
      }
      if (db.users.some((user) => user.email === email)) {
        json(res, 409, { error: "An account with that email already exists." });
        return;
      }
      const user = createUser({ name, email, password });
      db.users.push(user);
      const token = createSession(db, user.id);
      await saveDb(db);
      setCookie(res, token);
      json(res, 201, { user: publicUser(user), data: enrichData(user.data) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/login") {
      const body = await readBody(req);
      const email = cleanText(body.email).toLowerCase();
      const user = db.users.find((item) => item.email === email);
      if (!user || !verifyPassword(String(body.password || ""), user)) {
        json(res, 401, { error: "Email or password is incorrect." });
        return;
      }
      const token = createSession(db, user.id);
      await saveDb(db);
      setCookie(res, token);
      json(res, 200, { user: publicUser(user), data: enrichData(user.data) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/logout") {
      const cookies = parseCookies(req.headers.cookie || "");
      db.sessions = db.sessions.filter((session) => session.token !== cookies[SESSION_COOKIE]);
      await saveDb(db);
      clearCookie(res);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && pathname === "/api/me") {
      const user = currentUser(req, db);
      if (!user) {
        json(res, 200, { user: null, data: null });
        return;
      }
      json(res, 200, { user: publicUser(user), data: enrichData(user.data) });
      return;
    }

    const user = requireAuth(req, res, db);
    if (!user) return;

    if (req.method === "GET" && pathname === "/api/accounts") {
      json(res, 200, { user: publicUser(user), data: enrichData(user.data) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/demo/reset") {
      user.data = starterData(true);
      touchUser(user);
      await saveDb(db);
      json(res, 200, { user: publicUser(user), data: enrichData(user.data) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/transactions") {
      const body = await readBody(req);
      const transaction = normalizeTransaction(body);
      syncTransactionLists(user.data, transaction);
      user.data.transactions.push({ id: id(), ...transaction, createdAt: nowIso() });
      touchUser(user);
      await saveDb(db);
      json(res, 201, { data: enrichData(user.data) });
      return;
    }

    const transactionMatch = pathname.match(/^\/api\/transactions\/([^/]+)$/);
    if (transactionMatch) {
      const transactionId = decodeURIComponent(transactionMatch[1]);
      const index = user.data.transactions.findIndex((transaction) => transaction.id === transactionId);
      if (index === -1) {
        json(res, 404, { error: "Transaction not found." });
        return;
      }
      if (req.method === "PUT") {
        const body = await readBody(req);
        user.data.transactions[index] = normalizeTransaction(body, user.data.transactions[index]);
        syncTransactionLists(user.data, user.data.transactions[index]);
        touchUser(user);
        await saveDb(db);
        json(res, 200, { data: enrichData(user.data) });
        return;
      }
      if (req.method === "DELETE") {
        user.data.transactions.splice(index, 1);
        touchUser(user);
        await saveDb(db);
        json(res, 200, { data: enrichData(user.data) });
        return;
      }
    }

    if (req.method === "PUT" && pathname === "/api/budgets") {
      const body = await readBody(req);
      const next = Array.isArray(body.budgets) ? body.budgets : [];
      user.data.budgets = next.map((item) => ({
        id: item.id || id(),
        category: cleanText(item.category || "Other"),
        monthlyBudget: Math.max(0, toNumber(item.monthlyBudget)),
        createdAt: item.createdAt || nowIso(),
        updatedAt: nowIso()
      }));
      touchUser(user);
      await saveDb(db);
      json(res, 200, { data: enrichData(user.data) });
      return;
    }

    if (req.method === "PUT" && pathname === "/api/settings") {
      const body = await readBody(req);
      user.data.settings = normalizeSettings(body.settings || body, user.data.settings);
      if (user.data.settings.defaultAccount && !user.data.accounts.includes(user.data.settings.defaultAccount)) {
        user.data.accounts.push(user.data.settings.defaultAccount);
      }
      touchUser(user);
      await saveDb(db);
      json(res, 200, { data: enrichData(user.data) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/import/transactions") {
      const body = await readBody(req);
      const imported = transactionsFromCsv(body.csvText);
      if (!imported.length) {
        json(res, 400, { error: "No transactions found in the CSV." });
        return;
      }
      const existing = new Set(
        user.data.transactions.map((row) => [row.date, row.type, row.amount, row.category, row.account, row.description].join("|"))
      );
      const fresh = imported.filter((row) => !existing.has([row.date, row.type, row.amount, row.category, row.account, row.description].join("|")));
      fresh.forEach((transaction) => {
        syncTransactionLists(user.data, transaction);
        user.data.transactions.push({ id: id(), ...transaction, createdAt: nowIso() });
      });
      touchUser(user);
      await saveDb(db);
      json(res, 201, { imported: fresh.length, skipped: imported.length - fresh.length, data: enrichData(user.data) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/net-worth") {
      const body = await readBody(req);
      const row = normalizeNetWorth(body);
      user.data.netWorth.push({ id: id(), ...row, createdAt: nowIso() });
      touchUser(user);
      await saveDb(db);
      json(res, 201, { data: enrichData(user.data) });
      return;
    }

    const netWorthMatch = pathname.match(/^\/api\/net-worth\/([^/]+)$/);
    if (netWorthMatch) {
      const netWorthId = decodeURIComponent(netWorthMatch[1]);
      const index = user.data.netWorth.findIndex((row) => row.id === netWorthId);
      if (index === -1) {
        json(res, 404, { error: "Net worth row not found." });
        return;
      }
      if (req.method === "PUT") {
        const body = await readBody(req);
        user.data.netWorth[index] = normalizeNetWorth(body, user.data.netWorth[index]);
        touchUser(user);
        await saveDb(db);
        json(res, 200, { data: enrichData(user.data) });
        return;
      }
      if (req.method === "DELETE") {
        user.data.netWorth.splice(index, 1);
        touchUser(user);
        await saveDb(db);
        json(res, 200, { data: enrichData(user.data) });
        return;
      }
    }

    if (req.method === "GET" && pathname === "/api/export/transactions.csv") {
      const rows = enrichData(user.data).transactions;
      const header = ["Date", "Type", "Amount", "Category", "Account", "Description / Reason", "Month", "Week", "Running Balance", "Notes"];
      const csv = [
        header.join(","),
        ...rows.map((row) =>
          [
            row.date,
            row.type,
            row.amount,
            row.category,
            row.account,
            row.description,
            row.month,
            row.week,
            row.runningBalance,
            row.notes
          ]
            .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
            .join(",")
        )
      ].join("\n");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="cura-transactions.csv"'
      });
      res.end(csv);
      return;
    }

    if (req.method === "GET" && pathname === "/api/export/backup.json") {
      const exportPayload = {
        app: "Cura Accounts Manager",
        exportedAt: nowIso(),
        user: publicUser(user),
        data: enrichData(user.data)
      };
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="cura-accounts-backup.json"'
      });
      res.end(JSON.stringify(exportPayload, null, 2));
      return;
    }

    if (req.method === "GET" && pathname === "/api/export/report.pdf") {
      const pdf = buildReportPdf(user);
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="cura-finance-report.pdf"',
        "Content-Length": pdf.length
      });
      res.end(pdf);
      return;
    }

    json(res, 404, { error: "Route not found." });
  } catch (error) {
    json(res, 400, { error: error.message || "Something went wrong." });
  }
}

function safeStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const target = decoded === "/" ? "/index.html" : decoded;
  const resolved = path.resolve(PUBLIC_DIR, `.${target}`);
  if (!resolved.startsWith(PUBLIC_DIR)) return null;
  return resolved;
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

async function serveStatic(req, res, pathname) {
  const filePath = safeStaticPath(pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(await fs.readFile(filePath));
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

async function main() {
  const db = await loadDb();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, db, url.pathname);
      return;
    }
    await serveStatic(req, res, url.pathname);
  });

  server.listen(PORT, () => {
    console.log(`Cura Accounts Manager running at http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
