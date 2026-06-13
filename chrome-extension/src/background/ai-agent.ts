import { EXTRACT_SYSTEM_PROMPT, FILL_SYSTEM_PROMPT, storeFactsSchema, fillResultSchema } from './prompts';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, generateObject, tool } from 'ai';
import { z } from 'zod';
import type { ExtractedFact, FillInstruction } from './prompts';
import type { LanguageModelV1 } from 'ai';

// --- Content Processing ---
const cleanContent = (raw: string): string => {
  const lines = raw.split('\n');
  const skipPatterns =
    /^(skip to|cookie|accept|decline|sign in|sign up|log in|©|privacy|terms|all rights|menu|navigation|footer|header|sidebar|advertisement|sponsored|loading|please wait)/i;
  const cleaned: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length <= 3) continue;
    if (skipPatterns.test(trimmed)) continue;
    if (/^[•\-=_|·]{3,}$/.test(trimmed)) continue;
    cleaned.push(trimmed);
  }
  const deduped: string[] = [];
  for (const line of cleaned) {
    if (deduped[deduped.length - 1] !== line) deduped.push(line);
  }
  return deduped.join('\n');
};

const CHUNK_SIZE = 6000;
const splitIntoChunks = (content: string): string[] => {
  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > 0) {
    if (remaining.length <= CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }
    let bp = remaining.lastIndexOf('\n\n', CHUNK_SIZE);
    if (bp < CHUNK_SIZE * 0.5) bp = remaining.lastIndexOf('\n', CHUNK_SIZE);
    if (bp < CHUNK_SIZE * 0.5) bp = remaining.lastIndexOf('. ', CHUNK_SIZE);
    if (bp < CHUNK_SIZE * 0.5) bp = CHUNK_SIZE;
    chunks.push(remaining.slice(0, bp + 1));
    remaining = remaining.slice(bp + 1);
  }
  return chunks;
};

// --- Provider Setup ---
// Smart provider: uses native Google SDK for Google AI Studio (faster, proper tool support)
// Uses OpenAI-compatible for NVIDIA, OpenRouter, and custom endpoints
const getModel = (apiKey: string, baseUrl: string, model: string): LanguageModelV1 => {
  if (baseUrl.includes('generativelanguage.googleapis.com')) {
    // Native Google AI provider — best performance for Gemini models
    const google = createGoogleGenerativeAI({ apiKey });
    return google(model);
  }
  // OpenAI-compatible endpoint (NVIDIA, OpenRouter, custom)
  const openai = createOpenAI({ apiKey, baseURL: baseUrl, compatibility: 'compatible' });
  return openai.chat(model);
};

// --- Extraction Agent ---

const isGoogleProvider = (baseUrl: string): boolean => baseUrl.includes('generativelanguage.googleapis.com');

const processChunk = async (
  apiKey: string,
  baseUrl: string,
  model: string,
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  existingMemory: string,
): Promise<ExtractedFact[]> => {
  const userContent = existingMemory
    ? `EXISTING MEMORY:\n${existingMemory}\n\n---\nChunk ${chunkIndex + 1}/${totalChunks}:\n\n${chunk}`
    : `Chunk ${chunkIndex + 1}/${totalChunks}:\n\n${chunk}`;

  // For Google: use generateObject (structured output) — most reliable for Gemini
  if (isGoogleProvider(baseUrl)) {
    try {
      const result = await generateObject({
        model: getModel(apiKey, baseUrl, model),
        schema: storeFactsSchema,
        system: EXTRACT_SYSTEM_PROMPT,
        prompt: userContent,
        temperature: 0.1,
      });
      console.log(`processChunk (structured): extracted ${result.object.facts.length} facts`);
      return result.object.facts;
    } catch (err) {
      console.error('Structured output failed, trying text fallback:', err);
      // Fall through to text-based extraction below
    }
  }

  // For other providers: use tool calling with generateText
  const allFacts: ExtractedFact[] = [];

  const result = await generateText({
    model: getModel(apiKey, baseUrl, model),
    system: EXTRACT_SYSTEM_PROMPT,
    prompt: userContent,
    tools: {
      store_facts: tool({
        description:
          'Store extracted user facts into memory. Call with an array of facts, each having category, key, value, confidence, and optional action.',
        parameters: storeFactsSchema,
        execute: async ({ facts }) => {
          allFacts.push(...facts);
          return { stored: facts.length };
        },
      }),
    },
    maxSteps: 3,
    temperature: 0.1,
    toolChoice: 'auto',
  });

  // Fallback: handle malformed tool calls and text responses
  if (allFacts.length === 0) {
    // Check if any step had tool calls with malformed arguments
    for (const step of result.steps) {
      for (const tc of step.toolCalls || []) {
        if (tc.toolName === 'store_facts' && tc.args) {
          try {
            const args = tc.args as Record<string, unknown>;
            let factsData = args.facts;
            // Handle double-encoded string (NVIDIA bug)
            if (typeof factsData === 'string') {
              factsData = JSON.parse(factsData);
            }
            if (Array.isArray(factsData)) {
              for (const f of factsData) {
                // Normalize: some models use 'fact' instead of 'key'
                allFacts.push({
                  category: f.category || 'other',
                  key: f.key || f.fact || f.name || '',
                  value: f.value || '',
                  confidence: f.confidence ?? 0.8,
                  action: f.action,
                });
              }
            }
          } catch {
            console.error('Failed to parse malformed tool args');
          }
        }
      }
    }

    // Final fallback: parse JSON from text content
    if (allFacts.length === 0 && result.text) {
      try {
        const match = result.text.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed)) {
            for (const f of parsed) {
              allFacts.push({
                category: f.category || 'other',
                key: f.key || f.fact || f.name || '',
                value: f.value || '',
                confidence: f.confidence ?? 0.8,
                action: f.action,
              });
            }
          }
        }
      } catch {
        console.error('Failed to parse text fallback');
      }
    }
  }

  console.log(`processChunk: extracted ${allFacts.length} facts`);
  return allFacts;
};

