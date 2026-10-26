import { useEffect, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Cpu,
  FileText,
  FolderUp,
  Info,
  LockKeyhole,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  createProjectSchema,
  documentInputSchema,
  MAX_DOCUMENT_CHARS,
  MAX_DOCUMENTS,
  MAX_TOTAL_CHARS,
} from '../../../shared/types';
import type {
  AppConfig,
  CreateProjectInput,
  ProjectDetail,
  SimulationSettings,
} from '../../../shared/types';
import { errorMessage } from '../api';
import { count } from '../lib/format';
import { Notice, Spinner } from './ui';

interface InputDocument {
  id: string;
  name: string;
  content: string;
}

const starter = {
  name: 'A quieter, greener town centre',
  question:
    'How might different fictional community groups respond to a trial of car-free weekends in the town centre?',
  content: `FICTIONAL STARTER MATERIAL — not a real town, study, or forecast.

The fictional town of Alder Quay is considering a six-week trial of car-free Saturdays on its central shopping street. The draft proposal would keep emergency access, introduce two accessible drop-off points, and direct deliveries to a morning window.

A fictional neighbourhood meeting raised three themes: cleaner air and safer walking routes; uncertainty about access for disabled residents and older visitors; and possible changes to footfall for independent shops. The proposal includes a temporary shuttle from a nearby car park, but no funding decision has been made.

The fictional council would collect pedestrian counts, access complaints, and shopkeeper feedback during the trial. Some residents favour a reversible experiment, while others want the access plan clarified first. These notes are invented scenario inputs. They contain no measured results or statements from real people.`,
};

