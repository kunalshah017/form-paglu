import { PenLine, ScanSearch, Loader2, Upload, Database } from 'lucide-react';
import type { FC } from 'react';

interface HomeViewProps {
  onScan: () => void;
  onFill: () => void;
  onUpload: () => void;
  onMemoryClick: () => void;
  factCount: number;
  loading: 'scan' | 'fill' | 'upload' | null;
  status: string;
}

const HomeView: FC<HomeViewProps> = ({ onScan, onFill, onUpload, onMemoryClick, factCount, loading, status }) => (
  <div className="flex flex-1 flex-col items-center justify-between p-6">
    <div />

    <div className="flex w-full max-w-xs flex-col items-center gap-4">
      <button
        onClick={onFill}
        disabled={loading !== null || factCount === 0}
        className="border-primary text-secondary font-doodle flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-white px-6 py-4 text-base transition-all hover:scale-[1.02] hover:bg-red-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
        {loading === 'fill' ? <Loader2 size={20} className="animate-spin" /> : <PenLine size={20} />}
        <span>{loading === 'fill' ? 'filling...' : 'Fill out form'}</span>
      </button>

      {/* Separator */}
      <div className="flex w-full items-center gap-3">
        <div className="h-px flex-1 border-t border-dashed border-gray-200" />
        <span className="font-doodle text-xs text-gray-300">or add data</span>
        <div className="h-px flex-1 border-t border-dashed border-gray-200" />
      </div>

      <button
        onClick={onScan}
        disabled={loading !== null}
        className="border-secondary text-secondary font-doodle flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-white px-6 py-4 text-base transition-all hover:scale-[1.02] hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
        {loading === 'scan' ? <Loader2 size={20} className="animate-spin" /> : <ScanSearch size={20} />}
        <span>{loading === 'scan' ? 'scanning...' : 'Scan webpage'}</span>
      </button>

      <button
        onClick={onUpload}
        disabled={loading !== null}
        className="border-secondary text-secondary font-doodle flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-white px-6 py-4 text-base transition-all hover:scale-[1.02] hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
        {loading === 'upload' ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
        <span>{loading === 'upload' ? 'extracting...' : 'Upload PDF / Image'}</span>
      </button>

      {status && <p className="font-doodle text-center text-sm text-gray-600">{status}</p>}
    </div>

    {/* Bottom: View Memories */}
    <div className="flex flex-col items-center gap-1 pb-2">
      <button
        onClick={onMemoryClick}
        className="font-doodle text-secondary flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm transition-all hover:border-red-300 hover:bg-red-50">
        <Database size={14} />
        <span>View Memories</span>
        {factCount > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">{factCount}</span>
        )}
      </button>
      {factCount === 0 && <p className="font-doodle text-xs text-gray-400">no data scanned yet</p>}
    </div>
  </div>
);

export { HomeView };
