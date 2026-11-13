const CATEGORIES = ["Alimentação", "Saúde", "Lazer", "Compras", "Assinaturas", "Educação", "Viagens", "Outros"];
const INCOME_CATEGORIES = ["salário", "outros recebimentos"];
const DB_NAME = "financeiro_pessoal_v1", DB_VERSION = 1;
let db, currentDate = new Date(), cashflowChart = null, categoryChart = null;

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
  const target = $(id);
  if (target) target.classList.add("active-view");
  document.querySelectorAll(".nav").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  const titles = { dashboard: "Dashboard", lancamentos: "Lançamentos", cartoes: "Cartões", backup: "Backup" };
  $("pageTitle").textContent = titles[id] || "Dashboard";
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
  const monthTx = all.filter(x => x.date.startsWith(key));
  
  const income = monthTx.filter(x => x.type === "income").reduce((a, x) => a + x.amount, 0);
  const accountExpense = monthTx.filter(x => x.type === "expense" && x.paymentMethod !== "credit").reduce((a, x) => a + x.amount, 0);
  const creditExpense = monthTx.filter(x => x.type === "expense" && x.paymentMethod === "credit").reduce((a, x) => a + x.amount, 0);
  
  // Saldo em Conta Acumulado até o final do mês selecionado
  const upToMonthTx = all.filter(x => x.date.slice(0, 7) <= key);
  const cumIncome = upToMonthTx.filter(x => x.type === "income").reduce((a, x) => a + x.amount, 0);
  const cumAccExpense = upToMonthTx.filter(x => x.type === "expense" && x.paymentMethod !== "credit").reduce((a, x) => a + x.amount, 0);
  const cumulativeBalance = cumIncome - cumAccExpense;

  if ($("mReceitas")) $("mReceitas").textContent = money(income);
  if ($("mDespesas")) $("mDespesas").textContent = money(accountExpense);
  if ($("mSaldo")) $("mSaldo").textContent = money(cumulativeBalance);
  if ($("mCartao")) $("mCartao").textContent = money(creditExpense);

  const byCat = {};
  monthTx.filter(x => x.type === "expense").forEach(x => byCat[x.category] = (byCat[x.category] || 0) + x.amount);

  // Destruir gráficos anteriores com segurança para evitar travamentos
  if (cashflowChart) {
    cashflowChart.destroy();
    cashflowChart = null;
  }
  if (categoryChart) {
    categoryChart.destroy();
    categoryChart = null;
  }

  const ctxCash = $("cashflowChart");
  if (ctxCash) {
    cashflowChart = new Chart(ctxCash, {
      type: "bar",
      data: {
        labels: ["Receitas", "Saídas Conta", "Saldo Final", "Cartão (A Vencer)"],
        datasets: [{
          data: [income, accountExpense, cumulativeBalance, creditExpense],
          backgroundColor: ["#10b981", "#ef4444", "#38bdf8", "#f59e0b"],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => money(ctx.raw)
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: "#94a3b8",
              callback: value => "R$ " + Number(value).toLocaleString("pt-BR")
            },
            grid: { color: "rgba(255,255,255,0.05)" }
          },
          x: {
            ticks: { color: "#f8fafc", font: { size: 11 } },
            grid: { display: false }
          }
        }
      }
    });
  }

  const ctxCat = $("categoryChart");
  if (ctxCat) {
    const catLabels = Object.keys(byCat).length ? Object.keys(byCat) : ["Sem despesas"];
    const catData = Object.values(byCat).length ? Object.values(byCat) : [1];
    categoryChart = new Chart(ctxCat, {
      type: "doughnut",
      data: {
        labels: catLabels,
        datasets: [{
          data: catData,
          backgroundColor: [
            "#38bdf8", "#10b981", "#f59e0b", "#ef4444",
            "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"
          ],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { color: "#94a3b8", boxWidth: 12, padding: 10 } },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.label}: ${money(ctx.raw)}`
            }
          }
        }
      }
    });
  }

  const recent = [...monthTx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
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
  const all = await getAll("transactions");
  const key = monthKey(currentDate);
  const filter = $("typeFilter") ? $("typeFilter").value : "all";
  let tx = all.filter(x => x.date.startsWith(key) && (filter === "all" || x.type === filter)).sort((a, b) => b.date.localeCompare(a.date));
  
  if ($("transactionsTable")) {
    $("transactionsTable").innerHTML = tx.length ? tx.map(x => `
      <tr>
        <td>${dateBR(x.date)}</td>
        <td><span class="tag">${x.type === "income" ? "Receita" : "Despesa"}</span></td>
        <td>${x.category}</td>
        <td>${x.description || "—"} ${x.paymentMethod === "credit" ? '<span class="tag" style="background:#334155;color:#38bdf8;">Cartão</span>' : ''}</td>
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

  const creditTx = allTx.filter(x => x.date.startsWith(key) && x.type === "expense" && x.paymentMethod === "credit");
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
  const file = e.target.files && e.target.files[0];
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
        alert("Backup restaurado com sucesso!");
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