export function CreateExperiment({
  config,
  initialProject,
  useStarter,
  busy,
  onBack,
  onSubmit,
}: {
  config: AppConfig | null;
  initialProject?: ProjectDetail | null;
  useStarter?: boolean;
  busy: boolean;
  onBack: () => void;
  onSubmit: (input: CreateProjectInput, start: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(
    initialProject ? `${initialProject.name.slice(0, 93)} (copy)` : useStarter ? starter.name : '',
  );
  const [question, setQuestion] = useState(
    initialProject?.question ?? (useStarter ? starter.question : ''),
  );
  const [pasted, setPasted] = useState(useStarter ? starter.content : '');
  const [documents, setDocuments] = useState<InputDocument[]>(
    initialProject?.documents.map((document) => ({ ...document })) ?? [],
  );
  const [settings, setSettings] = useState<SimulationSettings>(
    initialProject
      ? {
          ...initialProject.settings,
          mode:
            initialProject.mode === 'llm' && !config?.provider.configured
              ? 'local'
              : initialProject.mode,
        }
      : {
          mode: 'local',
          agentCount: 12,
          rounds: 8,
          seed: 42,
          network: 'community',
          intervention: null,
        },
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [starterLoaded, setStarterLoaded] = useState(Boolean(useStarter));
  const errorRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const readLock = useRef(false);
  const providerReady = Boolean(config?.provider.configured && config.capabilities.modelAssisted);
  const model = settings.mode === 'llm';
  const maxAgents = model ? 10 : 24;
  const maxRounds = model ? 10 : 24;
  const totalChars =
    documents.reduce((sum, document) => sum + document.content.trim().length, 0) +
    pasted.trim().length;
  const documentCount = documents.length + (pasted.trim() ? 1 : 0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const updateSetting = <K extends keyof SimulationSettings>(
    key: K,
    value: SimulationSettings[K],
  ) => {
    setSettings((old) => ({ ...old, [key]: value }));
  };

  const loadStarter = () => {
    setName(starter.name);
    setQuestion(starter.question);
    setPasted(starter.content);
    setStarterLoaded(true);
    setErrors([]);
  };

  const readFiles = async (files: File[]) => {
    if (!files.length || readLock.current || busy) return;
    setFileError(null);
    if (files.some((file) => /\.pdf$/iu.test(file.name) || file.type === 'application/pdf')) {
      setFileError(
        'PDF is not supported. Export the text yourself and upload a UTF-8 TXT or Markdown file.',
      );
      return;
    }
    if (files.length + documentCount > MAX_DOCUMENTS) {
      setFileError(
        `Use at most ${MAX_DOCUMENTS} documents, including pasted notes. Remove a document first.`,
      );
      return;
    }
    readLock.current = true;
    setReading(true);
    try {
      const additions: InputDocument[] = [];
      for (const file of files) {
        if (
          /[\\/]/u.test(file.name) ||
          !/\.(txt|md|markdown)$/iu.test(file.name) ||
          Array.from(file.name).some((character) => character.charCodeAt(0) < 32)
        ) {
          throw new Error(
            `${file.name}: only TXT and Markdown filenames without path separators are accepted. PDF is not supported.`,
          );
        }
        if (file.size > MAX_DOCUMENT_CHARS * 4 + 3) {
          throw new Error(
            `${file.name} is too large. Each document must contain 80–${count(MAX_DOCUMENT_CHARS)} characters.`,
          );
        }
        let content: string;
        try {
          content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        } catch {
          throw new Error(
            `${file.name} could not be decoded. Save it as plain UTF-8 TXT or Markdown and try again.`,
          );
        }
        const parsed = documentInputSchema.safeParse({ name: file.name, content });
        if (!parsed.success) {
          throw new Error(
            `${file.name}: ${parsed.error.issues.map((issue) => issue.message).join(' ')}`,
          );
        }
        additions.push({ id: crypto.randomUUID(), ...parsed.data });
      }
      const addedChars = additions.reduce((sum, document) => sum + document.content.length, 0);
      if (totalChars + addedChars > MAX_TOTAL_CHARS) {
        throw new Error(
          `Combined source material cannot exceed ${count(MAX_TOTAL_CHARS)} characters.`,
        );
      }
      if (mounted.current) setDocuments((old) => [...old, ...additions]);
    } catch (error) {
      if (mounted.current) setFileError(errorMessage(error));
    } finally {
      readLock.current = false;
      if (mounted.current) setReading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void readFiles(Array.from(event.dataTransfer.files));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || reading) return;
    setErrors([]);
    const input = {
      name,
      question,
      documents: [
        ...documents.map(({ name: documentName, content }) => ({ name: documentName, content })),
        ...(pasted.trim() ? [{ name: 'notes.md', content: pasted }] : []),
      ],
      settings,
    };
    const parsed = createProjectSchema.safeParse(input);
    const messages = parsed.success
      ? []
      : parsed.error.issues.map((issue) => {
          const location = issue.path.join(' › ');
          return `${location ? `${location}: ` : ''}${issue.message}`;
        });
    if (model && !providerReady)
      messages.push(
        'Model assistance is unavailable. Choose the rules-based engine or configure a provider on the server.',
      );
    if (messages.length) {
      setErrors(messages);
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    if (!parsed.success) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const start = !(submitter instanceof HTMLButtonElement && submitter.value === 'draft');
    try {
      await onSubmit(parsed.data, start);
    } catch (error) {
      setErrors([errorMessage(error)]);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  };

  return (
    <div className="create-page page-enter">
      <div className="page-back-row">
        <button className="text-button" type="button" onClick={onBack} disabled={busy}>
          <ArrowLeft size={15} aria-hidden="true" /> Back to lab
        </button>
        <span className="quiet-label">NEW EXPERIMENT</span>
      </div>
      <div className="create-heading">
        <div>
          <span className="eyebrow">SET THE SCENE</span>
          <h1>A question worth exploring.</h1>
          <p>Give your scenario some context. Keep the assumptions visible.</p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={loadStarter}
          disabled={busy || reading}
        >
          <Plus size={15} aria-hidden="true" /> Load starter scenario
        </button>
      </div>
      {starterLoaded && (
        <Notice title="Fictional input, ready to edit">
          This starter contains invented source material only. No results, agents, or metrics have
          been preloaded.
        </Notice>
      )}
      {initialProject && (
        <Notice title="A fresh copy">
          Source text and settings are copied. Previous results, conversations, and execution data
          are not.
        </Notice>
      )}
      <form onSubmit={(event) => void submit(event)} noValidate aria-busy={busy}>
        {errors.length > 0 && (
          <div
            ref={errorRef}
            tabIndex={-1}
            id="form-errors"
            className="form-error-summary"
            role="alert"
          >
            <strong>Let’s fix a few things before continuing.</strong>
            <ul>
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}
        <fieldset className="form-section" disabled={busy}>
          <legend>
            <span className="section-number">01</span> Frame your question
          </legend>
          <div className="field">
            <label htmlFor="experiment-name">
              Experiment name <span>3–100 characters</span>
            </label>
            <input
              id="experiment-name"
              name="name"
              autoComplete="off"
              placeholder="e.g. A new chapter for the high street"
              minLength={3}
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              aria-invalid={errors.length > 0 && name.trim().length < 3 ? true : undefined}
              aria-describedby={
                errors.length > 0 && name.trim().length < 3 ? 'form-errors' : undefined
              }
            />
          </div>
          <div className="field">
            <label htmlFor="experiment-question">
              What would you like to explore? <span>{count(question.length)} / 2,000</span>
            </label>
            <textarea
              id="experiment-question"
              name="question"
              rows={3}
              placeholder="How might different groups respond if…?"
              minLength={10}
              maxLength={2_000}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              required
              aria-invalid={errors.length > 0 && question.trim().length < 10 ? true : undefined}
              aria-describedby={
                errors.length > 0 && question.trim().length < 10
                  ? 'question-help form-errors'
                  : 'question-help'
              }
            />
            <p id="question-help" className="field-help">
              A focused, open question works best. This explores assumptions; it does not predict
              real-world behaviour.
            </p>
          </div>
        </fieldset>

        <fieldset className="form-section" disabled={busy || reading}>
          <legend>
            <span className="section-number">02</span> Add source material
          </legend>
          <div className="source-intro">
            <p>Context in, traceable evidence out. Use your own text.</p>
            <span
              className={
                totalChars > MAX_TOTAL_CHARS || documentCount > MAX_DOCUMENTS
                  ? 'text-error'
                  : 'quiet-label'
              }
            >
              {documentCount} / 5 DOCUMENTS · {count(totalChars)} / 100,000 CHARACTERS
            </span>
          </div>
          <div
            className={`file-drop ${dragging ? 'file-drop-active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={dropFiles}
          >
            <FolderUp size={28} aria-hidden="true" />
            <strong>Drop your context here</strong>
            <p>UTF-8 TXT or Markdown only · 80–40,000 characters each</p>
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={reading || documentCount >= MAX_DOCUMENTS}
            >
              {reading ? <Spinner label="Reading files" /> : <Plus size={14} aria-hidden="true" />}{' '}
              Browse files
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              className="sr-only"
              tabIndex={-1}
              aria-label="Upload TXT or Markdown source documents"
              onChange={(event) => void readFiles(Array.from(event.target.files ?? []))}
            />
            <span className="file-drop-note">
              PDF, binary files, and web URLs are not supported.
            </span>
          </div>
          {fileError && (
            <Notice tone="error" title="Could not add the files">
              {fileError}
            </Notice>
          )}
          {documents.length > 0 && (
            <ul className="uploaded-files">
              {documents.map((document) => (
                <li key={document.id}>
                  <span className="file-icon">
                    <FileText size={17} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{document.name}</strong>
                    <small>{count(document.content.length)} characters</small>
                  </span>
                  <Check size={15} className="text-teal" aria-hidden="true" />
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() =>
                      setDocuments((old) => old.filter((item) => item.id !== document.id))
                    }
                    aria-label={`Remove ${document.name}`}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="field pasted-field">
            <label htmlFor="source-notes">
              Or paste your source text <span>saved as notes.md</span>
            </label>
            <textarea
              id="source-notes"
              rows={7}
              value={pasted}
              maxLength={MAX_DOCUMENT_CHARS}
              placeholder="Paste background notes, a proposal, a brief, or a fictional scenario. At least 80 characters if used."
              onChange={(event) => setPasted(event.target.value)}
              aria-describedby="source-notes-help"
            />
            <p id="source-notes-help" className="field-help">
              Pasted notes count as one document. {count(pasted.trim().length)} / 40,000 characters.
              Markdown is displayed as plain text.
            </p>
          </div>
        </fieldset>

        <fieldset className="form-section" disabled={busy}>
          <legend>
            <span className="section-number">03</span> Choose the engine
          </legend>
          <div className="engine-options">
            <label className={`engine-card ${!model ? 'engine-selected' : ''}`}>
              <input
                type="radio"
                name="engine"
                value="local"
                checked={!model}
                onChange={() => updateSetting('mode', 'local')}
              />
              <span className="engine-icon">
                <Cpu size={22} aria-hidden="true" />
              </span>
              <span className="engine-copy">
                <strong>
                  Rules-based <span className="pill">DEFAULT</span>
                </strong>
                <span>Deterministic, local simulation. Not AI.</span>
                <small>Lexical topics · opinion updates · evidence inspection</small>
              </span>
              <span className="radio-indicator" aria-hidden="true" />
            </label>
            <label
              className={`engine-card ${model ? 'engine-selected' : ''} ${!providerReady ? 'engine-disabled' : ''}`}
            >
              <input
                type="radio"
                name="engine"
                value="llm"
                checked={model}
                disabled={!providerReady}
                onChange={() =>
                  setSettings((old) => ({
                    ...old,
                    mode: 'llm',
                    agentCount: Math.min(old.agentCount, 10),
                    rounds: Math.min(old.rounds, 10),
                  }))
                }
                aria-describedby="provider-state"
              />
              <span className="engine-icon violet">
                <Sparkles size={22} aria-hidden="true" />
              </span>
              <span className="engine-copy">
                <strong>
                  Model-assisted <span className="pill pill-violet">OPTIONAL</span>
                </strong>
                <span>AI-generated personas, actions, and analysis.</span>
                <small>
                  {providerReady
                    ? `${config?.provider.name} · ${config?.provider.model || 'configured model'}`
                    : 'Configure a provider on the server to enable.'}
                </small>
              </span>
              <span className="radio-indicator" aria-hidden="true" />
            </label>
          </div>
          <p id="provider-state" className="field-help provider-state">
            <Info size={14} aria-hidden="true" />{' '}
            {providerReady
              ? 'Provider configuration is present, not proof of connectivity. A run may still fail if the model cannot be reached.'
              : config?.provider.reason ||
                'Model availability is checked with the local backend. Rules-based mode does not require a provider.'}
          </p>
          <div className={`engine-disclosure ${model ? 'engine-disclosure-model' : ''}`}>
            <LockKeyhole size={17} aria-hidden="true" />
            <p>
              {model
                ? 'Model-assisted mode sends bounded source excerpts and fictional persona context to the selected provider. Provider data handling depends on its deployment. Never submit secrets or sensitive personal data.'
                : 'Source data stays on this machine in rules-based mode. No AI provider or external web retrieval is used.'}
            </p>
          </div>
        </fieldset>

        <fieldset className="form-section" disabled={busy}>
          <legend>
            <span className="section-number">04</span> Set the boundaries
          </legend>
          <div className="settings-grid">
            <div className="field">
              <label htmlFor="agent-count">Fictional agents</label>
              <input
                id="agent-count"
                type="number"
                min={4}
                max={maxAgents}
                step={1}
                value={settings.agentCount}
                onChange={(event) => updateSetting('agentCount', Number(event.target.value))}
              />
              <p className="field-help">4–{maxAgents} simulated personas</p>
            </div>
            <div className="field">
              <label htmlFor="round-count">Simulation rounds</label>
              <input
                id="round-count"
                type="number"
                min={3}
                max={maxRounds}
                step={1}
                value={settings.rounds}
                onChange={(event) => updateSetting('rounds', Number(event.target.value))}
              />
              <p className="field-help">3–{maxRounds} discrete rounds</p>
            </div>
            <div className="field">
              <label htmlFor="random-seed">Random seed</label>
              <input
                id="random-seed"
                type="number"
                min={1}
                max={2_147_483_647}
                step={1}
                value={settings.seed}
                onChange={(event) => updateSetting('seed', Number(event.target.value))}
              />
              <p className="field-help">1–2,147,483,647 · reproducible local runs</p>
            </div>
            <div className="field">
              <label htmlFor="network-type">Network structure</label>
              <select
                id="network-type"
                value={settings.network}
                onChange={(event) =>
                  updateSetting('network', event.target.value as SimulationSettings['network'])
                }
              >
                <option value="community">Community clusters</option>
                <option value="broadcast">Broadcast network</option>
              </select>
              <p className="field-help">An assumed interaction structure</p>
            </div>
          </div>
          <div className="intervention-toggle">
            <label>
              <input
                type="checkbox"
                checked={Boolean(settings.intervention)}
                onChange={(event) =>
                  updateSetting(
                    'intervention',
                    event.target.checked
                      ? { round: Math.min(4, settings.rounds), label: '', stance: 0, strength: 0.5 }
                      : null,
                  )
                }
              />
              <span>
                <strong>Schedule an intervention</strong>
                <small>Add a scenario change at a specific round.</small>
              </span>
            </label>
            <span className="pill">OPTIONAL</span>
          </div>
          {settings.intervention && (
            <div className="intervention-fields">
              <div className="field">
                <label htmlFor="intervention-label">
                  What changes? <span>5–300 characters</span>
                </label>
                <textarea
                  id="intervention-label"
                  rows={2}
                  minLength={5}
                  maxLength={300}
                  value={settings.intervention.label}
                  onChange={(event) =>
                    updateSetting('intervention', {
                      ...settings.intervention!,
                      label: event.target.value,
                    })
                  }
                  placeholder="e.g. A revised access plan is published for the trial."
                />
              </div>
              <div className="settings-grid intervention-grid">
                <div className="field">
                  <label htmlFor="intervention-round">At round</label>
                  <input
                    id="intervention-round"
                    type="number"
                    min={1}
                    max={settings.rounds}
                    step={1}
                    value={settings.intervention.round}
                    onChange={(event) =>
                      updateSetting('intervention', {
                        ...settings.intervention!,
                        round: Number(event.target.value),
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="intervention-stance">
                    Stance <output>{settings.intervention.stance.toFixed(1)}</output>
                  </label>
                  <input
                    id="intervention-stance"
                    type="range"
                    min={-1}
                    max={1}
                    step={0.1}
                    value={settings.intervention.stance}
                    onChange={(event) =>
                      updateSetting('intervention', {
                        ...settings.intervention!,
                        stance: Number(event.target.value),
                      })
                    }
                  />
                  <p className="field-help">−1 opposing · 0 neutral · +1 supporting</p>
                </div>
                <div className="field">
                  <label htmlFor="intervention-strength">
                    Strength <output>{settings.intervention.strength.toFixed(2)}</output>
                  </label>
                  <input
                    id="intervention-strength"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.intervention.strength}
                    onChange={(event) =>
                      updateSetting('intervention', {
                        ...settings.intervention!,
                        strength: Number(event.target.value),
                      })
                    }
                  />
                  <p className="field-help">0 none · 1 maximum assumed influence</p>
                </div>
              </div>
            </div>
          )}
        </fieldset>
        <div className="form-submit-row">
          <p>
            <Info size={16} aria-hidden="true" /> Fictional personas. Simulated metrics.
            <br />
            An exploration, not a validated forecast.
          </p>
          <div>
            <button
              className="button button-secondary"
              type="submit"
              value="draft"
              disabled={busy || reading}
            >
              <Save size={16} aria-hidden="true" /> Save draft
            </button>
            <button
              className="button button-primary"
              type="submit"
              value="run"
              disabled={busy || reading}
            >
              {busy ? (
                <Spinner label="Saving experiment" />
              ) : (
                <ArrowRight size={17} aria-hidden="true" />
              )}{' '}
              {busy ? 'Preparing experiment…' : 'Create & run'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
