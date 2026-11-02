import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Check, ChevronDown, Copy, Lock, UserMinus, UserPlus, Users } from 'lucide-react';
import { SPRING } from '../design/motion';
import {
  Button,
  Dialog,
  DialogContent,
  Disclosure,
  EmptyState,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  Notice,
  Orbit,
  Skeleton,
  Tooltip,
} from '../design/ui';
import { cx } from '../design/cx';
import { useProjectMembers, useWorkspaceMembers } from '../hooks/useMembers';
import type { MembersState } from '../hooks/useMembers';
import { parseObjectId, shortId, type WorkspaceRole } from '../lib/members';
import {
  COPY,
  lockedReason,
  projectScheme,
  roleChoices,
  workspaceScheme,
  type Scheme,
} from './accessView';
import { FocusDialog } from './shared/FocusDialog';
import { Orb } from './shared/Orb';
import { dayLabel, fullTime } from './shared/time';
import { usePanelLifecycle } from './shared/usePanelLifecycle';
import './access.css';

export interface ProjectAccessProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export interface PeopleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The caller's own role in the workspace. */
  actor: WorkspaceRole | null;
}

/** A role, chosen from the roles with what each lets a person do beside it, so that nobody grants what they have not read. */
function RoleMenu<Role extends string>({
  value,
  scheme,
  onChange,
  label,
  disabled,
}: {
  value: Role;
  scheme: Scheme<Role>;
  onChange: (role: Role) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="glass"
          size="sm"
          className="sw-access__role-button"
          disabled={disabled}
          iconEnd={<ChevronDown size={14} aria-hidden="true" />}
          aria-label={`${label}: ${scheme.view[value].label}`}
        >
          {scheme.view[value].label}
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="sw-access__menu">
        <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as Role)}>
          {roleChoices(scheme).map(({ role, allowed }) => (
            <MenuRadioItem key={role} value={role} disabled={!allowed}>
              <span className="sw-access__option">
                <strong>{scheme.view[role].label}</strong>
                <small>{scheme.view[role].can}</small>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function CopyId({ value, name }: { value: string; name: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <>
      <IconButton
        label={copied ? 'Copied' : `Copy the object ID of ${name}`}
        size="sm"
        className="sw-access__copy"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => setCopied(true),
            () => undefined,
          );
        }}
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </IconButton>
      <span className="sr-only" role="status">
        {copied ? 'Object ID copied.' : ''}
      </span>
    </>
  );
}

