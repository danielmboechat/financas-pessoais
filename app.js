const CATEGORIES = ["Alimentação", "Saúde", "Lazer", "Compras", "Assinaturas", "Educação", "Viagens", "Outros"];
const INCOME_CATEGORIES = ["salário", "outros recebimentos"];
const DB_NAME = "financeiro_pessoal_v1", DB_VERSION = 1;
let db, currentDate = new Date(), cashflowChart, categoryChart;

const $ = id => document.getElementById(id);
const money = v => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
const dateBR = s => new Date(s + "T12:00:00").toLocaleDateString("pt-BR");
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthName = d => d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, x => x.toUpperCase());

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("transactions")) {
        const s = d.createObjectStore("transactions", { keyPath: "id", autoIncrement: true });
        s.createIndex("date", "date");
      }
      if (!d.objectStoreNames.contains("cards")) {
        d.createObjectStore("cards", { keyPath: "id", autoIncrement: true });
      }
    };
    r.onsuccess = e => { db = e.target.result; resolve(db); };
    r.onerror = () => reject(r.error);
  });
}

const store = (name, mode = "readonly") => db.transaction(name, mode).objectStore(name);
const getAll = name => new Promise((res, rej) => { const r = store(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const add = (name, obj) => new Promise((res, rej) => { const r = store(name, "readwrite").add(obj); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const remove = (name, id) => new Promise((res, rej) => { const r = store(name, "readwrite").delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });

function setupNav() {
  document.querySelectorAll(".nav").forEach(b => b.onclick = () => showView(b.dataset.view));
  document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => showView(b.dataset.go));
  document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => b.closest("dialog").close());
}

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active-view"));
  $(id).classList.add("active-view");
  document.querySelectorAll(".nav").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  $("pageTitle").textContent = { dashboard: "Dashboard", lancamentos: "Lançamentos", cartoes: "Cartões", backup: "Backup" }[id];
  if (id === "dashboard") renderDashboard();
  if (id === "lancamentos") renderTransactions();
  if (id === "cartoes") renderCards();
}

function setupForms() {
  $("newExpense").onclick = () => openTransaction("expense");
  $("newIncome").onclick = () => openTransaction("income");
  if ($("newCard")) $("newCard").onclick = () => $("cardDialog").showModal();

  $("transactionForm").onsubmit = async e => {
    e.preventDefault();
    const type = $("transactionType").value;
    const pmElem = $("tPaymentMethod");
    const paymentMethod = (type === "expense" && pmElem) ? pmElem.value : "account";

    await add("transactions", {
      type: type,
      date: $("tDate").value,
      category: $("tCategory").value,
      paymentMethod: paymentMethod,
      description: $("tDescription").value.trim(),
      amount: Number($("tAmount").value)
    });

    $("transactionDialog").close();
    e.target.reset();
    await refresh();
  };

  $("cardForm").onsubmit = async e => {
    e.preventDefault();
    await add("cards", {
      name: $("cName").value.trim(),
      limit: Number($("cLimit").value),
      closing: Number($("cClosing").value),
      due: Number($("cDue").value)
    });
    $("cardDialog").close();
    e.target.reset();
    await renderCards();
  };

  if ($("typeFilter")) $("typeFilter").onchange = renderTransactions;
  if ($("exportBackup")) $("exportBackup").onclick = exportBackup;
  if ($("importBackup")) $("importBackup").onchange = importBackup;
  $("prevMonth").onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); refresh(); };
  $("nextMonth").onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); refresh(); };
}

function openTransaction(type) {
  $("transactionTitle").textContent = type === "expense" ? "Nova despesa" : "Nova receita";
  $("transactionType").value = type;
  $("tDate").value = new Date().toISOString().slice(0, 10);
  $("tCategory").innerHTML = (type === "expense" ? CATEGORIES : INCOME_CATEGORIES)
    .map(x => `<option value="${x}">${x}</option>`).join("");
  
  const pmElem = $("tPaymentMethod");
  if (pmElem) {
    const pmLabel = pmElem.closest("label");
    if (pmLabel) {
      if (type === "expense") {
        pmLabel.style.display = "block";
        pmElem.value = "account";
      } else {
        pmLabel.style.display = "none";
      }
    }
  }

  $("transactionDialog").showModal();
}

async function refresh() {
  $("currentMonth").textContent = monthName(currentDate);
  await renderDashboard();
  await renderTransactions();
  await renderCards();
}

