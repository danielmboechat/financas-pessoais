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

// IndexedDB Storage
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
const getAll = name => new Promise((res, rej) => {
  if (!db) return res([]);
  const r = store(name).getAll();
  r.onsuccess = () => res(r.result || []);
  r.onerror = () => rej(r.error);
});
const add = (name, obj) => new Promise((res, rej) => {
  const r = store(name, "readwrite").add(obj);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const remove = (name, id) => new Promise((res, rej) => {
  const r = store(name, "readwrite").delete(id);
  r.onsuccess = () => res();
  r.onerror = () => rej(r.error);
});

// UI Navigation & Event Binding
function setupNav() {
  document.querySelectorAll(".nav").forEach(b => {
    b.onclick = () => showView(b.dataset.view);
  });
  document.querySelectorAll("[data-go]").forEach(b => {
    b.onclick = () => showView(b.dataset.go);
  });
  document.querySelectorAll("[data-close]").forEach(b => {
    b.onclick = () => closeDialog(b.closest("dialog"));
  });
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
    dialog.style.display = "none";
  }
}

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function") {
    try {
      dialog.showModal();
    } catch (err) {
      dialog.setAttribute("open", "");
      dialog.style.display = "block";
    }
  } else {
    dialog.setAttribute("open", "");
    dialog.style.display = "block";
  }
}

function showView(id) {
  if (!id) return;
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

function setupForms() {
  // Global click delegation for modal triggers
  document.addEventListener("click", e => {
    const btn = e.target.closest("button, .btn, [role='button']");
    if (!btn) return;

    const id = btn.id;
    const text = (btn.textContent || "").toLowerCase();

    if (id === "newExpense" || text.includes("nova despesa")) {
      e.preventDefault();
      openTransaction("expense");
    } else if (id === "newIncome" || text.includes("nova receita")) {
      e.preventDefault();
      openTransaction("income");
    } else if (id === "newCard" || text.includes("novo cartão") || text.includes("novo cartao")) {
      e.preventDefault();
      openDialog($("cardDialog"));
    } else if (btn.hasAttribute("data-close") || btn.classList.contains("close")) {
      e.preventDefault();
      closeDialog(btn.closest("dialog"));
    }
  });

  // Handle transaction form submit
  const txForm = $("transactionForm");
  if (txForm) {
    txForm.onsubmit = async e => {
      e.preventDefault();
      const type = $("transactionType") ? $("transactionType").value : "expense";
      const dateVal = $("tDate") ? $("tDate").value : new Date().toISOString().slice(0, 10);
      const catVal = $("tCategory") ? $("tCategory").value : "Outros";
      const descVal = $("tDescription") ? $("tDescription").value.trim() : "";
      const amountVal = $("tAmount") ? Number($("tAmount").value) : 0;

      const pmElem = $("tPaymentMethod");
      const paymentMethod = (type === "expense" && pmElem) ? pmElem.value : "account";

      const instElem = $("tInstallments");
      const numInstallments = (type === "expense" && paymentMethod === "credit" && instElem) ? parseInt(instElem.value, 10) || 1 : 1;

      if (type === "expense" && paymentMethod === "credit" && numInstallments > 1) {
        // Multi-installment credit purchase
        const cards = await getAll("cards");
        const cardClosingDay = cards.length > 0 && cards[0].closing ? Number(cards[0].closing) : 31;

        let [y, m, d] = dateVal.split("-").map(Number);
        
        // If purchase date day > closing day, first installment starts next month
        if (d > cardClosingDay) {
          m += 1;
          if (m > 12) { m = 1; y += 1; }
        }

        const installmentAmount = Math.round((amountVal / numInstallments) * 100) / 100;

        for (let i = 1; i <= numInstallments; i++) {
          const monthStr = String(m).padStart(2, "0");
          const dayStr = String(Math.min(d, 28)).padStart(2, "0");
          const instDate = `${y}-${monthStr}-${dayStr}`;

          const instDesc = descVal ? `${descVal} (${i}/${numInstallments})` : `${catVal} (${i}/${numInstallments})`;
          
          // Last installment adjusts rounding difference
          const currentAmount = (i === numInstallments) 
            ? Math.round((amountVal - installmentAmount * (numInstallments - 1)) * 100) / 100 
            : installmentAmount;

          await add("transactions", {
            type: "expense",
            date: instDate,
            category: catVal,
            paymentMethod: "credit",
            description: instDesc,
            amount: currentAmount,
            installmentInfo: { current: i, total: numInstallments, totalAmount: amountVal }
          });

          m += 1;
          if (m > 12) { m = 1; y += 1; }
        }
      } else {
        // Single transaction
        await add("transactions", {
          type: type,
          date: dateVal,
          category: catVal,
          paymentMethod: paymentMethod,
          description: descVal,
          amount: amountVal
        });
      }

      closeDialog($("transactionDialog"));
      txForm.reset();
      await refresh();
    };
  }

  // Handle card form submit
  const cardForm = $("cardForm");
  if (cardForm) {
    cardForm.onsubmit = async e => {
      e.preventDefault();
      await add("cards", {
        name: $("cName") ? $("cName").value.trim() : "Cartão",
        limit: $("cLimit") ? Number($("cLimit").value) : 0,
        closing: $("cClosing") ? Number($("cClosing").value) : 1,
        due: $("cDue") ? Number($("cDue").value) : 10
      });
      closeDialog($("cardDialog"));
      cardForm.reset();
      await renderCards();
    };
  }

  // Filters & Month controls
  if ($("typeFilter")) $("typeFilter").onchange = renderTransactions;
  if ($("exportBackup")) $("exportBackup").onclick = exportBackup;
  if ($("importBackup")) $("importBackup").onchange = importBackup;

  if ($("prevMonth")) $("prevMonth").onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); refresh(); };
  if ($("nextMonth")) $("nextMonth").onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); refresh(); };

  // Listen to payment method changes in form to toggle installments field
  const pmSelect = $("tPaymentMethod");
  if (pmSelect) {
    pmSelect.onchange = () => toggleInstallmentsVisibility();
  }
}

