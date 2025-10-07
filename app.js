// Registro Live Mystery Product - gestione logica applicativa
(function () {
  const DB_NAME = 'mystery-product-db';
  const DB_VERSION = 1;
  const STORES = { CLIENTS: 'clients', PURCHASES: 'purchases' };
  const PRICE_SHORTCUTS = {
    'Digit1': 3,
    'Digit2': 5,
    'Digit3': 7,
    'Digit4': 10,
    'Digit5': 12,
    'Digit6': 15,
    'Digit7': 20,
    'Digit8': 25,
    'Digit9': 30,
    'Digit0': 35,
    'Equal': 40,
    'Numpad1': 3,
    'Numpad2': 5,
    'Numpad3': 7,
    'Numpad4': 10,
    'Numpad5': 12,
    'Numpad6': 15,
    'Numpad7': 20,
    'Numpad8': 25,
    'Numpad9': 30,
    'Numpad0': 35
  };

  let db;
  let clientsCache = [];
  let selectedClientId = null;
  let currentFilter = 'tutti';
  let currentPrice = null;
  let currentState = 'acquistato';
  let searchResults = [];
  let keyboardIndex = -1;
  let lastAddedPurchase = null;
  let undoTimer = null;
  let editingPurchaseId = null;
  let suggestionResults = [];

  const dom = {};

  document.addEventListener('DOMContentLoaded', init);

  // Inizializza il database, la UI e popola i dati demo
  async function init() {
    mapDom();
    attachListeners();
    dom.productName.addEventListener('input', updateAddButtonState);
    db = await openDatabase();
    await ensureDemoData();
    await loadClients();
    renderClientList(clientsCache);
    clearSearchSuggestions();
    updateStats();
    updateAddButtonState();
  }

  // Collega gli elementi del DOM a un dizionario per uso rapido
  function mapDom() {
    dom.clientSearch = document.getElementById('clientSearch');
    dom.clientList = document.getElementById('clientList');
    dom.searchSuggestions = document.getElementById('searchSuggestions');
    dom.newClient = document.getElementById('newClient');
    dom.selectedClientName = document.getElementById('selectedClientName');
    dom.selectedClientNotes = document.getElementById('selectedClientNotes');
    dom.clientTotal = document.getElementById('clientTotal');
    dom.productName = document.getElementById('productName');
    dom.customPrice = document.getElementById('customPrice');
    dom.quickPrices = document.querySelectorAll('.quick-prices button');
    dom.stateToggle = document.querySelectorAll('.state-toggle button');
    dom.purchaseForm = document.getElementById('purchaseForm');
    dom.addPurchase = document.getElementById('addPurchase');
    dom.historyBody = document.getElementById('historyBody');
    dom.tabs = document.querySelectorAll('.tabs button');
    dom.undoLast = document.getElementById('undoLast');
    dom.toastContainer = document.getElementById('toastContainer');
    dom.themeToggle = document.getElementById('themeToggle');
    dom.exportText = document.getElementById('exportText');
    dom.exportJson = document.getElementById('exportJson');
    dom.importJsonInput = document.getElementById('importJsonInput');
    dom.resetDb = document.getElementById('resetDb');
    dom.statClients = document.getElementById('statClients');
    dom.statPurchases = document.getElementById('statPurchases');
    dom.statTotal = document.getElementById('statTotal');
    dom.modal = document.getElementById('modal');
    dom.modalForm = document.getElementById('modalForm');
    dom.modalCancel = document.getElementById('modalCancel');
    dom.modalSave = document.getElementById('modalSave');
    dom.modalNome = document.getElementById('modalNome');
    dom.modalCognome = document.getElementById('modalCognome');
    dom.modalNote = document.getElementById('modalNote');
    dom.purchaseModal = document.getElementById('purchaseModal');
    dom.purchaseModalForm = document.getElementById('purchaseModalForm');
    dom.purchaseModalCancel = document.getElementById('purchaseModalCancel');
    dom.purchaseModalProduct = document.getElementById('purchaseModalProduct');
    dom.purchaseModalPrice = document.getElementById('purchaseModalPrice');
    dom.purchaseModalState = document.getElementById('purchaseModalState');
    dom.purchaseModalSave = document.getElementById('purchaseModalSave');
  }

  // Gestisce tutti gli ascoltatori di eventi
  function attachListeners() {
    dom.clientSearch.addEventListener('input', debounce(handleSearch, 150));
    dom.clientSearch.addEventListener('keydown', handleSearchKeys);
    dom.clientSearch.addEventListener('blur', () => setTimeout(() => clearSearchSuggestions(), 120));
    dom.newClient.addEventListener('click', () => openClientModal());
    dom.clientList.addEventListener('click', handleClientClick);

    dom.quickPrices.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.customPrice.value = '';
        setActivePrice(Number(btn.dataset.price));
      });
    });

    dom.customPrice.addEventListener('input', () => {
      if (!dom.customPrice.value) {
        currentPrice = null;
      } else {
        currentPrice = parsePrice(dom.customPrice.value);
      }
      clearActiveQuickPrice();
      updateAddButtonState();
    });

    dom.stateToggle.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.stateToggle.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        currentState = btn.dataset.state;
      });
    });

    dom.purchaseForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await handleAddPurchase();
    });

    dom.tabs.forEach(tab => tab.addEventListener('click', async () => {
      dom.tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      await renderHistory();
    }));

    dom.undoLast.addEventListener('click', undoLastInsert);
    dom.themeToggle.addEventListener('click', toggleTheme);
    dom.exportText.addEventListener('click', exportText);
    dom.exportJson.addEventListener('click', exportJson);
    dom.importJsonInput.addEventListener('change', importJson);
    dom.resetDb.addEventListener('click', resetDatabase);

    dom.modalCancel.addEventListener('click', closeModal);
    dom.modalForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveClientFromModal();
    });

    dom.purchaseModalCancel.addEventListener('click', closePurchaseModal);
    dom.purchaseModal.addEventListener('mousedown', (event) => {
      if (event.target === dom.purchaseModal) closePurchaseModal();
    });
    dom.modal.addEventListener('mousedown', (event) => {
      if (event.target === dom.modal) closeModal();
    });
    dom.purchaseModalForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await savePurchaseFromModal();
    });

    document.addEventListener('keydown', handleGlobalShortcuts);
  }

  // Inizializza IndexedDB creando gli store necessari
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const dbInstance = event.target.result;
        if (!dbInstance.objectStoreNames.contains(STORES.CLIENTS)) {
          const clientStore = dbInstance.createObjectStore(STORES.CLIENTS, { keyPath: 'id' });
          clientStore.createIndex('byName', 'nome');
          clientStore.createIndex('bySurname', 'cognome');
          clientStore.createIndex('bySearch', 'search');
        }
        if (!dbInstance.objectStoreNames.contains(STORES.PURCHASES)) {
          const purchaseStore = dbInstance.createObjectStore(STORES.PURCHASES, { keyPath: 'id' });
          purchaseStore.createIndex('byClient', 'clientId');
          purchaseStore.createIndex('byTimestamp', 'timestamp');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Assicura la presenza di dati demo al primo avvio
  async function ensureDemoData() {
    const tx = db.transaction(STORES.CLIENTS, 'readonly');
    const store = tx.objectStore(STORES.CLIENTS);
    const count = await requestToPromise(store.count());
    if (count > 0) return;

    const demoClients = [
      { id: crypto.randomUUID(), nome: 'Giulia', cognome: 'Moretti', note: 'Preferisce prodotti skincare', search: normalizeSearch('Giulia', 'Moretti') },
      { id: crypto.randomUUID(), nome: 'Luca', cognome: 'Bianchi', note: 'Pagamenti in contanti', search: normalizeSearch('Luca', 'Bianchi') }
    ];

    const now = Date.now();
    const demoPurchases = [
      { id: crypto.randomUUID(), clientId: demoClients[0].id, prodotto: 'Siero illuminante', prezzo: 25, stato: 'acquistato', timestamp: new Date(now - 3600_000).toISOString() },
      { id: crypto.randomUUID(), clientId: demoClients[0].id, prodotto: 'Maschera notte', prezzo: 15, stato: 'aggiunto', timestamp: new Date(now - 1800_000).toISOString() },
      { id: crypto.randomUUID(), clientId: demoClients[1].id, prodotto: 'Crema nutriente', prezzo: 20, stato: 'acquistato', timestamp: new Date(now - 5400_000).toISOString() },
      { id: crypto.randomUUID(), clientId: demoClients[1].id, prodotto: 'Mystery deluxe', prezzo: 35, stato: 'acquistato', timestamp: new Date(now - 900_000).toISOString() }
    ];

    const writeTx = db.transaction([STORES.CLIENTS, STORES.PURCHASES], 'readwrite');
    const clientStore = writeTx.objectStore(STORES.CLIENTS);
    const purchaseStore = writeTx.objectStore(STORES.PURCHASES);
    for (const client of demoClients) {
      clientStore.add(client);
    }
    for (const purchase of demoPurchases) {
      purchaseStore.add(purchase);
    }
    await transactionComplete(writeTx);
  }

  // Carica tutti i clienti in cache
  async function loadClients() {
    const tx = db.transaction(STORES.CLIENTS, 'readonly');
    const store = tx.objectStore(STORES.CLIENTS);
    clientsCache = await requestToPromise(store.getAll());
    clientsCache.sort((a, b) => a.cognome.localeCompare(b.cognome, 'it', { sensitivity: 'base' }));
  }

  // Renderizza la lista clienti nel pannello sinistro
  function renderClientList(list) {
    dom.clientList.innerHTML = '';
    searchResults = list;
    keyboardIndex = -1;
    for (const client of list) {
      const li = document.createElement('li');
      li.dataset.id = client.id;
      li.tabIndex = 0;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = `${client.cognome} ${client.nome}`;
      li.appendChild(name);
      if (client.note) {
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = client.note;
        li.appendChild(note);
      }
      if (client.id === selectedClientId) {
        li.classList.add('selected');
      }
      dom.clientList.appendChild(li);
    }
  }

  function handleClientClick(event) {
    const li = event.target.closest('li');
    if (!li) return;
    selectClient(li.dataset.id);
    clearSearchSuggestions();
  }

  function renderSearchSuggestions(list, term) {
    if (!term || term.length < 2 || !list.length) {
      clearSearchSuggestions();
      return;
    }
    dom.searchSuggestions.innerHTML = '';
    const slice = list.slice(0, 6);
    suggestionResults = slice;
    dom.searchSuggestions.scrollTop = 0;
    keyboardIndex = -1;
    for (const client of slice) {
      const li = document.createElement('li');
      li.dataset.id = client.id;
      li.innerHTML = formatSuggestionLabel(client, term);
      li.tabIndex = -1;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.addEventListener('mousedown', async (event) => {
        event.preventDefault();
        dom.clientSearch.value = '';
        renderClientList(filterClients(''));
        await selectClient(client.id);
      });
      dom.searchSuggestions.appendChild(li);
    }
    dom.searchSuggestions.hidden = false;
    dom.clientSearch.setAttribute('aria-expanded', 'true');
  }

  function formatSuggestionLabel(client, term) {
    const fullName = `${client.nome} ${client.cognome}`;
    const reversed = `${client.cognome} ${client.nome}`;
    const target = fullName.toLowerCase().includes(term) ? fullName : reversed;
    const highlighted = highlightTerm(target, term);
    const details = client.note ? `<small>${escapeHtml(client.note)}</small>` : '';
    return `<strong>${highlighted}</strong>${details}`;
  }

  function highlightTerm(text, term) {
    const tokens = term.split(/\s+/).filter(Boolean);
    let html = escapeHtml(text);
    for (const token of tokens) {
      const regex = new RegExp(escapeRegex(token), 'ig');
      html = html.replace(regex, match => `<mark>${match}</mark>`);
    }
    return html;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return str.replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char] || char));
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function clearSearchSuggestions() {
    dom.searchSuggestions.hidden = true;
    dom.searchSuggestions.innerHTML = '';
    keyboardIndex = -1;
    suggestionResults = [];
    dom.clientSearch.setAttribute('aria-expanded', 'false');
  }

  function filterClients(term) {
    if (!term) {
      return clientsCache.slice();
    }
    const tokens = term.split(/\s+/).filter(Boolean);
    const matches = clientsCache.filter(client => {
      const normalized = `${client.nome} ${client.cognome}`.toLowerCase();
      const reversed = `${client.cognome} ${client.nome}`.toLowerCase();
      return tokens.every(tok => normalized.includes(tok) || reversed.includes(tok));
    });
    const priority = tokens[0] || term;
    matches.sort((a, b) => {
      const diff = scoreClient(a, priority) - scoreClient(b, priority);
      if (diff !== 0) return diff;
      return a.cognome.localeCompare(b.cognome, 'it', { sensitivity: 'base' });
    });
    return matches;
  }

  function scoreClient(client, term) {
    const normalized = `${client.nome} ${client.cognome}`.toLowerCase();
    const reversed = `${client.cognome} ${client.nome}`.toLowerCase();
    const directIndex = normalized.indexOf(term);
    const reverseIndex = reversed.indexOf(term);
    const directScore = directIndex >= 0 ? directIndex : Number.MAX_SAFE_INTEGER;
    const reverseScore = reverseIndex >= 0 ? reverseIndex + 0.1 : Number.MAX_SAFE_INTEGER;
    return Math.min(directScore, reverseScore);
  }

  // Seleziona un cliente e carica il relativo storico
  async function selectClient(id) {
    selectedClientId = id;
    updateClientSelectionUI();
    await renderHistory();
    dom.productName.focus();
    updateAddButtonState();
    clearSearchSuggestions();
  }

  function updateClientSelectionUI() {
    dom.clientList.querySelectorAll('li').forEach(li => {
      li.classList.toggle('selected', li.dataset.id === selectedClientId);
      li.classList.remove('keyboard-focus');
    });
    const client = clientsCache.find(c => c.id === selectedClientId);
    if (client) {
      dom.selectedClientName.textContent = `${client.cognome} ${client.nome}`;
      dom.selectedClientNotes.textContent = client.note || '';
    } else {
      dom.selectedClientName.textContent = 'Seleziona un cliente';
      dom.selectedClientNotes.textContent = '';
      dom.clientTotal.textContent = formatCurrency(0);
    }
  }

  // Recupera e mostra lo storico acquisti del cliente selezionato
  async function renderHistory() {
    dom.historyBody.innerHTML = '';
    if (!selectedClientId) {
      dom.clientTotal.textContent = formatCurrency(0);
      return;
    }
    const purchases = await getPurchasesForClient(selectedClientId);
    const filtered = purchases.filter(p => {
      if (currentFilter === 'tutti') return true;
      return p.stato === currentFilter;
    });
    for (const purchase of filtered) {
      const tr = document.createElement('tr');

      const timeCell = document.createElement('td');
      timeCell.textContent = formatTime(purchase.timestamp);
      tr.appendChild(timeCell);

      const productCell = document.createElement('td');
      productCell.textContent = purchase.prodotto;
      tr.appendChild(productCell);

      const priceCell = document.createElement('td');
      priceCell.textContent = formatCurrency(purchase.prezzo);
      tr.appendChild(priceCell);

      const statusCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `badge ${purchase.stato}`;
      badge.textContent = capitalize(purchase.stato);
      statusCell.appendChild(badge);
      tr.appendChild(statusCell);

      const actionsCell = document.createElement('td');
      actionsCell.className = 'actions';
      actionsCell.appendChild(createActionButton('✏️', 'edit', purchase.id));
      actionsCell.appendChild(createActionButton('🔁', 'toggle', purchase.id));
      actionsCell.appendChild(createActionButton('🗑️', 'delete', purchase.id));
      tr.appendChild(actionsCell);

      dom.historyBody.appendChild(tr);
    }
    const total = purchases.filter(p => p.stato === 'acquistato')
      .reduce((sum, p) => sum + Number(p.prezzo), 0);
    dom.clientTotal.textContent = formatCurrency(total);
  }

  function handleHistoryAction(event) {
    const action = event.currentTarget.dataset.action;
    const id = event.currentTarget.dataset.id;
    if (action === 'edit') editPurchase(id);
    if (action === 'toggle') togglePurchaseState(id);
    if (action === 'delete') deletePurchase(id);
  }

  // Crea un pulsante per la tabella storico con azione associata
  function createActionButton(label, action, id) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.action = action;
    btn.dataset.id = id;
    btn.addEventListener('click', handleHistoryAction);
    return btn;
  }

  // Recupera acquisti per cliente da IndexedDB
  async function getPurchasesForClient(clientId) {
    const tx = db.transaction(STORES.PURCHASES, 'readonly');
    const store = tx.objectStore(STORES.PURCHASES);
    const index = store.index('byClient');
    const request = index.getAll(IDBKeyRange.only(clientId));
    const purchases = await requestToPromise(request);
    purchases.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return purchases;
  }

  async function handleAddPurchase() {
    if (!selectedClientId) {
      showToast('Seleziona un cliente', 'error');
      return;
    }
    const product = dom.productName.value.trim();
    if (!product) {
      showToast('Inserisci il nome prodotto', 'error');
      return;
    }
    if (currentPrice === null || Number.isNaN(currentPrice)) {
      showToast('Seleziona o inserisci un prezzo valido', 'error');
      return;
    }
    const purchase = {
      id: crypto.randomUUID(),
      clientId: selectedClientId,
      prodotto: product,
      prezzo: Number(currentPrice),
      stato: currentState,
      timestamp: new Date().toISOString()
    };
    await addPurchase(purchase);
    dom.productName.value = '';
    const activeQuick = Array.from(dom.quickPrices).find(btn => btn.classList.contains('active'));
    if (activeQuick) {
      currentPrice = Number(activeQuick.dataset.price);
    } else {
      currentPrice = null;
      dom.customPrice.value = '';
    }
    dom.productName.focus();
    showToast('Riga aggiunta — Annulla?', 'success', undoLastInsert);
    lastAddedPurchase = purchase;
    dom.undoLast.disabled = false;
    scheduleUndoTimeout();
    await renderHistory();
    updateStats();
    updateAddButtonState();
  }

  // Scrive una riga acquisto nel DB
  async function addPurchase(purchase) {
    const tx = db.transaction(STORES.PURCHASES, 'readwrite');
    tx.objectStore(STORES.PURCHASES).add(purchase);
    await transactionComplete(tx);
  }

  async function editPurchase(id) {
    const purchase = await getPurchase(id);
    if (!purchase) return;
    dom.purchaseModalProduct.value = purchase.prodotto;
    dom.purchaseModalPrice.value = purchase.prezzo;
    dom.purchaseModalState.value = purchase.stato;
    editingPurchaseId = id;
    openPurchaseModal();
  }

  async function togglePurchaseState(id) {
    const purchase = await getPurchase(id);
    if (!purchase) return;
    purchase.stato = purchase.stato === 'acquistato' ? 'aggiunto' : 'acquistato';
    await updatePurchase(purchase);
    showToast(`Stato impostato su ${purchase.stato}`, 'success');
    await renderHistory();
    updateStats();
  }

  async function deletePurchase(id) {
    const firstConfirm = confirm('Vuoi eliminare questa riga?');
    if (!firstConfirm) return;
    const secondConfirm = confirm('Confermi l\'eliminazione definitiva?');
    if (!secondConfirm) return;
    const tx = db.transaction(STORES.PURCHASES, 'readwrite');
    tx.objectStore(STORES.PURCHASES).delete(id);
    await transactionComplete(tx);
    showToast('Riga eliminata', 'success');
    await renderHistory();
    updateStats();
  }

  async function getPurchase(id) {
    const tx = db.transaction(STORES.PURCHASES, 'readonly');
    const store = tx.objectStore(STORES.PURCHASES);
    const request = store.get(id);
    return await requestToPromise(request);
  }

  async function updatePurchase(purchase) {
    const tx = db.transaction(STORES.PURCHASES, 'readwrite');
    tx.objectStore(STORES.PURCHASES).put(purchase);
    await transactionComplete(tx);
  }

  async function savePurchaseFromModal() {
    if (!editingPurchaseId) return;
    const purchase = await getPurchase(editingPurchaseId);
    if (!purchase) return;
    purchase.prodotto = dom.purchaseModalProduct.value.trim();
    const priceValue = parsePrice(dom.purchaseModalPrice.value);
    purchase.prezzo = priceValue;
    purchase.stato = dom.purchaseModalState.value;
    if (!purchase.prodotto || Number.isNaN(priceValue)) {
      showToast('Compila tutti i campi', 'error');
      return;
    }
    await updatePurchase(purchase);
    closePurchaseModal();
    showToast('Riga aggiornata', 'success');
    await renderHistory();
    updateStats();
  }

  function openPurchaseModal() {
    dom.purchaseModal.hidden = false;
    dom.purchaseModal.classList.add('visible');
    dom.purchaseModalProduct.focus();
  }

  function closePurchaseModal() {
    dom.purchaseModal.hidden = true;
    dom.purchaseModal.classList.remove('visible');
    editingPurchaseId = null;
  }

  async function handleSearch(event) {
    const term = event.target.value.trim().toLowerCase();
    const filtered = filterClients(term);
    renderClientList(filtered);
    renderSearchSuggestions(filtered, term);
  }

  function handleSearchKeys(event) {
    if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      event.preventDefault();
    }
    const activeResults = suggestionResults.length ? suggestionResults : searchResults;
    if (event.key === 'ArrowDown') {
      if (!activeResults.length) return;
      keyboardIndex = (keyboardIndex + 1) % activeResults.length;
      updateKeyboardFocus();
    }
    if (event.key === 'ArrowUp') {
      if (!activeResults.length) return;
      keyboardIndex = (keyboardIndex - 1 + activeResults.length) % activeResults.length;
      updateKeyboardFocus();
    }
    if (event.key === 'Enter') {
      if (!activeResults.length) return;
      const targetIndex = keyboardIndex >= 0 ? keyboardIndex : 0;
      const target = activeResults[targetIndex];
      if (target) {
        selectClient(target.id);
        dom.clientSearch.select();
        clearSearchSuggestions();
      }
    }
  }

  function updateKeyboardFocus() {
    const suggestionItems = Array.from(dom.searchSuggestions.querySelectorAll('li'));
    const targetItems = suggestionItems.length ? suggestionItems : Array.from(dom.clientList.querySelectorAll('li'));
    dom.clientList.querySelectorAll('li').forEach(li => li.classList.remove('keyboard-focus'));
    suggestionItems.forEach((li, index) => {
      const active = index === keyboardIndex;
      li.classList.toggle('keyboard-focus', active);
      li.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (!suggestionItems.length) {
      targetItems.forEach((li, index) => li.classList.toggle('keyboard-focus', index === keyboardIndex));
    }
  }

  function setActivePrice(price) {
    currentPrice = price;
    if (price !== null) {
      dom.customPrice.value = '';
    }
    dom.quickPrices.forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.price) === price);
    });
    updateAddButtonState();
  }

  function clearActiveQuickPrice() {
    dom.quickPrices.forEach(btn => btn.classList.remove('active'));
  }

  function updateAddButtonState() {
    const productFilled = Boolean(dom.productName.value.trim());
    const priceValid = currentPrice !== null && !Number.isNaN(currentPrice);
    const hasClient = Boolean(selectedClientId);
    const enabled = productFilled && priceValid && hasClient;
    dom.addPurchase.disabled = !enabled;
    let title = '';
    if (!hasClient) title = 'Seleziona un cliente';
    else if (!productFilled) title = 'Inserisci il nome prodotto';
    else if (!priceValid) title = 'Scegli un prezzo';
    dom.addPurchase.title = title;
  }

  function debounce(fn, delay) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
  }

  function parsePrice(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return Number(value);
    const normalized = value.replace(/\s/g, '').replace(',', '.');
    return Number(normalized);
  }

  function formatTime(iso) {
    const date = new Date(iso);
    return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function normalizeSearch(nome, cognome) {
    return `${nome} ${cognome}`.toLowerCase();
  }

  function updateStats() {
    dom.statClients.textContent = clientsCache.length;
    countPurchases().then(({ rows, total }) => {
      dom.statPurchases.textContent = rows;
      dom.statTotal.textContent = formatCurrency(total);
    });
  }

  async function countPurchases() {
    const tx = db.transaction(STORES.PURCHASES, 'readonly');
    const store = tx.objectStore(STORES.PURCHASES);
    const purchases = await requestToPromise(store.getAll());
    const total = purchases.filter(p => p.stato === 'acquistato')
      .reduce((sum, p) => sum + Number(p.prezzo), 0);
    return { rows: purchases.length, total };
  }

  async function handleGlobalShortcuts(event) {
    if (event.key === 'Escape') {
      if (!dom.purchaseModal.hidden) {
        event.preventDefault();
        closePurchaseModal();
        return;
      }
      if (!dom.modal.hidden) {
        event.preventDefault();
        closeModal();
        return;
      }
      if (!dom.searchSuggestions.hidden) {
        clearSearchSuggestions();
        return;
      }
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      dom.clientSearch.focus();
      dom.clientSearch.select();
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      openClientModal();
    }
    if (document.body.contains(dom.modal) && !dom.modal.hidden) {
      return; // evita scorciatoie quando il modal cliente è aperto
    }
    if (!dom.purchaseModal.hidden) {
      return;
    }
    if (event.key === 'Enter' && document.activeElement === dom.productName && !dom.addPurchase.disabled) {
      event.preventDefault();
      dom.purchaseForm.requestSubmit();
    }
    if (PRICE_SHORTCUTS[event.code] !== undefined) {
      const tag = event.target.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && event.target !== dom.productName) {
        return;
      }
      event.preventDefault();
      setActivePrice(PRICE_SHORTCUTS[event.code]);
    }
  }

  async function openClientModal() {
    dom.modal.hidden = false;
    dom.modal.dataset.mode = 'new';
    dom.modalNome.value = '';
    dom.modalCognome.value = '';
    dom.modalNote.value = '';
    dom.modalNome.focus();
  }

  function closeModal() {
    dom.modal.hidden = true;
  }

  async function saveClientFromModal() {
    const nome = dom.modalNome.value.trim();
    const cognome = dom.modalCognome.value.trim();
    const note = dom.modalNote.value.trim();
    if (!nome || !cognome) {
      showToast('Nome e cognome sono obbligatori', 'error');
      return;
    }
    const client = {
      id: crypto.randomUUID(),
      nome,
      cognome,
      note,
      search: normalizeSearch(nome, cognome)
    };
    const tx = db.transaction(STORES.CLIENTS, 'readwrite');
    tx.objectStore(STORES.CLIENTS).add(client);
    await transactionComplete(tx);
    closeModal();
    clientsCache.push(client);
    clientsCache.sort((a, b) => a.cognome.localeCompare(b.cognome, 'it', { sensitivity: 'base' }));
    renderClientList(clientsCache);
    clearSearchSuggestions();
    showToast('Cliente creato', 'success');
    updateStats();
  }

  function showToast(message, type = 'success', undoHandler) {
    while (dom.toastContainer.children.length >= 3) {
      dom.toastContainer.removeChild(dom.toastContainer.firstChild);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    if (undoHandler) {
      const btn = document.createElement('button');
      btn.textContent = 'Annulla';
      btn.addEventListener('click', () => {
        undoHandler();
        dom.toastContainer.removeChild(toast);
      });
      toast.appendChild(btn);
    }
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('visible');
    }, 10);
    setTimeout(() => {
      toast.remove();
    }, 5000);
  }

  function scheduleUndoTimeout() {
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
      lastAddedPurchase = null;
      dom.undoLast.disabled = true;
      undoTimer = null;
    }, 5000);
  }

  async function undoLastInsert() {
    if (!lastAddedPurchase) return;
    clearTimeout(undoTimer);
    undoTimer = null;
    const tx = db.transaction(STORES.PURCHASES, 'readwrite');
    tx.objectStore(STORES.PURCHASES).delete(lastAddedPurchase.id);
    await transactionComplete(tx);
    showToast('Ultimo inserimento annullato', 'success');
    lastAddedPurchase = null;
    dom.undoLast.disabled = true;
    await renderHistory();
    updateStats();
  }

  function toggleTheme() {
    const app = document.querySelector('.app');
    const next = app.dataset.theme === 'light' ? 'dark' : 'light';
    app.dataset.theme = next;
  }

  async function exportText() {
    const allData = await getDataGroupedByClient();
    if (!allData.length) {
      showToast('Nessun dato da esportare', 'error');
      return;
    }

    const now = new Date();
    const lines = [];
    lines.push('Registro Live Mystery Product');
    lines.push(`Ordini Live – ${now.toLocaleString('it-IT')}`);
    lines.push('');

    let overallTotal = 0;

    for (const group of allData) {
      const { client, purchases } = group;
      lines.push(`${client.cognome} ${client.nome}`.trim());
      if (client.note) {
        lines.push(`Note: ${client.note}`);
      }

      for (const purchase of purchases) {
        const status = capitalize(purchase.stato);
        const price = formatCurrency(purchase.prezzo);
        const time = formatTime(purchase.timestamp);
        lines.push(`  - [${time}] ${purchase.prodotto} • ${price} • ${status}`);
      }

      const totalClient = purchases
        .filter(p => p.stato === 'acquistato')
        .reduce((sum, p) => sum + Number(p.prezzo), 0);
      overallTotal += totalClient;
      lines.push(`  Totale cliente (acquistato): ${formatCurrency(totalClient)}`);
      lines.push('');
    }

    lines.push(`Totale generale (acquistato): ${formatCurrency(overallTotal)}`);

    try {
      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ordini-live-${Date.now()}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('Documento di testo creato con successo', 'success');
    } catch (error) {
      console.error('Errore durante la creazione del documento di testo', error);
      showToast('Errore durante l\'export testo', 'error');
    }
  }

  async function getDataGroupedByClient() {
    const txClients = db.transaction(STORES.CLIENTS, 'readonly');
    const clients = await requestToPromise(txClients.objectStore(STORES.CLIENTS).getAll());
    const txPurchases = db.transaction(STORES.PURCHASES, 'readonly');
    const purchases = await requestToPromise(txPurchases.objectStore(STORES.PURCHASES).getAll());
    const map = new Map();
    for (const client of clients) {
      map.set(client.id, { client, purchases: [] });
    }
    for (const purchase of purchases) {
      if (!map.has(purchase.clientId)) continue;
      map.get(purchase.clientId).purchases.push(purchase);
    }
    const groups = Array.from(map.values()).filter(group => group.purchases.length > 0);
    groups.forEach(group => {
      group.purchases.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    });
    groups.sort((a, b) => {
      const surname = a.client.cognome.localeCompare(b.client.cognome, 'it', { sensitivity: 'base' });
      if (surname !== 0) return surname;
      return a.client.nome.localeCompare(b.client.nome, 'it', { sensitivity: 'base' });
    });
    return groups;
  }

  async function exportJson() {
    const clients = clientsCache;
    const tx = db.transaction(STORES.PURCHASES, 'readonly');
    const purchases = await requestToPromise(tx.objectStore(STORES.PURCHASES).getAll());
    const payload = JSON.stringify({ clients, purchases }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mystery-product-backup-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Export JSON completato', 'success');
  }

  async function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data.clients) || !Array.isArray(data.purchases)) {
        throw new Error('Formato non valido');
      }
      const confirmImport = confirm('Importare il backup selezionato? Questa operazione sovrascrive i dati.');
      if (!confirmImport) return;
      const tx = db.transaction([STORES.CLIENTS, STORES.PURCHASES], 'readwrite');
      const clientStore = tx.objectStore(STORES.CLIENTS);
      const purchaseStore = tx.objectStore(STORES.PURCHASES);
      clientStore.clear();
      purchaseStore.clear();
      for (const client of data.clients) {
        client.search = normalizeSearch(client.nome, client.cognome);
        clientStore.put(client);
      }
      for (const purchase of data.purchases) {
        purchaseStore.put(purchase);
      }
      await transactionComplete(tx);
      await loadClients();
      renderClientList(clientsCache);
      selectedClientId = null;
      lastAddedPurchase = null;
      dom.undoLast.disabled = true;
      clearTimeout(undoTimer);
      undoTimer = null;
      updateClientSelectionUI();
      await renderHistory();
      updateStats();
      updateAddButtonState();
      showToast('Import completato', 'success');
    } catch (error) {
      showToast('Import fallito: ' + error.message, 'error');
    } finally {
      event.target.value = '';
    }
  }

  async function resetDatabase() {
    const first = confirm('Vuoi davvero azzerare il database?');
    if (!first) return;
    const second = confirm('Confermi la cancellazione di tutti i dati?');
    if (!second) return;
    const tx = db.transaction([STORES.CLIENTS, STORES.PURCHASES], 'readwrite');
    tx.objectStore(STORES.CLIENTS).clear();
    tx.objectStore(STORES.PURCHASES).clear();
    await transactionComplete(tx);
    clientsCache = [];
    selectedClientId = null;
    lastAddedPurchase = null;
    dom.undoLast.disabled = true;
    clearTimeout(undoTimer);
    undoTimer = null;
    renderClientList([]);
    updateClientSelectionUI();
    await renderHistory();
    updateStats();
    updateAddButtonState();
    showToast('Database svuotato', 'success');
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionComplete(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
})();
