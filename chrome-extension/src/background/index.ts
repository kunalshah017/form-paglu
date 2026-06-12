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
      const { content, url, apiKey, baseUrl, model, existingMemory } = message.payload as {
        content: string;
        url: string;
        apiKey: string;
        baseUrl: string;
        model: string;
        existingMemory: string;
      };
      const facts = await extractData(
        content,
        apiKey,
        baseUrl,
        model,
        existingMemory || '',
        (current, total, factsFound) => {
          chrome.runtime
            .sendMessage({ type: 'SCAN_PROGRESS', payload: { current, total, factsFound } })
            .catch(() => {});
        },
      );
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
      console.log('FILL_FORM: memory length:', userMemory.length, 'fields count:', JSON.parse(formFields).length);
      const instructions = await generateFillInstructions(userMemory, formFields, apiKey, baseUrl, model);
      console.log('FILL_FORM: got', instructions.length, 'instructions');
      if (instructions.length > 0) {
        console.log('FILL_FORM: first instruction:', JSON.stringify(instructions[0]));
      }
      return { instructions };
    }

    case 'GET_PAGE_CONTENT': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { error: 'No active tab' };
      if (
        !tab.url ||
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('about:') ||
        tab.url.startsWith('chrome-extension://')
      ) {
        return { error: 'Cannot scan this page (browser internal pages are not accessible)' };
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.body.innerText,
      });
      return { content: results[0]?.result ?? '', url: tab.url };
    }

    case 'GET_FORM_FIELDS': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { error: 'No active tab' };
      if (
        !tab.url ||
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('about:') ||
        tab.url.startsWith('chrome-extension://')
      ) {
        return { error: 'Cannot access this page (browser internal pages are not accessible)' };
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const fields: object[] = [];
          const inputs = document.querySelectorAll(
            'input, select, textarea, [contenteditable="true"], [contenteditable=""]',
          );
          inputs.forEach((el, idx) => {
            const input = el as HTMLInputElement;
            const type = input.type || (el.hasAttribute('contenteditable') ? 'contenteditable' : 'text');
            // Skip non-fillable types
            if (['hidden', 'submit', 'button', 'file', 'password', 'image', 'reset'].includes(type)) return;
            // Skip invisible elements
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            // Multi-strategy label detection
            let label = '';
            if (input.id) label = document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() ?? '';
            if (!label) {
              const parentLabel = el.closest('label');
              if (parentLabel) label = parentLabel.textContent?.trim() ?? '';
            }
            if (!label) {
              const prev = el.previousElementSibling;
              if (prev && ['LABEL', 'SPAN', 'P', 'DIV'].includes(prev.tagName)) {
                label = prev.textContent?.trim()?.slice(0, 100) ?? '';
              }
            }

            // Robust selector generation
            let selector = '';
            if (input.id) selector = `#${input.id}`;
            else if (input.name) selector = `[name="${input.name}"]`;
            else {
              el.setAttribute('data-fp-idx', String(idx));
              selector = `[data-fp-idx="${idx}"]`;
            }

            fields.push({
              tag: el.tagName.toLowerCase(),
              type,
              name: input.name || '',
              id: input.id || '',
              placeholder: input.placeholder || '',
              label,
              ariaLabel: input.getAttribute('aria-label') || '',
              autocomplete: input.getAttribute('autocomplete') || '',
              selector,
              options:
                el.tagName === 'SELECT'
                  ? Array.from((el as HTMLSelectElement).options).map(o => ({
                      value: o.value,
                      text: o.textContent?.trim(),
                    }))
                  : undefined,
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
          // Framework-aware value setter that works with React, Vue, Angular
          const setInputValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
            // Use native setter to bypass React's controlled component tracking
            const prototype = Object.getPrototypeOf(el);
            const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
            if (descriptor?.set) {
              descriptor.set.call(el, value);
            } else {
              el.value = value;
            }
            // Dispatch all events frameworks might listen for
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          };

          const setSelectValue = (el: HTMLSelectElement, value: string) => {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
            if (descriptor?.set) {
              descriptor.set.call(el, value);
            } else {
              el.value = value;
            }
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };

          for (const inst of fillInstructions) {
            const el = document.querySelector(inst.selector) as HTMLElement | null;
            if (!el) continue;

            try {
              if (inst.method === 'check' && el instanceof HTMLInputElement) {
                el.checked = inst.value === 'true';
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('click', { bubbles: true }));
              } else if (inst.method === 'select' && el instanceof HTMLSelectElement) {
                setSelectValue(el, inst.value);
              } else if (el.hasAttribute('contenteditable')) {
                el.textContent = inst.value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
              } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                // Focus first (some frameworks validate on focus)
                el.focus();
                setInputValue(el, inst.value);
              }
            } catch (err) {
              console.error('Failed to fill field:', inst.selector, err);
            }
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
