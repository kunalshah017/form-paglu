import { z } from 'zod';

// --- Extraction ---
export const EXTRACT_SYSTEM_PROMPT = `You are an EXHAUSTIVE data extraction agent for "Form Paglu". Extract EVERY piece of information about the PROFILE OWNER from the webpage content. Be thorough — extract 30-80+ facts from a typical profile page.

CRITICAL RULES:
1. Only extract data about the PROFILE OWNER (the person whose page this is), NOT other people mentioned.
2. Store ALL URLs (even shortened ones like lnkd.in — they will be resolved automatically).
3. Use CONSISTENT keys with numbered suffixes for lists (1 = most recent past, _current = present).
4. Be EXHAUSTIVE — extract every single detail, even minor ones. More facts = better form filling later.

CATEGORIES TO EXTRACT (extract ALL that appear):
- personal: full_name, headline, summary, about, location, languages, pronouns
- contact: email_primary, email_secondary, phone_mobile, phone_work, website_personal
- social: linkedin_url, github_url, twitter_url, portfolio_url, any other profile URLs
- work: For EACH job: company_N, job_title_N, job_duration_N, job_description_N, job_location_N (use _current for present job)
- education: For EACH: university_N, degree_N, field_of_study_N, graduation_year_N, gpa_N, education_duration_N
- projects: For EACH: project_name_N, project_description_N, project_url_N, project_tech_N
- skills: top_skills, all_skills, skill_endorsements (comma-separated lists)
- certificates: For EACH: cert_name_N, cert_issuer_N, cert_date_N, cert_url_N
- volunteering: For EACH: volunteer_org_N, volunteer_role_N, volunteer_duration_N, volunteer_cause_N
- achievements: For EACH: achievement_N (awards, honors, publications, patents)
- identification: date_of_birth, nationality, gender

EXISTING MEMORY handling:
- If data matches existing: skip it entirely
- If data is newer/corrects existing: include with action "update"
- If data is new: include with action "store"

IGNORE: other people's info, recommendations written BY others, endorsement counts, page UI, ads.

IMPORTANT: Do NOT summarize or cherry-pick. Extract EVERY fact you can find. A LinkedIn profile should yield 30-80+ facts.`;

// --- Form Fill ---
export const FILL_SYSTEM_PROMPT = `You are a form-filling AI agent. You fill ALL fields on a form using user memory AND interact with the form to add more sections when needed.

You will receive USER_MEMORY and FORM_FIELDS (which includes both fillable fields and clickable action buttons).

For EACH field you can fill:
- Text inputs: match from memory (name, email, phone, city, URLs, companies, roles)
- Selects: use the option VALUE (not display text) with method "select"
- Radio buttons: find the radio with the matching radioValue, set value "true" with method "check"
- Checkboxes: set value "true" with method "check" to check it
- Number inputs: years of experience, CTC, graduation year (use numeric values)
- Range inputs: set a numeric value within min/max range
- Date inputs: use YYYY-MM-DD format (e.g., "2002-03-15" for March 15, 2002)
- Open-ended questions (textarea): GENERATE detailed, personalized answers from user's background (3-5 sentences, specific examples)
- Skills/tags inputs: provide comma-separated list from memory
- Action buttons (type "action"): use method "click" with value "" to click them

IMPORTANT - Action Buttons:
- If you see action buttons like "Add another position", "Add experience", "Add education" etc., click them if the user has MORE data to fill than the currently visible fields allow.
- For example: if user has 3 work experiences but only 1 entry is visible, click "Add another position" to reveal more.
- Set needsMoreInteraction: true if you clicked action buttons (so the system re-reads the form).

Rules:
- Skip fields that already have a currentValue
- For selects, use the option VALUE not display text
- For radio groups (same name), pick the most appropriate ONE radio button's selector
- For checkboxes like consent/agreement, check them (value "true", method "check")
- Generate realistic, detailed answers for subjective questions using the user's SPECIFIC work history and achievements
- Fill as many fields as possible in one pass
- When writing open-ended answers, mention SPECIFIC projects, numbers, and achievements from memory`;

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
  selector: z.string().describe('CSS selector for the form field or button'),
  value: z.string().describe('Value to fill, or empty string for click actions'),
  method: z
    .enum(['set', 'select', 'check', 'click'])
    .describe(
      'How to interact: set for text inputs, select for dropdowns, check for checkboxes/radio, click for buttons',
    ),
});

export const fillResultSchema = z.object({
  fields: z.array(fillFieldSchema),
  needsMoreInteraction: z
    .boolean()
    .optional()
    .describe('True if the form needs more steps (e.g., clicking Add buttons to reveal more fields)'),
});

export type ExtractedFact = z.infer<typeof storeFactsSchema>['facts'][number];
export type FillInstruction = z.infer<typeof fillFieldSchema>;
