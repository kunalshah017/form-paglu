import type OpenAI from 'openai';

export const EXTRACT_SYSTEM_PROMPT = `You are a data extraction agent for "Form Paglu". You receive webpage content chunks and extract the PROFILE OWNER's personal data only.

CRITICAL RULES:
1. Only extract data about the PROFILE OWNER (the person whose page this is), NOT other people mentioned.
2. Store ALL URLs you find associated with the user (even shortened ones like lnkd.in - they will be resolved automatically).
3. Use CONSISTENT keys - don't create multiple keys for the same concept:
   - One "linkedin_url" not "linkedin_url" + "linkedin_profile"
   - One "github_url" not "github_url" + "github_profile"  
   - One "job_title_current" for current job, "job_title_1", "job_title_2" for past jobs (numbered by recency)
4. For work history, use numbered suffixes: company_1, job_title_1, work_start_1, work_end_1 (1 = most recent past job)
5. Current job uses "_current" suffix: company_current, job_title_current

EXISTING MEMORY handling:
- If data matches existing: skip it entirely
- If data is newer/corrects existing: include with action "update"
- If existing data is clearly wrong: include with action "delete"
- If data is new: include with action "store"

Extract ALL user data you can find:
- Personal: full_name, gender, date_of_birth, languages
- Contact: email_primary, phone_mobile, phone_home
- Address: city, state, country, zip_code, full_address
- Education: university_name, degree_type, field_of_study, graduation_year, gpa
- Work: company_current, job_title_current, work_start_current, company_1, job_title_1, etc.
- Skills: skills (comma-separated list)
- Social: linkedin_url, github_url, portfolio_url, twitter_url (store any URL found, even shortened)
- Identification: certifications, licenses

IGNORE: other people's info, recommendations text, endorsements from others, page UI elements, ads.

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
