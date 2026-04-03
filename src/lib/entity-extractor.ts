/**
 * Entity Extractor — scans card sections for named entities (vendors, persons, dates).
 *
 * Strategy:
 * 1. Table cells (structured): entity names are column values in the first column
 *    or any column recognized as a name-type (vendor, company, person).
 * 2. Narrative text: regex against known vendor names from the active dataset.
 *
 * Returns EntityRef[] — used to populate WorkspaceObject.entityRefs for smart card linking.
 */
import type { EntityRef } from './workspace-types';
import { getActiveDataset } from './active-dataset';

// Heuristic column name patterns that suggest entity name columns
const ENTITY_COLUMN_PATTERNS = [
  /vendor/i, /company/i, /supplier/i, /client/i, /customer/i,
  /name/i, /entity/i, /payee/i, /recipient/i, /contact/i, /person/i,
];

/**
 * Determine if a column name suggests it contains entity names.
 */
function isEntityColumn(colName: string): boolean {
  return ENTITY_COLUMN_PATTERNS.some((p) => p.test(colName));
}

/**
 * Classify the type of entity based on column name context.
 */
function classifyEntityType(colName: string): EntityRef['entityType'] {
  if (/person|contact|employee|name/i.test(colName)) return 'person';
  if (/date|due|deadline|timestamp/i.test(colName)) return 'date';
  if (/vendor|supplier|payee|company|client|customer/i.test(colName)) return 'vendor';
  return 'other';
}

/**
 * Extract entity refs from card sections.
 * Scans table cells in entity-type columns and narrative text.
 */
export function extractEntityRefs(sections: any[]): EntityRef[] {
  const seen = new Set<string>();
  const refs: EntityRef[] = [];

  const addRef = (entityName: string, entityType: EntityRef['entityType']) => {
    const key = entityName.toLowerCase().trim();
    if (!key || key.length < 2 || seen.has(key)) return;
    seen.add(key);
    refs.push({ entityName: entityName.trim(), entityType });
  };

  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;

    if (section.type === 'table' && Array.isArray(section.columns) && Array.isArray(section.rows)) {
      // Find entity columns
      const entityColIndices: { idx: number; type: EntityRef['entityType'] }[] = [];
      for (let i = 0; i < section.columns.length; i++) {
        if (isEntityColumn(String(section.columns[i]))) {
          entityColIndices.push({ idx: i, type: classifyEntityType(String(section.columns[i])) });
        }
      }
      // Extract values from entity columns
      for (const row of section.rows) {
        for (const { idx, type } of entityColIndices) {
          const val = row[idx];
          if (val != null && String(val).trim()) {
            addRef(String(val), type);
          }
        }
      }
    }

    // Narrative sections — scan against known vendor names from active dataset
    if ((section.type === 'narrative' || section.type === 'summary') && typeof section.text === 'string') {
      extractNarrativeEntities(section.text, addRef);
    }
  }

  return refs;
}

/**
 * Scan narrative text for known vendor names from the active dataset.
 * Only looks for names 3+ chars to avoid noise.
 */
function extractNarrativeEntities(
  text: string,
  addRef: (name: string, type: EntityRef['entityType']) => void,
): void {
  const { columns, rows } = getActiveDataset();

  // Find the first entity-type column in the active dataset
  const entityColIdx = columns.findIndex((c) => isEntityColumn(c));
  if (entityColIdx === -1) return;

  // Build a set of known entity names
  const knownNames = new Set(
    rows.map((r) => String(r[entityColIdx] ?? '').trim().toLowerCase()).filter((n) => n.length >= 3)
  );

  const textLower = text.toLowerCase();
  for (const name of knownNames) {
    if (textLower.includes(name)) {
      // Find original casing from dataset
      const originalRow = rows.find((r) => String(r[entityColIdx] ?? '').trim().toLowerCase() === name);
      const originalName = originalRow ? String(originalRow[entityColIdx]).trim() : name;
      addRef(originalName, classifyEntityType(columns[entityColIdx]));
    }
  }
}
