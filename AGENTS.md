# AGENTS.md — Diretrizes para IAs (Copilot, Claude, ChatGPT, Gemini)

## 📌 Visão Geral do Projeto
- **Nome:** Finanças Pessoais PWA
- **Objetivo:** Aplicativo de gestão financeira pessoal 100% offline-first, rodando diretamente no navegador (otimizado para Safari no iOS / iPhone).
- **Repositório oficial (Single Source of Truth):** `danielmboechat/financas-pessoais` no GitHub.

---

## 🏗️ Arquitetura e Estrutura de Arquivos

O projeto utiliza **JavaScript Nativo (Vanilla JS)** sem build tools ou frameworks (sem React, Vite ou Webpack).

### Arquivos Principais:
1. `index.html`: Shell da aplicação HTML5.
   - **Regra de Scripts:** Utiliza carregamento por **scripts clássicos** na ordem estrita de dependência:
     ```html
     <script src="validation.js?v=2.0"></script>
     <script src="db.js?v=2.0"></script>
     <script src="app.js?v=2.0"></script>
     ```
   - **Upload de Backup:** O campo de arquivo aceita extensões de texto e JSON:
     ```html
     <input type="file" id="importBackup" accept=".json,.txt,application/json,text/plain">
     ```

2. `validation.js`: Camada de validação e sanitização de dados.
   - Contém as categorias de despesas permitidas (incluindo `"Fatura Cartão"`).
   - Valida entradas de transações, cartões e payloads de backup (`validateBackupPayload`).
   - **Tolerância Legada:** Trata transações antigas no cartão sem `cardId` (associa automaticamente ao cartão existente ou deixa não atribuído, sem rejeitar a importação).

3. `db.js`: Gerenciador de armazenamento no navegador.
   - Interface simples com o **IndexedDB** (`DB_NAME = "financeiro_pessoal_v1"`).
   - Expõe métodos assíncronos: `openDB()`, `getAll(name)`, `add(name, obj)`, `remove(name, id)`.

4. `app.js`: Lógica principal da interface e fluxo de dados.
   - Executado dentro de escopo protegido por `DOMContentLoaded`.
   - **Sanitização XSS:** Todo texto vindo do usuário (descrições, categorias, nomes de cartão) passa por `escapeHTML()` antes de ser renderizado via `innerHTML`.
   - **Cálculo por Cartão:** Limite e totais da fatura são calculados individualmente por cartão (`c.id`), evitando soma global incorreta.
   - **Gestão de Backup:** Exportação e importação completa em formato JSON.

5. `sw.js`: Service Worker para suporte PWA offline.
   - Gerencia a versão de cache (ex: `financas-v2.0`).

---

## ⚠️ Regras Rígidas de Desenvolvimento para IAs

1. **Compatibilidade Mobile Safari:**
   - Não alterar o carregamento de scripts no `index.html` para `type="module"` sem testar bloqueios de CORS/módulos no iOS Safari.
   - Manipulação de datas deve utilizar a ISO `YYYY-MM-DD` com parser seguro `new Date("${value}T12:00:00")`.

2. **Segurança de Dados:**
   - Nunca inserir texto controlado pelo usuário diretamente no DOM sem tratar caracteres especiais (`&`, `<`, `>`, `"`, `'`).

3. **Validação de Backup:**
   - Todo backup restaurado deve preservar o histórico retroativo. Não exigir campos novos em esquemas v1 antigos.

4. **Colaboração Multi-IA:**
   - Qualquer refatoração deve ser comitada no GitHub antes de ser enviada para validação com outra IA.
