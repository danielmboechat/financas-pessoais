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
  document.querySelectorAll(".nav").forEach(b => {
    b.onclick = () => showView(b.dataset.view);
  });
  document.querySelectorAll("[data-go]").forEach(b => {
    b.onclick = () => showView(b.dataset.go);
  });
  document.querySelectorAll("[data-close]").forEach(b => {
    b.onclick = () => {
      const dialog = b.closest("dialog");
      if (dialog) dialog.close();
    };
  });
}

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active-view"));
  const targetView = $(id);
  if (targetView) targetView.classList.add("active-view");
  document.querySelectorAll(".nav").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  const pageTitle = $("pageTitle");
  if (pageTitle) {
    pageTitle.textContent = { dashboard: "Dashboard", lancamentos: "Lançamentos", cartoes: "Cartões", backup: "Backup" }[id] || "Dashboard";
  }
  if (id === "dashboard") renderDashboard();
  if (id === "lancamentos") renderTransactions();
  if (id === "cartoes") renderCards();
}

window.openTransaction = function(type) {
  const title = $("transactionTitle");
  if (title) title.textContent = type === "expense" ? "Nova despesa" : "Nova receita";
  
  const typeInput = $("transactionType");
  if (typeInput) typeInput.value = type;
  
  const dateInput = $("tDate");
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
  
  const catInput = $("tCategory");
  if (catInput) {
    catInput.innerHTML = (type === "expense" ? CATEGORIES : INCOME_CATEGORIES)
      .map(x => `<option value="${x}">${x}</option>`).join("");
  }
  
  const pmElem = $("tPaymentMethod");
  const pmGroup = $("paymentMethodGroup") || (pmElem ? pmElem.closest("label") : null);
  const instElem = $("tInstallments");
  const instGroup = $("installmentsGroup") || (instElem ? instElem.closest("label") : null);

  if (type === "expense") {
    if (pmGroup) pmGroup.style.display = "block";
    if (pmElem) pmElem.value = "account";
    if (instGroup) instGroup.style.display = "none";
    if (instElem) instElem.value = "1";
  } else {
    if (pmGroup) pmGroup.style.display = "none";
    if (instGroup) instGroup.style.display = "none";
  }

  const dialog = $("transactionDialog");
  if (dialog && typeof dialog.showModal === "function") {
    dialog.showModal();
  }
};

function setupForms() {
  const btnExpense = $("newExpense");
  if (btnExpense) btnExpense.onclick = () => window.openTransaction("expense");
  
  const btnIncome = $("newIncome");
  if (btnIncome) btnIncome.onclick = () => window.openTransaction("income");
  
  const btnCard = $("newCard");
  if (btnCard) {
    btnCard.onclick = () => {
      const cardDialog = $("cardDialog");
      if (cardDialog && typeof cardDialog.showModal === "function") cardDialog.showModal();
    };
  }

  const pmElem = $("tPaymentMethod");
  if (pmElem) {
    pmElem.onchange = () => {
      const instElem = $("tInstallments");
      const instGroup = $("installmentsGroup") || (instElem ? instElem.closest("label") : null);
      if (instGroup) {
        instGroup.style.display = pmElem.value === "credit" ? "block" : "none";
      }
    };
  }

  // Global click listener fallback in case IDs differ or dynamic elements exist
  document.addEventListener("click", e => {
    const btn = e.target.closest("#newExpense, #newIncome, [data-open-expense], [data-open-income]");
    if (btn) {
      if (btn.id === "newExpense" || btn.hasAttribute("data-open-expense")) window.openTransaction("expense");
      if (btn.id === "newIncome" || btn.hasAttribute("data-open-income")) window.openTransaction("income");
    }
  });

  const txForm = $("transactionForm");
  if (txForm) {
    txForm.onsubmit = async e => {
      e.preventDefault();
      const type = $("transactionType") ? $("transactionType").value : "expense";
      const pmElem = $("tPaymentMethod");
      const paymentMethod = (type === "expense" && pmElem) ? pmElem.value : "account";
      const instElem = $("tInstallments");
      const installments = (type === "expense" && paymentMethod === "credit" && instElem) ? (parseInt(instElem.value) || 1) : 1;
      
      const rawDate = $("tDate").value;
      const category = $("tCategory").value;
      const description = $("tDescription").value.trim();
      const totalAmount = Number($("tAmount").value);

      const cards = await getAll("cards");
      const primaryCard = cards.length ? cards[0] : null;
      const closingDay = primaryCard ? Number(primaryCard.closing) : 31;

      if (type === "expense" && paymentMethod === "credit" && installments > 1) {
        const installmentAmount = Number((totalAmount / installments).toFixed(2));
        let baseDate = new Date(rawDate + "T12:00:00");
        
        if (baseDate.getDate() > closingDay) {
          baseDate.setMonth(baseDate.getMonth() + 1);
        }

        for (let i = 0; i < installments; i++) {
          let instDate = new Date(baseDate);
          instDate.setMonth(baseDate.getMonth() + i);
          const formattedDate = instDate.toISOString().slice(0, 10);
          
          await add("transactions", {
            type: "expense",
            date: formattedDate,
            category: category,
            paymentMethod: "credit",
            description: `${description || category} (${i + 1}/${installments})`,
            amount: installmentAmount
          });
        }
      } else {
        let finalDate = rawDate;
        if (type === "expense" && paymentMethod === "credit" && closingDay) {
          let checkDate = new Date(rawDate + "T12:00:00");
          if (checkDate.getDate() > closingDay) {
            checkDate.setMonth(checkDate.getMonth() + 1);
            finalDate = checkDate.toISOString().slice(0, 10);
          }
        }

        await add("transactions", {
          type: type,
          date: finalDate,
          category: category,
          paymentMethod: paymentMethod,
          description: description,
          amount: totalAmount
        });
      }

      const dialog = $("transactionDialog");
      if (dialog) dialog.close();
      e.target.reset();
      await refresh();
    };
  }

  const cardForm = $("cardForm");
  if (cardForm) {
    cardForm.onsubmit = async e => {
      e.preventDefault();
      await add("cards", {
        name: $("cName").value.trim(),
        limit: Number($("cLimit").value),
        closing: Number($("cClosing").value),
        due: Number($("cDue").value)
      });
      const dialog = $("cardDialog");
      if (dialog) dialog.close();
      e.target.reset();
      await renderCards();
    };
  }

  if ($("typeFilter")) $("typeFilter").onchange = renderTransactions;
  if ($("exportBackup")) $("exportBackup").onclick = exportBackup;
  if ($("importBackup")) $("importBackup").onchange = importBackup;
  if ($("prevMonth")) $("prevMonth").onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); refresh(); };
  if ($("nextMonth")) $("nextMonth").onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); refresh(); };
}

