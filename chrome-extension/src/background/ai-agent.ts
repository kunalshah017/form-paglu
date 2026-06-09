import { EXTRACT_SYSTEM_PROMPT, FILL_SYSTEM_PROMPT } from './prompts';
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

// Truncate content to avoid token limits and timeouts
const MAX_CONTENT_LENGTH = 15000;
const truncateContent = (content: string): string => {
  if (content.length <= MAX_CONTENT_LENGTH) return content;
  return content.slice(0, MAX_CONTENT_LENGTH) + '\n\n[...content truncated]';
};

const createClient = (apiKey: string, baseUrl: string): OpenAI =>
  new OpenAI({
    apiKey,
    baseURL: baseUrl,
    dangerouslyAllowBrowser: true,
  });

const extractData = async (
  content: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<ExtractedFact[]> => {
  const client = createClient(apiKey, baseUrl);
  const trimmed = truncateContent(content);

  const response = await client.chat.completions.create({
    model,
    stream: false,
    messages: [
      { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
      { role: 'user', content: `Extract all user data from this content:\n\n${trimmed}` },
    ],
    temperature: 0.1,
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

export { extractData, generateFillInstructions };
export type { ExtractedFact, FillInstruction };
