import { Settings, ArrowLeft } from 'lucide-react';
import type { FC } from 'react';

interface HeaderProps {
  onSettingsClick: () => void;
  showBack?: boolean;
  onBackClick?: () => void;
}

const Header: FC<HeaderProps> = ({ onSettingsClick, showBack, onBackClick }) => (
  <header className="flex items-center justify-between border-b-2 border-dashed border-gray-200 px-4 py-3">
    {showBack ? (
      <button
        onClick={onBackClick}
        className="text-secondary hover:text-primary flex items-center gap-1 transition-colors"
        aria-label="Go back">
        <ArrowLeft size={18} />
        <span className="font-doodle text-sm">back</span>
      </button>
    ) : (
      <div className="flex items-center gap-2">
        <img src={chrome.runtime.getURL('logo.png')} alt="Form Paglu" className="h-8 w-8 rounded" />
        <span className="font-doodle text-secondary text-base font-bold">form paglu</span>
      </div>
    )}
    <button
      onClick={onSettingsClick}
      className="text-secondary hover:text-primary hover:bg-primary/10 flex h-10 w-10 items-center justify-center rounded-lg transition-all"
      aria-label="Settings">
      <Settings size={20} />
    </button>
  </header>
);

export { Header };
