const CATEGORIES = ["Alimentação", "Saúde", "Lazer", "Compras", "Assinaturas", "Educação", "Viagens", "Outros"];
const INCOME_CATEGORIES = ["salário", "outros recebimentos"];
const DB_NAME = "financeiro_pessoal_v1", DB_VERSION = 1;

let db, currentDate = new Date(), cashflowChart, categoryChart;

// Safe DOM helpers
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
  document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => {
    const dlg = b.closest("dialog");
    if (dlg) dlg.close();
  });
}

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active-view"));
  const viewElem = $(id);
  if (viewElem) viewElem.classList.add("active-view");

  document.querySelectorAll(".nav").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  
  const pageTitle = $("pageTitle");
  if (pageTitle) {
    pageTitle.textContent = { dashboard: "Dashboard", lancamentos: "Lançamentos", cartoes: "Cartões", backup: "Backup" }[id] || "Dashboard";
  }

  if (id === "dashboard") renderDashboard();
  if (id === "lancamentos") renderTransactions();
  if (id === "cartoes") renderCards();
}

function setupForms() {
  const newExpenseBtn = $("newExpense");
  if (newExpenseBtn) newExpenseBtn.onclick = () => openTransaction("expense");

  const newIncomeBtn = $("newIncome");
  if (newIncomeBtn) newIncomeBtn.onclick = () => openTransaction("income");

  const newCardBtn = $("newCard");
  if (newCardBtn) newCardBtn.onclick = () => {
    const dlg = $("cardDialog");
    if (dlg) dlg.showModal();
  };

  const pmElem = $("tPaymentMethod");
  if (pmElem) {
    pmElem.onchange = () => toggleInstallmentsVisibility();
  }

  const txForm = $("transactionForm");
  if (txForm) {
    txForm.onsubmit = async e => {
      e.preventDefault();
      const type = $("transactionType") ? $("transactionType").value : "expense";
      const pmField = $("tPaymentMethod");
      const paymentMethod = (type === "expense" && pmField) ? pmField.value : "account";
      const instField = $("tInstallments");
      const installments = (type === "expense" && paymentMethod === "credit" && instField) ? Math.max(1, parseInt(instField.value) || 1) : 1;

      await add("transactions", {
        type: type,
        date: $("tDate") ? $("tDate").value : new Date().toISOString().slice(0, 10),
        category: $("tCategory") ? $("tCategory").value : "Outros",
        paymentMethod: paymentMethod,
        installments: installments,
        description: $("tDescription") ? $("tDescription").value.trim() : "",
        amount: Number($("tAmount") ? $("tAmount").value : 0)
      });

      const dlg = $("transactionDialog");
      if (dlg) dlg.close();
      e.target.reset();
      await refresh();
    };
  }

  const cardForm = $("cardForm");
  if (cardForm) {
    cardForm.onsubmit = async e => {
      e.preventDefault();
      await add("cards", {
        name: $("cName") ? $("cName").value.trim() : "Cartão",
        limit: Number($("cLimit") ? $("cLimit").value : 0),
        closing: Number($("cClosing") ? $("cClosing").value : 30),
        due: Number($("cDue") ? $("cDue").value : 10)
      });

      const dlg = $("cardDialog");
      if (dlg) dlg.close();
      e.target.reset();
      await renderCards();
    };
  }

  const typeFilter = $("typeFilter");
  if (typeFilter) typeFilter.onchange = renderTransactions;

  const exportBtn = $("exportBackup");
  if (exportBtn) exportBtn.onclick = exportBackup;

  const importBtn = $("importBackup");
  if (importBtn) importBtn.onchange = importBackup;

  const prevBtn = $("prevMonth");
  if (prevBtn) prevBtn.onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); refresh(); };

  const nextBtn = $("nextMonth");
  if (nextBtn) nextBtn.onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); refresh(); };
}

