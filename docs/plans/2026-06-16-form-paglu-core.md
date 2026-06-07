# Form Paglu Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that uses an AI agent to scan webpages/documents, extract user data into a dynamic memory structure, and auto-fill forms on any website.

**Architecture:** Side panel as primary UI (popup mirrors it). Content script injected on-demand to read DOM and fill forms. Background service worker orchestrates AI calls via OpenAI SDK (OpenRouter/NVIDIA compatible). IndexedDB for dynamic user memory (unlimited storage, structured for AI-readable retrieval). Chrome storage for settings/API keys.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vite, OpenAI SDK (openai npm package), Dexie.js (IndexedDB wrapper), Chrome Extension APIs (scripting, storage, sidePanel)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│ Side Panel / Popup (React UI)                       │
│  - Home: Scan Webpage / Fill Form buttons           │
│  - Settings: API key, model selection               │
├─────────────────────────────────────────────────────┤
│ Background Service Worker                           │
│  - AI Agent (OpenAI SDK → OpenRouter/NVIDIA)        │
│  - Memory Manager (read/write IndexedDB via Dexie)  │
│  - Message router (UI ↔ content script)             │
├─────────────────────────────────────────────────────┤
│ Content Script (injected on-demand)                 │
│  - DOM reader (extract page text/structure)         │
│  - Form filler (find inputs, set values, dispatch)  │
└─────────────────────────────────────────────────────┘
```

## Data Model (IndexedDB via Dexie)

The key insight: we DON'T define fixed fields. The AI agent stores data as **semantic key-value facts** with metadata. This allows infinite flexibility.

```typescript
// Database: "form-paglu-memory"

// Table: "facts" - Every piece of extracted info is a "fact"
interface Fact {
  id: string;              // auto-generated UUID
  category: string;        // AI-assigned: "personal", "address", "education", "work", "financial", etc.
  key: string;             // AI-assigned semantic key: "full_name", "email_primary", "university_name", etc.
  value: string;           // The actual data
  confidence: number;      // 0-1, how confident the AI is about this extraction
  source: string;          // Where it came from: URL, filename, "manual"
  extractedAt: number;     // timestamp
  updatedAt: number;       // timestamp
}

// Table: "sources" - Track what was scanned
interface Source {
  id: string;
  type: "webpage" | "document" | "image";
  identifier: string;     // URL or filename
  scannedAt: number;
  factCount: number;
}

// Table: "settings"
interface Settings {
  key: string;             // "apiKey", "apiProvider", "model", "uiMode"
  value: string;           // encrypted for sensitive values
}
```

When filling forms, the AI gets ALL facts as context and maps them to form fields intelligently. Duplicates are merged by the AI (same key = update, new key = insert).

---

## Task 1: Install Dependencies & Configure Base

**Files:**
- Modify: `package.json` (root)
- Modify: `chrome-extension/package.json`
- Modify: `pages/popup/package.json`
- Modify: `pages/side-panel/package.json`
- Modify: `chrome-extension/manifest.ts`

- [ ] **Step 1: Install openai SDK and dexie**

```bash
pnpm i openai dexie -F chrome-extension
pnpm i dexie -F @extension/storage
```

- [ ] **Step 2: Update manifest permissions**

Update `chrome-extension/manifest.ts` to add required permissions:

```typescript
import { readFileSync } from 'node:fs';
import type { ManifestType } from '@extension/shared';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

const manifest = {
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_extensionName__',
  version: packageJson.version,
  description: '__MSG_extensionDescription__',
  permissions: ['storage', 'sidePanel', 'activeTab', 'scripting'],
  background: {
    service_worker: 'background.js',
    type: 'module',
  },
  action: {
    default_popup: 'popup/index.html',
    default_icon: 'icon-34.png',
  },
  icons: {
    '128': 'icon-128.png',
  },
  side_panel: {
    default_path: 'side-panel/index.html',
  },
} satisfies ManifestType;

export default manifest;
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: add openai sdk, dexie dependencies and update manifest permissions"
```

---

## Task 2: Memory Layer (IndexedDB via Dexie)

**Files:**
- Create: `packages/storage/lib/memory/db.ts`
- Create: `packages/storage/lib/memory/facts.ts`
- Create: `packages/storage/lib/memory/sources.ts`
- Create: `packages/storage/lib/memory/index.ts`
- Modify: `packages/storage/lib/index.ts`

- [ ] **Step 1: Create Dexie database schema**

Create `packages/storage/lib/memory/db.ts`:

```typescript
import Dexie, { type EntityTable } from 'dexie';