// Post-processing
const REDIRECT_DOMAINS = ['lnkd.in', 'bit.ly', 't.co', 'goo.gl', 'tinyurl.com', 'shorturl.at'];
const isRedirectUrl = (value: string): boolean => REDIRECT_DOMAINS.some(d => value.includes(d));

const resolveRedirectUrl = async (url: string): Promise<string | null> => {
  try {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    // Try redirect: 'manual' first to read Location header
    const manualRes = await fetch(fullUrl, { method: 'GET', redirect: 'manual' });
    const location = manualRes.headers.get('location');
    if (location && !isRedirectUrl(location)) {
      return location.startsWith('http') ? location : `https://${location}`;
    }
    // LinkedIn lnkd.in serves an interstitial HTML page with the real URL
    // Parse the HTML to find the actual destination link
    const response = await fetch(fullUrl, { method: 'GET', redirect: 'follow' });
    const html = await response.text();
    // Look for the external link: <a ... data-tracking-control-name="external_url_click" ... href="REAL_URL">
    const extMatch = html.match(/data-tracking-control-name="external_url_click"[^>]*href="([^"]+)"/);
    if (extMatch?.[1] && !isRedirectUrl(extMatch[1])) return extMatch[1];
    // Fallback: look for href in reverse order (href before data-tracking)
    const extMatch2 = html.match(/href="([^"]+)"[^>]*data-tracking-control-name="external_url_click"/);
    if (extMatch2?.[1] && !isRedirectUrl(extMatch2[1])) return extMatch2[1];
    // Check if the response URL itself resolved
    if (response.url && response.url !== fullUrl && !isRedirectUrl(response.url)) return response.url;
    return null;
  } catch {
    return null;
  }
};

const postProcessFacts = async (facts: ExtractedFact[]): Promise<ExtractedFact[]> => {
  // First: split comma-separated URL facts into individual facts
  const expanded: ExtractedFact[] = [];
  for (const fact of facts) {
    if (fact.value && fact.value.includes(',') && isRedirectUrl(fact.value)) {
      // Multiple redirect URLs in one value — split into individual facts
      const urls = fact.value
        .split(',')
        .map(u => u.trim())
        .filter(u => u.length > 0);
      for (let i = 0; i < urls.length; i++) {
        expanded.push({
          ...fact,
          key: urls.length > 1 ? `${fact.key}_${i + 1}` : fact.key,
          value: urls[i],
        });
      }
    } else {
      expanded.push(fact);
    }
  }

  // Resolve redirect URLs (keep original if resolution fails)
  const resolved = await Promise.all(
    expanded.map(async fact => {
      if (fact.value && isRedirectUrl(fact.value)) {
        const url = await resolveRedirectUrl(fact.value);
        if (url) return { ...fact, value: url };
        // Keep the original shortened URL rather than dropping the fact
        console.log(`Could not resolve redirect URL, keeping original: ${fact.value}`);
        return fact;
      }
      return fact;
    }),
  );
  const filtered = resolved.filter(f => f.value || f.action === 'delete');
  const deduped = new Map<string, ExtractedFact>();
  for (const fact of filtered) {
    const key = `${fact.category}:${fact.key}`;
    const existing = deduped.get(key);
    if (!existing || fact.confidence > existing.confidence) deduped.set(key, fact);
  }
  return Array.from(deduped.values());
};

