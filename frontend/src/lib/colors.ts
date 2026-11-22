/**
 * Canonical anatomical structure color palette and deterministic color resolver.
 * Must match backend CANONICAL_STRUCTURE_COLORS in app/core/segment.py exactly.
 */

export const CANONICAL_STRUCTURE_COLORS: readonly string[] = [
  '#38BDF8', // 1. Sky blue
  '#34D399', // 2. Emerald green
  '#F43F5E', // 3. Rose red
  '#FBBF24', // 4. Amber yellow
  '#A855F7', // 5. Purple / violet
  '#EC4899', // 6. Pink
  '#06B6D4', // 7. Cyan
  '#F97316', // 8. Orange
  '#84CC16', // 9. Lime green
  '#6366F1', // 10. Indigo
  '#14B8A6', // 11. Teal
  '#E11D48', // 12. Crimson
  '#3B82F6', // 13. Blue
  '#10B981', // 14. Mint green
  '#EAB308', // 15. Warm yellow
  '#8B5CF6', // 16. Violet
];

/**
 * Returns the single authoritative hex color for an anatomical structure.
 * 1. If structure has a valid hex color string (e.g. from backend report/labels_meta), uses that directly.
 * 2. Otherwise deterministically derives from structure.id / label_id.
 * NEVER depends on array position, search queries, or filter indices.
 */
export function getStructureColor(
  structure: { id: number; color?: string | null } | number
): string {
  if (typeof structure === 'object' && structure !== null) {
    if (structure.color && typeof structure.color === 'string' && structure.color.startsWith('#')) {
      return structure.color;
    }
    return getStructureColor(structure.id);
  }

  const id = Number(structure);
  if (!id || id <= 0) {
    return CANONICAL_STRUCTURE_COLORS[0];
  }
  const idx = (id - 1) % CANONICAL_STRUCTURE_COLORS.length;
  return CANONICAL_STRUCTURE_COLORS[idx];
}
