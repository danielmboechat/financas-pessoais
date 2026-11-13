export const DB_NAME = "financeiro_pessoal_v1";
export const DB_VERSION = 1;

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains("transactions")) {
        const transactions = db.createObjectStore("transactions", {
          keyPath: "id",
          autoIncrement: true
        });
        transactions.createIndex("date", "date");
      }

      if (!db.objectStoreNames.contains("cards")) {
        db.createObjectStore("cards", {
          keyPath: "id",
          autoIncrement: true
        });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () => {
      reject(request.error || new Error("Não foi possível abrir o banco de dados."));
    };

    request.onblocked = () => {
      reject(new Error("Feche outras abas do aplicativo para atualizar o banco de dados."));
    };
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => {
      reject(transaction.error || new Error("A operação no banco de dados foi cancelada."));
    };
    transaction.onerror = () => {
      reject(transaction.error || new Error("Erro ao acessar o banco de dados."));
    };
  });
}

export function getAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => {
      reject(request.error || new Error(`Não foi possível buscar ${storeName}.`));
    };
  });
}

export async function addRecord(db, storeName, record) {
  const transaction = db.transaction(storeName, "readwrite");
  const request = transaction.objectStore(storeName).add(record);
  const done = transactionDone(transaction);

  const id = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(request.error || new Error(`Não foi possível salvar em ${storeName}.`));
    };
  });

  await done;
  return id;
}

export async function removeRecord(db, storeName, id) {
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).delete(id);
  await transactionDone(transaction);
}

/**
 * Replaces both stores in one IndexedDB transaction. If an import fails,
 * IndexedDB rolls the transaction back instead of leaving partially restored data.
 */
export async function importBackupRecords(db, data) {
  const transaction = db.transaction(["transactions", "cards"], "readwrite");
  const transactionsStore = transaction.objectStore("transactions");
  const cardsStore = transaction.objectStore("cards");

  transactionsStore.clear();
  cardsStore.clear();

  for (const card of data.cards) {
    cardsStore.add(card);
  }

  for (const record of data.transactions) {
    transactionsStore.add(record);
  }

  await transactionDone(transaction);
}
