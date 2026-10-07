const CATEGORIES = ["Alimentação", "Saúde", "Lazer", "Compras", "Assinaturas", "Educação", "Viagens", "Outros"];
const INCOME_CATEGORIES = ["salário", "outros recebimentos"];
const DB_NAME = "financeiro_pessoal_v1", DB_VERSION = 1;

let db = null;
let currentDate = new Date();
let cashflowChart = null;
let categoryChart = null;

const $ = id => document.getElementById(id);
const money = v => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
const dateBR = s => {
  if (!s) return "";
  const parts = s.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : s;
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
      if (dialog && typeof dialog.close === "function") dialog.close();
    };
  });
}

function showView(id) {
  if (!$(id)) return;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active-view"));
  $(id).classList.add("active-view");
  document.querySelectorAll(".nav").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  
  const pageTitle = $("pageTitle");
  if (pageTitle) {
    const titles = { dashboard: "Dashboard", lancamentos: "Lançamentos", cartoes: "Cartões", backup: "Backup" };
    pageTitle.textContent = titles[id] || "Dashboard";
  }

  if (id === "dashboard") renderDashboard();
  if (id === "lancamentos") renderTransactions();
  if (id === "cartoes") renderCards();
}

function openTransaction(type) {
  const dialog = $("transactionDialog");
  if (!dialog) return;

  const titleElem = $("transactionTitle");
  if (titleElem) titleElem.textContent = type === "expense" ? "Nova despesa" : "Nova receita";

  const typeElem = $("transactionType");
  if (typeElem) typeElem.value = type;

  const dateElem = $("tDate");
  if (dateElem && !dateElem.value) {
    dateElem.value = new Date().toISOString().slice(0, 10);
  }

  const catElem = $("tCategory");
  if (catElem) {
    catElem.innerHTML = (type === "expense" ? CATEGORIES : INCOME_CATEGORIES)
      .map(x => `<option value="${x}">${x}</option>`).join("");
  }

  const pmGroup = $("paymentMethodGroup");
  const pmElem = $("tPaymentMethod");
  const instGroup = $("installmentsGroup");
  const instElem = $("tInstallments");

  if (type === "expense") {
    if (pmGroup) pmGroup.style.display = "block";
    if (pmElem) {
      pmElem.value = "account";
      if (instGroup) instGroup.style.display = "none";
    }
  } else {
    if (pmGroup) pmGroup.style.display = "none";
    if (instGroup) instGroup.style.display = "none";
  }

  if (instElem) instElem.value = "1";

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "true");
  }
}