async function refresh() {
  if ($("currentMonth")) $("currentMonth").textContent = monthName(currentDate);
  await renderDashboard();
  await renderTransactions();
  await renderCards();
}

async function renderDashboard() {
  const all = await getAll("transactions"), key = monthKey(currentDate), tx = all.filter(x => x.date && x.date.startsWith(key));
  const income = tx.filter(x => x.type === "income").reduce((a, x) => a + x.amount, 0);
  const expense = tx.filter(x => x.type === "expense").reduce((a, x) => a + x.amount, 0);
  
  const accountExpense = tx.filter(x => x.type === "expense" && x.paymentMethod !== "credit").reduce((a, x) => a + x.amount, 0);
  const balance = income - accountExpense;

  if ($("mReceitas")) $("mReceitas").textContent = money(income);
  if ($("mDespesas")) $("mDespesas").textContent = money(expense);
  if ($("mSaldo")) $("mSaldo").textContent = money(balance);
  if ($("mLancamentos")) $("mLancamentos").textContent = tx.length;

  const byCat = {};
  tx.filter(x => x.type === "expense").forEach(x => byCat[x.category] = (byCat[x.category] || 0) + x.amount);

  if (typeof Chart !== "undefined") {
    cashflowChart?.destroy();
    categoryChart?.destroy();

    const cashElem = $("cashflowChart");
    if (cashElem) {
      cashflowChart = new Chart(cashElem, {
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

  const recent = [...tx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  if ($("recentList")) {
    $("recentList").innerHTML = recent.length ? recent.map(x => `
      <div class="list-row">
        <span class="muted">${dateBR(x.date)}</span>
        <span>${x.description || x.category} ${x.paymentMethod === 'credit' ? '<small class="tag">Cartão</small>' : ''}</span>
        <strong class="${x.type}">${x.type === "income" ? "+" : "−"} ${money(x.amount)}</strong>
      </div>`).join("") : `<div class="muted">Nenhum lançamento neste mês.</div>`;
  }
}

async function renderTransactions() {
  const all = await getAll("transactions"), key = monthKey(currentDate);
  const filterElem = $("typeFilter");
  const filter = filterElem ? filterElem.value : "all";
  let tx = all.filter(x => x.date && x.date.startsWith(key) && (filter === "all" || x.type === filter)).sort((a, b) => b.date.localeCompare(a.date));
  
  if ($("transactionsTable")) {
    $("transactionsTable").innerHTML = tx.length ? tx.map(x => `
      <tr>
        <td>${dateBR(x.date)}</td>
        <td><span class="tag">${x.type === "income" ? "Receita" : "Despesa"}</span></td>
        <td>${x.category}</td>
        <td>${x.description || "—"} ${x.paymentMethod === "credit" ? '<span class="tag" style="background:#e2e8f0;">Cartão</span>' : ''}</td>
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
}

async function renderCards() {
  const cards = await getAll("cards");
  const allTx = await getAll("transactions");
  const key = monthKey(currentDate);

  const creditTx = allTx.filter(x => x.date && x.date.startsWith(key) && x.type === "expense" && x.paymentMethod === "credit");
  const totalCreditMonth = creditTx.reduce((a, x) => a + x.amount, 0);

  const todayKey = monthKey(new Date());
  const futureCreditTx = allTx.filter(x => x.date && x.date >= todayKey && x.type === "expense" && x.paymentMethod === "credit");
  const totalCommitted = futureCreditTx.reduce((a, x) => a + x.amount, 0);

  if ($("cardsList")) {
    $("cardsList").innerHTML = cards.length ? cards.map(c => `
      <div class="credit-card">
        <h3>${c.name}</h3>
        <p><span>Limite Total</span><strong>${money(c.limit)}</strong></p>
        <p><span>Fechamento</span><strong>dia ${c.closing}</strong></p>
        <p><span>Vencimento</span><strong>dia ${c.due}</strong></p>
        <p><span>Fatura do Mês</span><strong>${money(totalCreditMonth)}</strong></p>
        <p><span>Limite Comprometido (Futuro)</span><strong>${money(totalCommitted)}</strong></p>
        <p><span>Limite Disponível</span><strong>${money(c.limit - totalCommitted)}</strong></p>
        <button class="delete" style="margin-top:10px;" data-card-delete="${c.id}">Excluir cartão</button>
      </div>`).join("") : `<div class="muted">Nenhum cartão cadastrado.</div>`;

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
  const file = e.target.files;
  if (!file || !file[0]) return;
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
  r.readAsText(file[0]);
  e.target.value = "";
}

function initApp() {
  setupNav();
  setupForms();
  openDB().then(() => refresh()).catch(err => console.error("DB Error:", err));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
