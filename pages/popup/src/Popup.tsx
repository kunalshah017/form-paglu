import '@src/Popup.css';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { ErrorDisplay, FormPagluApp, LoadingSpinner } from '@extension/ui';

const Popup = () => <FormPagluApp />;

export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);
