export const EXPENSE_CATEGORIES = [
  "Alimentação",
  "Saúde",
  "Lazer",
  "Compras",
  "Assinaturas",
  "Educação",
  "Viagens",
  "Outros",
  "Fatura Cartão"
];

export const INCOME_CATEGORIES = ["salário", "outros recebimentos"];
export const VALID_TRANSACTION_TYPES = ["income", "expense"];
export const VALID_PAYMENT_METHODS = ["account", "credit"];

export function toMoney(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value) || 0);
}

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthName(date) {
  return date
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    .replace(/^./, character => character.toUpperCase());
}

export function dateBR(value) {
  if (!value) return "—";

  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleDateString("pt-BR");
}

function numberValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function normalizeId(value, label) {
  if (value === undefined) return { ok: true, id: undefined };

  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: `Identificador inválido: ${label}.` };
  }

  return { ok: true, id };
}

export function normalizeTransactionInput(input, { requireCardForCredit = false } = {}) {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Lançamento inválido." };
  }

  const type = String(input.type || "").trim();
  if (!VALID_TRANSACTION_TYPES.includes(type)) {
    return { ok: false, error: "Tipo de lançamento inválido." };
  }

  const date = String(input.date || "").trim();
  if (!isValidDate(date)) {
    return { ok: false, error: "Selecione uma data válida." };
  }

  const category = String(input.category || "").trim();
  const validCategories = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  if (!validCategories.includes(category)) {
    return { ok: false, error: "Selecione uma categoria válida." };
  }

  const amount = numberValue(input.amount);
  if (amount === null || amount <= 0) {
    return { ok: false, error: "Informe um valor maior que zero." };
  }

  const paymentMethod = type === "expense"
    ? String(input.paymentMethod || "account")
    : "account";

  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    return { ok: false, error: "Forma de pagamento inválida." };
  }

  let cardId;
  if (input.cardId !== undefined && input.cardId !== null && input.cardId !== "") {
    const parsedCardId = Number(input.cardId);
    if (Number.isInteger(parsedCardId) && parsedCardId > 0) {
      cardId = parsedCardId;
    }
  }

  if (type === "expense" && paymentMethod === "credit" &&
      requireCardForCredit && cardId === undefined) {
    return { ok: false, error: "Selecione um cartão para esta despesa." };
  }

  if (type !== "expense" || paymentMethod !== "credit") {
    cardId = undefined;
  }

  const idResult = normalizeId(input.id, "lançamento");
  if (!idResult.ok) return idResult;

  return {
    ok: true,
    data: {
      ...(idResult.id !== undefined ? { id: idResult.id } : {}),
      type,
      date,
      category,
      paymentMethod,
      description: String(input.description || "").trim().slice(0, 100),
      amount: Number(amount.toFixed(2)),
      ...(cardId !== undefined ? { cardId } : {})
    }
  };
}

export function normalizeCardInput(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Cartão inválido." };
  }

  const name = String(input.name || "").trim();
  if (!name) {
    return { ok: false, error: "Informe o nome do cartão." };
  }

  const limit = numberValue(input.limit);
  if (limit === null || limit < 0) {
    return { ok: false, error: "O limite deve ser maior ou igual a zero." };
  }

  const closing = Number(input.closing);
  const due = Number(input.due);

  if (!Number.isInteger(closing) || closing < 1 || closing > 31) {
    return { ok: false, error: "O fechamento deve estar entre os dias 1 e 31." };
  }

  if (!Number.isInteger(due) || due < 1 || due > 31) {
    return { ok: false, error: "O vencimento deve estar entre os dias 1 e 31." };
  }

  const idResult = normalizeId(input.id, "cartão");
  if (!idResult.ok) return idResult;

  return {
    ok: true,
    data: {
      ...(idResult.id !== undefined ? { id: idResult.id } : {}),
      name,
      limit: Number(limit.toFixed(2)),
      closing,
      due
    }
  };
}

export function validateBackupPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Arquivo de backup inválido." };
  }

  if (payload.version !== undefined && payload.version !== 1) {
    return { ok: false, error: "A versão deste backup não é compatível." };
  }

  if (!Array.isArray(payload.transactions) || !Array.isArray(payload.cards)) {
    return { ok: false, error: "O backup não contém listas válidas de lançamentos e cartões." };
  }

  const transactions = [];
  const cards = [];

  for (const transaction of payload.transactions) {
    const result = normalizeTransactionInput(transaction);
    if (!result.ok) return result;
    transactions.push(result.data);
  }

  for (const card of payload.cards) {
    const result = normalizeCardInput(card);
    if (!result.ok) return result;
    cards.push(result.data);
  }

  const cardIds = cards
    .map(card => card.id)
    .filter(id => id !== undefined);

  const knownCardIds = new Set(cardIds);
  for (const transaction of transactions) {
    if (transaction.cardId !== undefined && !knownCardIds.has(transaction.cardId)) {
      if (cardIds.length === 1) {
        transaction.cardId = cardIds[0];
      } else {
        delete transaction.cardId;
      }
    }
  }

  return {
    ok: true,
    data: { transactions, cards }
  };
}
