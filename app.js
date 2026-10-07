const CATEGORIES = ["Alimentação", "Saúde", "Lazer", "Compras", "Assinaturas", "Educação", "Viagens", "Outros"];
const INCOME_CATEGORIES = ["salário", "outros recebimentos"];
const DB_NAME = "financeiro_pessoal_v1", DB_VERSION = 1;
let db, currentDate = new Date(), cashflowChart, categoryChart;

const $ = id => document.getElementById(id);
const money = v => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
const dateBR = s => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};
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
const getAll = name => new Promise((res, rej) => { const r = store(name).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
const add = (name, obj) => new Promise((res, rej) => { const r = store(name, "readwrite").add(obj); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const remove = (name, id) => new Promise((res, rej) => { const r = store(name, "readwrite").delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });

function setupNav() {
  document.querySelectorAll(".nav").forEach(b => {
    b.onclick = () => showView(b.dataset.view);
  });
  document.querySelectorAll("[data-go]").forEach(b => {
    b.onclick = () => showView(b.dataset.go);
  });
  document.querySelectorAll("[data-close]").forEach(b => {
    b.onclick = () => {
      const dlg = b.closest("dialog");
      if (dlg) dlg.close();
    };
  });
}

function showView(id) {
  const target = $(id);
  if (!target) return;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active-view"));
  target.classList.add("active-view");
  document.querySelectorAll(".nav").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  
  const titleElem = $("pageTitle");
  if (titleElem) {
    titleElem.textContent = { dashboard: "Dashboard", lancamentos: "Lançamentos", cartoes: "Cartões", backup: "Backup" }[id] || "Financeiro";
  }
  
  if (id === "dashboard") renderDashboard();
  if (id === "lancamentos") renderTransactions();
  if (id === "cartoes") renderCards();
}

function toggleInstallmentsVisibility() {
  const type = $("transactionType")?.value;
  const pmElem = $("tPaymentMethod");
  const instGroup = $("installmentsGroup") || $("tInstallments")?.closest("label");
  const pmGroup = $("paymentMethodGroup") || pmElem?.closest("label");

  if (pmGroup) {
    pmGroup.style.display = (type === "expense") ? "block" : "none";
  }
  if (instGroup) {
    instGroup.style.display = (type === "expense" && pmElem && pmElem.value === "credit") ? "block" : "none";
  }
}

function setupForms() {
  const btnExpense = $("newExpense");
  if (btnExpense) btnExpense.onclick = () => openTransaction("expense");

  const btnIncome = $("newIncome");
  if (btnIncome) btnIncome.onclick = () => openTransaction("income");

  const btnCard = $("newCard");
  if (btnCard) btnCard.onclick = () => $("cardDialog")?.showModal();

  const pmElem = $("tPaymentMethod");
  if (pmElem) {
    pmElem.onchange = toggleInstallmentsVisibility;
  }

  const txForm = $("transactionForm");
  if (txForm) {
    txForm.onsubmit = async e => {
      e.preventDefault();
      const type = $("transactionType")?.value || "expense";
      const paymentMethod = (type === "expense" && pmElem) ? pmElem.value : "account";
      const totalAmount = Number($("tAmount")?.value || 0);
      const baseDateStr = $("tDate")?.value || new Date().toISOString().slice(0, 10);
      const category = $("tCategory")?.value || "Outros";
      const description = ($("tDescription")?.value || "").trim();
      const installmentsCount = (type === "expense" && paymentMethod === "credit" && $("tInstallments")) 
        ? Math.max(1, parseInt($("tInstallments").value) || 1) 
        : 1;

      const cards = await getAll("cards");
      const card = cards[0]; // único cartão
      const closingDay = card ? Number(card.closing) : null;

      const [y, m, d] = baseDateStr.split("-").map(Number);
      let startYear = y;
      let startMonth = m - 1; // 0-indexed month

      if (paymentMethod === "credit" && closingDay && d >= closingDay) {
        startMonth += 1;
        if (startMonth > 11) {
          startMonth = 0;
          startYear += 1;
        }
      }

      const installmentAmount = Math.round((totalAmount / installmentsCount) * 100) / 100;
      let remainder = Math.round((totalAmount - installmentAmount * installmentsCount) * 100) / 100;

      for (let i = 1; i <= installmentsCount; i++) {
        let curM = startMonth + (i - 1);
        let curY = startYear + Math.floor(curM / 12);
        curM = ((curM % 12) + 12) % 12;

        const targetDay = Math.min(d, new Date(curY, curM + 1, 0).getDate());
        const instDateStr = `${curY}-${String(curM + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;

        const itemAmount = (i === 1) ? Math.round((installmentAmount + remainder) * 100) / 100 : installmentAmount;
        const itemDesc = installmentsCount > 1 
          ? `${description || category} (${i}/${installmentsCount})` 
          : (description || category);

        await add("transactions", {
          type,
          date: instDateStr,
          category,
          paymentMethod,
          description: itemDesc,
          amount: itemAmount
        });
      }

      $("transactionDialog")?.close();
      txForm.reset();
      await refresh();
    };
  }

  const cardForm = $("cardForm");
  if (cardForm) {
    cardForm.onsubmit = async e => {
      e.preventDefault();
      await add("cards", {
        name: ($("cName")?.value || "Cartão").trim(),
        limit: Number($("cLimit")?.value || 0),
        closing: Number($("cClosing")?.value || 1),
        due: Number($("cDue")?.value || 10)
      });
      $("cardDialog")?.close();
      cardForm.reset();
      await renderCards();
    };
  }

  const filterElem = $("typeFilter");
  if (filterElem) filterElem.onchange = renderTransactions;

  const btnExport = $("exportBackup");
  if (btnExport) btnExport.onclick = exportBackup;

  const btnImport = $("importBackup");
  if (btnImport) btnImport.onchange = importBackup;

  const btnPrev = $("prevMonth");
  if (btnPrev) btnPrev.onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); refresh(); };

  const btnNext = $("nextMonth");
  if (btnNext) btnNext.onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); refresh(); };
}

function openTransaction(type) {
  const title = $("transactionTitle");
  if (title) title.textContent = type === "expense" ? "Nova despesa" : "Nova receita";

  const typeInput = $("transactionType");
  if (typeInput) typeInput.value = type;

  const dateInput = $("tDate");
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

  const catSelect = $("tCategory");
  if (catSelect) {
    catSelect.innerHTML = (type === "expense" ? CATEGORIES : INCOME_CATEGORIES)
      .map(x => `<option value="${x}">${x}</option>`).join("");
  }

  const pmElem = $("tPaymentMethod");
  if (pmElem) pmElem.value = "account";

  const instElem = $("tInstallments");
  if (instElem) instElem.value = "1";

  toggleInstallmentsVisibility();

  const dlg = $("transactionDialog");
  if (dlg) {
    if (typeof dlg.showModal === "function") {
      dlg.showModal();
    } else {
      dlg.setAttribute("open", "true");
    }
  }
}

async function refresh() {
  const monthElem = $("currentMonth");
  if (monthElem) monthElem.textContent = monthName(currentDate);

  await renderDashboard();
  await renderTransactions();
  await renderCards();
}

async function renderDashboard() {
  const all = await getAll("transactions");
  const key = monthKey(currentDate);
  const tx = all.filter(x => x.date && x.date.startsWith(key));

  const income = tx.filter(x => x.type === "income").reduce((a, x) => a + x.amount, 0);
  const expense = tx.filter(x => x.type === "expense").reduce((a, x) => a + x.amount, 0);
  const accountExpense = tx.filter(x => x.type === "expense" && x.paymentMethod !== "credit").reduce((a, x) => a + x.amount, 0);
  const balance = income - accountExpense;

  if ($("mReceitas")) $("mReceitas").textContent = money(income);
  if ($("mDespesas")) $("mDespesas").textContent = money(expense);
  if ($("mSaldo")) $("mSaldo").textContent = money(balance);
  if ($("mLancamentos")) $("mLancamentos").textContent = tx.length;

  const byCat = {};
  tx.filter(x => x.type === "expense").forEach(x => {
    byCat[x.category] = (byCat[x.category] || 0) + x.amount;
  });

  cashflowChart?.destroy();
  categoryChart?.destroy();

  const cashCtx = $("cashflowChart");
  if (cashCtx && typeof Chart !== "undefined") {
    cashflowChart = new Chart(cashCtx, {
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

  const catCtx = $("categoryChart");
  if (catCtx && typeof Chart !== "undefined") {
    categoryChart = new Chart(catCtx, {
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

  const recentList = $("recentList");
  if (recentList) {
    const recent = [...tx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    recentList.innerHTML = recent.length ? recent.map(x => `
      <div class="list-row">
        <span class="muted">${dateBR(x.date)}</span>
        <span>${x.description || x.category} ${x.paymentMethod === 'credit' ? '<small class="tag">Cartão</small>' : ''}</span>
        <strong class="${x.type}">${x.type === "income" ? "+" : "−"} ${money(x.amount)}</strong>
      </div>`).join("") : `<div class="muted">Nenhum lançamento neste mês.</div>`;
  }
}

async function renderTransactions() {
  const all = await getAll("transactions");
  const key = monthKey(currentDate);
  const filterElem = $("typeFilter");
  const filter = filterElem ? filterElem.value : "all";

  let tx = all.filter(x => x.date && x.date.startsWith(key) && (filter === "all" || x.type === filter))
             .sort((a, b) => b.date.localeCompare(a.date));

  const table = $("transactionsTable");
  if (table) {
    table.innerHTML = tx.length ? tx.map(x => `
      <tr>
        <td>${dateBR(x.date)}</td>
        <td><span class="tag">${x.type === "income" ? "Receita" : "Despesa"}</span></td>
        <td>${x.category}</td>
        <td>${x.description || "—"} ${x.paymentMethod === "credit" ? '<span class="tag" style="background:#e2e8f0;">Cartão</span>' : ''}</td>
        <td class="${x.type}">${x.type === "income" ? "+" : "−"} ${money(x.amount)}</td>
        <td><button class="delete" data-delete="${x.id}">Excluir</button></td>
      </tr>`).join("") : `<tr><td colspan="6" class="muted">Nenhum lançamento.</td></tr>`;

    table.querySelectorAll("[data-delete]").forEach(b => {
      b.onclick = async () => {
        if (confirm("Excluir este lançamento?")) {
          await remove("transactions", Number(b.dataset.delete));
          await refresh();
        }
      };
    });
  }
}

async function renderCards() {
  const cards = await getAll("cards");
  const allTx = await getAll("transactions");
  const key = monthKey(currentDate);

  const creditTx = allTx.filter(x => x.date && x.date.startsWith(key) && x.type === "expense" && x.paymentMethod === "credit");
  const totalCreditMonth = creditTx.reduce((a, x) => a + x.amount, 0);

  const cardsList = $("cardsList");
  if (cardsList) {
    cardsList.innerHTML = cards.length ? cards.map(c => `
      <div class="credit-card">
        <h3>${c.name}</h3>
        <p><span>Limite Total</span><strong>${money(c.limit)}</strong></p>
        <p><span>Fechamento</span><strong>dia ${c.closing}</strong></p>
        <p><span>Vencimento</span><strong>dia ${c.due}</strong></p>
        <p><span>Fatura do Mês</span><strong>${money(totalCreditMonth)}</strong></p>
        <p><span>Limite Disponível</span><strong>${money(c.limit - totalCreditMonth)}</strong></p>
        <button class="delete" style="margin-top:10px;" data-card-delete="${c.id}">Excluir cartão</button>
      </div>`).join("") : `<div class="muted">Nenhum cartão cadastrado.</div>`;

    cardsList.querySelectorAll("[data-card-delete]").forEach(b => {
      b.onclick = async () => {
        if (confirm("Excluir este cartão?")) {
          await remove("cards", Number(b.dataset.cardDelete));
          await renderCards();
        }
      };
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
  const file = e.target.files;
  if (!file || !file[0]) return;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.transactions) || !Array.isArray(d.cards)) throw Error();
      const txStore = store("transactions", "readwrite");
      const cardStore = store("cards", "readwrite");
      (await getAll("transactions")).forEach(x => txStore.delete(x.id));
      (await getAll("cards")).forEach(x => cardStore.delete(x.id));
      d.transactions.forEach(x => { delete x.id; txStore.add(x); });
      d.cards.forEach(x => { delete x.id; cardStore.add(x); });
      txStore.transaction.oncomplete = async () => {
        alert("Backup restaurado com sucesso.");
        await refresh();
      };
    } catch (err) {
      alert("Arquivo de backup inválido.");
    }
  };
  r.readAsText(file[0]);
  e.target.value = "";
}

document.addEventListener("DOMContentLoaded", async () => {
  setupNav();
  setupForms();
  try {
    await openDB();
    await refresh();
  } catch (err) {
    console.error("Erro ao inicializar o banco:", err);
  }
});