function setupForms() {
  document.addEventListener("click", e => {
    const btn = e.target.closest("#newExpense, #newIncome, [data-action='newExpense'], [data-action='newIncome']");
    if (btn) {
      const id = btn.id || btn.dataset.action;
      if (id === "newExpense") openTransaction("expense");
      if (id === "newIncome") openTransaction("income");
    }

    const cardBtn = e.target.closest("#newCard, [data-action='newCard']");
    if (cardBtn) {
      const dialog = $("cardDialog");
      if (dialog) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "true");
      }
    }
  });

  const pmElem = $("tPaymentMethod");
  const instGroup = $("installmentsGroup");
  if (pmElem) {
    pmElem.onchange = () => {
      if (instGroup) {
        instGroup.style.display = pmElem.value === "credit" ? "block" : "none";
      }
    };
  }

  const txForm = $("transactionForm");
  if (txForm) {
    txForm.onsubmit = async e => {
      e.preventDefault();
      const typeElem = $("transactionType");
      const dateElem = $("tDate");
      const catElem = $("tCategory");
      const descElem = $("tDescription");
      const amountElem = $("tAmount");
      const pmElem = $("tPaymentMethod");
      const instElem = $("tInstallments");

      const type = typeElem ? typeElem.value : "expense";
      const baseDateStr = dateElem ? dateElem.value : new Date().toISOString().slice(0, 10);
      const category = catElem ? catElem.value : "Outros";
      const description = descElem ? descElem.value.trim() : "";
      const totalAmount = Number(amountElem ? amountElem.value : 0) || 0;
      const paymentMethod = (type === "expense" && pmElem) ? pmElem.value : "account";
      const numInstallments = (type === "expense" && paymentMethod === "credit" && instElem) ? (parseInt(instElem.value, 10) || 1) : 1;

      if (numInstallments > 1) {
        const cards = await getAll("cards");
        let closingDay = 31;
        if (cards && cards.length > 0 && cards[0].closing) {
          closingDay = Number(cards[0].closing) || 31;
        }

        const parts = baseDateStr.split("-");
        let startYear = parseInt(parts[0], 10);
        let startMonth = parseInt(parts[1], 10) - 1; // 0-indexed
        let purchaseDay = parseInt(parts[2], 10);

        if (purchaseDay > closingDay) {
          startMonth += 1;
        }

        const partAmount = Math.round((totalAmount / numInstallments) * 100) / 100;

        for (let i = 1; i <= numInstallments; i++) {
          const curDate = new Date(startYear, startMonth + (i - 1), Math.min(purchaseDay, 28));
          const y = curDate.getFullYear();
          const m = String(curDate.getMonth() + 1).padStart(2, "0");
          const d = String(purchaseDay).padStart(2, "0");
          const dateStr = `${y}-${m}-${d}`;

          const descText = description ? `${description} (${i}/${numInstallments})` : `${category} (${i}/${numInstallments})`;

          await add("transactions", {
            type,
            date: dateStr,
            category,
            paymentMethod: "credit",
            description: descText,
            amount: partAmount,
            installment: `${i}/${numInstallments}`
          });
        }
      } else {
        await add("transactions", {
          type,
          date: baseDateStr,
          category,
          paymentMethod,
          description,
          amount: totalAmount
        });
      }

      const dialog = $("transactionDialog");
      if (dialog && typeof dialog.close === "function") dialog.close();
      txForm.reset();
      await refresh();
    };
  }

  const cardForm = $("cardForm");
  if (cardForm) {
    cardForm.onsubmit = async e => {
      e.preventDefault();
      const cName = $("cName");
      const cLimit = $("cLimit");
      const cClosing = $("cClosing");
      const cDue = $("cDue");

      await add("cards", {
        name: cName ? cName.value.trim() : "Cartão",
        limit: Number(cLimit ? cLimit.value : 0),
        closing: Number(cClosing ? cClosing.value : 1),
        due: Number(cDue ? cDue.value : 10)
      });

      const dialog = $("cardDialog");
      if (dialog && typeof dialog.close === "function") dialog.close();
      cardForm.reset();
      await renderCards();
    };
  }

  const typeFilter = $("typeFilter");
  if (typeFilter) typeFilter.onchange = renderTransactions;

  const exportBtn = $("exportBackup");
  if (exportBtn) exportBtn.onclick = exportBackup;

  const importInput = $("importBackup");
  if (importInput) importInput.onchange = importBackup;

  const prevBtn = $("prevMonth");
  if (prevBtn) {
    prevBtn.onclick = () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      refresh();
    };
  }

  const nextBtn = $("nextMonth");
  if (nextBtn) {
    nextBtn.onclick = () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      refresh();
    };
  }
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
  const key = monthKey(currentDate);
  const tx = all.filter(x => x && x.date && x.date.startsWith(key));

  const income = tx.filter(x => x.type === "income").reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const expense = tx.filter(x => x.type === "expense").reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const accountExpense = tx.filter(x => x.type === "expense" && x.paymentMethod !== "credit").reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const balance = income - accountExpense;

  if ($("mReceitas")) $("mReceitas").textContent = money(income);
  if ($("mDespesas")) $("mDespesas").textContent = money(expense);
  if ($("mSaldo")) $("mSaldo").textContent = money(balance);
  if ($("mLancamentos")) $("mLancamentos").textContent = tx.length;

  const byCat = {};
  tx.filter(x => x.type === "expense").forEach(x => {
    byCat[x.category] = (byCat[x.category] || 0) + (Number(x.amount) || 0);
  });

  if (typeof Chart !== "undefined") {
    if (cashflowChart) cashflowChart.destroy();
    if (categoryChart) categoryChart.destroy();

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
  const tableElem = $("transactionsTable");
  if (!tableElem) return;

  const all = await getAll("transactions");
  const key = monthKey(currentDate);
  const filterElem = $("typeFilter");
  const filter = filterElem ? filterElem.value : "all";

  let tx = all.filter(x => x && x.date && x.date.startsWith(key) && (filter === "all" || x.type === filter))
             .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  tableElem.innerHTML = tx.length ? tx.map(x => `
    <tr>
      <td>${dateBR(x.date)}</td>
      <td><span class="tag">${x.type === "income" ? "Receita" : "Despesa"}</span></td>
      <td>${x.category}</td>
      <td>${x.description || "—"} ${x.paymentMethod === "credit" ? '<span class="tag" style="background:#e2e8f0;">Cartão</span>' : ''}</td>
      <td class="${x.type}">${x.type === "income" ? "+" : "−"} ${money(x.amount)}</td>
      <td><button class="delete" data-delete="${x.id}">Excluir</button></td>
    </tr>`).join("") : `<tr><td colspan="6" class="muted">Nenhum lançamento.</td></tr>`;

  document.querySelectorAll("[data-delete]").forEach(b => {
    b.onclick = async () => {
      if (confirm("Excluir este lançamento?")) {
        await remove("transactions", Number(b.dataset.delete));
        await refresh();
      }
    };
  });
}

async function renderCards() {
  const cardsList = $("cardsList");
  if (!cardsList) return;

  const cards = await getAll("cards");
  const allTx = await getAll("transactions");
  const key = monthKey(currentDate);

  const creditTx = allTx.filter(x => x && x.date && x.date.startsWith(key) && x.type === "expense" && x.paymentMethod === "credit");
  const totalCreditMonth = creditTx.reduce((a, x) => a + (Number(x.amount) || 0), 0);

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

  document.querySelectorAll("[data-card-delete]").forEach(b => {
    b.onclick = async () => {
      if (confirm("Excluir este cartão?")) {
        await remove("cards", Number(b.dataset.cardDelete));
        await renderCards();
      }
    };
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
  const file = e.target.files ? e.target.files[0] : null;
  if (!file) return;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.transactions) || !Array.isArray(d.cards)) throw Error();
      const tx = store("transactions", "readwrite");
      const cards = store("cards", "readwrite");
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

window.openTransaction = openTransaction;

const init = async () => {
  setupNav();
  setupForms();
  try {
    await openDB();
    await refresh();
  } catch (e) {
    console.error("IndexedDB error:", e);
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
