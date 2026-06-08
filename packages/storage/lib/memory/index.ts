export { db } from './db.js';
export type { Fact, Source } from './db.js';
export { upsertFacts, getAllFacts, getFactsByCategory, deleteFact, clearAllFacts, getFactsAsText } from './facts.js';
export { addSource, getAllSources } from './sources.js';
