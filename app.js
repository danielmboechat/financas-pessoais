const CATEGORIES = ["Alimentação", "Saúde", "Lazer", "Compras", "Assinaturas", "Educação", "Viagens", "Outros"];
const INCOME_CATEGORIES = ["salário", "outros recebimentos"];
const DB_NAME = "financeiro_pessoal_v1", DB_VERSION = 1;
let db, currentDate = new Date(), cashflowChart, categoryChart;

const $ = id => document.getElementById(id);
const money = v => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
const dateBR = s => {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return y && m && d ? `${d}/${m}/${y}` : s;
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
const getAll = name => new Promise((res, rej) => { const r = store(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const add = (name, obj) => new Promise((res, rej) => { const r = store(name, "readwrite").add(obj); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const remove = (name, id) => new Promise((res, rej) => { const r = store(name, "readwrite").delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });

function setupNav() {
  document.querySelectorAll(".nav").forEach(b => b.onclick = () => showView(b.dataset.view));
  document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => showView(b.dataset.go));
  document.querySelectorAll("[data-close]").forEach(b => b.closest("dialog")?.close());
}

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active-view"));
  const viewElem = $(id);
  if (viewElem) viewElem.classList.add("active-view");
  document.querySelectorAll(".nav").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  
  const titles = { dashboard: "Dashboard", lancamentos: "Lançamentos", cartoes: "Cartões", backup: "Backup" };
  if ($("pageTitle")) $("pageTitle").textContent = titles[id] || "Dashboard";
  
  if (id === "dashboard") renderDashboard();
  if (id === "lancamentos") renderTransactions();
  if (id === "cartoes") renderCards();
}

function setupForms() {
  document.addEventListener("click", e => {
    const btn = e.target.closest("button, [data-action]");
    if (!btn) return;
    const action = btn.dataset.action || btn.id;
    if (action === "newExpense" || btn.textContent.includes("Nova despesa")) {
      openTransaction("expense");
    } else if (action === "newIncome" || btn.textContent.includes("Nova receita")) {
      openTransaction("income");
    } else if (action === "newCard" || btn.textContent.includes("Novo cartão")) {
      $("cardDialog")?.showModal();
    }
  });

  const pmElem = $("tPaymentMethod");
  if (pmElem) {
    pmElem.onchange = () => {
      const instGroup = $("installmentsGroup");
      if (instGroup) {
        instGroup.style.display = pmElem.value === "credit" ? "block" : "none";
      }
    };
  }

  const txForm = $("transactionForm");
  if (txForm) {
    txForm.onsubmit = async e => {
      e.preventDefault();
      const type = $("transactionType")?.value || "expense";
      const pmVal = (type === "expense" && $("tPaymentMethod")) ? $("tPaymentMethod").value : "account";
      const installments = (type === "expense" && pmVal === "credit" && $("tInstallments")) ? Number($("tInstallments").value) || 1 : 1;
      
      const baseDateStr = $("tDate")?.value || new Date().toISOString().slice(0, 10);
      const catVal = $("tCategory")?.value || "Outros";
      const descVal = $("tDescription")?.value.trim() || "";
      const totalAmount = Number($("tAmount")?.value) || 0;

      if (installments > 1) {
        const perInstallmentAmount = Math.round((totalAmount / installments) * 100) / 100;
        const cards = await getAll("cards");
        const closingDay = cards.length > 0 ? (cards[0].closing || 30) : 30;

        let [y, m, d] = baseDateStr.split("-").map(Number);
        if (d > closingDay) {
          m += 1;
          if (m > 12) { m = 1; y += 1; }
        }

        for (let i = 1; i <= installments; i++) {
          const instDateStr = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, 28)).padStart(2, "0")}`;
          const itemDesc = descVal ? `${descVal} (${i}/${installments})` : `${catVal} (${i}/${installments})`;

          await add("transactions", {
            type: type,
            date: instDateStr,
            category: catVal,
            paymentMethod: pmVal,
            description: itemDesc,
            amount: perInstallmentAmount
          });

          m += 1;
          if (m > 12) { m = 1; y += 1; }
        }
      } else {
        await add("transactions", {
          type: type,
          date: baseDateStr,
          category: catVal,
          paymentMethod: pmVal,
          description: descVal,
          amount: totalAmount
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
        name: $("cName")?.value.trim() || "Cartão",
        limit: Number($("cLimit")?.value) || 0,
        closing: Number($("cClosing")?.value) || 1,
        due: Number($("cDue")?.value) || 10
      });
      $("cardDialog")?.close();
      cardForm.reset();
      await renderCards();
    };
  }

  if ($("typeFilter")) $("typeFilter").onchange = renderTransactions;
  if ($("exportBackup")) $("exportBackup").onclick = exportBackup;
  if ($("importBackup")) $("importBackup").onchange = importBackup;
  if ($("prevMonth")) $("prevMonth").onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); refresh(); };
  if ($("nextMonth")) $("nextMonth").onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); refresh(); };
}

function openTransaction(type) {
  if ($("transactionTitle")) $("transactionTitle").textContent = type === "expense" ? "Nova despesa" : "Nova receita";
  if ($("transactionType")) $("transactionType").value = type;
  if ($("tDate")) $("tDate").value = new Date().toISOString().slice(0, 10);
  
  if ($("tCategory")) {
    $("tCategory").innerHTML = (type === "expense" ? CATEGORIES : INCOME_CATEGORIES)
      .map(x => `<option value="${x}">${x}</option>`).join("");
  }

  const pmGroup = $("paymentMethodGroup");
  const instGroup = $("installmentsGroup");
  const pmElem = $("tPaymentMethod");

  if (type === "expense") {
    if (pmGroup) pmGroup.style.display = "block";
    if (pmElem) pmElem.value = "account";
    if (instGroup) instGroup.style.display = "none";
  } else {
    if (pmGroup) pmGroup.style.display = "none";
    if (instGroup) instGroup.style.display = "none";
  }

  const dialog = $("transactionDialog");
  if (dialog) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "true");
  }
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

  cashflowChart?.destroy();
  categoryChart?.destroy();

  const c1 = $("cashflowChart");
  if (c1) {
    cashflowChart = new Chart(c1, {
      type: "bar",
      data: {
        labels: ["Receitas", "Despesas Totais", "Despesas Conta"],
        datasets: [{
          data: [income, expense, accountExpense],
          backgroundColor: ["#18794e", "#a33b3b", "#2b6cb0"]
        }]
      },
      options: { plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false }
    });
  }

  const c2 = $("categoryChart");
  if (c2) {
    categoryChart = new Chart(c2, {
      type: "doughnut",
      data: {
        labels: Object.keys(byCat).length ? Object.keys(byCat) : ["Sem despesas"],
        datasets: [{ data: Object.values(byCat).length ? Object.values(byCat) : [1] }]
      },
      options: { plugins: { legend: { position: "bottom" } }, responsive: true }
    });
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
  const filter = $("typeFilter")?.value || "all";
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

  if ($("cardsList")) {
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
  const files = e.target.files;
  if (!files || !files.length) return;
  const file = files[0];
  const r = new FileReader();
  r.onload = async () => {
    try {
      const d = JSON.parse(r.result);
      const txs = Array.isArray(d.transactions) ? d.transactions : (Array.isArray(d) ? d : []);
      const crds = Array.isArray(d.cards) ? d.cards : [];

      const txStore = store("transactions", "readwrite");
      const cardStore = store("cards", "readwrite");

      (await getAll("transactions")).forEach(x => txStore.delete(x.id));
      (await getAll("cards")).forEach(x => cardStore.delete(x.id));

      txs.forEach(x => { delete x.id; txStore.add(x); });
      crds.forEach(x => { delete x.id; cardStore.add(x); });

      txStore.transaction.oncomplete = async () => {
        alert("Backup restaurado com sucesso!");
        await refresh();
      };
    } catch (err) {
      console.error(err);
      alert("Arquivo de backup inválido.");
    }
  };
  r.readAsText(file);
  e.target.value = "";
}

window.openTransaction = openTransaction;

document.addEventListener("DOMContentLoaded", async () => {
  setupNav();
  setupForms();
  await openDB();
  await refresh();
});

if (document.readyState === "complete" || document.readyState === "interactive") {
  setTimeout(async () => {
    setupNav();
    setupForms();
    await openDB();
    await refresh();
  }, 100);
}
