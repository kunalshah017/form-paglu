import { EXTRACT_SYSTEM_PROMPT, FILL_SYSTEM_PROMPT, STORE_FACTS_TOOL } from './prompts';
import OpenAI from 'openai';

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

// Split content into chunks at natural boundaries (paragraphs/sentences)
const CHUNK_SIZE = 4000;
const splitIntoChunks = (content: string): string[] => {
  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }

    // Find a natural break point (double newline, single newline, or period+space)
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

// Collect a streaming response into a complete message (handles providers that force streaming)
const collectStreamResponse = async (
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
): Promise<{ content: string; toolCalls: { name: string; arguments: string }[] }> => {
  let content = '';
  const toolCallParts: Record<number, { name: string; arguments: string }> = {};

  for await (const chunk of stream) {
    // Some providers send chunks with empty/missing choices (heartbeats, reasoning tokens)
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

// Process a single chunk - tries non-streaming first, falls back to streaming
const processChunk = async (
  client: OpenAI,
  model: string,
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
): Promise<ExtractedFact[]> => {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Chunk ${chunkIndex + 1}/${totalChunks}. Extract all user data from this content:\n\n${chunk}`,
    },
  ];

  // Use streaming to handle all providers (some force streaming regardless)
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

  // If tool calls were made, parse them
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

  // Fallback: try to parse JSON from content (for models that don't support tools)
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

// Main extraction: chunks content and processes each with tool calling
const extractData = async (
  content: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  onProgress?: (current: number, total: number, factsFound: number) => void,
): Promise<ExtractedFact[]> => {
  const client = createClient(apiKey, baseUrl);
  const chunks = splitIntoChunks(content);
  const allFacts: ExtractedFact[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkFacts = await processChunk(client, model, chunks[i], i, chunks.length);
    allFacts.push(...chunkFacts);
    onProgress?.(i + 1, chunks.length, allFacts.length);
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

export { extractData, generateFillInstructions, splitIntoChunks };
export type { ExtractedFact, FillInstruction };
