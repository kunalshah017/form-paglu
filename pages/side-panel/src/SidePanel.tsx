import '@src/SidePanel.css';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { ErrorDisplay, FormPagluApp, LoadingSpinner } from '@extension/ui';

const SidePanel = () => <FormPagluApp />;

export default withErrorBoundary(withSuspense(SidePanel, <LoadingSpinner />), ErrorDisplay);
