import { EXTRACT_SYSTEM_PROMPT, FILL_SYSTEM_PROMPT, STORE_FACTS_TOOL } from './prompts';
import OpenAI from 'openai';

interface ExtractedFact {
  category: string;
  key: string;
  value: string;
  confidence: number;
  action?: 'store' | 'update' | 'delete';
}

interface FillInstruction {
  selector: string;
  value: string;
  method: 'set' | 'select' | 'check';
}

// Strip boilerplate/navigation content, keep only meaningful text
const cleanContent = (raw: string): string => {
  const lines = raw.split('\n');
  const cleaned: string[] = [];
  const skipPatterns =
    /^(skip to|cookie|accept|decline|sign in|sign up|log in|©|privacy|terms|all rights|menu|navigation|footer|header|sidebar|advertisement|sponsored|loading|please wait)/i;
  const shortLineThreshold = 3; // skip very short lines (usually UI elements)

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.length <= shortLineThreshold) continue;
    if (skipPatterns.test(trimmed)) continue;
    // Skip lines that are just repeated separators or bullets
    if (/^[•\-=_|·]{3,}$/.test(trimmed)) continue;
    cleaned.push(trimmed);
  }

  // Deduplicate consecutive identical lines
  const deduped: string[] = [];
  for (const line of cleaned) {
    if (deduped[deduped.length - 1] !== line) deduped.push(line);
  }

  return deduped.join('\n');
};

// Split content into chunks at natural boundaries
const CHUNK_SIZE = 6000;
const splitIntoChunks = (content: string): string[] => {
  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }

    let breakPoint = remaining.lastIndexOf('\n\n', CHUNK_SIZE);
    if (breakPoint < CHUNK_SIZE * 0.5) breakPoint = remaining.lastIndexOf('\n', CHUNK_SIZE);
    if (breakPoint < CHUNK_SIZE * 0.5) breakPoint = remaining.lastIndexOf('. ', CHUNK_SIZE);
    if (breakPoint < CHUNK_SIZE * 0.5) breakPoint = CHUNK_SIZE;

    chunks.push(remaining.slice(0, breakPoint + 1));
    remaining = remaining.slice(breakPoint + 1);
  }

  return chunks;
};

const createClient = (apiKey: string, baseUrl: string): OpenAI =>
  new OpenAI({
    apiKey,
    baseURL: baseUrl,
    dangerouslyAllowBrowser: true,
  });

// Collect a streaming response into a complete message
const collectStreamResponse = async (
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
): Promise<{ content: string; toolCalls: { name: string; arguments: string }[] }> => {
  let content = '';
  const toolCallParts: Record<number, { name: string; arguments: string }> = {};

  for await (const chunk of stream) {
    if (!chunk.choices || !chunk.choices[0]) continue;
    const delta = chunk.choices[0].delta;
    if (!delta) continue;

    if (delta.content) content += delta.content;

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (!toolCallParts[tc.index]) {
          toolCallParts[tc.index] = { name: '', arguments: '' };
        }
        if (tc.function?.name) toolCallParts[tc.index].name += tc.function.name;
        if (tc.function?.arguments) toolCallParts[tc.index].arguments += tc.function.arguments;
      }
    }
  }

  return { content: content.trim(), toolCalls: Object.values(toolCallParts) };
};

// Process a single chunk with existing memory context
const processChunk = async (
  client: OpenAI,
  model: string,
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  existingMemory: string,
): Promise<ExtractedFact[]> => {
  const userContent = existingMemory
    ? `EXISTING MEMORY (update/delete if needed):\n${existingMemory}\n\n---\nChunk ${chunkIndex + 1}/${totalChunks}. Extract user data:\n\n${chunk}`
    : `Chunk ${chunkIndex + 1}/${totalChunks}. Extract all user data:\n\n${chunk}`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const stream = await client.chat.completions.create({
    model,
    stream: true,
    messages,
    tools: [STORE_FACTS_TOOL],
    tool_choice: 'auto',
    temperature: 0.1,
  });

  const { content, toolCalls } = await collectStreamResponse(
    stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  );

  if (toolCalls.length > 0) {
    const allFacts: ExtractedFact[] = [];
    for (const tc of toolCalls) {
      if (tc.name === 'store_facts') {
        try {
          const args = JSON.parse(tc.arguments);
          if (Array.isArray(args.facts)) allFacts.push(...args.facts);
        } catch {
          console.error('Failed to parse tool call:', tc.arguments);
        }
      }
    }
    return allFacts;
  }

  // Fallback: parse JSON from content
  if (content) {
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]) as ExtractedFact[];
    } catch {
      console.error('Failed to parse content as facts:', content);
    }
  }

  return [];
};