// Threshold: if cleaned content is under this, use single AI call (no chunking)
const SINGLE_CALL_THRESHOLD = 30000;

const extractData = async (
  content: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  existingMemory: string,
  onProgress?: (current: number, total: number, factsFound: number) => void,
): Promise<ExtractedFact[]> => {
  // Content is already cleaned by Readability in the content script
  // Only do light additional cleaning
  const cleaned = cleanContent(content);
  console.log(`Extraction: content length after cleaning: ${cleaned.length} chars`);

  let allFacts: ExtractedFact[];

  if (cleaned.length <= SINGLE_CALL_THRESHOLD) {
    // FAST PATH: Single AI call (most pages after Readability extraction)
    console.log('Using single-call extraction (content fits in one request)');
    onProgress?.(0, 1, 0);
    allFacts = await processChunk(apiKey, baseUrl, model, cleaned, 0, 1, existingMemory);
    onProgress?.(1, 1, allFacts.length);
  } else {
    // SUB-AGENT PATH: Content too large, split into chunks processed in parallel
    // Each sub-agent processes a chunk independently, main agent merges results
    console.log(`Using sub-agent extraction (${cleaned.length} chars > ${SINGLE_CALL_THRESHOLD} threshold)`);
    const chunks = splitIntoChunks(cleaned);
    allFacts = [];
    let completed = 0;

    // Process all chunks in parallel (sub-agents)
    const results = await Promise.allSettled(
      chunks.map((chunk, idx) => processChunk(apiKey, baseUrl, model, chunk, idx, chunks.length, existingMemory)),
    );

    // Main agent: merge results from all sub-agents
    for (const result of results) {
      if (result.status === 'fulfilled') allFacts.push(...result.value);
      else console.error('Sub-agent chunk failed:', result.reason);
      completed++;
      onProgress?.(completed, chunks.length, allFacts.length);
    }
  }

  // Main agent: deduplicate and post-process merged results
  return postProcessFacts(allFacts);
};

// --- Form Fill Agent ---
type FillResult = { instructions: FillInstruction[]; needsMoreInteraction: boolean };

const generateFillInstructions = async (
  userMemory: string,
  formFields: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<FillResult> => {
  const prompt = `USER_MEMORY:\n${userMemory}\n\nFORM_FIELDS:\n${formFields}`;

  // For Google: use generateObject (structured output) — Gemini handles this reliably
  if (isGoogleProvider(baseUrl)) {
    try {
      const result = await generateObject({
        model: getModel(apiKey, baseUrl, model),
        schema: fillResultSchema,
        system: FILL_SYSTEM_PROMPT,
        prompt,
        temperature: 0.2,
      });
      console.log(
        `Fill agent (structured): ${result.object.fields.length} instructions generated, needsMore: ${result.object.needsMoreInteraction}`,
      );
      return {
        instructions: result.object.fields,
        needsMoreInteraction: result.object.needsMoreInteraction ?? false,
      };
    } catch (err) {
      console.error('Structured fill failed, trying tool-calling fallback:', err);
      // Fall through to tool calling below
    }
  }

  // For other providers: use tool calling with generateText
  const allInstructions: FillInstruction[] = [];

  const result = await generateText({
    model: getModel(apiKey, baseUrl, model),
    system: FILL_SYSTEM_PROMPT,
    prompt,
    tools: {
      fill_field: tool({
        description: 'Fill a form field with a value or click a button',
        parameters: z.object({
          selector: z.string().describe('CSS selector for the field or button'),
          value: z.string().describe('Value to fill, or empty string for click'),
          method: z
            .enum(['set', 'select', 'check', 'click'])
            .describe('How to interact: set for text, select for dropdowns, check for checkboxes, click for buttons'),
        }),
        execute: async ({ selector, value, method }) => {
          allInstructions.push({ selector, value, method });
          return { filled: selector };
        },
      }),
    },
    maxSteps: 10,
    temperature: 0.2,
  });

  // Fallback: parse JSON from text if model didn't use tools
  if (allInstructions.length === 0 && result.text) {
    try {
      const match = result.text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]) as FillInstruction[];
        allInstructions.push(...parsed);
      }
    } catch {
      console.error('Failed to parse fill response:', result.text?.slice(0, 300));
    }
  }

  const hasClicks = allInstructions.some(i => i.method === 'click');
  console.log(`Fill agent: ${allInstructions.length} instructions generated in ${result.steps.length} steps`);
  return { instructions: allInstructions, needsMoreInteraction: hasClicks };
};

export { extractData, generateFillInstructions, splitIntoChunks, cleanContent };
export type { ExtractedFact, FillInstruction };
