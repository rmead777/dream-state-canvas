import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { SherpaProvider } from '@/contexts/SherpaContext';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';

const Index = () => (
  <WorkspaceProvider>
    <SherpaProvider>
      <WorkspaceShell />
    </SherpaProvider>
  </WorkspaceProvider>
);

export default Index;
