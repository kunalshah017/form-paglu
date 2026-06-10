import type OpenAI from 'openai';

export const EXTRACT_SYSTEM_PROMPT = `You are a data extraction agent for "Form Paglu". You receive webpage content chunks and extract user data.

IMPORTANT: You may also receive EXISTING MEMORY. Compare new data against it:
- If data matches existing: skip it (don't include in store_facts)
- If data is newer/more accurate: include with action "update"
- If existing data is clearly wrong based on new info: include with action "delete"
- If data is new: include with action "store"

Use the "store_facts" tool with ALL facts found. Only extract ACTUAL USER DATA useful for form filling:
- Names, emails, phones, addresses, DOB, gender
- Education (university, degree, year, GPA)
- Work (company, title, dates, skills)
- IDs (passport, license, SSN last 4, etc.)
- Social profiles, websites

IGNORE: other people's data, page UI text, recommendations, ads, navigation.

Categories: personal, contact, address, education, work, financial, identification, medical, preferences, social
Keys: use semantic names like full_name, email_primary, phone_mobile, company_current, job_title_current, university_name, degree_type, etc.

If a chunk has no useful user data, respond with text "No user data found" (don't call the tool).`;

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
    description: 'Store, update, or delete user facts. Only include facts that need changes.',
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
                  'Category: personal, contact, address, education, work, financial, identification, medical, preferences, social',
              },
              key: {
                type: 'string',
                description: 'Semantic key like full_name, email_primary, phone_mobile, company_current',
              },
              value: { type: 'string', description: 'The extracted value (empty string for delete action)' },
              confidence: { type: 'number', description: 'Confidence score 0-1' },
              action: { type: 'string', enum: ['store', 'update', 'delete'], description: 'What to do with this fact' },
            },
            required: ['category', 'key', 'value', 'confidence'],
          },
        },
      },
      required: ['facts'],
    },
  },
};
