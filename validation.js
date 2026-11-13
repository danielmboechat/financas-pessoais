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
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    .replace(/^./, x => x.toUpperCase());
}

export function dateBR(value) {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR");
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeTransactionInput(input) {
  const type = String(input?.type || "").trim();
  if (!VALID_TRANSACTION_TYPES.includes(type)) {
    return { ok: false, error: "Tipo de lançamento inválido." };
  }

  const date = String(input?.date || "").trim();
  if (!date || Number.isNaN(new Date(`${date}T12:00:00`).getTime())) {
    return { ok: false, error: "Selecione uma data válida." };
  }

  const category = String(input?.category || "").trim();
  if (!category) {
    return { ok: false, error: "Selecione uma categoria." };
  }

  const amount = toNumber(input?.amount);
  if (amount === null || amount <= 0) {
    return { ok: false, error: "Informe um valor maior que zero." };
  }

  const paymentMethod = VALID_PAYMENT_METHODS.includes(input?.paymentMethod) ? input.paymentMethod : "account";
  const cardId = input?.cardId !== undefined && input?.cardId !== null && input?.cardId !== ""
    ? Number(input.cardId)
    : null;

  if (type === "expense" && paymentMethod === "credit" && (!Number.isInteger(cardId) || cardId <= 0)) {
    return { ok: false, error: "Selecione um cartão para o pagamento com cartão de crédito." };
  }

  const description = String(input?.description || "").trim().slice(0, 100) || "Sem descrição";

  return {
    ok: true,
    data: {
      type,
      date,
      category,
      paymentMethod,
      description,
      amount: Number(amount.toFixed(2)),
      ...(cardId !== null ? { cardId } : {})
    }
  };
}

export function normalizeCardInput(input) {
  const name = String(input?.name || "").trim();
  if (!name) {
    return { ok: false, error: "Informe o nome do cartão." };
  }

  const limit = toNumber(input?.limit);
  if (limit === null || limit < 0) {
    return { ok: false, error: "O limite deve ser maior ou igual a zero." };
  }

  const closing = Number(input?.closing);
  const due = Number(input?.due);

  if (!Number.isInteger(closing) || closing < 1 || closing > 31) {
    return { ok: false, error: "O dia de fechamento deve estar entre 1 e 31." };
  }

  if (!Number.isInteger(due) || due < 1 || due > 31) {
    return { ok: false, error: "O dia de vencimento deve estar entre 1 e 31." };
  }

  return {
    ok: true,
    data: {
      name,
      limit: Number(limit.toFixed(2)),
      closing,
      due
    }
  };
}

export function validateBackupPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Arquivo de backup inválido." };
  }

  if (!Array.isArray(payload.transactions) || !Array.isArray(payload.cards)) {
    return { ok: false, error: "Arquivo de backup inválido: estrutura inesperada." };
  }

  const normalizedTransactions = payload.transactions.map(transaction => {
    const normalized = normalizeTransactionInput(transaction);
    if (!normalized.ok) {
      throw new Error(normalized.error);
    }
    return normalized.data;
  });

  const normalizedCards = payload.cards.map(card => {
    const normalized = normalizeCardInput(card);
    if (!normalized.ok) {
      throw new Error(normalized.error);
    }
    return normalized.data;
  });

  return {
    ok: true,
    data: {
      transactions: normalizedTransactions,
      cards: normalizedCards
    }
  };
}
