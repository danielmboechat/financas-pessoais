let currentDate = new Date(), cashflowChart, categoryChart;

const $ = id => document.getElementById(id);

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
  const titleElem = $("pageTitle");
  if (titleElem) {
    titleElem.textContent = { dashboard: "Dashboard", lancamentos: "Lançamentos", cartoes: "Cartões", backup: "Backup" }[id] || "Dashboard";
  }
  if (id === "dashboard") renderDashboard();
  if (id === "lancamentos") renderTransactions();
  if (id === "cartoes") renderCards();
}

function setupForms() {
  if ($("newExpense")) $("newExpense").onclick = () => openTransaction("expense");
  if ($("newIncome")) $("newIncome").onclick = () => openTransaction("income");
  if ($("newCard")) $("newCard").onclick = () => $("cardDialog").showModal();

  document.querySelectorAll("[data-action='newExpense']").forEach(b => b.onclick = () => openTransaction("expense"));
  document.querySelectorAll("[data-action='newIncome']").forEach(b => b.onclick = () => openTransaction("income"));

  const tForm = $("transactionForm");
  if (tForm) {
    tForm.onsubmit = async e => {
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
  }

  const cForm = $("cardForm");
  if (cForm) {
    cForm.onsubmit = async e => {
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
  }

  if ($("typeFilter")) $("typeFilter").onchange = renderTransactions;
  if ($("exportBackup")) $("exportBackup").onclick = exportBackup;
  if ($("importBackup")) $("importBackup").onchange = importBackup;
  if ($("prevMonth")) $("prevMonth").onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); refresh(); };
  if ($("nextMonth")) $("nextMonth").onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); refresh(); };
}

function openTransaction(type) {
  $("transactionTitle").textContent = type === "expense" ? "Nova despesa" : "Nova receita";
  $("transactionType").value = type;
  $("tDate").value = new Date().toISOString().slice(0, 10);
  
  const cats = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  $("tCategory").innerHTML = cats.map(x => `<option value="${escapeHTML(x)}">${escapeHTML(x)}</option>`).join("");
  
  const pmElem = $("tPaymentMethod");
  if (pmElem) {
    const pmLabel = $("paymentMethodGroup") || pmElem.closest("label");
    if (pmLabel) {
      pmLabel.style.display = (type === "expense") ? "block" : "none";
    }
    pmElem.value = "account";
  }

  $("transactionDialog").showModal();
}

async function refresh() {
  if ($("currentMonth")) $("currentMonth").textContent = monthName(currentDate);
  await renderDashboard();
  await renderTransactions();
  await renderCards();
}