// Main extraction: cleans content, chunks it, processes in parallel batches
const CONCURRENCY = 4;
const extractData = async (
  content: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  existingMemory: string,
  onProgress?: (current: number, total: number, factsFound: number) => void,
): Promise<ExtractedFact[]> => {
  const client = createClient(apiKey, baseUrl);
  const cleaned = cleanContent(content);
  const chunks = splitIntoChunks(cleaned);
  const allFacts: ExtractedFact[] = [];
  let completed = 0;

  // Process chunks in parallel batches
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((chunk, idx) => processChunk(client, model, chunk, i + idx, chunks.length, existingMemory)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allFacts.push(...result.value);
      } else {
        console.error('Chunk processing failed:', result.reason);
      }
      completed++;
      onProgress?.(completed, chunks.length, allFacts.length);
    }
  }

  return postProcessFacts(allFacts);
};

// Post-process: resolve redirects, filter bad data, deduplicate, normalize
const REDIRECT_DOMAINS = ['lnkd.in', 'bit.ly', 't.co', 'goo.gl', 'tinyurl.com', 'shorturl.at'];

const isRedirectUrl = (value: string): boolean => REDIRECT_DOMAINS.some(domain => value.includes(domain));

// Resolve a shortened URL to its final destination
const resolveRedirectUrl = async (url: string): Promise<string | null> => {
  try {
    // Ensure it has a protocol
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const response = await fetch(fullUrl, { method: 'HEAD', redirect: 'follow' });
    const finalUrl = response.url;
    // Only return if it resolved to something different and useful
    if (finalUrl && finalUrl !== fullUrl && !isRedirectUrl(finalUrl)) {
      return finalUrl;
    }
    return null;
  } catch {
    return null;
  }
};

const postProcessFacts = async (facts: ExtractedFact[]): Promise<ExtractedFact[]> => {
  // Resolve redirect URLs instead of just filtering them out
  const resolved = await Promise.all(
    facts.map(async fact => {
      if (fact.value && isRedirectUrl(fact.value)) {
        const resolvedUrl = await resolveRedirectUrl(fact.value);
        if (resolvedUrl) {
          return { ...fact, value: resolvedUrl };
        }
        // If resolution failed, drop the fact
        return null;
      }
      return fact;
    }),
  );

  const filtered = (resolved.filter(Boolean) as ExtractedFact[]).filter(fact => {
    if (!fact.value && fact.action !== 'delete') return false;
    return true;
  });

  // Deduplicate: keep highest confidence for same category+key
  const deduped = new Map<string, ExtractedFact>();
  for (const fact of filtered) {
    const dedupKey = `${fact.category}:${fact.key}`;
    const existing = deduped.get(dedupKey);
    if (!existing || fact.confidence > existing.confidence) {
      deduped.set(dedupKey, fact);
    }
  }

  return Array.from(deduped.values());
};

// Single pass of fill instruction generation
const runFillPass = async (
  client: OpenAI,
  model: string,
  userMemory: string,
  formFields: string,
  pass: string,
): Promise<FillInstruction[]> => {
  const stream = await client.chat.completions.create({
    model,
    stream: true,
    messages: [
      { role: 'system', content: FILL_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `PASS: ${pass}\n\nUSER_MEMORY:\n${userMemory}\n\nFORM_FIELDS:\n${formFields}`,
      },
    ],
    temperature: pass === 'generate_answers' ? 0.4 : 0.1,
  });

  const { content } = await collectStreamResponse(
    stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  );

  console.log(`Fill pass "${pass}" response length:`, content.length);

  if (!content) return [];

  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error(`No JSON in "${pass}" response:`, content.slice(0, 300));
      return [];
    }
    const instructions = JSON.parse(jsonMatch[0]) as FillInstruction[];
    console.log(`Fill pass "${pass}": ${instructions.length} instructions`);
    return instructions;
  } catch (err) {
    console.error(`Failed to parse "${pass}" response:`, err, content.slice(0, 300));
    return [];
  }
};

// Multi-turn fill: data pass → generate pass
const generateFillInstructions = async (
  userMemory: string,
  formFields: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<FillInstruction[]> => {
  const client = createClient(apiKey, baseUrl);
  const allInstructions: FillInstruction[] = [];

  // Pass 1: Fill direct data matches (name, email, phone, selects, checkboxes, etc.)
  console.log('Starting fill pass 1: fill_data');
  const dataInstructions = await runFillPass(client, model, userMemory, formFields, 'fill_data');
  allInstructions.push(...dataInstructions);

  // Pass 2: Generate answers for open-ended/empty fields
  // Update form fields with what we just filled to avoid re-filling
  const filledSelectors = new Set(dataInstructions.map(i => i.selector));
  const fields = JSON.parse(formFields);
  const remainingFields = fields.filter(
    (f: { selector: string; currentValue?: string }) => !filledSelectors.has(f.selector) && !f.currentValue,
  );

  if (remainingFields.length > 0) {
    console.log(`Starting fill pass 2: generate_answers (${remainingFields.length} remaining fields)`);
    const generateInstructions = await runFillPass(
      client,
      model,
      userMemory,
      JSON.stringify(remainingFields),
      'generate_answers',
    );
    allInstructions.push(...generateInstructions);
  }

  console.log(`Total fill instructions: ${allInstructions.length}`);
  return allInstructions;
};

export { extractData, generateFillInstructions, splitIntoChunks, cleanContent };
export type { ExtractedFact, FillInstruction };
