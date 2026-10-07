const CATEGORIES=["Alimentação","Saúde","Lazer","Compras","Assinaturas","Educação","Viagens","Outros"];
const INCOME_CATEGORIES=["salário","outros recebimentos"];
const DB_NAME="financeiro_pessoal_v1", DB_VERSION=1;
let db, currentDate=new Date(), cashflowChart, categoryChart;

const $=id=>document.getElementById(id);
const money=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v)||0);
const dateBR=s=>new Date(s+"T12:00:00").toLocaleDateString("pt-BR");
const monthKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const monthName=d=>d.toLocaleDateString("pt-BR",{month:"long",year:"numeric"}).replace(/^./,x=>x.toUpperCase());

function openDB(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains("transactions")){const s=d.createObjectStore("transactions",{keyPath:"id",autoIncrement:true});s.createIndex("date","date")}if(!d.objectStoreNames.contains("cards"))d.createObjectStore("cards",{keyPath:"id",autoIncrement:true})};
    r.onsuccess=e=>{db=e.target.result;resolve(db)};r.onerror=()=>reject(r.error);
  });
}
const store=(name,mode="readonly")=>db.transaction(name,mode).objectStore(name);
const getAll=name=>new Promise((res,rej)=>{const r=store(name).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
const add=(name,obj)=>new Promise((res,rej)=>{const r=store(name,"readwrite").add(obj);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
const remove=(name,id)=>new Promise((res,rej)=>{const r=store(name,"readwrite").delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)});

function setupNav(){
 document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>showView(b.dataset.view));
 document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>showView(b.dataset.go));
 document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>b.closest("dialog").close());
}
function showView(id){
 document.querySelectorAll(".view").forEach(v=>v.classList.remove("active-view"));
 $(id).classList.add("active-view");
 document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
 $("pageTitle").textContent={dashboard:"Dashboard",lancamentos:"Lançamentos",cartoes:"Cartões",backup:"Backup"}[id];
 if(id==="dashboard")renderDashboard(); if(id==="lancamentos")renderTransactions(); if(id==="cartoes")renderCards();
}
function setupForms(){
 $("newExpense").onclick=()=>openTransaction("expense");
 $("newIncome").onclick=()=>openTransaction("income");
 $("newCard").onclick=()=>$("cardDialog").showModal();
 $("transactionForm").onsubmit=async e=>{e.preventDefault();await add("transactions",{type:$("transactionType").value,date:$("tDate").value,category:$("tCategory").value,description:$("tDescription").value.trim(),amount:Number($("tAmount").value)});$("transactionDialog").close();e.target.reset();await refresh()};
 $("cardForm").onsubmit=async e=>{e.preventDefault();await add("cards",{name:$("cName").value.trim(),limit:Number($("cLimit").value),closing:Number($("cClosing").value),due:Number($("cDue").value)});$("cardDialog").close();e.target.reset();await renderCards()};
 $("typeFilter").onchange=renderTransactions;
 $("exportBackup").onclick=exportBackup;
 $("importBackup").onchange=importBackup;
 $("prevMonth").onclick=()=>{currentDate.setMonth(currentDate.getMonth()-1);refresh()};
 $("nextMonth").onclick=()=>{currentDate.setMonth(currentDate.getMonth()+1);refresh()};
}
function openTransaction(type){
 $("transactionType").value=type;$("transactionTitle").textContent=type==="expense"?"Nova despesa":"Nova receita";
 $("tDate").value=new Date().toISOString().slice(0,10);
 $("tCategory").innerHTML=(type==="expense"?CATEGORIES:INCOME_CATEGORIES).map(x=>`<option>${x}</option>`).join("");
 $("transactionDialog").showModal();
}
async function refresh(){ $("currentMonth").textContent=monthName(currentDate);await renderDashboard();await renderTransactions();await renderCards() }
async function renderDashboard(){
 const all=await getAll("transactions"), key=monthKey(currentDate), tx=all.filter(x=>x.date.startsWith(key));
 const income=tx.filter(x=>x.type==="income").reduce((a,x)=>a+x.amount,0), expense=tx.filter(x=>x.type==="expense").reduce((a,x)=>a+x.amount,0);
 $("mReceitas").textContent=money(income);$("mDespesas").textContent=money(expense);$("mSaldo").textContent=money(income-expense);$("mLancamentos").textContent=tx.length;
 const byCat={};tx.filter(x=>x.type==="expense").forEach(x=>byCat[x.category]=(byCat[x.category]||0)+x.amount);
 cashflowChart?.destroy();categoryChart?.destroy();
 cashflowChart=new Chart($("cashflowChart"),{type:"bar",data:{labels:["Receitas","Despesas"],datasets:[{data:[income,expense]}]},options:{plugins:{legend:{display:false}},responsive:true,maintainAspectRatio:false}});
 categoryChart=new Chart($("categoryChart"),{type:"doughnut",data:{labels:Object.keys(byCat).length?Object.keys(byCat):["Sem despesas"],datasets:[{data:Object.values(byCat).length?Object.values(byCat):[1]}]},options:{plugins:{legend:{position:"bottom"}},responsive:true}});
 const recent=[...tx].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6);
 $("recentList").innerHTML=recent.length?recent.map(x=>`<div class="list-row"><span class="muted">${dateBR(x.date)}</span><span>${x.description||x.category}</span><strong class="${x.type}">${x.type==="income"?"+":"−"} ${money(x.amount)}</strong></div>`).join(""):`<div class="muted">Nenhum lançamento neste mês.</div>`;
}
async function renderTransactions(){
 const all=await getAll("transactions"), key=monthKey(currentDate), filter=$("typeFilter").value;
 let tx=all.filter(x=>x.date.startsWith(key)&&(filter==="all"||x.type===filter)).sort((a,b)=>b.date.localeCompare(a.date));
 $("transactionsTable").innerHTML=tx.length?tx.map(x=>`<tr><td>${dateBR(x.date)}</td><td><span class="tag">${x.type==="income"?"Receita":"Despesa"}</span></td><td>${x.category}</td><td>${x.description||"—"}</td><td class="${x.type}">${x.type==="income"?"+":"−"} ${money(x.amount)}</td><td><button class="delete" data-delete="${x.id}">Excluir</button></td></tr>`).join(""):`<tr><td colspan="6" class="muted">Nenhum lançamento.</td></tr>`;
 document.querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{if(confirm("Excluir este lançamento?")){await remove("transactions",Number(b.dataset.delete));await refresh()}});
}
async function renderCards(){
 const cards=await getAll("cards");
 $("cardsList").innerHTML=cards.length?cards.map(c=>`<div class="credit-card"><h3>${c.name}</h3><p><span>Limite</span><strong>${money(c.limit)}</strong></p><p><span>Fechamento</span><strong>dia ${c.closing}</strong></p><p><span>Vencimento</span><strong>dia ${c.due}</strong></p><p><span>Compras</span><strong>—</strong></p><p><span>Parcelas</span><strong>—</strong></p><button class="delete" data-card-delete="${c.id}">Excluir cartão</button></div>`).join(""):`<div class="muted">Nenhum cartão cadastrado.</div>`;
 document.querySelectorAll("[data-card-delete]").forEach(b=>b.onclick=async()=>{if(confirm("Excluir este cartão?")){await remove("cards",Number(b.dataset.cardDelete));await renderCards()}});
}
async function exportBackup(){
 const data={version:1,exportedAt:new Date().toISOString(),transactions:await getAll("transactions"),cards:await getAll("cards")};
 const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}), a=document.createElement("a");
 a.href=URL.createObjectURL(blob);a.download=`financeiro-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);
}
function importBackup(e){
 const file=e.target.files[0];if(!file)return;
 const r=new FileReader();r.onload=async()=>{try{const d=JSON.parse(r.result);if(!Array.isArray(d.transactions)||!Array.isArray(d.cards))throw Error();
   const tx=store("transactions","readwrite"), cards=store("cards","readwrite");
   (await getAll("transactions")).forEach(x=>tx.delete(x.id));(await getAll("cards")).forEach(x=>cards.delete(x.id));
   d.transactions.forEach(x=>{delete x.id;tx.add(x)});d.cards.forEach(x=>{delete x.id;cards.add(x)});
   tx.transaction.oncomplete=async()=>{alert("Backup restaurado com sucesso.");await refresh()};
 }catch(err){alert("Arquivo de backup inválido.")}};r.readAsText(file);e.target.value="";
}
(async()=>{setupNav();setupForms();await openDB();await refresh()})();