import { Search, X } from 'lucide-react';
import { cx } from '../../design/cx';
import { IconButton, Input } from '../../design/ui';
import './shared.css';

/** A search box with its own clear button. It filters as the person types; nothing is sent anywhere. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cx('sw-psearch', className)}>
      <Search className="sw-psearch__icon" size={16} aria-hidden="true" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
      {value && (
        <IconButton
          label="Clear search"
          size="sm"
          className="sw-psearch__clear"
          onClick={() => onChange('')}
        >
          <X size={14} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}
