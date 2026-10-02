import { Camera, ImagePlus, Star, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Photo, PhotoOwner } from '../../shared/types';
import { api, errorMessage } from '../lib/api';
import { useRefresh } from '../lib/data';
import { prepareImage, type PreparedImage } from '../lib/images';
import { Modal } from './Modal';
import { useToast } from './Toast';

interface Props {
  ownerType: PhotoOwner;
  /** Null while the thing does not exist yet (a new expense): pictures are held in `pending` until it is saved. */
  ownerId: string | null;
  pending?: PreparedImage[];
  onPending?: (list: PreparedImage[]) => void;
  /** Label for the add button and the empty hint. */
  noun?: string;
  max?: number;
}

/** Saves the pictures chosen before a thing existed, once it does. */
export async function savePending(ownerType: PhotoOwner, ownerId: string, list: PreparedImage[]): Promise<void> {
  for (const p of list) await api.photoAdd({ ownerType, ownerId, image: p.image, thumb: p.thumb });
}

/** A row of small pictures with add, enlarge, "make first" and remove. Used on designs, colours and expense receipts. */
export function PhotoStrip({ ownerType, ownerId, pending = [], onPending, noun = 'picture', max = 10 }: Props) {
  const toast = useToast();
  const refresh = useRefresh();
  const input = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ id: string; src: string; index: number } | null>(null);

  useEffect(() => {
    if (!ownerId) return;
    let live = true;
    api.photosList(ownerType, ownerId).then((p) => live && setPhotos(p)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ownerType, ownerId]);

  const shown = ownerId ? photos.map((p) => ({ key: p.id, thumb: p.thumb, id: p.id })) : pending.map((p, i) => ({ key: String(i), thumb: p.thumb, id: '' }));

  async function choose(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (shown.length + 1 > max) throw new Error(`Up to ${max} pictures can be kept here.`);
        const ready = await prepareImage(file);
        if (ownerId) {
          const added = await api.photoAdd({ ownerType, ownerId, image: ready.image, thumb: ready.thumb });
          setPhotos((p) => [...p, added]);
        } else {
          onPending?.([...pending, ready]);
        }
        shown.push({ key: 'x', thumb: ready.thumb, id: '' });
      }
      if (ownerId) refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function view(id: string, thumb: string, index: number) {
    if (!id) return setOpen({ id: '', src: thumb, index });
    setOpen({ id, src: thumb, index });
    try {
      setOpen({ id, src: await api.photoGet(id), index });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function remove(id: string, index: number) {
    try {
      if (id) {
        await api.photoDelete(id);
        setPhotos((p) => p.filter((x) => x.id !== id));
        refresh();
      } else onPending?.(pending.filter((_, i) => i !== index));
      setOpen(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function makeFirst(id: string) {
    try {
      setPhotos(await api.photoSetCover(id));
      refresh();
      toast.success('Now the first picture');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {shown.map((p, i) => (
          <button key={p.key + i} type="button" onClick={() => void view(p.id, p.thumb, i)} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-line bg-canvas transition-shadow hover:shadow-card" aria-label={`Open ${noun} ${i + 1}`}>
            <img src={p.thumb} alt="" className="h-full w-full object-cover" />
            {i === 0 && shown.length > 1 && <span className="absolute left-1 top-1 rounded bg-surface/90 px-1 text-[10px] text-ink-muted">First</span>}
          </button>
        ))}
        {shown.length < max && (
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-xs text-ink-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50">
            {shown.length === 0 ? <Camera className="h-5 w-5" aria-hidden /> : <ImagePlus className="h-5 w-5" aria-hidden />}
            {busy ? 'Adding…' : `Add ${noun}`}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} onChange={(e) => void choose(e.target.files)} />

      {open && (
        <Modal
          title={`Picture`}
          size="lg"
          onClose={() => setOpen(null)}
          footer={
            <>
              {ownerId && open.id && photos[0]?.id !== open.id && (
                <button type="button" onClick={() => void makeFirst(open.id)} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink">
                  <Star className="h-4 w-4" aria-hidden /> Make this the first picture
                </button>
              )}
              <button type="button" onClick={() => void remove(open.id, open.index)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-status-overdue-fg transition-colors hover:bg-status-overdue-bg">
                <Trash2 className="h-4 w-4" aria-hidden /> Remove
              </button>
              <button type="button" onClick={() => setOpen(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 transition-colors hover:bg-canvas">
                <X className="h-4 w-4" aria-hidden /> Close
              </button>
            </>
          }
        >
          <img src={open.src} alt="" className="mx-auto max-h-[60vh] rounded-lg object-contain" />
        </Modal>
      )}
    </div>
  );
}
