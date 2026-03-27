import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';

const Index = () => (
  <WorkspaceProvider>
    <WorkspaceShell />
  </WorkspaceProvider>
);

export default Index;
