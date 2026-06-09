import { Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { FC } from 'react';

interface FactItem {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  updatedAt: number;
}

interface MemoryViewProps {
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

const openMemoryDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('form-paglu-memory', 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains('facts')) {
        const store = database.createObjectStore('facts', { keyPath: 'id' });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('key', 'key', { unique: false });
        store.createIndex('source', 'source', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const MemoryView: FC<MemoryViewProps> = ({ onDelete, onClearAll }) => {
  const [facts, setFacts] = useState<FactItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFacts = async () => {
    setLoading(true);
    try {
      const database = await openMemoryDB();
      const tx = database.transaction('facts', 'readonly');
      const store = tx.objectStore('facts');
      const req = store.getAll();
      req.onsuccess = () => {
        setFacts(req.result as FactItem[]);
        setLoading(false);
      };
      database.close();
    } catch {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFacts();
  }, []);

  const handleDelete = async (id: string) => {
    onDelete(id);
    setFacts(prev => prev.filter(f => f.id !== id));
  };

  const handleClearAll = () => {
    onClearAll();
    setFacts([]);
  };

  // Group facts by category
  const grouped: Record<string, FactItem[]> = {};
  for (const fact of facts) {
    if (!grouped[fact.category]) grouped[fact.category] = [];
    grouped[fact.category].push(fact);
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="font-doodle text-sm text-gray-400">loading memory...</p>
      </div>
    );
  }

  if (facts.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-doodle text-center text-sm text-gray-400">
          no data in memory yet.
          <br />
          scan a webpage to get started!
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {Object.entries(grouped).map(([category, categoryFacts]) => (
          <div key={category} className="mb-4">
            <h3 className="font-doodle text-primary mb-2 text-xs font-bold uppercase tracking-wide">{category}</h3>
            <div className="flex flex-col gap-1">
              {categoryFacts.map(fact => (
                <div
                  key={fact.id}
                  className="group flex items-start justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-secondary text-sm font-medium">{fact.key.replace(/_/g, ' ')}</p>
                    <p className="truncate text-sm text-gray-600">{fact.value}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(fact.id)}
                    className="ml-2 flex-shrink-0 text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    aria-label={`Delete ${fact.key}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 px-4 py-3">
        <button
          onClick={handleClearAll}
          className="font-doodle w-full rounded-lg border-2 border-dashed border-red-200 py-2 text-xs text-red-500 transition-all hover:border-red-400 hover:bg-red-50">
          clear all memory
        </button>
      </div>
    </div>
  );
};

export { MemoryView };
