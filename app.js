import {
  addRecord,
  getAll,
  importBackupRecords,
  openDB,
  removeRecord
} from "./db.js";

import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  dateBR,
  monthKey,
  monthName,
  normalizeCardInput,
  normalizeTransactionInput,
  toMoney,
  validateBackupPayload
} from "./validation.js";

const state = {
  db: null,
  currentDate: new Date(),
  transactions: [],
  cards: [],
  charts: {
    cashflow: null,
    categories: null
  }
};

const $ = id => document.getElementById(id);

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function showError(message) {
  window.alert(message || "Ocorreu um erro. Tente novamente.");
}

function monthTransactions() {
  const key = monthKey(state.currentDate);
  return state.transactions.filter(transaction => transaction.date.startsWith(key));
}

function sum(items) {
  return items.reduce((total, item) => total + Number(item.amount || 0), 0);
}

async function reloadData() {
  const [transactions, cards] = await Promise.all([
    getAll(state.db, "transactions"),
    getAll(state.db, "cards")
  ]);

  state.transactions = transactions;
  state.cards = cards;
}

async function refresh() {
  try {
    await reloadData();
    $("currentMonth").textContent = monthName(state.currentDate);
    renderDashboard();
    renderTransactions();
    renderCards();
  } catch (error) {
    console.error(error);
    showError("Não foi possível carregar os dados locais.");
  }
}

function showView(id) {
  document.querySelectorAll(".view").forEach(view => {
    view.classList.toggle("active-view", view.id === id);
  });

  document.querySelectorAll(".nav").forEach(button => {
    button.classList.toggle("active", button.dataset.view === id);
  });

  const titles = {
    dashboard: "Dashboard",
    lancamentos: "Lançamentos",
    cartoes: "Cartões",
    backup: "Backup"
  };

  $("pageTitle").textContent = titles[id] || "Dashboard";
}

function setupNavigation() {
  document.querySelectorAll(".nav").forEach(button => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  document.querySelectorAll("[data-go]").forEach(button => {
    button.addEventListener("click", () => showView(button.dataset.go));
  });

  document.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", () => {
      openTransaction(button.dataset.action === "newIncome" ? "income" : "expense");
    });
  });

  document.querySelectorAll("[data-close]").forEach(button => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });
}

function ensureCardPicker() {
  const paymentMethod = $("tPaymentMethod");
  if (!paymentMethod || $("tCard")) return;

  const cardLabel = document.createElement("label");
  cardLabel.id = "tCardField";
  cardLabel.hidden = true;
  cardLabel.append("Cartão de crédito");

  const select = document.createElement("select");
  select.id = "tCard";
  select.innerHTML = '<option value="">Selecione um cartão</option>';
  cardLabel.append(select);

  paymentMethod.closest("label").after(cardLabel);

  paymentMethod.addEventListener("change", updatePaymentFields);
  select.addEventListener("change", () => select.setCustomValidity(""));
}

function updatePaymentFields() {
  const paymentMethod = $("tPaymentMethod");
  const paymentLabel = paymentMethod?.closest("label");
  const cardField = $("tCardField");
  const isExpense = $("transactionType").value === "expense";
  const isCredit = isExpense && paymentMethod.value === "credit";

  if (paymentLabel) paymentLabel.hidden = !isExpense;
  if (cardField) cardField.hidden = !isCredit;
}

function populateCardPicker() {
  const select = $("tCard");
  if (!select) return;

  select.innerHTML = [
    '<option value="">Selecione um cartão</option>',
    ...state.cards.map(card =>
      `<option value="${Number(card.id)}">${escapeHTML(card.name)}</option>`
    )
  ].join("");
}

