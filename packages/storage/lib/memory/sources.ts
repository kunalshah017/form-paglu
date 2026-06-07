import { db } from './db';
import type { Source } from './db';

const addSource = async (source: Omit<Source, 'id'>): Promise<string> => {
  const id = crypto.randomUUID();
  await db.sources.add({ ...source, id });
  return id;
};

const getAllSources = async (): Promise<Source[]> => db.sources.orderBy('scannedAt').reverse().toArray();

export { addSource, getAllSources };
