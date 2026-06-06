import '@src/Popup.css';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { ErrorDisplay, LoadingSpinner } from '@extension/ui';

const Popup = () => (
  <div className="App">
    <h1>Form Paglu</h1>
  </div>
);

export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);
