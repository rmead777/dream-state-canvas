import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { SherpaProvider } from '@/contexts/SherpaContext';
import { DocumentProvider } from '@/contexts/DocumentContext';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';

const Index = () => (
  <WorkspaceProvider>
    <SherpaProvider>
      <DocumentProvider>
        <WorkspaceShell />
      </DocumentProvider>
    </SherpaProvider>
  </WorkspaceProvider>
);

export default Index;
