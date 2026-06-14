import { Trash2, Pencil, Check, X, Search } from 'lucide-react';
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
  onEdit?: (id: string, value: string) => void;
}

const openMemoryDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('form-paglu-memory', 2);
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

const CATEGORY_ICONS: Record<string, string> = {
  personal: '👤',
  contact: '📧',
  social: '🔗',
  work: '💼',
  education: '🎓',
  skills: '⚡',
  projects: '🚀',
  certificates: '📜',
  volunteering: '🤝',
  achievements: '🏆',
  identification: '🪪',
};

const MemoryView: FC<MemoryViewProps> = ({ onDelete, onClearAll, onEdit }) => {
  const [facts, setFacts] = useState<FactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

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
        // Expand all categories by default
        const categories = new Set((req.result as FactItem[]).map(f => f.category));
        setExpandedCategories(categories);
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
    if (!confirm('Delete all memories? This cannot be undone.')) return;
    onClearAll();
    setFacts([]);
  };

  const startEdit = (fact: FactItem) => {
    setEditingId(fact.id);
    setEditValue(fact.value);
  };

  const saveEdit = async (id: string) => {
    if (onEdit) {
      onEdit(id, editValue);
    } else {
      // Direct IDB update
      const database = await openMemoryDB();
      const tx = database.transaction('facts', 'readwrite');
      const store = tx.objectStore('facts');
      const req = store.get(id);
      req.onsuccess = () => {
        const fact = req.result;
        if (fact) {
          fact.value = editValue;
          fact.updatedAt = Date.now();
          store.put(fact);
        }
      };
      database.close();
    }
    setFacts(prev => prev.map(f => (f.id === id ? { ...f, value: editValue, updatedAt: Date.now() } : f)));
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  // Filter facts by search
  const filteredFacts = searchQuery
    ? facts.filter(
        f =>
          f.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
          f.value.toLowerCase().includes(searchQuery.toLowerCase()) ||
          f.category.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : facts;

  // Group facts by category
  const grouped: Record<string, FactItem[]> = {};
  for (const fact of filteredFacts) {
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
          scan a webpage or upload a file to get started!
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Search bar */}
      <div className="border-b border-gray-100 px-4 py-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search memories..."
            className="font-doodle focus:border-primary w-full rounded-lg border border-dashed border-gray-200 bg-gray-50 py-1.5 pl-8 pr-3 text-xs outline-none"
          />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="font-doodle text-xs text-gray-400">{filteredFacts.length} facts</span>
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="font-doodle text-xs text-blue-500">
              clear
            </button>
          )}
        </div>
      </div>

      {/* Facts list */}
      <div className="flex-1 overflow-y-auto px-4 pb-2">
        {Object.entries(grouped).map(([category, categoryFacts]) => (
          <div key={category} className="mb-3">
            <button
              onClick={() => toggleCategory(category)}
              className="font-doodle sticky top-0 z-10 mb-1.5 flex w-full items-center gap-2 rounded-md bg-white py-1 text-left text-xs font-bold uppercase tracking-wide text-gray-500 hover:text-gray-700">
              <span>{CATEGORY_ICONS[category] || '📁'}</span>
              <span className="flex-1">{category}</span>
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal text-gray-400">
                {categoryFacts.length}
              </span>
              <span className="text-gray-300">{expandedCategories.has(category) ? '▾' : '▸'}</span>
            </button>

            {expandedCategories.has(category) && (
              <div className="flex flex-col gap-1.5 pl-5">
                {categoryFacts.map(fact => (
                  <div
                    key={fact.id}
                    className="group rounded-lg border border-dashed border-gray-200 bg-white px-3 py-2 transition-all hover:border-gray-300 hover:shadow-sm">
                    {editingId === fact.id ? (
                      /* Edit mode */
                      <div className="flex flex-col gap-1.5">
                        <p className="text-secondary text-xs font-medium">{fact.key.replace(/_/g, ' ')}</p>
                        <textarea
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          className="focus:border-primary w-full rounded border border-gray-300 px-2 py-1 text-xs outline-none"
                          rows={Math.min(5, Math.ceil(editValue.length / 40))}
                        />
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={cancelEdit}
                            className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100">
                            <X size={12} />
                          </button>
                          <button
                            onClick={() => saveEdit(fact.id)}
                            className="text-primary hover:bg-primary/10 rounded px-2 py-0.5 text-xs">
                            <Check size={12} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* View mode */
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-secondary text-xs font-medium">{fact.key.replace(/_/g, ' ')}</p>
                          <p className="mt-0.5 break-words text-xs leading-relaxed text-gray-600">{fact.value}</p>
                        </div>
                        <div className="flex flex-shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => startEdit(fact)}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                            aria-label={`Edit ${fact.key}`}>
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => handleDelete(fact.id)}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                            aria-label={`Delete ${fact.key}`}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 px-4 py-2">
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
