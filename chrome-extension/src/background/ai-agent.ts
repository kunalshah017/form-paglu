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

// Process a single chunk using tool calling
const processChunk = async (
  client: OpenAI,
  model: string,
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
): Promise<ExtractedFact[]> => {
  const response = await client.chat.completions.create({
    model,
    stream: false,
    messages: [
      { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Chunk ${chunkIndex + 1}/${totalChunks}. Extract all user data from this content:\n\n${chunk}`,
      },
    ],
    tools: [STORE_FACTS_TOOL],
    tool_choice: 'auto',
    temperature: 0.1,
  });

  const message = response.choices[0]?.message;
  if (!message?.tool_calls?.length) return [];

  const allFacts: ExtractedFact[] = [];
  for (const toolCall of message.tool_calls) {
    if (toolCall.function.name === 'store_facts') {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        if (Array.isArray(args.facts)) {
          allFacts.push(...args.facts);
        }
      } catch {
        console.error('Failed to parse tool call arguments:', toolCall.function.arguments);
      }
    }
  }
  return allFacts;
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

  const response = await client.chat.completions.create({
    model,
    stream: false,
    messages: [
      { role: 'system', content: FILL_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `USER_MEMORY:\n${userMemory}\n\nFORM_FIELDS:\n${formFields}`,
      },
    ],
    temperature: 0.1,
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
};

export { extractData, generateFillInstructions, splitIntoChunks };
export type { ExtractedFact, FillInstruction };