export interface Fact {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  extractedAt: number;
  updatedAt: number;
}

export interface Source {
  id: string;
  type: 'webpage' | 'document' | 'image';
  identifier: string;
  scannedAt: number;
  factCount: number;
}

const db = new Dexie('form-paglu-memory') as Dexie & {
  facts: EntityTable<Fact, 'id'>;
  sources: EntityTable<Source, 'id'>;
};

db.version(1).stores({
  facts: 'id, category, key, source, updatedAt',
  sources: 'id, type, scannedAt',
});

export { db };
```

- [ ] **Step 2: Create facts CRUD helper**

Create `packages/storage/lib/memory/facts.ts`:

```typescript
import { db, type Fact } from './db';

export async function upsertFacts(facts: Omit<Fact, 'id' | 'updatedAt'>[]): Promise<void> {
  const now = Date.now();

  await db.transaction('rw', db.facts, async () => {
    for (const fact of facts) {
      const existing = await db.facts.where({ key: fact.key, category: fact.category }).first();

      if (existing) {
        await db.facts.update(existing.id, {
          value: fact.value,
          confidence: fact.confidence,
          source: fact.source,
          updatedAt: now,
        });
      } else {
        await db.facts.add({
          ...fact,
          id: crypto.randomUUID(),
          updatedAt: now,
        });
      }
    }
  });
}

export async function getAllFacts(): Promise<Fact[]> {
  return db.facts.orderBy('category').toArray();
}

export async function getFactsByCategory(category: string): Promise<Fact[]> {
  return db.facts.where('category').equals(category).toArray();
}

export async function deleteFact(id: string): Promise<void> {
  await db.facts.delete(id);
}

export async function clearAllFacts(): Promise<void> {
  await db.facts.clear();
}

export async function getFactsAsText(): Promise<string> {
  const facts = await getAllFacts();
  if (facts.length === 0) return 'No user data stored yet.';

  const grouped: Record<string, Fact[]> = {};
  for (const fact of facts) {
    if (!grouped[fact.category]) grouped[fact.category] = [];
    grouped[fact.category].push(fact);
  }

  let text = '';
  for (const [category, categoryFacts] of Object.entries(grouped)) {
    text += `\n[${category}]\n`;
    for (const f of categoryFacts) {
      text += `  ${f.key}: ${f.value}\n`;
    }
  }
  return text.trim();
}
```

- [ ] **Step 3: Create sources helper**

Create `packages/storage/lib/memory/sources.ts`:

```typescript
import { db, type Source } from './db';

export async function addSource(source: Omit<Source, 'id'>): Promise<string> {
  const id = crypto.randomUUID();
  await db.sources.add({ ...source, id });
  return id;
}

export async function getAllSources(): Promise<Source[]> {
  return db.sources.orderBy('scannedAt').reverse().toArray();
}
```

- [ ] **Step 4: Create barrel export**

Create `packages/storage/lib/memory/index.ts`:

```typescript
export { db, type Fact, type Source } from './db';
export { upsertFacts, getAllFacts, getFactsByCategory, deleteFact, clearAllFacts, getFactsAsText } from './facts';
export { addSource, getAllSources } from './sources';
```

- [ ] **Step 5: Export from storage package**

Add to `packages/storage/lib/index.ts`:

```typescript
export * from './memory/index';
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add IndexedDB memory layer with Dexie for dynamic fact storage"
```

---

## Task 3: Settings Storage (Encrypted API Keys)

**Files:**
- Create: `packages/storage/lib/impl/settings-storage.ts`
- Modify: `packages/storage/lib/index.ts`

- [ ] **Step 1: Create settings storage with encryption for API key**

Create `packages/storage/lib/impl/settings-storage.ts`:

```typescript
import { createStorage, StorageEnum } from '../base/index.js';

interface SettingsState {
  apiKey: string;        // stored encrypted (base64 obfuscation for local-only protection)
  apiProvider: 'openrouter' | 'nvidia' | 'custom';
  apiBaseUrl: string;
  model: string;
  uiMode: 'sidepanel' | 'popup';
}

