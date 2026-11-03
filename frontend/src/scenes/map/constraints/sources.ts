import { FileText, Sparkles, UserRound } from 'lucide-react';
import type { ConstraintSource } from '../../../../../shared/constraints';

/** One glyph for where a constraint came from. It never stands alone: the label says it too. */
export const SOURCE_ICONS: Record<ConstraintSource, typeof UserRound> = {
  user: UserRound,
  extracted: FileText,
  inferred: Sparkles,
};