function openTransaction(type) {
  ensureCardPicker();
  populateCardPicker();

  $("transactionTitle").textContent = type === "expense" ? "Nova despesa" : "Nova receita";
  $("transactionType").value = type;
  $("tDate").value = localDateInputValue();
  $("tDescription").value = "";
  $("tAmount").value = "";
  $("tPaymentMethod").value = "account";
  $("tCard").value = "";

  const categories = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  $("tCategory").innerHTML = categories
    .map(category => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`)
    .join("");

  updatePaymentFields();
  $("transactionDialog").showModal();
}

function setupForms() {
  ensureCardPicker();

  $("newExpense").addEventListener("click", () => openTransaction("expense"));
  $("newIncome").addEventListener("click", () => openTransaction("income"));

  $("newCard")?.addEventListener("click", () => $("cardDialog").showModal());

  $("transactionForm").addEventListener("submit", async event => {
    event.preventDefault();

    const type = $("transactionType").value;
    const paymentMethod = type === "expense" ? $("tPaymentMethod").value : "account";
    const result = normalizeTransactionInput({
      type,
      date: $("tDate").value,
      category: $("tCategory").value,
      paymentMethod,
      cardId: paymentMethod === "credit" ? $("tCard").value : undefined,
      description: $("tDescription").value,
      amount: $("tAmount").value
    }, { requireCardForCredit: true });

    if (!result.ok) {
      showError(result.error);
      return;
    }

    try {
      await addRecord(state.db, "transactions", result.data);
      $("transactionDialog").close();
      event.currentTarget.reset();
      await refresh();
    } catch (error) {
      console.error(error);
      showError("Não foi possível salvar o lançamento.");
    }
  });

  $("cardForm").addEventListener("submit", async event => {
    event.preventDefault();

    const result = normalizeCardInput({
      name: $("cName").value,
      limit: $("cLimit").value,
      closing: $("cClosing").value,
      due: $("cDue").value
    });

    if (!result.ok) {
      showError(result.error);
      return;
    }

    try {
      await addRecord(state.db, "cards", result.data);
      $("cardDialog").close();
      event.currentTarget.reset();
      await refresh();
    } catch (error) {
      console.error(error);
      showError("Não foi possível salvar o cartão.");
    }
  });

  $("typeFilter")?.addEventListener("change", renderTransactions);

  $("prevMonth").addEventListener("click", async () => {
    state.currentDate.setDate(1);
    state.currentDate.setMonth(state.currentDate.getMonth() - 1);
    await refresh();
  });

  $("nextMonth").addEventListener("click", async () => {
    state.currentDate.setDate(1);
    state.currentDate.setMonth(state.currentDate.getMonth() + 1);
    await refresh();
  });

  $("exportBackup")?.addEventListener("click", exportBackup);
  $("importBackup")?.addEventListener("change", importBackup);
}

function renderDashboard() {
  const transactions = monthTransactions();
  const income = sum(transactions.filter(item => item.type === "income"));
  const accountExpenses = sum(transactions.filter(item =>
    item.type === "expense" && item.paymentMethod !== "credit"
  ));
  const creditExpenses = sum(transactions.filter(item =>
    item.type === "expense" && item.paymentMethod === "credit"
  ));

  const key = monthKey(state.currentDate);
  const throughSelectedMonth = state.transactions.filter(item => item.date.slice(0, 7) <= key);
  const cumulativeIncome = sum(throughSelectedMonth.filter(item => item.type === "income"));
  const cumulativeAccountExpenses = sum(throughSelectedMonth.filter(item =>
    item.type === "expense" && item.paymentMethod !== "credit"
  ));
  const balance = cumulativeIncome - cumulativeAccountExpenses;

  $("mReceitas").textContent = toMoney(income);
  $("mDespesas").textContent = toMoney(accountExpenses);
  $("mSaldo").textContent = toMoney(balance);
  $("mCartao").textContent = toMoney(creditExpenses);

  renderCharts({ income, accountExpenses, balance, creditExpenses, transactions });

  const recent = [...transactions]
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id))
    .slice(0, 6);

  $("recentList").innerHTML = recent.length
    ? recent.map(item => `
      <div class="list-row">
        <span class="muted">${escapeHTML(dateBR(item.date))}</span>
        <span>
          ${escapeHTML(item.description || item.category)}
          ${item.paymentMethod === "credit" ? '<small class="tag">Cartão</small>' : ""}
        </span>
        <strong class="${item.type}">
          ${item.type === "income" ? "+" : "−"} ${toMoney(item.amount)}
        </strong>
      </div>
    `).join("")
    : '<div class="muted">Nenhum lançamento neste mês.</div>';
}

function destroyCharts() {
  for (const chart of Object.values(state.charts)) {
    chart?.destroy();
  }
  state.charts.cashflow = null;
  state.charts.categories = null;
}

function renderCharts({ income, accountExpenses, balance, creditExpenses, transactions }) {
  destroyCharts();

  if (typeof Chart === "undefined") return;

  const cashflowCanvas = $("cashflowChart");
  if (cashflowCanvas) {
    state.charts.cashflow = new Chart(cashflowCanvas, {
      type: "bar",
      data: {
        labels: ["Receitas", "Saídas Conta", "Saldo Acumulado", "Cartão no mês"],
        datasets: [{
          data: [income, accountExpenses, balance, creditExpenses],
          backgroundColor: ["#10b981", "#ef4444", "#38bdf8", "#f59e0b"],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: context => toMoney(context.raw) } }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: "#94a3b8",
              callback: value => `R$ ${Number(value).toLocaleString("pt-BR")}`
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

  const byCategory = {};
  transactions
    .filter(item => item.type === "expense")
    .forEach(item => {
      byCategory[item.category] = (byCategory[item.category] || 0) + Number(item.amount);
    });

  const categoryCanvas = $("categoryChart");
  if (categoryCanvas) {
    const labels = Object.keys(byCategory);
    state.charts.categories = new Chart(categoryCanvas, {
      type: "doughnut",
      data: {
        labels: labels.length ? labels : ["Sem despesas"],
        datasets: [{
          data: labels.length ? Object.values(byCategory) : [1],
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
          legend: {
            position: "bottom",
            labels: { color: "#94a3b8", boxWidth: 12, padding: 10 }
          },
          tooltip: { callbacks: { label: context => `${context.label}: ${toMoney(context.raw)}` } }
        }
      }
    });
  }
}

function renderTransactions() {
  const filter = $("typeFilter")?.value || "all";
  const transactions = monthTransactions()
    .filter(item => filter === "all" || item.type === filter)
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));

  $("transactionsTable").innerHTML = transactions.length
    ? transactions.map(item => `
      <tr>
        <td>${escapeHTML(dateBR(item.date))}</td>
        <td><span class="tag">${item.type === "income" ? "Receita" : "Despesa"}</span></td>
        <td>${escapeHTML(item.category)}</td>
        <td>
          ${escapeHTML(item.description || "—")}
          ${item.paymentMethod === "credit" ? '<span class="tag">Cartão</span>' : ""}
        </td>
        <td class="${item.type}">
          ${item.type === "income" ? "+" : "−"} ${toMoney(item.amount)}
        </td>
        <td><button type="button" class="delete" data-delete="${Number(item.id)}">Excluir</button></td>
      </tr>
    `).join("")
    : '<tr><td colspan="6" class="muted">Nenhum lançamento.</td></tr>';
}

function renderCards() {
  const transactions = monthTransactions();
  const creditTransactions = transactions.filter(item =>
    item.type === "expense" && item.paymentMethod === "credit"
  );

  const unassignedTotal = sum(creditTransactions.filter(item => !item.cardId));

  $("cardsList").innerHTML = state.cards.length
    ? state.cards.map(card => {
      const cardSpent = sum(creditTransactions.filter(item => Number(item.cardId) === Number(card.id)));
      const estimatedAvailable = Number(card.limit || 0) - cardSpent;

      return `
        <div class="credit-card">
          <h3>${escapeHTML(card.name)}</h3>
          <p><span>Limite total</span><strong>${toMoney(card.limit)}</strong></p>
          <p><span>Fechamento</span><strong>dia ${Number(card.closing)}</strong></p>
          <p><span>Vencimento</span><strong>dia ${Number(card.due)}</strong></p>
          <p><span>Compras deste mês</span><strong>${toMoney(cardSpent)}</strong></p>
          <p><span>Limite após compras do mês*</span><strong>${toMoney(estimatedAvailable)}</strong></p>
          <button type="button" class="delete" data-card-delete="${Number(card.id)}">
            Excluir cartão
          </button>
        </div>
      `;
    }).join("")
    : '<div class="muted">Nenhum cartão cadastrado.</div>';

  if (unassignedTotal > 0) {
    $("cardsList").insertAdjacentHTML("beforeend", `
      <p class="muted">
        ${toMoney(unassignedTotal)} em compras no cartão neste mês não estão associadas
        a um cartão específico (por exemplo, lançamentos antigos).
      </p>
    `);
  }

  if (state.cards.length) {
    $("cardsList").insertAdjacentHTML("beforeend", `
      <p class="muted">
        *Estimativa baseada apenas nas compras lançadas neste mês; não representa a fatura
        ou o limite disponível informado pelo banco.
      </p>
    `);
  }
}

document.addEventListener("click", async event => {
  const deleteTransactionButton = event.target.closest("[data-delete]");
  const deleteCardButton = event.target.closest("[data-card-delete]");

  try {
    if (deleteTransactionButton) {
      if (!window.confirm("Excluir este lançamento?")) return;

      await removeRecord(state.db, "transactions", Number(deleteTransactionButton.dataset.delete));
      await refresh();
      return;
    }

    if (deleteCardButton) {
      const cardId = Number(deleteCardButton.dataset.cardDelete);
      const hasTransactions = state.transactions.some(item => Number(item.cardId) === cardId);

      if (hasTransactions) {
        showError("Este cartão está associado a lançamentos. Não é possível excluí-lo.");
        return;
      }

      if (!window.confirm("Excluir este cartão?")) return;

      await removeRecord(state.db, "cards", cardId);
      await refresh();
    }
  } catch (error) {
    console.error(error);
    showError("Não foi possível concluir a operação.");
  }
});

async function exportBackup() {
  try {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions: state.transactions,
      cards: state.cards
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `financeiro-backup-${localDateInputValue()}.json`;
    link.click();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error(error);
    showError("Não foi possível exportar o backup.");
  }
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    const validation = validateBackupPayload(payload);

    if (!validation.ok) {
      throw new Error(validation.error);
    }

    if (!window.confirm(
      "A importação substituirá todos os lançamentos e cartões deste navegador. Continuar?"
    )) {
      return;
    }

    await importBackupRecords(state.db, validation.data);
    await refresh();
    showError("Backup restaurado com sucesso.");
  } catch (error) {
    console.error(error);
    showError(error.message || "Arquivo de backup inválido.");
  } finally {
    event.target.value = "";
  }
}

async function initialize() {
  setupNavigation();
  setupForms();

  try {
    state.db = await openDB();
    await refresh();
  } catch (error) {
    console.error(error);
    showError(error.message || "Não foi possível iniciar o aplicativo.");
  }
}

initialize();
