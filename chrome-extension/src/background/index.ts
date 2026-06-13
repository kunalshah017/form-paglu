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
      const result = await generateFillInstructions(userMemory, formFields, apiKey, baseUrl, model);
      console.log(
        'FILL_FORM: got',
        result.instructions.length,
        'instructions, needsMore:',
        result.needsMoreInteraction,
      );
      if (result.instructions.length > 0) {
        console.log('FILL_FORM: first instruction:', JSON.stringify(result.instructions[0]));
      }
      return { instructions: result.instructions, needsMoreInteraction: result.needsMoreInteraction };
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
        func: () => {
          // Readability-style content extraction: strip boilerplate, keep main content
          const clone = document.cloneNode(true) as Document;

          // Copy live input values from original DOM to clone (cloneNode doesn't copy .value)
          const origInputs = document.querySelectorAll('input, textarea, select');
          const cloneInputs = clone.querySelectorAll('input, textarea, select');
          origInputs.forEach((orig, i) => {
            const cloned = cloneInputs[i];
            if (!cloned) return;
            if (orig instanceof HTMLInputElement && cloned instanceof HTMLInputElement) {
              cloned.setAttribute('data-live-value', orig.value);
              if (orig.type === 'checkbox' || orig.type === 'radio') {
                cloned.setAttribute('data-live-checked', String(orig.checked));
              }
            } else if (orig instanceof HTMLTextAreaElement && cloned instanceof HTMLTextAreaElement) {
              cloned.setAttribute('data-live-value', orig.value);
            } else if (orig instanceof HTMLSelectElement && cloned instanceof HTMLSelectElement) {
              cloned.setAttribute('data-live-value', orig.value);
              const selectedOpt = orig.options[orig.selectedIndex];
              if (selectedOpt) cloned.setAttribute('data-live-text', selectedOpt.text);
            }
          });

          // Remove non-content elements
          const removeSelectors = [
            'script',
            'style',
            'noscript',
            'iframe',
            'svg',
            'canvas',
            'nav',
            'footer',
            'header',
            '[role="navigation"]',
            '[role="banner"]',
            '[role="contentinfo"]',
            '.nav',
            '.navbar',
            '.footer',
            '.header',
            '.sidebar',
            '.menu',
            '.advertisement',
            '.ad',
            '.ads',
            '.cookie-banner',
            '.popup',
            '.modal',
            '.overlay',
            '.social-share',
            '.comments',
          ];
          for (const sel of removeSelectors) {
            clone.querySelectorAll(sel).forEach(el => el.remove());
          }

          // Try to find main content area
          const mainSelectors = ['main', 'article', '[role="main"]', '.main-content', '#content', '.content'];
          let mainEl: Element | null = null;
          for (const sel of mainSelectors) {
            mainEl = clone.querySelector(sel);
            if (mainEl && mainEl.textContent && mainEl.textContent.trim().length > 200) break;
            mainEl = null;
          }

          // Fallback: use body
          const source = mainEl || clone.body;
          if (!source) return '';

          // Preserve form field values: inputs/textareas don't appear in textContent
          // Insert their values as visible text so the AI can see what the user typed
          source.querySelectorAll('input, textarea, select').forEach(el => {
            const value = el.getAttribute('data-live-value')?.trim();
            const type = el.getAttribute('type') || el.tagName.toLowerCase();

            // For checkboxes/radios, show checked state
            if (type === 'checkbox' || type === 'radio') {
              if (el.getAttribute('data-live-checked') === 'true') {
                const label =
                  el.closest('label')?.textContent?.trim() || el.getAttribute('name') || el.getAttribute('id') || '';
                const marker = document.createTextNode(` [${label}: checked] `);
                el.parentNode?.insertBefore(marker, el.nextSibling);
              }
              return;
            }

            if (!value) return;

            // For select elements, show selected option text
            if (el.tagName === 'SELECT') {
              const selectedText = el.getAttribute('data-live-text')?.trim();
              if (selectedText && !selectedText.startsWith('Select')) {
                const marker = document.createTextNode(` [Selected: ${selectedText}] `);
                el.parentNode?.insertBefore(marker, el.nextSibling);
              }
              return;
            }

            // For text inputs and textareas, show the value
            if (type !== 'hidden' && type !== 'password') {
              const marker = document.createTextNode(` [Value: ${value}] `);
              el.parentNode?.insertBefore(marker, el.nextSibling);
            }
          });

          // Preserve URLs: convert <a href="...">text</a> to "text (url)" before extracting text
          // For redirect URLs (lnkd.in etc), try to get the real destination from DOM attributes
          const redirectDomains = ['lnkd.in', 'bit.ly', 't.co', 'goo.gl', 'tinyurl.com', 'shorturl.at'];
          source.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            const text = a.textContent?.trim();
            if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
              // Make relative URLs absolute
              const absoluteUrl = href.startsWith('http')
                ? href
                : href.startsWith('/')
                  ? `${window.location.origin}${href}`
                  : `${window.location.origin}/${href}`;

              // Check if this is a redirect URL — look for real URL in title/data attributes
              const isRedirect = redirectDomains.some(d => absoluteUrl.includes(d));
              let resolvedUrl = absoluteUrl;

              if (isRedirect) {
                // LinkedIn stores real URLs in title or data attributes sometimes
                const title = a.getAttribute('title');
                const dataUrl = a.getAttribute('data-url') || a.getAttribute('data-href');
                if (title && title.startsWith('http') && !redirectDomains.some(d => title.includes(d))) {
                  resolvedUrl = title;
                } else if (dataUrl && dataUrl.startsWith('http')) {
                  resolvedUrl = dataUrl;
                }
              }

              // Only annotate if URL differs from visible text
              if (!text.includes(resolvedUrl) && text !== resolvedUrl) {
                a.textContent = `${text} (${resolvedUrl})`;
              } else if (!text.startsWith('http')) {
                a.textContent = `${text} (${resolvedUrl})`;
              }
            }
          });

          // Get text content, clean up whitespace
          const text = source.textContent || '';
          const lines = text.split('\n');
          const cleaned: string[] = [];
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.length <= 2) continue;
            cleaned.push(trimmed);
          }

          // Deduplicate consecutive lines
          const deduped: string[] = [];
          for (const line of cleaned) {
            if (deduped[deduped.length - 1] !== line) deduped.push(line);
          }

          return deduped.join('\n');
        },
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
          // Detect native form fields + ARIA/custom components (React Select, MUI, Headless UI, etc.)
          const inputs = document.querySelectorAll(
            [
              'input',
              'select',
              'textarea',
              '[contenteditable="true"]',
              '[contenteditable=""]',
              // Custom dropdown/combobox components
              '[role="combobox"]',
              '[role="listbox"]',
              '[role="spinbutton"]',
              '[role="slider"]',
              '[role="switch"]',
              '[role="textbox"]',
              // MUI/Ant Design specific
              '[class*="MuiInput"] input',
              '[class*="MuiSelect"]',
              '[class*="ant-input"]',
              '[class*="ant-select"]',
            ].join(', '),
          );
          const seen = new Set<Element>();
          inputs.forEach((el, idx) => {
            if (seen.has(el)) return;
            seen.add(el);

            const input = el as HTMLInputElement;
            const role = el.getAttribute('role') || '';
            const isCustom =
              !!role &&
              !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement);
            const type =
              input.type ||
              (el.hasAttribute('contenteditable') || role === 'textbox' ? 'contenteditable' : isCustom ? role : 'text');

            // Skip non-fillable types
            if (['hidden', 'submit', 'button', 'file', 'password', 'image', 'reset'].includes(type)) return;
            // Skip invisible elements
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            // Skip if inside a hidden parent
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return;

            // Multi-strategy label detection
            let label = '';
            // 1. Explicit label[for]
            if (input.id) label = document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() ?? '';
            // 2. Wrapping label
            if (!label) {
              const parentLabel = el.closest('label');
              if (parentLabel) label = parentLabel.textContent?.trim() ?? '';
            }
            // 3. aria-labelledby
            if (!label) {
              const labelledBy = el.getAttribute('aria-labelledby');
              if (labelledBy) label = document.getElementById(labelledBy)?.textContent?.trim() ?? '';
            }
            // 4. aria-label
            if (!label) label = el.getAttribute('aria-label') || '';
            // 5. Previous sibling
            if (!label) {
              const prev = el.previousElementSibling;
              if (prev && ['LABEL', 'SPAN', 'P', 'DIV'].includes(prev.tagName)) {
                label = prev.textContent?.trim()?.slice(0, 100) ?? '';
              }
            }
            // 6. Parent field-group's label (common pattern in form libraries)
            if (!label) {
              const fieldGroup = el.closest(
                '[class*="field"], [class*="form-group"], [class*="form-item"], [class*="FormControl"]',
              );
              if (fieldGroup) {
                const groupLabel = fieldGroup.querySelector('label, [class*="label"]');
                if (groupLabel) label = groupLabel.textContent?.trim()?.slice(0, 100) ?? '';
              }
            }

            // Robust selector generation
            let selector = '';
            if (input.id) selector = `#${CSS.escape(input.id)}`;
            else if (input.name && !['radio', 'checkbox'].includes(type))
              selector = `[name="${CSS.escape(input.name)}"]`;
            else if (input.name && (type === 'radio' || type === 'checkbox')) {
              // For radio/checkbox, need value-specific selector
              selector = `[name="${CSS.escape(input.name)}"][value="${CSS.escape(input.value || '')}"]`;
            } else {
              el.setAttribute('data-fp-idx', String(idx));
              selector = `[data-fp-idx="${idx}"]`;
            }

            // Get options for custom dropdowns (role="listbox" children or aria-owns)
            let customOptions: { value: string; text: string }[] | undefined;
            if (isCustom && (role === 'combobox' || role === 'listbox')) {
              const listboxId = el.getAttribute('aria-owns') || el.getAttribute('aria-controls');
              const listbox = listboxId ? document.getElementById(listboxId) : el.querySelector('[role="listbox"]');
              if (listbox) {
                customOptions = Array.from(listbox.querySelectorAll('[role="option"]')).map(opt => ({
                  value: opt.getAttribute('data-value') || opt.textContent?.trim() || '',
                  text: opt.textContent?.trim() || '',
                }));
              }
            }

            fields.push({
              tag: el.tagName.toLowerCase(),
              type,
              name: input.name || '',
              id: input.id || '',
              placeholder: input.placeholder || el.getAttribute('data-placeholder') || '',
              label,
              ariaLabel: el.getAttribute('aria-label') || '',
              autocomplete: input.getAttribute('autocomplete') || '',
              selector,
              // Include value attribute for radio/checkbox (tells AI which option this represents)
              radioValue: type === 'radio' || type === 'checkbox' ? input.value || '' : undefined,
              checked: type === 'radio' || type === 'checkbox' ? input.checked : undefined,
              // Include constraints for number/date/range
              min: input.getAttribute('min') || undefined,
              max: input.getAttribute('max') || undefined,
              step: input.getAttribute('step') || undefined,
              options:
                el.tagName === 'SELECT'
                  ? Array.from((el as HTMLSelectElement).options).map(o => ({
                      value: o.value,
                      text: o.textContent?.trim(),
                    }))
                  : customOptions,
              currentValue:
                input.value ||
                (el.tagName === 'SELECT' ? (el as HTMLSelectElement).value : '') ||
                el.getAttribute('aria-valuenow') ||
                '',
              isCustom: isCustom || undefined,
            });
          });

          // Also detect action buttons (Add experience, Add education, etc.)
          const actionButtons = document.querySelectorAll(
            'button[type="button"], .add-entry-btn, [class*="add-"], [class*="Add"], button:not([type="submit"]):not([type="reset"])',
          );
          const seenButtons = new Set<Element>();
          actionButtons.forEach((btn, idx) => {
            if (seenButtons.has(btn)) return;
            seenButtons.add(btn);
            const text = btn.textContent?.trim() || '';
            // Only include buttons that look like "add more" actions
            if (!text || text.length > 100) return;
            const lowerText = text.toLowerCase();
            if (
              lowerText.includes('add') ||
              lowerText.includes('more') ||
              lowerText.includes('another') ||
              lowerText.includes('new entry') ||
              lowerText.includes('+')
            ) {
              const rect = btn.getBoundingClientRect();
              if (rect.width === 0 && rect.height === 0) return;

              let selector = '';
              if ((btn as HTMLElement).id) selector = `#${CSS.escape((btn as HTMLElement).id)}`;
              else {
                btn.setAttribute('data-fp-btn', String(idx));
                selector = `[data-fp-btn="${idx}"]`;
              }

              fields.push({
                tag: 'button',
                type: 'action',
                name: '',
                id: (btn as HTMLElement).id || '',
                placeholder: '',
                label: text,
                ariaLabel: btn.getAttribute('aria-label') || '',
                autocomplete: '',
                selector,
                currentValue: '',
              });
            }
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
          // Framework-aware value setter that works with React, Vue, Angular, Svelte
          const setInputValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
            // Focus first — many frameworks validate on focus
            el.focus();
            el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
            el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

            // Use the correct prototype's native setter (Input vs Textarea)
            const proto =
              el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(el, value);
            } else {
              el.value = value;
            }

            // Dispatch synthetic events that all frameworks listen for
            // React uses SyntheticEvent triggered by native events
            el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            // Vue v-model uses input event; also dispatch compositionend for CJK
            el.dispatchEvent(new Event('compositionend', { bubbles: true }));
            // Angular uses (input) and (ngModelChange) triggered by native input event
            // Svelte uses on:input and bind:value triggered by input event
            // Blur to trigger validation
            el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
            el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
          };

          const setSelectValue = (el: HTMLSelectElement, value: string) => {
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(el, value);
            } else {
              el.value = value;
            }
            // Also set selectedIndex for frameworks that track it
            const optionIdx = Array.from(el.options).findIndex(o => o.value === value);
            if (optionIdx >= 0) el.selectedIndex = optionIdx;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };

          const setCheckbox = (el: HTMLInputElement, checked: boolean) => {
            // Use native setter for React compat
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
            if (nativeSetter) {
              nativeSetter.call(el, checked);
            } else {
              el.checked = checked;
            }
            // Dispatch click (React tracks this) then change
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };

          for (const inst of fillInstructions) {
            const el = document.querySelector(inst.selector) as HTMLElement | null;
            if (!el) continue;

            try {
              if (inst.method === 'click') {
                // Click action buttons (Add experience, etc.)
                el.click();
                el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              } else if (inst.method === 'check' && el instanceof HTMLInputElement) {
                setCheckbox(el, inst.value === 'true');
              } else if (inst.method === 'select' && el instanceof HTMLSelectElement) {
                setSelectValue(el, inst.value);
              } else if (inst.method === 'select' && el.getAttribute('role') === 'combobox') {
                // Custom dropdown (React Select, MUI, Headless UI)
                // Click to open, find option, click it
                el.click();
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                setTimeout(() => {
                  // Look for the matching option in the opened dropdown
                  const listboxId = el.getAttribute('aria-owns') || el.getAttribute('aria-controls');
                  const listbox = listboxId
                    ? document.getElementById(listboxId)
                    : document.querySelector('[role="listbox"]:not([hidden])');
                  if (listbox) {
                    const option = Array.from(listbox.querySelectorAll('[role="option"]')).find(
                      o =>
                        o.textContent?.trim().toLowerCase() === inst.value.toLowerCase() ||
                        o.getAttribute('data-value') === inst.value,
                    );
                    if (option) (option as HTMLElement).click();
                  }
                }, 100);
              } else if (el.hasAttribute('contenteditable') || el.getAttribute('role') === 'textbox') {
                // Contenteditable (rich text editors, Notion-style inputs)
                el.focus();
                el.innerHTML = inst.value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
              } else if (el.getAttribute('role') === 'switch') {
                // Toggle switch component
                if (inst.value === 'true') el.click();
              } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                setInputValue(el, inst.value);
              } else {
                // Unknown custom element — try click + text
                el.click();
                if ('value' in el) {
                  (el as unknown as HTMLInputElement).value = inst.value;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                }
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