async function renderDashboard() {
  const all = await getAll("transactions"), key = monthKey(currentDate);
  const tx = all.filter(x => x.date && x.date.startsWith(key));
  
  const income = tx.filter(x => x.type === "income").reduce((a, x) => a + x.amount, 0);
  const expense = tx.filter(x => x.type === "expense").reduce((a, x) => a + x.amount, 0);
  const accountExpense = tx.filter(x => x.type === "expense" && x.paymentMethod !== "credit").reduce((a, x) => a + x.amount, 0);
  const creditExpense = tx.filter(x => x.type === "expense" && x.paymentMethod === "credit").reduce((a, x) => a + x.amount, 0);
  const balance = income - accountExpense;

  if ($("mReceitas")) $("mReceitas").textContent = toMoney(income);
  if ($("mDespesas")) $("mDespesas").textContent = toMoney(accountExpense);
  if ($("mSaldo")) $("mSaldo").textContent = toMoney(balance);
  if ($("mCartao")) $("mCartao").textContent = toMoney(creditExpense);

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
          labels: ["Receitas", "Despesas Conta", "Cartão (A Vencer)"],
          datasets: [{
            data: [income, accountExpense, creditExpense],
            backgroundColor: ["#18794e", "#a33b3b", "#2b6cb0"]
          }]
        },
        options: { plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false }
      });
    }

    const catElem = $("categoryChart");
    if (catElem) {
      categoryChart = new Chart(catElem, {
        type: "doughnut",
        data: {
          labels: Object.keys(byCat).length ? Object.keys(byCat).map(escapeHTML) : ["Sem despesas"],
          datasets: [{ data: Object.values(byCat).length ? Object.values(byCat) : [1] }]
        },
        options: { plugins: { legend: { position: "bottom" } }, responsive: true }
      });
    }
  }

  const recent = [...tx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  if ($("recentList")) {
    $("recentList").innerHTML = recent.length ? recent.map(x => `
      <div class="list-row">
        <span class="muted">${dateBR(x.date)}</span>
        <span>${escapeHTML(x.description || x.category)} ${x.paymentMethod === 'credit' ? '<small class="tag">Cartão</small>' : ''}</span>
        <strong class="${x.type}">${x.type === "income" ? "+" : "−"} ${toMoney(x.amount)}</strong>
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
        <td>${escapeHTML(x.category)}</td>
        <td>${escapeHTML(x.description || "—")} ${x.paymentMethod === "credit" ? '<span class="tag" style="background:#e2e8f0;">Cartão</span>' : ''}</td>
        <td class="${x.type}">${x.type === "income" ? "+" : "−"} ${toMoney(x.amount)}</td>
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
        <h3>${escapeHTML(c.name)}</h3>
        <p><span>Limite Total</span><strong>${toMoney(c.limit)}</strong></p>
        <p><span>Fechamento</span><strong>dia ${c.closing}</strong></p>
        <p><span>Vencimento</span><strong>dia ${c.due}</strong></p>
        <p><span>Compras (Mês)</span><strong>${toMoney(totalCreditMonth)}</strong></p>
        <p><span>Limite Disponível</span><strong>${toMoney(c.limit - totalCreditMonth)}</strong></p>
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
  const input = e.target;
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = async () => {
    let backup;

    // Primeiro conferimos o arquivo. Os dados atuais só serão tocados depois disso.
    try {
      backup = JSON.parse(reader.result);
    } catch (err) {
      alert("Não foi possível ler o backup. O arquivo não parece ser um JSON válido.");
      return;
    }

    const validation = typeof validateBackupPayload === "function"
      ? validateBackupPayload(backup)
      : {
          ok: !!backup &&
            typeof backup === "object" &&
            Array.isArray(backup.transactions) &&
            Array.isArray(backup.cards),
          error: "O arquivo não contém um backup válido."
        };

    if (!validation.ok) {
      alert(validation.error || "Arquivo de backup inválido.");
      return;
    }

    // Evita que um arquivo malformado apague os dados atuais.
    const validRecords = records =>
      records.every(record =>
        record !== null &&
        typeof record === "object" &&
        !Array.isArray(record)
      );

    if (!validRecords(backup.transactions) || !validRecords(backup.cards)) {
      alert("O backup contém registros inválidos. Nenhum dado atual foi alterado.");
      return;
    }

    // Mantém IDs válidos do backup; registros sem ID recebem um novo ID automaticamente.
    const prepareRecord = record => {
      const copy = { ...record };
      if (!Number.isInteger(copy.id) || copy.id <= 0) {
        delete copy.id;
      }
      return copy;
    };

    let transaction;
    let finished = false;

    const reportFailure = message => {
      if (finished) return;
      finished = true;
      alert(
        "Não foi possível restaurar o backup. Seus dados anteriores foram preservados. " +
        (message || "Tente novamente com outro arquivo.")
      );
    };

    try {
      // Uma única operação para as duas listas: ou tudo é restaurado, ou nada é alterado.
      transaction = db.transaction(["transactions", "cards"], "readwrite");

      transaction.oncomplete = async () => {
        if (finished) return;
        finished = true;
        alert("Backup restaurado com sucesso!");
        await refresh();
      };

      transaction.onerror = () => {
        reportFailure(transaction.error?.message);
      };

      transaction.onabort = () => {
        reportFailure(transaction.error?.message);
      };

      const txStore = transaction.objectStore("transactions");
      const cardStore = transaction.objectStore("cards");

      // Não usar await entre estas operações: o navegador precisa concluir a transação
      // enquanto ela ainda está ativa.
      txStore.clear();
      cardStore.clear();

      backup.transactions.forEach(record => {
        txStore.add(prepareRecord(record));
      });

      backup.cards.forEach(record => {
        cardStore.add(prepareRecord(record));
      });
    } catch (err) {
      if (transaction) {
        try {
          transaction.abort();
        } catch (_) {
          // A transação pode já ter sido encerrada pelo navegador.
        }
      }
      reportFailure(err.message);
    }
  };

  reader.onerror = () => {
    alert("O arquivo não pôde ser lido. Tente selecioná-lo novamente.");
  };

  reader.readAsText(file);
  input.value = "";
}

// Global initialization
document.addEventListener("DOMContentLoaded", async () => {
  setupNav();
  setupForms();
  try {
    await openDB();
    await refresh();
  } catch (err) {
    console.error("Erro ao inicializar banco de dados:", err);
  }
});
