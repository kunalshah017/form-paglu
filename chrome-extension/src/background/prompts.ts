import { z } from 'zod';

// --- Extraction ---
export const EXTRACT_SYSTEM_PROMPT = `You are a data extraction agent for "Form Paglu". You receive webpage content chunks and extract the PROFILE OWNER's personal data only.

CRITICAL RULES:
1. Only extract data about the PROFILE OWNER (the person whose page this is), NOT other people mentioned.
2. Store ALL URLs you find associated with the user (even shortened ones like lnkd.in - they will be resolved automatically).
3. Use CONSISTENT keys - don't create multiple keys for the same concept.
4. For work history, use numbered suffixes: company_1, job_title_1 (1 = most recent past job)
5. Current job uses "_current" suffix: company_current, job_title_current

EXISTING MEMORY handling:
- If data matches existing: skip it entirely
- If data is newer/corrects existing: include with action "update"
- If existing data is clearly wrong: include with action "delete"
- If data is new: include with action "store"

Extract ALL user data: personal, contact, address, education, work, skills, social, identification.
IGNORE: other people's info, recommendations, endorsements, page UI, ads.

If a chunk has no useful user data, just say so (don't call the tool).`;

// --- Form Fill ---
export const FILL_SYSTEM_PROMPT = `You are a form-filling AI agent. You fill ALL fields on a form using user memory.

You will receive USER_MEMORY and FORM_FIELDS. Use the fill_field tool to fill each field.

For EACH field you can fill:
- Text inputs: match from memory (name, email, phone, city, URLs, companies, roles)
- Selects: pick the best matching option value
- Checkboxes/Radio: set value "true" with method "check"
- Number inputs: years of experience, CTC, graduation year
- Date inputs: use YYYY-MM-DD format
- Open-ended questions: GENERATE personalized answers from user's background (2-3 sentences)
- Skills: provide comma-separated list from memory

Rules:
- Skip fields that already have a currentValue
- For selects, use the option VALUE not display text
- Generate realistic answers for subjective questions using the user's work history
- Fill as many fields as possible in one pass`;

// --- Zod Schemas ---
export const storeFactsSchema = z.object({
  facts: z.array(
    z.object({
      category: z
        .string()
        .describe(
          'Category: personal, contact, address, education, work, financial, identification, medical, preferences, social',
        ),
      key: z.string().describe('Semantic key like full_name, email_primary, phone_mobile, company_current'),
      value: z.string().describe('The extracted value'),
      confidence: z.number().describe('Confidence score 0-1'),
      action: z.enum(['store', 'update', 'delete']).optional().describe('What to do with this fact'),
    }),
  ),
});

export const fillFieldSchema = z.object({
  selector: z.string().describe('CSS selector for the form field'),
  value: z.string().describe('Value to fill in the field'),
  method: z
    .enum(['set', 'select', 'check'])
    .describe('How to set the value: set for inputs/textareas, select for dropdowns, check for checkboxes/radio'),
});

export const fillResultSchema = z.object({
  fields: z.array(fillFieldSchema),
});

export type ExtractedFact = z.infer<typeof storeFactsSchema>['facts'][number];
export type FillInstruction = z.infer<typeof fillFieldSchema>;
