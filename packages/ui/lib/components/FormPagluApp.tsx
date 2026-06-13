import { Header } from './Header';
import { HomeView } from './HomeView';
import { MemoryView } from './MemoryView';
import { SettingsView } from './SettingsView';
import { useState, useEffect, useCallback } from 'react';
import type { FC } from 'react';

const openMemoryDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('form-paglu-memory', 2);
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
  const [provider, setProvider] = useState('google');
  const [baseUrl, setBaseUrl] = useState('https://generativelanguage.googleapis.com/v1beta/openai');
  const [model, setModel] = useState('gemini-3.1-flash-lite');
  const [factCount, setFactCount] = useState(0);
  const [loading, setLoading] = useState<'scan' | 'fill' | null>(null);
  const [status, setStatus] = useState('');

  // Listen for scan progress from background (persists across view changes)
  useEffect(() => {
    const listener = (message: { type: string; payload?: { current: number; total: number; factsFound: number } }) => {
      if (message.type === 'SCAN_PROGRESS' && message.payload) {
        const { current, total, factsFound } = message.payload;
        setStatus(`Scanning chunk ${current}/${total}... (${factsFound} facts found)`);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

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
        setProvider(settings.apiProvider || 'google');
        setBaseUrl(settings.apiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai');
        setModel(settings.model || 'gemini-3.1-flash-lite');
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
    setLoading('scan');
    setStatus('Reading page content...');
    try {
      if (!apiKey) throw new Error('Set your API key in settings first');

      const contentResp = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT' });
      if (contentResp.error) throw new Error(contentResp.error);

      // Get existing memory to pass to agent for smart updates
      const existingMemory = await getFactsAsText();

      const extractResp = await chrome.runtime.sendMessage({
        type: 'SCAN_PAGE',
        payload: { content: contentResp.content, url: contentResp.url, apiKey, baseUrl, model, existingMemory },
      });
      if (extractResp.error) throw new Error(extractResp.error);

      const { facts, source } = extractResp;
      if (facts.length > 0) {
        const database = await openMemoryDB();
        const now = Date.now();

        for (const fact of facts) {
          try {
            // Handle delete action
            if (fact.action === 'delete') {
              const tx = database.transaction('facts', 'readwrite');
              const store = tx.objectStore('facts');
              const index = store.index('key');
              const req = index.getAll(fact.key);
              await new Promise<void>((resolve, reject) => {
                req.onsuccess = () => {
                  const match = req.result.find((f: { category: string }) => f.category === fact.category);
                  if (match) {
                    const delTx = database.transaction('facts', 'readwrite');
                    delTx.objectStore('facts').delete(match.id);
                    delTx.oncomplete = () => resolve();
                    delTx.onerror = () => reject(delTx.error);
                  } else {
                    resolve();
                  }
                };
                req.onerror = () => reject(req.error);
              });
              continue;
            }

            // Store or update
            const tx = database.transaction('facts', 'readonly');
            const store = tx.objectStore('facts');
            const index = store.index('key');
            const req = index.getAll(fact.key);

            await new Promise<void>((resolve, reject) => {
              req.onsuccess = () => {
                const existing = req.result.find((f: { category: string }) => f.category === fact.category);
                const writeTx = database.transaction('facts', 'readwrite');
                const writeStore = writeTx.objectStore('facts');

                if (existing) {
                  writeStore.put({
                    ...existing,
                    value: fact.value,
                    confidence: fact.confidence,
                    source,
                    updatedAt: now,
                  });
                } else {
                  writeStore.add({
                    id: crypto.randomUUID(),
                    category: fact.category,
                    key: fact.key,
                    value: fact.value,
                    confidence: fact.confidence,
                    source,
                    extractedAt: now,
                    updatedAt: now,
                  });
                }
                writeTx.oncomplete = () => resolve();
                writeTx.onerror = () => reject(writeTx.error);
              };
              req.onerror = () => reject(req.error);
            });
          } catch (err) {
            console.error('Failed to process fact:', fact.key, fact.action, err);
          }
        }
        database.close();
      }
      refreshFactCount();
      setStatus('Scan complete!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setTimeout(() => setStatus(''), 5000);
    } finally {
      setLoading(null);
    }
  };

  const handleFill = async () => {
    setLoading('fill');
    setStatus('Reading form fields...');
    try {
      if (!apiKey) throw new Error('Set your API key in settings first');

      const userMemory = await getFactsAsText();
      if (userMemory === 'No user data stored yet.') {
        throw new Error('No data in memory. Scan a page first!');
      }

      let filledCount = 0;
      const MAX_ITERATIONS = 4; // Safety limit to prevent infinite loops

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        setStatus(
          iteration === 0 ? 'AI is mapping data to form fields...' : `Pass ${iteration + 1}: Filling new fields...`,
        );

        // Read current form state
        const fieldsResp = await chrome.runtime.sendMessage({ type: 'GET_FORM_FIELDS' });
        if (fieldsResp.error) throw new Error(fieldsResp.error);

        // Ask AI to fill + interact
        const fillResp = await chrome.runtime.sendMessage({
          type: 'FILL_FORM',
          payload: { userMemory, formFields: fieldsResp.formFields, apiKey, baseUrl, model },
        });
        if (fillResp.error) throw new Error(fillResp.error);

        if (fillResp.instructions.length > 0) {
          // Execute click actions first, then fills (clicks reveal new fields)
          const clicks = fillResp.instructions.filter((i: { method: string }) => i.method === 'click');
          const fills = fillResp.instructions.filter((i: { method: string }) => i.method !== 'click');

          if (clicks.length > 0) {
            await chrome.runtime.sendMessage({
              type: 'EXECUTE_FILL',
              payload: { instructions: clicks },
            });
            // Wait for DOM to update after clicks
            await new Promise(r => setTimeout(r, 600));
          }

          if (fills.length > 0) {
            await chrome.runtime.sendMessage({
              type: 'EXECUTE_FILL',
              payload: { instructions: fills },
            });
            filledCount += fills.length;
          }
        }

        setStatus(`Filled ${filledCount} fields so far...`);

        // If no more interaction needed, break
        if (!fillResp.needsMoreInteraction) break;

        // Wait for DOM to stabilize before next iteration
        await new Promise(r => setTimeout(r, 500));
      }

      // Final verification pass
      setStatus(`Verifying ${filledCount} filled fields...`);
      await new Promise(r => setTimeout(r, 500));

      const verifyResp = await chrome.runtime.sendMessage({ type: 'GET_FORM_FIELDS' });
      if (!verifyResp.error) {
        const verifyFields = JSON.parse(verifyResp.formFields) as Array<{
          type: string;
          currentValue: string;
          label: string;
          name: string;
        }>;
        const emptyFields = verifyFields.filter(f => {
          if (f.type === 'radio' || f.type === 'checkbox' || f.type === 'action') return false;
          if (f.currentValue && f.currentValue.trim()) return false;
          return true;
        });

        if (emptyFields.length > 0 && emptyFields.length < 20) {
          setStatus(`${emptyFields.length} fields still empty. Final pass...`);
          const retryResp = await chrome.runtime.sendMessage({
            type: 'FILL_FORM',
            payload: { userMemory, formFields: verifyResp.formFields, apiKey, baseUrl, model },
          });
          if (!retryResp.error && retryResp.instructions.length > 0) {
            const retryFills = retryResp.instructions.filter((i: { method: string }) => i.method !== 'click');
            if (retryFills.length > 0) {
              await chrome.runtime.sendMessage({
                type: 'EXECUTE_FILL',
                payload: { instructions: retryFills },
              });
              filledCount += retryFills.length;
            }
          }
        }
      }

      setStatus(`Done! Filled ${filledCount} fields total.`);
      setTimeout(() => setStatus(''), 4000);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setTimeout(() => setStatus(''), 5000);
    } finally {
      setLoading(null);
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
          loading={loading}
          status={status}
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
