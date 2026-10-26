import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { AlertCircle, ArrowRight, Check, FileText, LoaderCircle, X } from 'lucide-react';
import type { ProjectStatus } from '../../../shared/types';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <LoaderCircle size={16} className="spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Notice({
  children,
  title,
  tone = 'info',
  action,
}: {
  children: ReactNode;
  title?: string;
  tone?: 'info' | 'error' | 'warning' | 'success';
  action?: ReactNode;
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'success' ? (
        <Check size={18} aria-hidden="true" />
      ) : (
        <AlertCircle size={18} aria-hidden="true" />
      )}
      <div className="notice-copy">
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {status}
    </span>
  );
}

export function EmptyPanel({
  title,
  children,
  icon,
  action,
}: {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-panel">
      <div className="empty-icon">{icon || <FileText size={25} aria-hidden="true" />}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function SourceLinks({ ids, onOpen }: { ids: string[]; onOpen: (id: string) => void }) {
  if (!ids.length) return null;
  return (
    <div className="source-links" aria-label="Supporting source excerpts">
      <span className="source-label">Sources</span>
      {[...new Set(ids)].map((id) => (
        <button
          className="source-chip"
          key={id}
          onClick={() => onOpen(id)}
          title={`Find source excerpt ${id}`}
          type="button"
        >
          <FileText size={11} aria-hidden="true" />
          {id}
          <ArrowRight size={10} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="section-heading">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog">
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  id,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  id: string;
}) {
  const handleKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const tab = tabs[next];
    if (tab) {
      onChange(tab.id);
      document.getElementById(`${id}-tab-${tab.id}`)?.focus();
    }
  };
  return (
    <div className="tabs-scroll">
      <div className="tabs" role="tablist" aria-label="Experiment views">
        {tabs.map((tab, index) => (
          <button
            type="button"
            role="tab"
            key={tab.id}
            id={`${id}-tab-${tab.id}`}
            aria-selected={value === tab.id}
            aria-controls={`${id}-panel`}
            tabIndex={value === tab.id ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKey(event, index)}
          >
            {tab.label}
            {tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
