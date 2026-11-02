import {
  Activity,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  FileText,
  Globe,
  History,
  Info,
  MessageSquareReply,
  OctagonAlert,
  Scale,
  Settings2,
  Sigma,
  Sparkles,
  TriangleAlert,
  User,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { StatementOrigin } from '../../../../../shared/brief';
import type { CritiqueSeverity, CritiqueStatus } from '../../../../../shared/critique';

/** A glyph of its own for each origin and each severity, so that meaning never rests on colour. */
export const ORIGIN_ICONS: Record<StatementOrigin, LucideIcon> = {
  'supplied-evidence': FileText,
  'retrieved-public-evidence': Globe,
  'user-assumption': User,
  'system-assumption': Settings2,
  'inferred-stakeholder': Users,
  'actor-behavior': Activity,
  'simulation-aggregation': Sigma,
  'model-interpretation': Sparkles,
  'historical-comparison': History,
  'unresolved-uncertainty': CircleHelp,
};

/** The origins group into a few families, which is all the colour says: evidence, an assumption, the simulation, a gap. */
export const ORIGIN_FAMILY: Record<
  StatementOrigin,
  'evidence' | 'assumption' | 'simulation' | 'model' | 'gap'
> = {
  'supplied-evidence': 'evidence',
  'retrieved-public-evidence': 'evidence',
  'historical-comparison': 'evidence',
  'user-assumption': 'assumption',
  'system-assumption': 'assumption',
  'inferred-stakeholder': 'simulation',
  'actor-behavior': 'simulation',
  'simulation-aggregation': 'simulation',
  'model-interpretation': 'model',
  'unresolved-uncertainty': 'gap',
};

export const SEVERITY_ICONS: Record<CritiqueSeverity, LucideIcon> = {
  blocking: OctagonAlert,
  major: TriangleAlert,
  minor: CircleAlert,
  note: Info,
};

export const STATUS_ICONS: Record<CritiqueStatus, LucideIcon> = {
  open: CircleHelp,
  responded: MessageSquareReply,
  accepted: CircleCheck,
  disputed: Scale,
};

/** The critics, named short for a margin: the full name is in the review. */
export const ROLE_SHORT: Record<string, string> = {
  evidence: 'Evidence',
  assumption: 'Assumptions',
  methodology: 'Method',
  'stakeholder-coverage': 'Coverage',
  bias: 'Bias',
  recommendation: 'Advice',
  adversarial: 'Adversary',
};