function toggleInstallmentsVisibility() {
  const type = $("transactionType") ? $("transactionType").value : "expense";
  const pmElem = $("tPaymentMethod");
  const instGroup = $("installmentsGroup") || ($("tInstallments") ? $("tInstallments").closest("label") : null);

  if (instGroup) {
    if (type === "expense" && pmElem && pmElem.value === "credit") {
      instGroup.style.display = "block";
    } else {
      instGroup.style.display = "none";
    }
  }
}

function openTransaction(type) {
  const titleElem = $("transactionTitle");
  if (titleElem) titleElem.textContent = type === "expense" ? "Nova despesa" : "Nova receita";

  const typeElem = $("transactionType");
  if (typeElem) typeElem.value = type;

  const dateElem = $("tDate");
  if (dateElem) dateElem.value = new Date().toISOString().slice(0, 10);

  const catElem = $("tCategory");
  if (catElem) {
    catElem.innerHTML = (type === "expense" ? CATEGORIES : INCOME_CATEGORIES)
      .map(x => `<option value="${x}">${x}</option>`).join("");
  }

  const pmElem = $("tPaymentMethod");
  const pmGroup = $("paymentMethodGroup") || (pmElem ? pmElem.closest("label") : null);

  if (pmGroup) {
    if (type === "expense") {
      pmGroup.style.display = "block";
      if (pmElem) pmElem.value = "account";
    } else {
      pmGroup.style.display = "none";
    }
  }

  const instElem = $("tInstallments");
  if (instElem) instElem.value = "1";

  toggleInstallmentsVisibility();

  const dlg = $("transactionDialog");
  if (dlg) dlg.showModal();
}

function calculateInstallmentsForMonth(txList, targetYear, targetMonth, cardClosingDay = 30) {
  const result = [];

  txList.forEach(tx => {
    if (tx.type === "income") {
      const [y, m] = tx.date.split("-").map(Number);
      if (y === targetYear && m === targetMonth) {
        result.push({ ...tx, currentAmount: tx.amount, isInstallment: false });
      }
      return;
    }

    const pm = tx.paymentMethod || "account";
    const instCount = tx.installments || 1;

    if (pm !== "credit") {
      const [y, m] = tx.date.split("-").map(Number);
      if (y === targetYear && m === targetMonth) {
        result.push({ ...tx, currentAmount: tx.amount, isInstallment: false });
      }
      return;
    }

    // Credit card transaction
    const [y, m, d] = tx.date.split("-").map(Number);
    let startY = y;
    let startM = m; // 1-based

    if (d > cardClosingDay) {
      startM += 1;
      if (startM > 12) {
        startM = 1;
        startY += 1;
      }
    }

    const targetMonthsTotal = targetYear * 12 + (targetMonth - 1);
    const startMonthsTotal = startY * 12 + (startM - 1);
    const diff = targetMonthsTotal - startMonthsTotal;

    if (diff >= 0 && diff < instCount) {
      const instNum = diff + 1;
      const instAmount = tx.amount / instCount;
      result.push({
        ...tx,
        currentAmount: instAmount,
        installmentNum: instNum,
        totalInstallments: instCount,
        isInstallment: true
      });
    }
  });

  return result;
}

async function getCardClosingDay() {
  try {
    const cards = await getAll("cards");
    if (cards && cards.length > 0 && cards[0].closing) {
      return Number(cards[0].closing);
    }
  } catch (e) {}
  return 30;
}

async function refresh() {
  const currentMonthElem = $("currentMonth");
  if (currentMonthElem) currentMonthElem.textContent = monthName(currentDate);

  await renderDashboard();
  await renderTransactions();
  await renderCards();
}

