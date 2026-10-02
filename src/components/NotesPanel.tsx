import { Check, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatDate, todayIso } from '../../shared/gst';
import { NOTE_KIND_LABEL, type NoteKind, type NoteSubject } from '../../shared/types';
import { api, errorMessage } from '../lib/api';
import { useQuery, useRefresh } from '../lib/data';
import { useToast } from './Toast';
import { Button, Card, ErrorNote, IconButton, Input, Money, MoneyInput, Select } from './ui';

/**
 * A running log for one customer, quote or invoice: notes, calls, visits, plus follow-ups and promises to pay that have a day
 * and can be ticked off. The ones still open show up on the dashboard and in the notifications when they come due.
 */
export function NotesPanel({ subjectType, subjectId, kinds, title = 'Notes' }: { subjectType: NoteSubject; subjectId: string; kinds?: NoteKind[]; title?: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const notes = useQuery(() => api.notesList(subjectType, subjectId), [subjectType, subjectId]);
  const allowed = kinds ?? (['note', 'call', 'visit', 'followup', 'promise'] as NoteKind[]);
  const [kind, setKind] = useState<NoteKind>(allowed[0]);
  const [body, setBody] = useState('');
  const [dueDate, setDueDate] = useState(todayIso());
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dated = kind === 'followup' || kind === 'promise';

  async function add() {
    setSaving(true);
    setError(null);
    try {
      await api.noteAdd({ subjectType, subjectId, kind, body, dueDate: dated ? dueDate : null, amountPaise: kind === 'promise' ? amount : 0 });
      setBody('');
      setAmount(0);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const today = todayIso();
  return (
    <>
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-base">{title}</h2>
        <span className="text-xs text-ink-muted">Follow-ups and promises appear on the dashboard when they come due.</span>
      </div>
      <Card className="mb-8 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)} className="w-40" aria-label="Kind of note">
            {allowed.map((k) => (
              <option key={k} value={k}>
                {NOTE_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
          {dated && <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="num w-40" aria-label="Day" />}
          {kind === 'promise' && <MoneyInput value={amount} onChange={setAmount} className="w-32" aria-label="Amount promised" />}
          <Input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            placeholder={kind === 'followup' ? 'What to follow up on' : kind === 'promise' ? 'Anything to remember (optional)' : 'What happened'}
            className="min-w-[12rem] flex-1"
          />
          <Button variant="primary" loading={saving} onClick={() => void add()}>
            Add
          </Button>
        </div>
        {error && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        {notes.data && notes.data.length > 0 && (
          <ul className="mt-4 divide-y divide-line/70">
            {notes.data.map((n) => {
              const open = (n.kind === 'followup' || n.kind === 'promise') && !n.doneAt;
              const late = open && n.dueDate !== null && n.dueDate < today;
              return (
                <li key={n.id} className="animate-fade-in flex items-start gap-3 py-2.5">
                  <div className="w-24 shrink-0 text-xs text-ink-muted">
                    <div className="num">{formatDate(n.createdAt.slice(0, 10))}</div>
                    <div>{NOTE_KIND_LABEL[n.kind]}</div>
                  </div>
                  <div className={`min-w-0 flex-1 ${n.doneAt ? 'text-ink-muted line-through' : ''}`}>
                    {n.kind === 'promise' && (
                      <span>
                        <Money paise={n.amountPaise} /> by <span className="num">{n.dueDate ? formatDate(n.dueDate) : ''}</span>
                        {n.body ? ' · ' : ''}
                      </span>
                    )}
                    {n.kind === 'followup' && n.dueDate && (
                      <span>
                        <span className="num">{formatDate(n.dueDate)}</span> · {' '}
                      </span>
                    )}
                    {n.body}
                    {late && <span className="ml-2 text-xs text-status-overdue-fg">overdue</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {(n.kind === 'followup' || n.kind === 'promise') && (
                      <Button className="h-8 text-xs" icon={<Check className="h-3.5 w-3.5" />} onClick={() => void act(() => api.noteDone(n.id, !n.doneAt))}>
                        {n.doneAt ? 'Reopen' : n.kind === 'promise' ? 'Kept' : 'Done'}
                      </Button>
                    )}
                    <IconButton label="Delete note" onClick={() => void act(() => api.noteDelete(n.id))}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
