import 'webextension-polyfill';
import { extractData, generateFillInstructions } from './ai-agent';

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Message handler for UI ↔ Background communication
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch(err => {
      console.error('Message handler error:', err);
      sendResponse({ error: err instanceof Error ? err.message : 'Unknown error' });
    });
  return true; // Keep channel open for async response
});

const handleMessage = async (message: { type: string; payload?: unknown }) => {
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
              options:
                el.tagName === 'SELECT' ? Array.from((el as HTMLSelectElement).options).map(o => o.value) : undefined,
            });
          });
          return JSON.stringify(fields);
        },
      });
      return { formFields: results[0]?.result ?? '[]' };
    }

    case 'EXECUTE_FILL': {
      const { instructions } = message.payload as {
        instructions: { selector: string; value: string; method: string }[];
      };
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
};
