import { db } from './db.js';
import type { Fact } from './db.js';

const upsertFacts = async (facts: Omit<Fact, 'id' | 'updatedAt'>[]): Promise<void> => {
  const now = Date.now();

  await db.transaction('rw', db.facts, async () => {
    for (const fact of facts) {
      const existing = await db.facts.where({ key: fact.key, category: fact.category }).first();

      if (existing) {
        await db.facts.update(existing.id, {
          value: fact.value,
          confidence: fact.confidence,
          source: fact.source,
          updatedAt: now,
        });
      } else {
        await db.facts.add({
          ...fact,
          id: crypto.randomUUID(),
          updatedAt: now,
        });
      }
    }
  });
};

const getAllFacts = async (): Promise<Fact[]> => db.facts.orderBy('category').toArray();

const getFactsByCategory = async (category: string): Promise<Fact[]> =>
  db.facts.where('category').equals(category).toArray();

const deleteFact = async (id: string): Promise<void> => {
  await db.facts.delete(id);
};

const clearAllFacts = async (): Promise<void> => {
  await db.facts.clear();
};

const getFactsAsText = async (): Promise<string> => {
  const facts = await getAllFacts();
  if (facts.length === 0) return 'No user data stored yet.';

  const grouped: Record<string, Fact[]> = {};
  for (const fact of facts) {
    if (!grouped[fact.category]) grouped[fact.category] = [];
    grouped[fact.category].push(fact);
  }

  let text = '';
  for (const [category, categoryFacts] of Object.entries(grouped)) {
    text += `\n[${category}]\n`;
    for (const f of categoryFacts) {
      text += `  ${f.key}: ${f.value}\n`;
    }
  }
  return text.trim();
};

export { upsertFacts, getAllFacts, getFactsByCategory, deleteFact, clearAllFacts, getFactsAsText };