async function renderDashboard() {
  const all = await getAll("transactions");
  const key = monthKey(currentDate);
  const tx = all.filter(x => x.date.startsWith(key));

  const income = tx.filter(x => x.type === "income").reduce((a, x) => a + x.amount, 0);
  const accountExpense = tx.filter(x => x.type === "expense" && x.paymentMethod !== "credit").reduce((a, x) => a + x.amount, 0);
  const creditExpense = tx.filter(x => x.type === "expense" && x.paymentMethod === "credit").reduce((a, x) => a + x.amount, 0);

  const allUpToMonth = all.filter(x => x.date.slice(0, 7) <= key);
  const totalIncomeUpToMonth = allUpToMonth.filter(x => x.type === "income").reduce((a, x) => a + x.amount, 0);
  const totalAccountExpenseUpToMonth = allUpToMonth.filter(x => x.type === "expense" && x.paymentMethod !== "credit").reduce((a, x) => a + x.amount, 0);
  const accumulatedBalance = totalIncomeUpToMonth - totalAccountExpenseUpToMonth;

  $("mReceitas").textContent = money(income);
  $("mDespesas").textContent = money(accountExpense);
  $("mSaldo").textContent = money(accumulatedBalance);
  if ($("mCartao")) $("mCartao").textContent = money(creditExpense);

  const byCat = {};
  tx.filter(x => x.type === "expense").forEach(x => {
    byCat[x.category] = (byCat[x.category] || 0) + x.amount;
  });

  if (cashflowChart) { cashflowChart.destroy(); cashflowChart = null; }
  if (categoryChart) { categoryChart.destroy(); categoryChart = null; }

  const ctxCashflow = $("cashflowChart");
  if (ctxCashflow) {
    cashflowChart = new Chart(ctxCashflow, {
      type: "bar",
      data: {
        labels: ["Receitas (Mês)", "Saídas Conta", "Cartão a Vencer"],
        datasets: [{
          data: [income, accountExpense, creditExpense],
          backgroundColor: ["#10b981", "#ef4444", "#f59e0b"]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  const ctxCategory = $("categoryChart");
  if (ctxCategory) {
    const catLabels = Object.keys(byCat).length ? Object.keys(byCat) : ["Sem despesas"];
    const catData = Object.values(byCat).length ? Object.values(byCat) : [1];

    categoryChart = new Chart(ctxCategory, {
      type: "doughnut",
      data: {
        labels: catLabels,
        datasets: [{
          data: catData
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } }
      }
    });
  }

  const recent = [...tx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  $("recentList").innerHTML = recent.length ? recent.map(x => `
    <div class="list-row">
      <span class="muted">${dateBR(x.date)}</span>
      <span>${x.description || x.category} ${x.paymentMethod === 'credit' ? '<small class="tag">Cartão</small>' : ''}</span>
      <strong class="${x.type}">${x.type === "income" ? "+" : "−"} ${money(x.amount)}</strong>
    </div>`).join("") : `<div class="muted">Nenhum lançamento neste mês.</div>`;
}

async function renderTransactions() {
  const all = await getAll("transactions"), key = monthKey(currentDate), filter = $("typeFilter").value;
  let tx = all.filter(x => x.date.startsWith(key) && (filter === "all" || x.type === filter)).sort((a, b) => b.date.localeCompare(a.date));
  
  $("transactionsTable").innerHTML = tx.length ? tx.map(x => `
    <tr>
      <td>${dateBR(x.date)}</td>
      <td><span class="tag">${x.type === "income" ? "Receita" : "Despesa"}</span></td>
      <td>${x.category}</td>
      <td>${x.description || "—"} ${x.paymentMethod === "credit" ? '<span class="tag" style="background:#e2e8f0;color:#0f172a;">Cartão</span>' : ''}</td>
      <td class="${x.type}">${x.type === "income" ? "+" : "−"} ${money(x.amount)}</td>
      <td><button class="delete" data-delete="${x.id}">Excluir</button></td>
    </tr>`).join("") : `<tr><td colspan="6" class="muted">Nenhum lançamento.</td></tr>`;

  document.querySelectorAll("[data-delete]").forEach(b => b.onclick = async () => {
    if (confirm("Excluir este lançamento?")) {
      await remove("transactions", Number(b.dataset.delete));
      await refresh();
    }
  });
}

async function renderCards() {
  const cards = await getAll("cards");
  const allTx = await getAll("transactions");
  const key = monthKey(currentDate);

  const creditTx = allTx.filter(x => x.date.startsWith(key) && x.type === "expense" && x.paymentMethod === "credit");
  const totalCreditMonth = creditTx.reduce((a, x) => a + x.amount, 0);

  $("cardsList").innerHTML = cards.length ? cards.map(c => `
    <div class="credit-card">
      <h3>${c.name}</h3>
      <p><span>Limite Total</span><strong>${money(c.limit)}</strong></p>
      <p><span>Fechamento</span><strong>dia ${c.closing}</strong></p>
      <p><span>Vencimento</span><strong>dia ${c.due}</strong></p>
      <p><span>Compras (Mês)</span><strong>${money(totalCreditMonth)}</strong></p>
      <p><span>Limite Disponível</span><strong>${money(c.limit - totalCreditMonth)}</strong></p>
      <button class="delete" style="margin-top:10px;" data-card-delete="${c.id}">Excluir cartão</button>
    </div>`).join("") : `<div class="muted">Nenhum cartão cadastrado.</div>`;

  document.querySelectorAll("[data-card-delete]").forEach(b => b.onclick = async () => {
    if (confirm("Excluir este cartão?")) {
      await remove("cards", Number(b.dataset.cardDelete));
      await renderCards();
    }
  });
}

async function exportBackup() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    transactions: await getAll("transactions"),
    cards: await getAll("cards")
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `financeiro-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importBackup(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !Array.isArray(d.transactions)) {
        throw new Error("Formato de arquivo JSON inválido.");
      }
      const transactions = d.transactions;
      const cards = Array.isArray(d.cards) ? d.cards : [];

      const t = db.transaction(["transactions", "cards"], "readwrite");
      const txStore = t.objectStore("transactions");
      const cardStore = t.objectStore("cards");

      txStore.clear();
      cardStore.clear();

      transactions.forEach(x => {
        const item = { ...x };
        delete item.id;
        txStore.add(item);
      });

      cards.forEach(x => {
        const item = { ...x };
        delete item.id;
        cardStore.add(item);
      });

      t.oncomplete = async () => {
        alert("Backup restaurado com sucesso!");
        await refresh();
      };

      t.onerror = err => {
        console.error(err);
        alert("Erro ao salvar no banco de dados.");
      };
    } catch (err) {
      console.error(err);
      alert("Arquivo de backup inválido: " + (err.message || err));
    }
  };
  r.readAsText(file);
  e.target.value = "";
}

(async () => {
  setupNav();
  setupForms();
  await openDB();
  await refresh();
})();
