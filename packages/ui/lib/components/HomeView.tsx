import { PenLine, ScanSearch, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { FC } from 'react';

interface HomeViewProps {
  onScan: () => Promise<void>;
  onFill: () => Promise<void>;
  factCount: number;
}

const HomeView: FC<HomeViewProps> = ({ onScan, onFill, factCount }) => {
  const [loading, setLoading] = useState<'scan' | 'fill' | null>(null);
  const [status, setStatus] = useState<string>('');

  const handleScan = async () => {
    setLoading('scan');
    setStatus('Scanning page...');
    try {
      await onScan();
      setStatus('Scan complete!');
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(null);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  const handleFill = async () => {
    setLoading('fill');
    setStatus('Filling form...');
    try {
      await onFill();
      setStatus('Form filled!');
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(null);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <div className="flex w-full max-w-xs flex-col gap-4">
        <button
          onClick={handleFill}
          disabled={loading !== null || factCount === 0}
          className="border-primary text-secondary font-doodle flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-white px-6 py-4 text-base transition-all hover:scale-[1.02] hover:bg-blue-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
          {loading === 'fill' ? <Loader2 size={20} className="animate-spin" /> : <PenLine size={20} />}
          <span>{loading === 'fill' ? 'filling...' : 'Fill out form'}</span>
        </button>

        <button
          onClick={handleScan}
          disabled={loading !== null}
          className="border-secondary text-secondary font-doodle flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-white px-6 py-4 text-base transition-all hover:scale-[1.02] hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
          {loading === 'scan' ? <Loader2 size={20} className="animate-spin" /> : <ScanSearch size={20} />}
          <span>{loading === 'scan' ? 'scanning...' : 'Scan webpage'}</span>
        </button>
      </div>

      {status && <p className="font-doodle text-center text-sm text-gray-600">{status}</p>}

      <p className="font-doodle text-xs text-gray-400">
        {factCount > 0 ? `${factCount} facts in memory` : 'no data scanned yet'}
      </p>
    </div>
  );
};

export { HomeView };