async function renderDashboard() {
  const all = await getAll("transactions");
  const targetYear = currentDate.getFullYear();
  const targetMonth = currentDate.getMonth() + 1;
  const cardClosingDay = await getCardClosingDay();

  const monthItems = calculateInstallmentsForMonth(all, targetYear, targetMonth, cardClosingDay);

  const income = monthItems.filter(x => x.type === "income").reduce((a, x) => a + x.currentAmount, 0);
  const expense = monthItems.filter(x => x.type === "expense").reduce((a, x) => a + x.currentAmount, 0);
  
  const accountExpense = monthItems.filter(x => x.type === "expense" && x.paymentMethod !== "credit").reduce((a, x) => a + x.currentAmount, 0);
  const balance = income - accountExpense;

  if ($("mReceitas")) $("mReceitas").textContent = money(income);
  if ($("mDespesas")) $("mDespesas").textContent = money(expense);
  if ($("mSaldo")) $("mSaldo").textContent = money(balance);
  if ($("mLancamentos")) $("mLancamentos").textContent = monthItems.length;

  const byCat = {};
  monthItems.filter(x => x.type === "expense").forEach(x => {
    byCat[x.category] = (byCat[x.category] || 0) + x.currentAmount;
  });

  if (typeof Chart !== "undefined") {
    cashflowChart?.destroy();
    categoryChart?.destroy();

    const cfElem = $("cashflowChart");
    if (cfElem) {
      cashflowChart = new Chart(cfElem, {
        type: "bar",
        data: {
          labels: ["Receitas", "Despesas Totais", "Despesas Conta"],
          datasets: [{
            data: [income, expense, accountExpense],
            backgroundColor: ["#18794e", "#a33b3b", "#2b6cb0"]
          }]
        },
        options: {
          plugins: { legend: { display: false } },
          responsive: true,
          maintainAspectRatio: false
        }
      });
    }

    const catElem = $("categoryChart");
    if (catElem) {
      categoryChart = new Chart(catElem, {
        type: "doughnut",
        data: {
          labels: Object.keys(byCat).length ? Object.keys(byCat) : ["Sem despesas"],
          datasets: [{
            data: Object.values(byCat).length ? Object.values(byCat) : [1]
          }]
        },
        options: {
          plugins: { legend: { position: "bottom" } },
          responsive: true
        }
      });
    }
  }

  const recentListElem = $("recentList");
  if (recentListElem) {
    const recent = [...monthItems].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    recentListElem.innerHTML = recent.length ? recent.map(x => {
      let tagHtml = "";
      if (x.paymentMethod === "credit") {
        const instText = x.totalInstallments > 1 ? ` ${x.installmentNum}/${x.totalInstallments}` : "";
        tagHtml = `<small class="tag">Cartão${instText}</small>`;
      }
      return `
        <div class="list-row">
          <span class="muted">${dateBR(x.date)}</span>
          <span>${x.description || x.category} ${tagHtml}</span>
          <strong class="${x.type}">${x.type === "income" ? "+" : "−"} ${money(x.currentAmount)}</strong>
        </div>`;
    }).join("") : `<div class="muted">Nenhum lançamento neste mês.</div>`;
  }
}

async function renderTransactions() {
  const all = await getAll("transactions");
  const targetYear = currentDate.getFullYear();
  const targetMonth = currentDate.getMonth() + 1;
  const cardClosingDay = await getCardClosingDay();

  const filterElem = $("typeFilter");
  const filter = filterElem ? filterElem.value : "all";

  let tx = calculateInstallmentsForMonth(all, targetYear, targetMonth, cardClosingDay);
  if (filter !== "all") {
    tx = tx.filter(x => x.type === filter);
  }
  tx.sort((a, b) => b.date.localeCompare(a.date));

  const tableElem = $("transactionsTable");
  if (tableElem) {
    tableElem.innerHTML = tx.length ? tx.map(x => {
      let tagHtml = "";
      if (x.paymentMethod === "credit") {
        const instText = x.totalInstallments > 1 ? ` (${x.installmentNum}/${x.totalInstallments})` : "";
        tagHtml = `<span class="tag" style="background:#e2e8f0;">Cartão${instText}</span>`;
      }

      return `
        <tr>
          <td>${dateBR(x.date)}</td>
          <td><span class="tag">${x.type === "income" ? "Receita" : "Despesa"}</span></td>
          <td>${x.category}</td>
          <td>${x.description || "—"} ${tagHtml}</td>
          <td class="${x.type}">${x.type === "income" ? "+" : "−"} ${money(x.currentAmount)}</td>
          <td><button class="delete" data-delete="${x.id}">Excluir</button></td>
        </tr>`;
    }).join("") : `<tr><td colspan="6" class="muted">Nenhum lançamento.</td></tr>`;

    document.querySelectorAll("[data-delete]").forEach(b => b.onclick = async () => {
      if (confirm("Excluir este lançamento completo?")) {
        await remove("transactions", Number(b.dataset.delete));
        await refresh();
      }
    });
  }
}

