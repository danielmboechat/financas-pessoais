const CATEGORIES = ["Alimentação", "Saúde", "Lazer", "Compras", "Assinaturas", "Educação", "Viagens", "Outros"];
const INCOME_CATEGORIES = ["salário", "outros recebimentos"];
const DB_NAME = "financeiro_pessoal_v1", DB_VERSION = 1;
let db, currentDate = new Date(), cashflowChart, categoryChart;

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
const getAll = name => new Promise((res, rej) => { const r = store(name).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
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
  const target = $(id);
  if (!target) return;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active-view"));
  target.classList.add("active-view");
  document.querySelectorAll(".nav").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  
  const titleElem = $("pageTitle");
  if (titleElem) {
    const titles = { dashboard: "Dashboard", lancamentos: "Lançamentos", cartoes: "Cartões", backup: "Backup" };
    titleElem.textContent = titles[id] || "Dashboard";
  }
  
  if (id === "dashboard") renderDashboard();
  if (id === "lancamentos") renderTransactions();
  if (id === "cartoes") renderCards();
}

function setupForms() {
  // Global click delegate for action buttons
  document.addEventListener("click", e => {
    const btn = e.target.closest("button, [data-action]");
    if (!btn) return;

    if (btn.id === "newExpense" || btn.dataset.action === "newExpense") {
      openTransaction("expense");
    } else if (btn.id === "newIncome" || btn.dataset.action === "newIncome") {
      openTransaction("income");
    } else if (btn.id === "newCard" || btn.dataset.action === "newCard") {
      const dlg = $("cardDialog");
      if (dlg && typeof dlg.showModal === "function") dlg.showModal();
    }
  });

  const txForm = $("transactionForm");
  if (txForm) {
    txForm.onsubmit = async e => {
      e.preventDefault();
      const type = $("transactionType") ? $("transactionType").value : "expense";
      const pmElem = $("tPaymentMethod");
      const instElem = $("tInstallments");
      const paymentMethod = (type === "expense" && pmElem) ? pmElem.value : "account";
      const totalAmount = Number($("tAmount").value) || 0;
      const baseDateStr = $("tDate").value;
      const category = $("tCategory").value;
      const rawDesc = $("tDescription").value.trim();

      const numInstallments = (type === "expense" && paymentMethod === "credit" && instElem)
        ? Math.max(1, parseInt(instElem.value, 10) || 1)
        : 1;

      if (numInstallments > 1) {
        const installmentAmount = Math.round((totalAmount / numInstallments) * 100) / 100;
        const [y, m, d] = baseDateStr.split("-").map(Number);

        for (let i = 1; i <= numInstallments; i++) {
          const instDate = new Date(y, (m - 1) + (i - 1), d);
          const yyyy = instDate.getFullYear();
          const mm = String(instDate.getMonth() + 1).padStart(2, "0");
          const dd = String(instDate.getDate()).padStart(2, "0");
          const formattedDate = `${yyyy}-${mm}-${dd}`;
          const descText = rawDesc ? `${rawDesc} (${i}/${numInstallments})` : `${category} (${i}/${numInstallments})`;

          await add("transactions", {
            type: type,
            date: formattedDate,
            category: category,
            paymentMethod: "credit",
            description: descText,
            amount: installmentAmount
          });
        }
      } else {
        await add("transactions", {
          type: type,
          date: baseDateStr,
          category: category,
          paymentMethod: paymentMethod,
          description: rawDesc,
          amount: totalAmount
        });
      }

      const dlg = $("transactionDialog");
      if (dlg) dlg.close();
      txForm.reset();
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
      const dlg = $("cardDialog");
      if (dlg) dlg.close();
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
  const pmElem = $("tPaymentMethod");
  const instGroup = $("installmentsGroup");
  const instElem = $("tInstallments");

  if (pmGroup) {
    if (type === "expense") {
      pmGroup.style.display = "block";
      if (pmElem) pmElem.value = "account";
    } else {
      pmGroup.style.display = "none";
    }
  }

  if (instGroup) {
    instGroup.style.display = "none";
    if (instElem) instElem.value = "1";
  }

  if (pmElem) {
    pmElem.onchange = () => {
      if (instGroup) {
        instGroup.style.display = (pmElem.value === "credit") ? "block" : "none";
      }
    };
  }

  const dlg = $("transactionDialog");
  if (dlg && typeof dlg.showModal === "function") {
    dlg.showModal();
  } else if (dlg) {
    dlg.setAttribute("open", "");
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
  const filter = $("typeFilter") ? $("typeFilter").value : "all";
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
  if (!files || files.length === 0) return;
  const file = files[0];

  const reader = new FileReader();
  reader.onload = async event => {
    try {
      const rawText = event.target.result;
      if (!rawText || !rawText.trim()) {
        throw new Error("Arquivo vazio");
      }
      
      const parsed = JSON.parse(rawText);

      let txList = [];
      let cardList = [];

      if (Array.isArray(parsed)) {
        txList = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        if (Array.isArray(parsed.transactions)) txList = parsed.transactions;
        if (Array.isArray(parsed.cards)) cardList = parsed.cards;
        // Also support fallback if user uploaded data under 'data' or similar
        if (txList.length === 0 && Array.isArray(parsed.data)) txList = parsed.data;
      }

      if (!Array.isArray(txList)) {
        throw new Error("Estrutura do backup não contém lançamentos válidos.");
      }

      // Execute atomic multi-store IndexedDB clear + populate transaction
      const idbTx = db.transaction(["transactions", "cards"], "readwrite");
      const txStore = idbTx.objectStore("transactions");
      const cardStore = idbTx.objectStore("cards");

      txStore.clear();
      cardStore.clear();

      txList.forEach(item => {
        if (item && typeof item === "object") {
          const record = { ...item };
          delete record.id; // allow IndexedDB autoIncrement
          txStore.add(record);
        }
      });

      cardList.forEach(item => {
        if (item && typeof item === "object") {
          const record = { ...item };
          delete record.id;
          cardStore.add(record);
        }
      });

      idbTx.oncomplete = async () => {
        alert("Backup restaurado com sucesso!");
        e.target.value = "";
        await refresh();
      };

      idbTx.onerror = err => {
        console.error("Erro na transação de restauração:", err);
        alert("Erro ao gravar dados no navegador.");
        e.target.value = "";
      };

    } catch (err) {
      console.error("Erro ao importar backup:", err);
      alert("Arquivo de backup inválido: " + err.message);
      e.target.value = "";
    }
  };

  reader.onerror = () => {
    alert("Erro ao ler o arquivo selecionado.");
    e.target.value = "";
  };

  reader.readAsText(file);
}

(async () => {
  setupNav();
  setupForms();
  await openDB();
  await refresh();
})();
