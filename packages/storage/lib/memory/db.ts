import { Dexie } from 'dexie';
import type { EntityTable } from 'dexie';

interface Fact {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  extractedAt: number;
  updatedAt: number;
}

interface Source {
  id: string;
  type: 'webpage' | 'document' | 'image';
  identifier: string;
  scannedAt: number;
  factCount: number;
}

const db = new Dexie('form-paglu-memory') as Dexie & {
  facts: EntityTable<Fact, 'id'>;
  sources: EntityTable<Source, 'id'>;
};

db.version(1).stores({
  facts: 'id, category, key, source, updatedAt',
  sources: 'id, type, scannedAt',
});

export { db };
export type { Fact, Source };
