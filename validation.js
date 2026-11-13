const EXPENSE_CATEGORIES = [
  "Alimentação", "Saúde", "Lazer", "Compras", "Assinaturas", "Educação", "Viagens", "Outros", "Fatura Cartão"
];
const INCOME_CATEGORIES = ["salário", "outros recebimentos"];
const VALID_TRANSACTION_TYPES = ["income", "expense"];
const VALID_PAYMENT_METHODS = ["account", "credit"];

function toMoney(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthName(date) {
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, c => c.toUpperCase());
}

function dateBR(value) {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString("pt-BR");
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function validateBackupPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Arquivo de backup inválido." };
  }
  if (!Array.isArray(payload.transactions) || !Array.isArray(payload.cards)) {
    return { ok: false, error: "O backup não contém listas válidas de lançamentos e cartões." };
  }
  return { ok: true, data: payload };
}
