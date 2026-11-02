import { Button, Orbit } from '../../design/ui';
import './ReadingView.css';

const FIELDS = [
  'Decision',
  'Changes',
  'Baseline',
  'Ways to do it',
  'Who is affected',
  'Assumptions',
] as const;

/**
 * What is on the screen while a question is being read, when the reading takes long enough to be noticed
 * (a model reading it can take a while). The question stays; light passes over it; the parts of a scenario
 * it will be broken into are named as they come into view. It ends the moment the reading does.
 */
export function ReadingView({
  question,
  model,
  onCancel,
}: {
  question: string;
  model: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="sw-reading" role="status" aria-live="polite">
      <p className="sw-eyebrow sw-rise">
        <Orbit size={16} label="" />{' '}
        {model ? 'A model is reading your question' : 'Reading your question'}
      </p>
      <p className="sw-reading__question sw-display">{question}</p>
      <ul className="sw-reading__fields" aria-hidden="true">
        {FIELDS.map((field, index) => (
          <li key={field} style={{ '--i': index } as React.CSSProperties}>
            <span>{field}</span>
            <i />
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Stop
      </Button>
    </div>
  );
}