const DEFAULT_SETTINGS: SettingsState = {
  apiKey: '',
  apiProvider: 'nvidia',
  apiBaseUrl: 'https://integrate.api.nvidia.com/v1',
  model: 'nvidia/llama-3.3-nemotron-super-49b-v1',
  uiMode: 'sidepanel',
};

const storage = createStorage<SettingsState>('fp-settings', DEFAULT_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

// Simple obfuscation for API key (not true encryption, but prevents casual inspection)
function encode(value: string): string {
  if (!value) return '';
  return btoa(encodeURIComponent(value));
}

function decode(value: string): string {
  if (!value) return '';
  try {
    return decodeURIComponent(atob(value));
  } catch {
    return value;
  }
}

export const settingsStorage = {
  ...storage,
  getApiKey: async (): Promise<string> => {
    const state = await storage.get();
    return decode(state.apiKey);
  },
  setApiKey: async (key: string): Promise<void> => {
    await storage.set(current => ({ ...current, apiKey: encode(key) }));
  },
  getProvider: async () => {
    const state = await storage.get();
    return { provider: state.apiProvider, baseUrl: state.apiBaseUrl, model: state.model };
  },
  setProvider: async (provider: SettingsState['apiProvider'], baseUrl: string, model: string) => {
    await storage.set(current => ({ ...current, apiProvider: provider, apiBaseUrl: baseUrl, model }));
  },
  getUiMode: async () => {
    const state = await storage.get();
    return state.uiMode;
  },
  setUiMode: async (mode: SettingsState['uiMode']) => {
    await storage.set(current => ({ ...current, uiMode: mode }));
  },
};
```

- [ ] **Step 2: Export settings storage**

Add to `packages/storage/lib/index.ts`:

```typescript
export { settingsStorage } from './impl/settings-storage';
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add settings storage with API key obfuscation"
```

---

## Task 4: AI Agent Service

**Files:**
- Create: `chrome-extension/src/background/ai-agent.ts`
- Create: `chrome-extension/src/background/prompts.ts`
- Modify: `chrome-extension/src/background/index.ts`

- [ ] **Step 1: Create system prompts**

Create `chrome-extension/src/background/prompts.ts`:

```typescript
export const EXTRACT_SYSTEM_PROMPT = `You are a data extraction AI agent for the "Form Paglu" Chrome extension.

Your job: Extract ALL personal/professional information from the given text content that could be useful for filling forms.

Rules:
1. Extract every piece of identifiable user data (names, emails, phones, addresses, education, work, dates, IDs, etc.)
2. Assign each fact a semantic "key" (e.g., "full_name", "email_primary", "phone_mobile", "address_line_1")
3. Assign each fact a "category" (personal, contact, address, education, work, financial, identification, medical, preferences, social, other)
4. Rate your confidence 0-1 for each extraction
5. If you find updated info for an existing key, include it (it will overwrite)
6. Be thorough - extract EVERYTHING that looks like user data
7. For ambiguous data, still extract with lower confidence

Respond ONLY with valid JSON array:
[{"category": "...", "key": "...", "value": "...", "confidence": 0.95}]

If no useful data found, respond with: []`;

export const FILL_SYSTEM_PROMPT = `You are a form-filling AI agent for the "Form Paglu" Chrome extension.

You will receive:
1. USER_MEMORY: All known facts about the user
2. FORM_FIELDS: List of form fields on the current page with their attributes

Your job: Map user memory to form fields. For each form field, determine the best matching value from memory.

Rules:
1. Match fields by analyzing: name, id, label, placeholder, aria-label, type attributes
2. Be smart about variations (e.g., "fname" = first_name, "tel" = phone)
3. Only fill fields you're confident about
4. For select/dropdown fields, pick the closest matching option
5. For date fields, format appropriately (the value should match the input type)
6. Skip password, captcha, and file upload fields
7. If a field has multiple possible matches, pick the highest confidence one

Respond ONLY with valid JSON array:
[{"selector": "css-selector-for-field", "value": "value-to-fill", "method": "set|select|check"}]

If no fields can be filled, respond with: []`;
```

- [ ] **Step 2: Create AI agent service**

Create `chrome-extension/src/background/ai-agent.ts`:

```typescript
import OpenAI from 'openai';
import { EXTRACT_SYSTEM_PROMPT, FILL_SYSTEM_PROMPT } from './prompts';

interface ExtractedFact {
  category: string;
  key: string;
  value: string;
  confidence: number;
}

interface FillInstruction {
  selector: string;
  value: string;
  method: 'set' | 'select' | 'check';
}

function createClient(apiKey: string, baseUrl: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: baseUrl,
    dangerouslyAllowBrowser: true,
  });
}

