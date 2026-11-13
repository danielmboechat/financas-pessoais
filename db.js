const DB_NAME = "financeiro_pessoal_v1", DB_VERSION = 1;
let db;

export function openDB() {
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

export const store = (name, mode = "readonly") => db.transaction(name, mode).objectStore(name);

export const getAll = name => new Promise((res, rej) => { 
  const r = store(name).getAll(); 
  r.onsuccess = () => res(r.result); 
  r.onerror = () => rej(r.error); 
});

export const add = (name, obj) => new Promise((res, rej) => { 
  const r = store(name, "readwrite").add(obj); 
  r.onsuccess = () => res(r.result); 
  r.onerror = () => rej(r.error); 
});

export const remove = (name, id) => new Promise((res, rej) => { 
  const r = store(name, "readwrite").delete(id); 
  r.onsuccess = () => res(); 
  r.onerror = () => rej(r.error); 
});