function PersonRow<Role extends string>({
  member,
  scheme,
  state,
  fresh,
  index,
  onTouched,
}: {
  member: { principalId: string; role: Role; addedAt: string };
  scheme: Scheme<Role>;
  state: MembersState<Role>;
  fresh: boolean;
  index: number;
  onTouched: (principalId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const name = shortId(member.principalId);
  const manageable = state.mayManage && scheme.mayManageRow(member.role);
  const locked = lockedReason(scheme, member.role, state.mayManage);
  const busy = state.working === member.principalId;
  const idle = state.working === null;
  return (
    <m.li
      layout="position"
      className="sw-access__row"
      data-fresh={fresh || undefined}
      data-busy={busy || undefined}
      aria-busy={busy || undefined}
      transition={SPRING.smooth}
      exit={{ opacity: 0, transition: { duration: 0.14 } }}
    >
      <div
        className="sw-access__line sw-rise"
        style={{ '--i': Math.min(index, 6) } as CSSProperties}
      >
        <Orb seed={member.principalId} size={34} />
        <div className="sw-access__who">
          <span className="sw-access__id">
            <span className="sw-mono" title={member.principalId}>
              {name}
            </span>
            <CopyId value={member.principalId} name={name} />
          </span>
          <span className="sw-caption" title={fullTime(member.addedAt)}>
            Added {dayLabel(member.addedAt)}
          </span>
        </div>
        <div className="sw-access__controls">
          {busy ? <Orbit size={18} label="Working on this person" /> : null}
          {manageable ? (
            <>
              <RoleMenu
                value={member.role}
                scheme={scheme}
                label={`Role of ${name}`}
                disabled={!idle}
                onChange={(role) => {
                  if (role === member.role) return;
                  onTouched(member.principalId);
                  void state.change(member.principalId, role);
                }}
              />
              <IconButton
                label={`Remove ${name}`}
                size="sm"
                disabled={!idle}
                pressed={confirming}
                className="sw-access__remove"
                onClick={() => setConfirming((value) => !value)}
              >
                <UserMinus size={16} aria-hidden="true" />
              </IconButton>
            </>
          ) : (
            <span className="sw-access__static">
              {scheme.view[member.role].label}
              {locked && (
                <Tooltip label={locked}>
                  <span className="sw-access__lock" tabIndex={0} role="img" aria-label={locked}>
                    <Lock size={13} aria-hidden="true" />
                  </span>
                </Tooltip>
              )}
            </span>
          )}
        </div>
        <AnimatePresence initial={false}>
          {confirming && (
            <m.div
              key="confirm"
              className="sw-access__confirm"
              role="group"
              aria-label={`Remove ${name}?`}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={SPRING.snappy}
            >
              <p className="sw-access__confirm-text">
                Remove {name}?<span className="sw-caption"> {COPY[scheme.subject].removeNote}</span>
              </p>
              <span className="sw-access__confirm-actions">
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!idle}
                  onClick={() => {
                    setConfirming(false);
                    onTouched(member.principalId);
                    void state.remove(member.principalId);
                  }}
                >
                  Remove
                </Button>
              </span>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </m.li>
  );
}

function AddPerson<Role extends string>({
  state,
  scheme,
}: {
  state: MembersState<Role>;
  scheme: Scheme<Role>;
}) {
  const [person, setPerson] = useState('');
  const [role, setRole] = useState<Role>(scheme.initial);
  const [problem, setProblem] = useState<string | null>(null);
  const adding = state.working !== null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseObjectId(person);
    if (!parsed.ok) {
      setProblem(parsed.message);
      return;
    }
    setProblem(null);
    if (await state.add(parsed.value, role)) setPerson('');
  };

  return (
    <form className="sw-access__add" noValidate onSubmit={(event) => void submit(event)}>
      <h3 className="sw-eyebrow">Add a person</h3>
      <div className="sw-access__add-row">
        <Field label="Object ID" labelHidden error={problem ?? undefined}>
          <Input
            autoComplete="off"
            spellCheck={false}
            value={person}
            disabled={adding}
            className="sw-mono"
            placeholder="Microsoft Entra object ID"
            onChange={(event) => {
              setPerson(event.target.value);
              setProblem(null);
            }}
          />
        </Field>
        <RoleMenu
          value={role}
          scheme={scheme}
          onChange={setRole}
          label="Role to give"
          disabled={adding}
        />
        <Button
          type="submit"
          variant="primary"
          busy={adding}
          busyLabel="Adding the person"
          icon={<UserPlus size={16} aria-hidden="true" />}
          className="sw-access__add-button"
        >
          Add
        </Button>
      </div>
      <Disclosure summary="Where do I find an object ID?">
        <p className="sw-caption sw-access__help">
          People are named by their Microsoft Entra object ID, like
          0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d. Swarm has no invitation by name or email: ask the
          person for it, or find it on their page in the Microsoft Entra admin centre.
        </p>
      </Disclosure>
    </form>
  );
}

function Outcome({ result }: { result: MembersState<string>['result'] }) {
  const [gone, setGone] = useState(false);
  // What went well says so, and then gets out of the way; what did not stays until the next try.
  useEffect(() => {
    setGone(false);
    if (!result?.ok) return undefined;
    const timer = setTimeout(() => setGone(true), 7000);
    return () => clearTimeout(timer);
  }, [result]);
  const shown = gone ? null : result;
  return (
    <div className="sw-access__outcome">
      <AnimatePresence initial={false} mode="wait">
        {shown && (
          <m.div
            key={`${shown.ok}-${shown.text}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={SPRING.snappy}
          >
            {shown.ok ? (
              <Notice tone="success" title="Done">
                {shown.text}
              </Notice>
            ) : (
              <Notice tone="error" title="That was not changed">
                {shown.text}
              </Notice>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="sw-access__skeleton" aria-busy="true">
      <span className="sr-only" role="status">
        Reading who has access
      </span>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="sw-access__skeleton-row"
          style={{ opacity: 1 - index * 0.2 }}
          aria-hidden="true"
        >
          <Skeleton width="2.1rem" height="2.1rem" radius="50%" />
          <div className="sw-access__skeleton-text">
            <Skeleton width="38%" height="1rem" />
            <Skeleton width="22%" height="0.8rem" />
          </div>
          <Skeleton width="6rem" height="2rem" radius="999px" />
        </div>
      ))}
    </div>
  );
}

/** The people, and for someone who may, the means to change who they are. It is generic in the roles it deals in. */
export function AccessBody<Role extends string>({
  state,
  scheme,
}: {
  state: MembersState<Role>;
  scheme: Scheme<Role>;
}) {
  const copy = COPY[scheme.subject];
  const members = state.members;
  const touched = useRef<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  // The row that was just changed says so for a moment, so that the change is seen where it happened.
  useEffect(() => {
    if (state.working === null && touched.current && state.result?.ok) {
      setFresh(touched.current);
      touched.current = null;
      const timer = setTimeout(() => setFresh(null), 1800);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [state.working, state.result]);

  let content: ReactNode;
  if (state.error && !members) {
    content = (
      <Notice
        tone="error"
        title="The list could not be read"
        action={
          <Button size="sm" variant="glass" busy={state.loading} onClick={state.reload}>
            Retry
          </Button>
        }
      >
        {state.error}
      </Notice>
    );
  } else if (!members) {
    content = <ListSkeleton />;
  } else if (members.length === 0) {
    content = (
      <EmptyState icon={<Users size={22} aria-hidden="true" />} title="Nobody is listed">
        {copy.emptyText}
      </EmptyState>
    );
  } else {
    content = (
      <ul className="sw-access__list" role="list" aria-label={`People in this ${scheme.subject}`}>
        <AnimatePresence initial={false} mode="popLayout">
          {members.map((member, index) => (
            <PersonRow
              key={member.principalId}
              member={member}
              scheme={scheme}
              state={state}
              fresh={fresh === member.principalId}
              index={index}
              onTouched={(id) => {
                touched.current = id;
              }}
            />
          ))}
        </AnimatePresence>
      </ul>
    );
  }

  return (
    <div className="sw-access">
      {members && state.mayManage && (
        <AddPerson key={scheme.subject} state={state} scheme={scheme} />
      )}
      {members && !state.mayManage && copy.readOnly && (
        <p className="sw-caption">{copy.readOnly}</p>
      )}
      <Outcome result={state.result} />
      {state.error && members && (
        <Notice
          tone="caution"
          title="The list could not be refreshed"
          action={
            <Button size="sm" variant="glass" busy={state.loading} onClick={state.reload}>
              Retry
            </Button>
          }
        >
          Showing what was read last. {state.error}
        </Notice>
      )}
      <div className={cx('sw-access__people', state.loading && members && 'is-refreshing')}>
        {content}
      </div>
      {members && (
        <Disclosure summary="What the roles mean">
          <dl className="sw-access__roles">
            {scheme.roles.map((role) => (
              <div key={role}>
                <dt>{scheme.view[role].label}</dt>
                <dd>
                  {scheme.view[role].can}
                  {scheme.view[role].cannot && (
                    <span className="sw-access__cannot"> {scheme.view[role].cannot}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Disclosure>
      )}
    </div>
  );
}

function AccessDialog<Role extends string>({
  open,
  onOpenChange,
  state,
  scheme,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: MembersState<Role>;
  scheme: Scheme<Role>;
}) {
  const lifecycle = usePanelLifecycle(open, onOpenChange, 'dialog');
  const copy = COPY[scheme.subject];
  return (
    <Dialog open={lifecycle.open} onOpenChange={lifecycle.onOpenChange}>
      <DialogContent
        title={copy.title}
        description={copy.description}
        className="sw-access-dialog"
        footer={
          <Button variant="primary" onClick={() => lifecycle.onOpenChange(false)}>
            Done
          </Button>
        }
      >
        <FocusDialog />
        <AccessBody state={state} scheme={scheme} />
      </DialogContent>
    </Dialog>
  );
}

/** Who may use one project, and in which role, with the means to change that for someone who may. */
export function ProjectAccess({ open, onOpenChange, projectId }: ProjectAccessProps) {
  const state = useProjectMembers(projectId, true);
  return (
    <AccessDialog open={open} onOpenChange={onOpenChange} state={state} scheme={projectScheme} />
  );
}

/** Everyone in the workspace, for an owner or an administrator. */
export function PeopleDialog({ open, onOpenChange, actor }: PeopleDialogProps) {
  const state = useWorkspaceMembers(true);
  const scheme = workspaceScheme(actor);
  return <AccessDialog open={open} onOpenChange={onOpenChange} state={state} scheme={scheme} />;
}
