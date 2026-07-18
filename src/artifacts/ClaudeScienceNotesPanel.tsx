import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  MAX_ARTIFACT_NOTE_BODY_LENGTH,
  MAX_ARTIFACT_NOTE_TITLE_LENGTH,
  type ArtifactNote,
  type ArtifactNoteFormat,
  type ArtifactNoteScope,
  type ArtifactSequenceRange,
} from './claude-science-workspace-collections';
import { getNoteRangeAnchorReview } from './claude-science-sequence-edit';

export type ArtifactNoteInput = Omit<ArtifactNote, 'id' | 'createdAt' | 'updatedAt' | 'provenance'>;
export type ArtifactNoteTextUpdate = Pick<ArtifactNoteInput, 'title' | 'body' | 'format'>;
export type ArtifactNoteFilter = 'all' | 'workspace' | 'record';

export type ClaudeScienceNotesPanelProps = {
  notes: readonly ArtifactNote[];
  activeRecordId?: string | null;
  activeRecordName?: string | null;
  selectedRange?: ArtifactSequenceRange | null;
  onAdd: (note: ArtifactNoteInput) => void;
  onUpdate: (noteId: string, patch: ArtifactNoteTextUpdate) => void;
  onConfirmAnchor: (noteId: string) => void;
  onRemove: (noteId: string) => void;
  onReveal: (note: ArtifactNote) => void;
};

type NoteDraft = {
  title: string;
  body: string;
  format: ArtifactNoteFormat;
};

const EMPTY_DRAFT: NoteDraft = { title: '', body: '', format: 'plain' };

function defaultScope(
  activeRecordId: string | null | undefined,
  selectedRange: ArtifactSequenceRange | null | undefined,
): ArtifactNoteScope {
  if (activeRecordId && selectedRange) return 'range';
  if (activeRecordId) return 'record';
  return 'workspace';
}

function noteTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function recordLabel(
  recordId: string | undefined,
  activeRecordId: string | null | undefined,
  activeRecordName: string | null | undefined,
): string {
  if (!recordId) return 'Record';
  if (recordId === activeRecordId && activeRecordName?.trim()) return activeRecordName.trim();
  return recordId;
}

function noteScopeLabel(
  note: ArtifactNote,
  activeRecordId: string | null | undefined,
  activeRecordName: string | null | undefined,
): string {
  if (note.scope === 'workspace') return 'Workspace';
  const owner = recordLabel(note.recordId, activeRecordId, activeRecordName);
  if (note.scope === 'record') return owner;
  return `${owner} · ${note.range!.start + 1}–${note.range!.end}`;
}

function NoteFormatButtons({
  value,
  onChange,
  label,
}: {
  value: ArtifactNoteFormat;
  onChange: (value: ArtifactNoteFormat) => void;
  label: string;
}) {
  return (
    <div className="motif-cs-segmented" role="group" aria-label={label}>
      <button
        type="button"
        data-active={value === 'plain' || undefined}
        aria-pressed={value === 'plain'}
        onClick={() => onChange('plain')}
      >
        Plain
      </button>
      <button
        type="button"
        data-active={value === 'markdown' || undefined}
        aria-pressed={value === 'markdown'}
        onClick={() => onChange('markdown')}
      >
        Markdown
      </button>
    </div>
  );
}

