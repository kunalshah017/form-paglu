import type OpenAI from 'openai';

export const EXTRACT_SYSTEM_PROMPT = `You are a data extraction agent. You will receive chunks of webpage content one at a time.

For each chunk, use the "store_facts" tool to save any personal/professional user data you find. Call the tool once per chunk with ALL facts found in that chunk.

Categories: personal, contact, address, education, work, financial, identification, medical, preferences, social, other
Keys should be semantic: full_name, email_primary, phone_mobile, company_name, job_title, university_name, etc.

Extract EVERYTHING useful for filling forms. Be thorough. If a chunk has no useful data, respond with text saying so (don't call the tool).`;

export const FILL_SYSTEM_PROMPT = `You are a form-filling AI agent for the "Form Paglu" Chrome extension.

You will receive:
1. USER_MEMORY: All known facts about the user
2. FORM_FIELDS: List of form fields on the current page with their attributes

Your job: Map user memory to form fields. For each form field, determine the best matching value from memory.

Rules:
1. Match fields by analyzing: name, id, label, placeholder, aria-label, type attributes
2. Be smart about variations (e.g., "fname" = first_name, "tel" = phone)
3. Only fill fields you're confident about
4. For select/dropdown fields, pick the closest matching option
5. For date fields, format appropriately (the value should match the input type)
6. Skip password, captcha, and file upload fields
7. If a field has multiple possible matches, pick the highest confidence one

Respond ONLY with valid JSON array:
[{"selector": "css-selector-for-field", "value": "value-to-fill", "method": "set|select|check"}]

If no fields can be filled, respond with: []`;

export const STORE_FACTS_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'store_facts',
    description: 'Store extracted user facts from the current content chunk into memory',
    parameters: {
      type: 'object',
      properties: {
        facts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              category: {
                type: 'string',
                description:
                  'Category: personal, contact, address, education, work, financial, identification, medical, preferences, social, other',
              },
              key: {
                type: 'string',
                description: 'Semantic key like full_name, email_primary, phone_mobile, company_name',
              },
              value: { type: 'string', description: 'The extracted value' },
              confidence: { type: 'number', description: 'Confidence score 0-1' },
            },
            required: ['category', 'key', 'value', 'confidence'],
          },
        },
      },
      required: ['facts'],
    },
  },
};
