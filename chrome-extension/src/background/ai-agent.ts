import { EXTRACT_SYSTEM_PROMPT, FILL_SYSTEM_PROMPT, storeFactsSchema } from './prompts';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import type { ExtractedFact, FillInstruction } from './prompts';

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
const createProvider = (apiKey: string, baseUrl: string) =>
  createOpenAI({ apiKey, baseURL: baseUrl, compatibility: 'compatible' });

// --- Extraction Agent ---

const processChunk = async (
  apiKey: string,
  baseUrl: string,
  model: string,
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  existingMemory: string,
): Promise<ExtractedFact[]> => {
  const provider = createProvider(apiKey, baseUrl);
  const userContent = existingMemory
    ? `EXISTING MEMORY:\n${existingMemory}\n\n---\nChunk ${chunkIndex + 1}/${totalChunks}:\n\n${chunk}`
    : `Chunk ${chunkIndex + 1}/${totalChunks}:\n\n${chunk}`;

  const allFacts: ExtractedFact[] = [];

  const result = await generateText({
    model: provider(model),
    system: EXTRACT_SYSTEM_PROMPT,
    prompt: userContent,
    tools: {
      store_facts: tool({
        description: 'Store extracted user facts into memory',
        parameters: storeFactsSchema,
        execute: async ({ facts }) => {
          allFacts.push(...facts);
          return { stored: facts.length };
        },
      }),
    },
    maxSteps: 3,
    temperature: 0.1,
  });

  // Fallback: if model returned JSON content instead of tool call
  if (allFacts.length === 0 && result.text) {
    try {
      const match = result.text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) allFacts.push(...parsed);
      }
    } catch {
      // ignore parse failures
    }
  }

  return allFacts;
};

// Post-processing
const REDIRECT_DOMAINS = ['lnkd.in', 'bit.ly', 't.co', 'goo.gl', 'tinyurl.com', 'shorturl.at'];
const isRedirectUrl = (value: string): boolean => REDIRECT_DOMAINS.some(d => value.includes(d));

const resolveRedirectUrl = async (url: string): Promise<string | null> => {
  try {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const response = await fetch(fullUrl, { method: 'HEAD', redirect: 'follow' });
    const finalUrl = response.url;
    if (finalUrl && finalUrl !== fullUrl && !isRedirectUrl(finalUrl)) return finalUrl;
    return null;
  } catch {
    return null;
  }
};

const postProcessFacts = async (facts: ExtractedFact[]): Promise<ExtractedFact[]> => {
  const resolved = await Promise.all(
    facts.map(async fact => {
      if (fact.value && isRedirectUrl(fact.value)) {
        const url = await resolveRedirectUrl(fact.value);
        return url ? { ...fact, value: url } : null;
      }
      return fact;
    }),
  );
  const filtered = (resolved.filter(Boolean) as ExtractedFact[]).filter(f => f.value || f.action === 'delete');
  const deduped = new Map<string, ExtractedFact>();
  for (const fact of filtered) {
    const key = `${fact.category}:${fact.key}`;
    const existing = deduped.get(key);
    if (!existing || fact.confidence > existing.confidence) deduped.set(key, fact);
  }
  return Array.from(deduped.values());
};

// Threshold: if cleaned content is under this, use single AI call (no chunking)
const SINGLE_CALL_THRESHOLD = 12000;

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
const generateFillInstructions = async (
  userMemory: string,
  formFields: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<FillInstruction[]> => {
  const provider = createProvider(apiKey, baseUrl);
  const allInstructions: FillInstruction[] = [];

  // Use generateText with tool calling - agent decides what to fill
  const result = await generateText({
    model: provider(model),
    system: FILL_SYSTEM_PROMPT,
    prompt: `USER_MEMORY:\n${userMemory}\n\nFORM_FIELDS:\n${formFields}`,
    tools: {
      fill_field: tool({
        description: 'Fill a form field with a value',
        parameters: z.object({
          selector: z.string().describe('CSS selector for the field'),
          value: z.string().describe('Value to fill'),
          method: z
            .enum(['set', 'select', 'check'])
            .describe('How to set: set for text, select for dropdowns, check for checkboxes'),
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

  console.log(`Fill agent: ${allInstructions.length} instructions generated in ${result.steps.length} steps`);
  return allInstructions;
};

export { extractData, generateFillInstructions, splitIntoChunks, cleanContent };
export type { ExtractedFact, FillInstruction };
