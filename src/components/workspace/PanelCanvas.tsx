import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WorkspaceObjectWrapper } from './WorkspaceObject';
import { RelationshipConnector } from './RelationshipConnector';

export function PanelCanvas() {
  const { state } = useWorkspace();
  const { spatialLayout, objects } = state;

  const primaryObjects = spatialLayout.primary
    .map((id) => objects[id])
    .filter((o) => o && o.status !== 'dissolved');

  const secondaryObjects = spatialLayout.secondary
    .map((id) => objects[id])
    .filter((o) => o && o.status !== 'dissolved');

  const hasObjects = primaryObjects.length > 0 || secondaryObjects.length > 0;

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 lg:p-10">
      {!hasObjects ? (
        <div className="flex h-full items-center justify-center">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-6 h-px w-16 bg-workspace-border" />
            <p className="text-sm text-workspace-text-secondary/50 leading-relaxed">
              Your workspace is clear. Ask the Sherpa to surface what matters, or explore a suggestion.
            </p>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-4xl space-y-4">
          {/* Primary zone */}
          {primaryObjects.length > 0 && (
            <div className="space-y-5">
              {primaryObjects.map((obj) => (
                <WorkspaceObjectWrapper key={obj.id} object={obj} />
              ))}
            </div>
          )}

          {/* Relationship connectors between primary and secondary */}
          <RelationshipConnector />

          {/* Secondary zone */}
          {secondaryObjects.length > 0 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {secondaryObjects.map((obj) => (
                  <WorkspaceObjectWrapper key={obj.id} object={obj} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
