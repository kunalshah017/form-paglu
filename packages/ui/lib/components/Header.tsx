import type { FC } from 'react';

interface HeaderProps {
  onSettingsClick: () => void;
  showBack?: boolean;
  onBackClick?: () => void;
}

const Header: FC<HeaderProps> = ({ onSettingsClick, showBack, onBackClick }) => (
  <header className="flex items-center justify-between border-b-2 border-dashed border-gray-300 px-4 py-3">
    {showBack ? (
      <button onClick={onBackClick} className="font-doodle text-secondary hover:text-primary text-sm transition-colors">
        ← back
      </button>
    ) : (
      <div className="flex items-center gap-2">
        <span className="font-doodle text-secondary text-lg font-bold">
          form <span className="text-red-500">♥</span> paglu
        </span>
      </div>
    )}
    <button
      onClick={onSettingsClick}
      className="hover:border-primary hover:text-primary flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-gray-300 transition-all"
      aria-label="Settings">
      ⚙
    </button>
  </header>
);

export { Header };
