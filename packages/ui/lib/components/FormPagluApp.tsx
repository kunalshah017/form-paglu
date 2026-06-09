import { Header } from './Header';
import { HomeView } from './HomeView';
import { MemoryView } from './MemoryView';
import { SettingsView } from './SettingsView';
import { useState, useEffect, useCallback } from 'react';
import type { FC } from 'react';

const openMemoryDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('form-paglu-memory', 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains('facts')) {
        const store = database.createObjectStore('facts', { keyPath: 'id' });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('key', 'key', { unique: false });
        store.createIndex('source', 'source', { unique: false });
      }
      if (!database.objectStoreNames.contains('sources')) {
        database.createObjectStore('sources', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const getFactsAsText = async (): Promise<string> => {
  const database = await openMemoryDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('facts', 'readonly');
    const store = tx.objectStore('facts');
    const req = store.getAll();
    req.onsuccess = () => {
      const facts = req.result;
      if (facts.length === 0) {
        resolve('No user data stored yet.');
        database.close();
        return;
      }
      const grouped: Record<string, { key: string; value: string }[]> = {};
      for (const f of facts) {
        if (!grouped[f.category]) grouped[f.category] = [];
        grouped[f.category].push({ key: f.key, value: f.value });
      }
      let text = '';
      for (const [cat, items] of Object.entries(grouped)) {
        text += `[${cat}]\n`;
        for (const item of items) {
          text += `  ${item.key}: ${item.value}\n`;
        }
      }
      resolve(text.trim());
      database.close();
    };
    req.onerror = () => {
      reject(req.error);
      database.close();
    };
  });
};

const FormPagluApp: FC = () => {
  const [view, setView] = useState<'home' | 'settings' | 'memory'>('home');
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('nvidia');
  const [baseUrl, setBaseUrl] = useState('https://integrate.api.nvidia.com/v1');
  const [model, setModel] = useState('nvidia/llama-3.3-nemotron-super-49b-v1');
  const [factCount, setFactCount] = useState(0);

  const refreshFactCount = useCallback(() => {
    const request = indexedDB.open('form-paglu-memory');
    request.onsuccess = () => {
      const database = request.result;
      if (database.objectStoreNames.contains('facts')) {
        const tx = database.transaction('facts', 'readonly');
        const store = tx.objectStore('facts');
        const countReq = store.count();
        countReq.onsuccess = () => setFactCount(countReq.result);
      }
      database.close();
    };
  }, []);

  useEffect(() => {
    chrome.storage.local.get('fp-settings', result => {
      const settings = result['fp-settings'];
      if (settings) {
        setApiKey(settings.apiKey ? atob(settings.apiKey) : '');
        setProvider(settings.apiProvider || 'nvidia');
        setBaseUrl(settings.apiBaseUrl || 'https://integrate.api.nvidia.com/v1');
        setModel(settings.model || 'nvidia/llama-3.3-nemotron-super-49b-v1');
      }
    });
    refreshFactCount();
  }, [refreshFactCount]);

  const handleSaveSettings = (settings: { apiKey: string; provider: string; baseUrl: string; model: string }) => {
    const encoded = settings.apiKey ? btoa(settings.apiKey) : '';
    chrome.storage.local.set({
      'fp-settings': {
        apiKey: encoded,
        apiProvider: settings.provider,
        apiBaseUrl: settings.baseUrl,
        model: settings.model,
        uiMode: 'sidepanel',
      },
    });
    setApiKey(settings.apiKey);
    setProvider(settings.provider);
    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
  };

  const handleScan = async () => {
    if (!apiKey) throw new Error('Set your API key in settings first');

    const contentResp = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT' });
    if (contentResp.error) throw new Error(contentResp.error);

    const extractResp = await chrome.runtime.sendMessage({
      type: 'SCAN_PAGE',
      payload: { content: contentResp.content, url: contentResp.url, apiKey, baseUrl, model },
    });
    if (extractResp.error) throw new Error(extractResp.error);

    const { facts, source } = extractResp;
    if (facts.length > 0) {
      const database = await openMemoryDB();
      const tx = database.transaction('facts', 'readwrite');
      const store = tx.objectStore('facts');
      const now = Date.now();

      for (const fact of facts) {
        const index = store.index('key');
        await new Promise<void>((resolve, reject) => {
          const req = index.openCursor(IDBKeyRange.only(fact.key));
          let found = false;
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor && cursor.value.category === fact.category) {
              cursor.update({
                ...cursor.value,
                value: fact.value,
                confidence: fact.confidence,
                source,
                updatedAt: now,
              });
              found = true;
              resolve();
            } else if (cursor) {
              cursor.continue();
            } else if (!found) {
              store.add({
                id: crypto.randomUUID(),
                category: fact.category,
                key: fact.key,
                value: fact.value,
                confidence: fact.confidence,
                source,
                extractedAt: now,
                updatedAt: now,
              });
              resolve();
            }
          };
          req.onerror = () => reject(req.error);
        });
      }
      database.close();
    }
    refreshFactCount();
  };

  const handleFill = async () => {
    if (!apiKey) throw new Error('Set your API key in settings first');

    const userMemory = await getFactsAsText();
    if (userMemory === 'No user data stored yet.') {
      throw new Error('No data in memory. Scan a page first!');
    }

    const fieldsResp = await chrome.runtime.sendMessage({ type: 'GET_FORM_FIELDS' });
    if (fieldsResp.error) throw new Error(fieldsResp.error);

    const fillResp = await chrome.runtime.sendMessage({
      type: 'FILL_FORM',
      payload: { userMemory, formFields: fieldsResp.formFields, apiKey, baseUrl, model },
    });
    if (fillResp.error) throw new Error(fillResp.error);

    if (fillResp.instructions.length > 0) {
      await chrome.runtime.sendMessage({
        type: 'EXECUTE_FILL',
        payload: { instructions: fillResp.instructions },
      });
    }
  };

  const handleDeleteFact = async (id: string) => {
    const database = await openMemoryDB();
    const tx = database.transaction('facts', 'readwrite');
    tx.objectStore('facts').delete(id);
    database.close();
    refreshFactCount();
  };

  const handleClearAllFacts = async () => {
    const database = await openMemoryDB();
    const tx = database.transaction('facts', 'readwrite');
    tx.objectStore('facts').clear();
    database.close();
    refreshFactCount();
  };

  return (
    <div className="flex h-screen flex-col bg-white font-sans">
      <Header
        onSettingsClick={() => setView(view === 'settings' ? 'home' : 'settings')}
        showBack={view !== 'home'}
        onBackClick={() => setView('home')}
      />
      {view === 'home' && (
        <HomeView
          onScan={handleScan}
          onFill={handleFill}
          onMemoryClick={() => setView('memory')}
          factCount={factCount}
        />
      )}
      {view === 'settings' && (
        <SettingsView apiKey={apiKey} provider={provider} baseUrl={baseUrl} model={model} onSave={handleSaveSettings} />
      )}
      {view === 'memory' && <MemoryView onDelete={handleDeleteFact} onClearAll={handleClearAllFacts} />}
    </div>
  );
};

export { FormPagluApp };