export async function extractData(
  content: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<ExtractedFact[]> {
  const client = createClient(apiKey, baseUrl);

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
      { role: 'user', content: `Extract all user data from this content:\n\n${content}` },
    ],
    temperature: 0.1,
    max_tokens: 4096,
  });

  const text = response.choices[0]?.message?.content?.trim() ?? '[]';

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as ExtractedFact[];
  } catch {
    console.error('Failed to parse AI extraction response:', text);
    return [];
  }
}

export async function generateFillInstructions(
  userMemory: string,
  formFields: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<FillInstruction[]> {
  const client = createClient(apiKey, baseUrl);

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: FILL_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `USER_MEMORY:\n${userMemory}\n\nFORM_FIELDS:\n${formFields}`,
      },
    ],
    temperature: 0.1,
    max_tokens: 4096,
  });

  const text = response.choices[0]?.message?.content?.trim() ?? '[]';

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as FillInstruction[];
  } catch {
    console.error('Failed to parse AI fill response:', text);
    return [];
  }
}
```

- [ ] **Step 3: Update background service worker with message handling**

Rewrite `chrome-extension/src/background/index.ts`:

```typescript
import 'webextension-polyfill';
import { extractData, generateFillInstructions } from './ai-agent';

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Message handler for UI ↔ Background communication
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    console.error('Message handler error:', err);
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message: { type: string; payload?: unknown }) {
  switch (message.type) {
    case 'SCAN_PAGE': {
      const { content, url, apiKey, baseUrl, model } = message.payload as {
        content: string;
        url: string;
        apiKey: string;
        baseUrl: string;
        model: string;
      };
      const facts = await extractData(content, apiKey, baseUrl, model);
      return { facts, source: url };
    }

    case 'FILL_FORM': {
      const { userMemory, formFields, apiKey, baseUrl, model } = message.payload as {
        userMemory: string;
        formFields: string;
        apiKey: string;
        baseUrl: string;
        model: string;
      };
      const instructions = await generateFillInstructions(userMemory, formFields, apiKey, baseUrl, model);
      return { instructions };
    }

    case 'GET_PAGE_CONTENT': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { error: 'No active tab' };

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.body.innerText,
      });
      return { content: results[0]?.result ?? '', url: tab.url };
    }

    case 'GET_FORM_FIELDS': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { error: 'No active tab' };

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const fields: object[] = [];
          const inputs = document.querySelectorAll('input, select, textarea');
          inputs.forEach(el => {
            const input = el as HTMLInputElement;
            const label = document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() ?? '';
            fields.push({
              tag: el.tagName.toLowerCase(),
              type: input.type || 'text',
              name: input.name || '',
              id: input.id || '',
              placeholder: input.placeholder || '',
              label,
              ariaLabel: input.getAttribute('aria-label') || '',
              selector: input.id ? `#${input.id}` : input.name ? `[name="${input.name}"]` : '',
              options: el.tagName === 'SELECT' ? Array.from((el as HTMLSelectElement).options).map(o => o.value) : undefined,
            });
          });
          return JSON.stringify(fields);
        },
      });
      return { formFields: results[0]?.result ?? '[]' };
    }

    case 'EXECUTE_FILL': {
      const { instructions } = message.payload as { instructions: { selector: string; value: string; method: string }[] };
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { error: 'No active tab' };

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (fillInstructions: { selector: string; value: string; method: string }[]) => {
          for (const inst of fillInstructions) {
            const el = document.querySelector(inst.selector) as HTMLInputElement | HTMLSelectElement | null;
            if (!el) continue;

            if (inst.method === 'check' && el instanceof HTMLInputElement) {
              el.checked = inst.value === 'true';
            } else if (inst.method === 'select' && el instanceof HTMLSelectElement) {
              el.value = inst.value;
            } else {
              (el as HTMLInputElement).value = inst.value;
            }

            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        },
        args: [instructions],
      });
      return { success: true };
    }

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add AI agent service with extraction and form-fill capabilities"
```

---

## Task 5: Shared UI App Component

Both popup and side-panel render the same app. We'll create a shared component in `packages/ui`.

**Files:**
- Create: `packages/ui/lib/components/FormPagluApp.tsx`
- Create: `packages/ui/lib/components/HomeView.tsx`
- Create: `packages/ui/lib/components/SettingsView.tsx`
- Create: `packages/ui/lib/components/Header.tsx`
- Modify: `packages/ui/lib/components/index.ts` (or create if doesn't exist)

- [ ] **Step 1: Create Header component**

Create `packages/ui/lib/components/Header.tsx`:

```tsx
import { type FC } from 'react';

