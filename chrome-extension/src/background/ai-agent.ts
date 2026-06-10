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
const CONCURRENCY = 3;
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

  return allFacts;
};

const generateFillInstructions = async (
  userMemory: string,
  formFields: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<FillInstruction[]> => {
  const client = createClient(apiKey, baseUrl);

  const stream = await client.chat.completions.create({
    model,
    stream: true,
    messages: [
      { role: 'system', content: FILL_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `USER_MEMORY:\n${userMemory}\n\nFORM_FIELDS:\n${formFields}`,
      },
    ],
    temperature: 0.1,
  });

  const { content } = await collectStreamResponse(
    stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  );

  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as FillInstruction[];
  } catch {
    console.error('Failed to parse AI fill response:', content);
    return [];
  }
};

export { extractData, generateFillInstructions, splitIntoChunks, cleanContent };
export type { ExtractedFact, FillInstruction };
