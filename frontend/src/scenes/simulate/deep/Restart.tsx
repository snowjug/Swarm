import { Button, Dialog, DialogClose, DialogContent, Notice } from '../../../design/ui';
import { useDeep } from './context';
import { plural } from './model';

/** The one destructive thing the run offers: starting again from round 1, which discards what was saved. */
export function RestartDialog({ onClose }: { onClose: () => void }) {
  const { project, actions, controls } = useDeep();
  const saved = project.rounds.length;
  const retry = controls.recovering;
  return (
    <Dialog open onOpenChange={(open) => !open && actions.pending !== 'restart' && onClose()}>
      <DialogContent
        tone="danger"
        title="Restart from round 1?"
        description={`This discards ${plural(saved, 'saved round')} and runs the simulation again from round 1 with the saved environment. It is not a resume.`}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost" disabled={actions.pending === 'restart'}>
                Keep the saved rounds
              </Button>
            </DialogClose>
            <Button
              variant="danger"
              busy={actions.pending === 'restart'}
              busyLabel="Restarting"
              onClick={() => void actions.restart().then((done) => done && onClose())}
            >
              {retry ? 'Discard and retry' : 'Discard'} {plural(saved, 'saved round')}
            </Button>
          </>
        }
      >
        {actions.error && <Notice tone="error">{actions.error}</Notice>}
      </DialogContent>
    </Dialog>
  );
}
