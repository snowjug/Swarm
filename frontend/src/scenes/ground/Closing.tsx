import { ArrowRight } from 'lucide-react';
import { useWorkspace } from '../../app/context';
import { Button } from '../../design/ui';
import { useGroundData } from './context';
import { nextStep } from './model';

/**
 * The page ends on the way forward, as it began: once the evidence is ready, the next part of the journey is one
 * press away from the last thing read. The floating copy of it steps aside while this one is on the screen.
 */
export function Closing() {
  const { journey, go } = useWorkspace();
  const { stage } = useGroundData();
  const next = nextStep(journey);
  if (!(stage === 'ready' || stage === 'record') || !next) return null;
  return (
    <div className="sw-ground-closing" data-end-action>
      <Button
        variant="primary"
        size="lg"
        iconEnd={<ArrowRight size={18} aria-hidden="true" />}
        onClick={() => go(next.scene)}
      >
        {next.label}
      </Button>
    </div>
  );
}
