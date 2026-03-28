/**
 * VendorLink — clickable vendor name that materializes a vendor dossier.
 * Used across all CFO objects for consistent cross-object navigation.
 */
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';

export function VendorLink({ name }: { name: string }) {
  const { processIntent } = useWorkspaceActions();

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        processIntent(`vendor dossier for ${name}`);
      }}
      className="text-workspace-accent hover:underline cursor-pointer font-medium text-left"
    >
      {name}
    </button>
  );
}

/** Format a dollar amount for CFO display */
export function formatCurrency(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}