async function renderCards() {
  const cards = await getAll("cards");
  const allTx = await getAll("transactions");
  const targetYear = currentDate.getFullYear();
  const targetMonth = currentDate.getMonth() + 1;
  const cardClosingDay = await getCardClosingDay();

  const monthItems = calculateInstallmentsForMonth(allTx, targetYear, targetMonth, cardClosingDay);
  const totalCreditMonth = monthItems
    .filter(x => x.type === "expense" && x.paymentMethod === "credit")
    .reduce((a, x) => a + x.currentAmount, 0);

  // Total credit commitment across all remaining future installments
  let totalCommitted = 0;
  const currentTargetTotal = targetYear * 12 + (targetMonth - 1);

  allTx.forEach(tx => {
    if (tx.type === "expense" && tx.paymentMethod === "credit") {
      const instCount = tx.installments || 1;
      const [y, m, d] = tx.date.split("-").map(Number);
      let startY = y;
      let startM = m;
      if (d > cardClosingDay) {
        startM += 1;
        if (startM > 12) { startM = 1; startY += 1; }
      }
      const startTotal = startY * 12 + (startM - 1);

      // Count remaining installments from current view month
      for (let k = 0; k < instCount; k++) {
        if (startTotal + k >= currentTargetTotal) {
          totalCommitted += (tx.amount / instCount);
        }
      }
    }
  });

  const cardsListElem = $("cardsList");
  if (cardsListElem) {
    cardsListElem.innerHTML = cards.length ? cards.map(c => {
      const limit = Number(c.limit) || 0;
      const available = limit - totalCommitted;

      return `
        <div class="credit-card">
          <h3>${c.name}</h3>
          <p><span>Limite Total</span><strong>${money(limit)}</strong></p>
          <p><span>Fechamento</span><strong>dia ${c.closing}</strong></p>
          <p><span>Vencimento</span><strong>dia ${c.due}</strong></p>
          <p><span>Fatura do Mês</span><strong>${money(totalCreditMonth)}</strong></p>
          <p><span>Comprometido Total</span><strong>${money(totalCommitted)}</strong></p>
          <p><span>Limite Disponível</span><strong style="color:${available < 0 ? '#a33b3b' : '#18794e'}">${money(available)}</strong></p>
          <button class="delete" style="margin-top:10px;" data-card-delete="${c.id}">Excluir cartão</button>
        </div>`;
    }).join("") : `<div class="muted">Nenhum cartão cadastrado.</div>`;

    document.querySelectorAll("[data-card-delete]").forEach(b => b.onclick = async () => {
      if (confirm("Excluir este cartão?")) {
        await remove("cards", Number(b.dataset.cardDelete));
        await renderCards();
      }
    });
  }
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
  const file = e.target.files ? e.target.files[0] : null;
  if (!file) return;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.transactions) || !Array.isArray(d.cards)) throw Error();
      const tx = store("transactions", "readwrite"), cards = store("cards", "readwrite");
      (await getAll("transactions")).forEach(x => tx.delete(x.id));
      (await getAll("cards")).forEach(x => cards.delete(x.id));
      d.transactions.forEach(x => { delete x.id; tx.add(x); });
      d.cards.forEach(x => { delete x.id; cards.add(x); });
      tx.transaction.oncomplete = async () => {
        alert("Backup restaurado com sucesso.");
        await refresh();
      };
    } catch (err) {
      alert("Arquivo de backup inválido.");
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
