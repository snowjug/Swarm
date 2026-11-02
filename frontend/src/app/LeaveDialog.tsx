import { Button, Dialog, DialogContent } from '../design/ui';

/** What every way out of a scene asks while the scene holds work that is not saved. "Keep editing" has focus. */
export function LeaveDialog({
  what,
  onStay,
  onLeave,
}: {
  what: string;
  onStay: () => void;
  onLeave: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onStay()}>
      <DialogContent
        title="Leave with unsaved changes?"
        description={`${what} They are lost if you leave.`}
        footer={
          <>
            <Button variant="ghost" onClick={onStay}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={onLeave}>
              Leave anyway
            </Button>
          </>
        }
      />
    </Dialog>
  );
}