interface HeaderProps {
  onSettingsClick: () => void;
  showBack?: boolean;
  onBackClick?: () => void;
}

export const Header: FC<HeaderProps> = ({ onSettingsClick, showBack, onBackClick }) => {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b-2 border-dashed border-gray-300">
      {showBack ? (
        <button
          onClick={onBackClick}
          className="font-[Delius_Swash_Caps] text-sm text-secondary hover:text-primary transition-colors"
        >
          ← back
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="font-[Delius_Swash_Caps] text-lg font-bold text-secondary">
            form <span className="text-red-500">♥</span> paglu
          </span>
        </div>
      )}
      <button
        onClick={onSettingsClick}
        className="w-8 h-8 flex items-center justify-center rounded-full border-2 border-dashed border-gray-300 hover:border-primary hover:text-primary transition-all"
        aria-label="Settings"
      >
        ⚙
      </button>
    </header>
  );
};
```

- [ ] **Step 2: Create HomeView component**

Create `packages/ui/lib/components/HomeView.tsx`:

```tsx
import { type FC, useState } from 'react';

interface HomeViewProps {
  onScan: () => Promise<void>;
  onFill: () => Promise<void>;
  factCount: number;
}

export const HomeView: FC<HomeViewProps> = ({ onScan, onFill, factCount }) => {
  const [loading, setLoading] = useState<'scan' | 'fill' | null>(null);
  const [status, setStatus] = useState<string>('');

  const handleScan = async () => {
    setLoading('scan');
    setStatus('Scanning page...');
    try {
      await onScan();
      setStatus('Scan complete!');
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(null);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  const handleFill = async () => {
    setLoading('fill');
    setStatus('Filling form...');
    try {
      await onFill();
      setStatus('Form filled!');
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(null);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-6 p-6">
      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button
          onClick={handleFill}
          disabled={loading !== null || factCount === 0}
          className="w-full py-4 px-6 rounded-xl border-2 border-dashed border-primary bg-white hover:bg-blue-50 font-[Delius_Swash_Caps] text-lg text-secondary transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === 'fill' ? '✍️ filling...' : '✍️ Fill out form'}
        </button>

        <button
          onClick={handleScan}
          disabled={loading !== null}
          className="w-full py-4 px-6 rounded-xl border-2 border-dashed border-secondary bg-white hover:bg-slate-50 font-[Delius_Swash_Caps] text-lg text-secondary transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === 'scan' ? '🔍 scanning...' : '🔍 Scan webpage'}
        </button>
      </div>

      {status && (
        <p className="text-sm font-[Delius_Swash_Caps] text-gray-600 text-center animate-pulse">
          {status}
        </p>
      )}

      <p className="text-xs text-gray-400 font-[Delius_Swash_Caps]">
        {factCount > 0 ? `${factCount} facts in memory` : 'no data scanned yet'}
      </p>
    </div>
  );
};
```

- [ ] **Step 3: Create SettingsView component**

Create `packages/ui/lib/components/SettingsView.tsx`:

```tsx
import { type FC, useState, useEffect } from 'react';

interface SettingsViewProps {
  apiKey: string;
  provider: string;
  baseUrl: string;
  model: string;
  onSave: (settings: { apiKey: string; provider: string; baseUrl: string; model: string }) => void;
}

const PROVIDERS = [
  { id: 'nvidia', label: 'NVIDIA (build.nvidia.ai)', baseUrl: 'https://integrate.api.nvidia.com/v1', defaultModel: 'nvidia/llama-3.3-nemotron-super-49b-v1' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'nvidia/llama-3.3-nemotron-super-49b-v1' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', baseUrl: '', defaultModel: '' },
];

export const SettingsView: FC<SettingsViewProps> = ({ apiKey, provider, baseUrl, model, onSave }) => {
  const [key, setKey] = useState(apiKey);
  const [selectedProvider, setSelectedProvider] = useState(provider);
  const [customBaseUrl, setCustomBaseUrl] = useState(baseUrl);
  const [selectedModel, setSelectedModel] = useState(model);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const p = PROVIDERS.find(p => p.id === selectedProvider);
    if (p && p.id !== 'custom') {
      setCustomBaseUrl(p.baseUrl);
      if (!selectedModel) setSelectedModel(p.defaultModel);
    }
  }, [selectedProvider]);

  const handleSave = () => {
    onSave({ apiKey: key, provider: selectedProvider, baseUrl: customBaseUrl, model: selectedModel });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="font-[Delius_Swash_Caps] text-xl text-secondary">settings</h2>

      <div className="flex flex-col gap-2">
        <label className="font-[Delius_Swash_Caps] text-sm text-gray-600">provider</label>
        <select
          value={selectedProvider}
          onChange={e => setSelectedProvider(e.target.value)}
          className="w-full p-2 rounded-lg border-2 border-dashed border-gray-300 font-[Delius_Swash_Caps] text-sm bg-white focus:border-primary outline-none"
        >
          {PROVIDERS.map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label className="font-[Delius_Swash_Caps] text-sm text-gray-600">api key</label>
        <input
          type="password"
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder="sk-..."
          className="w-full p-2 rounded-lg border-2 border-dashed border-gray-300 font-mono text-sm bg-white focus:border-primary outline-none"
        />
      </div>

      {selectedProvider === 'custom' && (
        <div className="flex flex-col gap-2">
          <label className="font-[Delius_Swash_Caps] text-sm text-gray-600">base url</label>
          <input
            type="url"
            value={customBaseUrl}
            onChange={e => setCustomBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            className="w-full p-2 rounded-lg border-2 border-dashed border-gray-300 font-mono text-sm bg-white focus:border-primary outline-none"
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label className="font-[Delius_Swash_Caps] text-sm text-gray-600">model</label>
        <input
          type="text"
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
          placeholder="model-name"
          className="w-full p-2 rounded-lg border-2 border-dashed border-gray-300 font-mono text-sm bg-white focus:border-primary outline-none"
        />
      </div>

      <button
        onClick={handleSave}
        className="w-full py-3 mt-2 rounded-xl border-2 border-dashed border-primary bg-white hover:bg-blue-50 font-[Delius_Swash_Caps] text-base text-secondary transition-all hover:scale-[1.02] active:scale-[0.98]"
      >
        {saved ? '✓ saved!' : 'save settings'}
      </button>
    </div>
  );
};
```

- [ ] **Step 4: Create main FormPagluApp component**

Create `packages/ui/lib/components/FormPagluApp.tsx`:

```tsx
import { type FC, useState, useEffect, useCallback } from 'react';
import { Header } from './Header';
import { HomeView } from './HomeView';
import { SettingsView } from './SettingsView';

export const FormPagluApp: FC = () => {
  const [view, setView] = useState<'home' | 'settings'>('home');
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('nvidia');
  const [baseUrl, setBaseUrl] = useState('https://integrate.api.nvidia.com/v1');
  const [model, setModel] = useState('nvidia/llama-3.3-nemotron-super-49b-v1');
  const [factCount, setFactCount] = useState(0);

  // Load settings from storage on mount
  useEffect(() => {
    chrome.storage.local.get('fp-settings', (result) => {
      const settings = result['fp-settings'];
      if (settings) {
        setApiKey(settings.apiKey ? atob(settings.apiKey) : '');
        setProvider(settings.apiProvider || 'nvidia');
        setBaseUrl(settings.apiBaseUrl || 'https://integrate.api.nvidia.com/v1');
        setModel(settings.model || 'nvidia/llama-3.3-nemotron-super-49b-v1');
      }
    });
    // Get fact count
    refreshFactCount();
  }, []);

  const refreshFactCount = useCallback(() => {
    // Message background to get fact count (or use indexedDB directly)
    const request = indexedDB.open('form-paglu-memory');
    request.onsuccess = () => {
      const db = request.result;
      if (db.objectStoreNames.contains('facts')) {
        const tx = db.transaction('facts', 'readonly');
        const store = tx.objectStore('facts');
        const countReq = store.count();
        countReq.onsuccess = () => setFactCount(countReq.result);
      }
      db.close();
    };
  }, []);

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

    // Get page content via background
    const contentResp = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT' });
    if (contentResp.error) throw new Error(contentResp.error);

    // Send to AI for extraction
    const extractResp = await chrome.runtime.sendMessage({
      type: 'SCAN_PAGE',
      payload: {
        content: contentResp.content,
        url: contentResp.url,
        apiKey,
        baseUrl,
        model,
      },
    });

    if (extractResp.error) throw new Error(extractResp.error);

    // Store facts in IndexedDB
    const { facts, source } = extractResp;
    if (facts.length > 0) {
      const db = await openMemoryDB();
      const tx = db.transaction('facts', 'readwrite');
      const store = tx.objectStore('facts');
      const now = Date.now();

      for (const fact of facts) {
        await new Promise<void>((resolve, reject) => {
          // Check if key+category exists
          const index = store.index('key');
          const req = index.openCursor(IDBKeyRange.only(fact.key));
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor && cursor.value.category === fact.category) {
              // Update existing
              cursor.update({ ...cursor.value, value: fact.value, confidence: fact.confidence, source, updatedAt: now });
              resolve();
            } else if (cursor) {
              cursor.continue();
            } else {
              // Add new
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
      db.close();
    }

    refreshFactCount();
  };

  const handleFill = async () => {
    if (!apiKey) throw new Error('Set your API key in settings first');

    // Get all facts as text
    const userMemory = await getFactsAsText();
    if (!userMemory || userMemory === 'No user data stored yet.') {
      throw new Error('No data in memory. Scan a page first!');
    }

    // Get form fields from current page
    const fieldsResp = await chrome.runtime.sendMessage({ type: 'GET_FORM_FIELDS' });
    if (fieldsResp.error) throw new Error(fieldsResp.error);

    // Ask AI to map memory to form fields
    const fillResp = await chrome.runtime.sendMessage({
      type: 'FILL_FORM',
      payload: {
        userMemory,
        formFields: fieldsResp.formFields,
        apiKey,
        baseUrl,
        model,
      },
    });

    if (fillResp.error) throw new Error(fillResp.error);

    // Execute fill instructions on the page
    if (fillResp.instructions.length > 0) {
      await chrome.runtime.sendMessage({
        type: 'EXECUTE_FILL',
        payload: { instructions: fillResp.instructions },
      });
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white font-sans">
      <Header
        onSettingsClick={() => setView(view === 'settings' ? 'home' : 'settings')}
        showBack={view === 'settings'}
        onBackClick={() => setView('home')}
      />
      {view === 'home' ? (
        <HomeView onScan={handleScan} onFill={handleFill} factCount={factCount} />
      ) : (
        <SettingsView
          apiKey={apiKey}
          provider={provider}
          baseUrl={baseUrl}
          model={model}
          onSave={handleSaveSettings}
        />
      )}
    </div>
  );
};

// Helper: open IndexedDB
function openMemoryDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('form-paglu-memory', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('facts')) {
        const store = db.createObjectStore('facts', { keyPath: 'id' });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('key', 'key', { unique: false });
        store.createIndex('source', 'source', { unique: false });
      }
      if (!db.objectStoreNames.contains('sources')) {
        db.createObjectStore('sources', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Helper: get all facts formatted for AI
async function getFactsAsText(): Promise<string> {
  const db = await openMemoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('facts', 'readonly');
    const store = tx.objectStore('facts');
    const req = store.getAll();
    req.onsuccess = () => {
      const facts = req.result;
      if (facts.length === 0) {
        resolve('No user data stored yet.');
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
    };
    req.onerror = () => reject(req.error);
    db.close();
  });
}
```

- [ ] **Step 5: Export new components**

Update `packages/ui/lib/components/index.ts` to add:

```typescript
export { FormPagluApp } from './FormPagluApp';
export { Header } from './Header';
export { HomeView } from './HomeView';
export { SettingsView } from './SettingsView';
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add shared UI components - header, home, settings, and main app"
```

---

## Task 6: Wire Up Popup & Side Panel

**Files:**
- Modify: `pages/popup/src/Popup.tsx`
- Modify: `pages/popup/src/Popup.css`
- Modify: `pages/side-panel/src/SidePanel.tsx`
- Modify: `pages/side-panel/src/SidePanel.css`

- [ ] **Step 1: Update Popup to use shared app**

Rewrite `pages/popup/src/Popup.tsx`:

```tsx
import '@src/Popup.css';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { ErrorDisplay, FormPagluApp, LoadingSpinner } from '@extension/ui';

const Popup = () => <FormPagluApp />;

export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);
```

- [ ] **Step 2: Update Popup CSS for dimensions**

Rewrite `pages/popup/src/Popup.css`:

```css
body {
  width: 360px;
  height: 480px;
  margin: 0;
  padding: 0;
}
```

- [ ] **Step 3: Update SidePanel to use shared app**

Rewrite `pages/side-panel/src/SidePanel.tsx`:

```tsx
import '@src/SidePanel.css';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { ErrorDisplay, FormPagluApp, LoadingSpinner } from '@extension/ui';

const SidePanel = () => <FormPagluApp />;

export default withErrorBoundary(withSuspense(SidePanel, <LoadingSpinner />), ErrorDisplay);
```

- [ ] **Step 4: Update SidePanel CSS**

Rewrite `pages/side-panel/src/SidePanel.css`:

```css
body {
  margin: 0;
  padding: 0;
  height: 100vh;
}
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: wire popup and side-panel to shared FormPagluApp component"
```

---

## Task 7: Add Google Font & Tailwind Config for Doodle Theme

**Files:**
- Modify: `pages/popup/index.html`
- Modify: `pages/side-panel/index.html`
- Modify: `packages/tailwindcss-config/tailwind.config.ts`

- [ ] **Step 1: Add Delius Swash Caps font to popup index.html**

Add to the `<head>` of `pages/popup/index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Delius+Swash+Caps&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Add same font to side-panel index.html**

Same additions to `pages/side-panel/index.html`.

- [ ] **Step 3: Update shared tailwind config with doodle theme colors**

Update `packages/tailwindcss-config/tailwind.config.ts` to extend with:

```typescript
theme: {
  extend: {
    colors: {
      primary: '#49B6E5',
      secondary: '#263D5B',
      success: '#16A34A',
      warning: '#D97706',
      danger: '#DC2626',
      surface: '#FFFFFF',
    },
    fontFamily: {
      doodle: ['Delius Swash Caps', 'cursive'],
    },
  },
},
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add doodle design theme with Delius Swash Caps font and tailwind colors"
```

---

## Task 8: Update Background Build Config for OpenAI SDK

The OpenAI SDK may need node polyfills in the service worker context. The `vite-plugin-node-polyfills` is already configured.

**Files:**
- Modify: `chrome-extension/vite.config.mts` (if needed)
- Modify: `chrome-extension/package.json`

- [ ] **Step 1: Add openai as dependency to chrome-extension**

Ensure `chrome-extension/package.json` has `openai` in dependencies:

```bash
pnpm i openai -F chrome-extension
```

- [ ] **Step 2: Verify vite config handles OpenAI SDK bundling**

The existing vite config already has `nodePolyfills()` plugin which handles Node.js APIs needed by the OpenAI SDK. No changes needed unless build fails.

- [ ] **Step 3: Build and verify**

```bash
TURBO_UI=false pnpm build
```

Fix any build errors that arise.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: ensure openai sdk builds correctly for extension service worker"
```

---

## Summary

After all tasks are complete, the extension will:
1. Show a clean doodle-themed UI with "form ♥ paglu" branding
2. Have a settings page for API key (NVIDIA/OpenRouter/custom) and model selection
3. "Scan webpage" reads the current tab's text, sends to AI for extraction, stores facts in IndexedDB
4. "Fill out form" reads all stored facts, reads current page's form fields, asks AI to map them, and auto-fills
5. All data stays local in IndexedDB (unlimited storage, dynamic schema)
6. API keys stored with base64 obfuscation in chrome.storage.local

---

**Future tasks (not in this plan):**
- Document/image upload for scanning
- Memory management UI (view/edit/delete facts)
- Multiple profiles support
- Export/import data
