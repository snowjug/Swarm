import { cx } from '../../design/cx';
import { listItems, paragraphs } from './model';

/**
 * The text of a section as it is read: paragraphs, or for the limitations a list. It is only ever
 * rendered as text, whoever wrote it, and a line break inside a paragraph is kept.
 */
export function Prose({
  body,
  list = false,
  className,
}: {
  body: string;
  list?: boolean;
  className?: string;
}) {
  if (list) {
    return (
      <ul className={cx('sw-studio-prose sw-studio-prose--list', className)}>
        {listItems(body).map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className={cx('sw-studio-prose', className)}>
      {paragraphs(body).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}