export function ClaudeScienceNotesPanel({
  notes,
  activeRecordId,
  activeRecordName,
  selectedRange,
  onAdd,
  onUpdate,
  onConfirmAnchor,
  onRemove,
  onReveal,
}: ClaudeScienceNotesPanelProps) {
  const titleId = useId();
  const bodyId = useId();
  const scopeId = useId();
  const [filter, setFilter] = useState<ArtifactNoteFilter>('all');
  const [createScope, setCreateScope] = useState<ArtifactNoteScope>(() => defaultScope(activeRecordId, selectedRange));
  const [createDraft, setCreateDraft] = useState<NoteDraft>(EMPTY_DRAFT);
  const [createError, setCreateError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<NoteDraft>(EMPTY_DRAFT);
  const [editError, setEditError] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const addDetailsRef = useRef<HTMLDetailsElement>(null);
  const addSummaryRef = useRef<HTMLElement>(null);
  const createTitleRef = useRef<HTMLInputElement>(null);
  const editTitleRef = useRef<HTMLInputElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreEditFocusIdRef = useRef<string | null>(null);
  const restoreDeleteFocusIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (filter === 'record' && !activeRecordId) setFilter('all');
    if (!activeRecordId && createScope !== 'workspace') setCreateScope('workspace');
    else if (createScope === 'range' && !selectedRange) setCreateScope(activeRecordId ? 'record' : 'workspace');
  }, [activeRecordId, createScope, filter, selectedRange]);

  useEffect(() => {
    if (editingId && !notes.some((note) => note.id === editingId)) setEditingId(null);
    if (pendingDeleteId && !notes.some((note) => note.id === pendingDeleteId)) setPendingDeleteId(null);
  }, [editingId, notes, pendingDeleteId]);

  useLayoutEffect(() => {
    if (editingId) {
      editTitleRef.current?.focus();
      return;
    }
    const noteId = restoreEditFocusIdRef.current;
    restoreEditFocusIdRef.current = null;
    if (noteId) editButtonRefs.current.get(noteId)?.focus();
  }, [editingId]);

  useLayoutEffect(() => {
    if (pendingDeleteId) {
      cancelDeleteRef.current?.focus();
      return;
    }
    const noteId = restoreDeleteFocusIdRef.current;
    restoreDeleteFocusIdRef.current = null;
    if (noteId) deleteButtonRefs.current.get(noteId)?.focus();
  }, [pendingDeleteId]);

  const visibleNotes = useMemo(() => {
    const filtered = notes.filter((note) => {
      if (filter === 'workspace') return note.scope === 'workspace';
      if (filter === 'record') return Boolean(activeRecordId) && note.recordId === activeRecordId;
      return true;
    });
    return [...filtered].sort((left, right) => (
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id)
    ));
  }, [activeRecordId, filter, notes]);

  const openAddNote = useCallback(() => {
    setCreateScope(defaultScope(activeRecordId, selectedRange));
    setCreateDraft(EMPTY_DRAFT);
    setCreateError('');
    setPendingDeleteId(null);
    setEditingId(null);
    createTitleRef.current?.focus();
  }, [activeRecordId, selectedRange]);

  const closeAddNote = useCallback(() => {
    if (addDetailsRef.current) addDetailsRef.current.open = false;
    setCreateError('');
    addSummaryRef.current?.focus();
  }, []);

  const submitCreate = useCallback((event?: FormEvent) => {
    event?.preventDefault();
    if (!createDraft.body.trim()) {
      setCreateError('Note body is required.');
      return;
    }
    if (createScope !== 'workspace' && !activeRecordId) {
      setCreateError('Choose an active record before adding this note.');
      return;
    }
    if (createScope === 'range' && !selectedRange) {
      setCreateError('Select a sequence range before adding a range note.');
      return;
    }
    const note: ArtifactNoteInput = {
      ...(createDraft.title.trim() ? { title: createDraft.title.trim() } : {}),
      body: createDraft.body,
      format: createDraft.format,
      scope: createScope,
      ...(createScope === 'workspace' ? {} : { recordId: activeRecordId! }),
      ...(createScope === 'range' ? { range: { ...selectedRange! } } : {}),
    };
    try {
      onAdd(note);
      setCreateDraft(EMPTY_DRAFT);
      setCreateError('');
      setStatus('Note added.');
      closeAddNote();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'The note could not be added.');
    }
  }, [activeRecordId, closeAddNote, createDraft, createScope, onAdd, selectedRange]);

  const startEdit = useCallback((note: ArtifactNote) => {
    setPendingDeleteId(null);
    setEditingId(note.id);
    setEditDraft({ title: note.title ?? '', body: note.body, format: note.format });
    setEditError('');
  }, []);

  const cancelEdit = useCallback((noteId: string) => {
    restoreEditFocusIdRef.current = noteId;
    setEditingId(null);
    setEditError('');
  }, []);

  const submitEdit = useCallback((event: FormEvent, noteId: string) => {
    event.preventDefault();
    if (!editDraft.body.trim()) {
      setEditError('Note body is required.');
      return;
    }
    try {
      onUpdate(noteId, {
        ...(editDraft.title.trim() ? { title: editDraft.title.trim() } : { title: undefined }),
        body: editDraft.body,
        format: editDraft.format,
      });
      restoreEditFocusIdRef.current = noteId;
      setEditingId(null);
      setEditError('');
      setStatus('Note updated.');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'The note could not be updated.');
    }
  }, [editDraft, onUpdate]);

  const cancelDelete = useCallback((noteId: string) => {
    restoreDeleteFocusIdRef.current = noteId;
    setPendingDeleteId(null);
  }, []);

  const confirmDelete = useCallback((noteId: string) => {
    try {
      onRemove(noteId);
      setPendingDeleteId(null);
      setStatus('Note deleted.');
      addSummaryRef.current?.focus();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The note could not be deleted.');
    }
  }, [onRemove]);

  const confirmAnchor = useCallback((noteId: string) => {
    try {
      onConfirmAnchor(noteId);
      setStatus('Range anchor confirmed.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The range anchor could not be confirmed.');
    }
  }, [onConfirmAnchor]);

  const emptyMessage = filter === 'workspace'
    ? 'No workspace notes yet.'
    : filter === 'record'
      ? `No notes for ${activeRecordName?.trim() || 'this record'} yet.`
      : 'No notes yet. Add workspace context or annotate the active record.';

  return (
    <section className="motif-cs-notes-panel motif-cs-annotation-panel-body" aria-label="Notes">
      <div className="motif-cs-layer-actions" role="group" aria-label="Filter notes">
        <div className="motif-cs-segmented">
          {(['all', 'workspace', 'record'] as const).map((option) => (
            <button
              key={option}
              type="button"
              data-active={filter === option || undefined}
              aria-pressed={filter === option}
              disabled={option === 'record' && !activeRecordId}
              onClick={() => setFilter(option)}
            >
              {option === 'all' ? 'All' : option === 'workspace' ? 'Workspace' : 'Record'}
            </button>
          ))}
        </div>
        <span className="motif-cs-muted">{visibleNotes.length} shown</span>
      </div>

      <details
        ref={addDetailsRef}
        className="motif-cs-annotation-editor-drawer"
        onToggle={(event) => {
          if (event.currentTarget.open) openAddNote();
        }}
      >
        <summary ref={addSummaryRef} className="motif-cs-annotation-editor-summary">
          <span>Add note</span>
          <span className="motif-cs-chip">{defaultScope(activeRecordId, selectedRange)}</span>
        </summary>
        <form
          className="motif-cs-form-body"
          onSubmit={submitCreate}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeAddNote();
          }}
        >
          <div className="motif-cs-form-grid">
            <label htmlFor={scopeId}>
              <span>Scope</span>
              <select
                id={scopeId}
                className="motif-cs-field"
                value={createScope}
                onChange={(event) => setCreateScope(event.target.value as ArtifactNoteScope)}
              >
                <option value="workspace">Workspace</option>
                <option value="record" disabled={!activeRecordId}>Active record</option>
                <option value="range" disabled={!activeRecordId || !selectedRange}>Selected range</option>
              </select>
            </label>
            <label htmlFor={titleId}>
              <span>Title</span>
              <input
                ref={createTitleRef}
                id={titleId}
                className="motif-cs-field"
                autoComplete="off"
                maxLength={MAX_ARTIFACT_NOTE_TITLE_LENGTH}
                value={createDraft.title}
                onChange={(event) => setCreateDraft((draft) => ({ ...draft, title: event.target.value }))}
                placeholder="Optional title"
              />
            </label>
          </div>
          <label htmlFor={bodyId}>
            <span>Note</span>
            <textarea
              id={bodyId}
              className="motif-cs-textarea motif-cs-entry-description"
              maxLength={MAX_ARTIFACT_NOTE_BODY_LENGTH}
              value={createDraft.body}
              onChange={(event) => {
                setCreateDraft((draft) => ({ ...draft, body: event.target.value }));
                if (createError) setCreateError('');
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
                submitCreate();
              }}
              aria-invalid={Boolean(createError)}
              aria-describedby={createError ? `${bodyId}-error` : undefined}
              rows={3}
            />
          </label>
          <div className="motif-cs-layer-actions motif-cs-layer-actions-flush">
            <NoteFormatButtons
              value={createDraft.format}
              onChange={(format) => setCreateDraft((draft) => ({ ...draft, format }))}
              label="New note format"
            />
            <button className="motif-cs-mini-button motif-cs-mini-button-accent" type="submit">Add note</button>
            <button className="motif-cs-mini-button" type="button" onClick={closeAddNote}>Cancel</button>
          </div>
          <p className="motif-cs-form-note">Markdown is stored as text and is never interpreted as HTML.</p>
          {createError ? <p id={`${bodyId}-error`} className="motif-cs-inline-error" role="alert">{createError}</p> : null}
        </form>
      </details>

      <div className="motif-cs-annotation-list" data-testid="notes-list">
        {visibleNotes.length === 0 ? <p className="motif-cs-muted">{emptyMessage}</p> : visibleNotes.map((note) => {
          const anchorReview = getNoteRangeAnchorReview(note);
          return (
          <article key={note.id} className="motif-cs-analysis-row" data-testid={`note-${note.id}`} data-anchor-review={anchorReview?.status}>
            {editingId === note.id ? (
              <form
                className="motif-cs-form-body"
                onSubmit={(event) => submitEdit(event, note.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  event.stopPropagation();
                  cancelEdit(note.id);
                }}
              >
                <label>
                  <span>Title</span>
                  <input
                    ref={editTitleRef}
                    className="motif-cs-field"
                    autoComplete="off"
                    maxLength={MAX_ARTIFACT_NOTE_TITLE_LENGTH}
                    value={editDraft.title}
                    onChange={(event) => setEditDraft((draft) => ({ ...draft, title: event.target.value }))}
                    aria-label={`Title for ${note.title || 'untitled note'}`}
                  />
                </label>
                <label>
                  <span>Note</span>
                  <textarea
                    className="motif-cs-textarea motif-cs-entry-description"
                    maxLength={MAX_ARTIFACT_NOTE_BODY_LENGTH}
                    value={editDraft.body}
                    onChange={(event) => {
                      setEditDraft((draft) => ({ ...draft, body: event.target.value }));
                      if (editError) setEditError('');
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }}
                    aria-invalid={Boolean(editError)}
                    rows={3}
                  />
                </label>
                <div className="motif-cs-layer-actions motif-cs-layer-actions-flush">
                  <NoteFormatButtons
                    value={editDraft.format}
                    onChange={(format) => setEditDraft((draft) => ({ ...draft, format }))}
                    label="Edit note format"
                  />
                  <button className="motif-cs-mini-button motif-cs-mini-button-accent" type="submit">Update</button>
                  <button className="motif-cs-mini-button" type="button" onClick={() => cancelEdit(note.id)}>Cancel</button>
                </div>
                {editError ? <p className="motif-cs-inline-error" role="alert">{editError}</p> : null}
              </form>
            ) : (
              <div>
                <strong>{note.title || 'Untitled note'}</strong>
                <p className="motif-cs-form-note">
                  {noteScopeLabel(note, activeRecordId, activeRecordName)} · {note.format === 'markdown' ? 'Markdown' : 'Plain text'} ·{' '}
                  <time dateTime={note.updatedAt}>{noteTimestamp(note.updatedAt)}</time>
                </p>
                <p>{note.body}</p>
                {anchorReview ? (
                  <p className="motif-cs-form-note" role="note">
                    <strong>Review range anchor.</strong>{' '}
                    {anchorReview.status === 'detached'
                      ? `Bases ${anchorReview.previousRange.start + 1}–${anchorReview.previousRange.end} were fully deleted; this note was retained at record level.`
                      : `The sequence changed inside bases ${anchorReview.previousRange.start + 1}–${anchorReview.previousRange.end}; confirm the updated range after review.`}
                  </p>
                ) : null}
              </div>
            )}

            {editingId === note.id ? null : pendingDeleteId === note.id ? (
              <div
                className="motif-cs-layer-actions motif-cs-layer-actions-flush"
                role="group"
                aria-label={`Confirm deletion of ${note.title || 'untitled note'}`}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  event.stopPropagation();
                  cancelDelete(note.id);
                }}
              >
                <span>Delete?</span>
                <button ref={cancelDeleteRef} className="motif-cs-mini-button" type="button" onClick={() => cancelDelete(note.id)}>Cancel</button>
                <button className="motif-cs-mini-button motif-cs-confirm-delete" data-armed="true" type="button" onClick={() => confirmDelete(note.id)}>Delete note</button>
              </div>
            ) : (
              <div className="motif-cs-layer-actions motif-cs-layer-actions-flush">
                {note.scope === 'workspace' ? null : (
                  <button className="motif-cs-mini-button" type="button" onClick={() => onReveal(note)}>Reveal</button>
                )}
                <button
                  ref={(element) => {
                    if (element) editButtonRefs.current.set(note.id, element);
                    else editButtonRefs.current.delete(note.id);
                  }}
                  className="motif-cs-mini-button"
                  type="button"
                  onClick={() => startEdit(note)}
                >
                  Edit
                </button>
                <button
                  ref={(element) => {
                    if (element) deleteButtonRefs.current.set(note.id, element);
                    else deleteButtonRefs.current.delete(note.id);
                  }}
                  className="motif-cs-mini-button"
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setPendingDeleteId(note.id);
                  }}
                  aria-label={`Delete ${note.title || 'untitled note'}`}
                >
                  Delete
                </button>
                {anchorReview?.status === 'review' ? (
                  <button className="motif-cs-mini-button motif-cs-mini-button-accent" type="button" onClick={() => confirmAnchor(note.id)}>
                    Confirm anchor
                  </button>
                ) : null}
              </div>
            )}
          </article>
          );
        })}
      </div>

      <p
        className="motif-cs-settings-reset-status"
        data-empty={!status || undefined}
        role="status"
        aria-live="polite"
      >
        {status}
      </p>
    </section>
  );
}