function toggleInstallmentsVisibility() {
  const pmSelect = $("tPaymentMethod");
  const instGroup = $("installmentsGroup") || ($("tInstallments") ? $("tInstallments").closest("label") : null);
  const typeVal = $("transactionType") ? $("transactionType").value : "expense";

  if (instGroup) {
    if (typeVal === "expense" && pmSelect && pmSelect.value === "credit") {
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

  toggleInstallmentsVisibility();

  openDialog($("transactionDialog"));
}

// Make openTransaction globally accessible
window.openTransaction = openTransaction;

async function refresh() {
  const monthElem = $("currentMonth");
  if (monthElem) monthElem.textContent = monthName(currentDate);

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

  const recentList = $("recentList");
  if (recentList) {
    const recent = [...tx].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6);
    recentList.innerHTML = recent.length ? recent.map(x => `
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

  let tx = all.filter(x => x.date && x.date.startsWith(key) && (filter === "all" || x.type === filter))
             .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const tableElem = $("transactionsTable");
  if (tableElem) {
    tableElem.innerHTML = tx.length ? tx.map(x => `
      <tr>
        <td>${dateBR(x.date)}</td>
        <td><span class="tag">${x.type === "income" ? "Receita" : "Despesa"}</span></td>
        <td>${x.category}</td>
        <td>${x.description || "—"} ${x.paymentMethod === "credit" ? '<span class="tag" style="background:#e2e8f0;">Cartão</span>' : ''}</td>
        <td class="${x.type}">${x.type === "income" ? "+" : "−"} ${money(x.amount)}</td>
        <td><button class="delete" data-delete="${x.id}">Excluir</button></td>
      </tr>`).join("") : `<tr><td colspan="6" class="muted">Nenhum lançamento.</td></tr>`;

    tableElem.querySelectorAll("[data-delete]").forEach(b => b.onclick = async () => {
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

  const cardsList = $("cardsList");
  if (cardsList) {
    cardsList.innerHTML = cards.length ? cards.map(c => `
      <div class="credit-card">
        <h3>${c.name}</h3>
        <p><span>Limite Total</span><strong>${money(c.limit)}</strong></p>
        <p><span>Fechamento</span><strong>dia ${c.closing}</strong></p>
        <p><span>Vencimento</span><strong>dia ${c.due}</strong></p>
        <p><span>Compras (Mês)</span><strong>${money(totalCreditMonth)}</strong></p>
        <p><span>Limite Disponível</span><strong>${money(c.limit - totalCreditMonth)}</strong></p>
        <button class="delete" style="margin-top:10px;" data-card-delete="${c.id}">Excluir cartão</button>
      </div>`).join("") : `<div class="muted">Nenhum cartão cadastrado.</div>`;

    cardsList.querySelectorAll("[data-card-delete]").forEach(b => b.onclick = async () => {
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

async function initApp() {
  setupNav();
  setupForms();
  try {
    await openDB();
    await refresh();
  } catch (e) {
    console.error("IndexedDB error:", e);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
