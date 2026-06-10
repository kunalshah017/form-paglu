import { PenLine, ScanSearch, Loader2, BrainCircuit } from 'lucide-react';
import type { FC } from 'react';

interface HomeViewProps {
  onScan: () => void;
  onFill: () => void;
  onMemoryClick: () => void;
  factCount: number;
  loading: 'scan' | 'fill' | null;
  status: string;
}

const HomeView: FC<HomeViewProps> = ({ onScan, onFill, onMemoryClick, factCount, loading, status }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
    <div className="flex w-full max-w-xs flex-col gap-4">
      <button
        onClick={onFill}
        disabled={loading !== null || factCount === 0}
        className="border-primary text-secondary font-doodle flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-white px-6 py-4 text-base transition-all hover:scale-[1.02] hover:bg-blue-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
        {loading === 'fill' ? <Loader2 size={20} className="animate-spin" /> : <PenLine size={20} />}
        <span>{loading === 'fill' ? 'filling...' : 'Fill out form'}</span>
      </button>

      <button
        onClick={onScan}
        disabled={loading !== null}
        className="border-secondary text-secondary font-doodle flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-white px-6 py-4 text-base transition-all hover:scale-[1.02] hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
        {loading === 'scan' ? <Loader2 size={20} className="animate-spin" /> : <ScanSearch size={20} />}
        <span>{loading === 'scan' ? 'scanning...' : 'Scan webpage'}</span>
      </button>
    </div>

    {status && <p className="font-doodle text-center text-sm text-gray-600">{status}</p>}

    <button
      onClick={onMemoryClick}
      className="font-doodle hover:text-primary flex items-center gap-2 text-xs text-gray-400 transition-colors">
      <BrainCircuit size={14} />
      <span>{factCount > 0 ? `${factCount} facts in memory` : 'no data scanned yet'}</span>
    </button>
  </div>
);

export { HomeView };
