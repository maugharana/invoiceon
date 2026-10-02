import { ImagePlus, Star, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { MAX_PHOTOS_PER_DESIGN, type DesignDetail } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { photoFromFile } from '../../lib/image';

/** A design's photos: add, make one the cover (the one shown in lists), remove. Up to four, each shrunk before it is kept. */
export function PhotosCard({ design }: { design: DesignDetail }) {
  const toast = useToast();
  const refresh = useRefresh();
  const photos = useQuery(() => api.designPhotos(design.id), [design.id]);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = photos.data ?? [];

  async function act(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      refresh();
      if (done) toast.success(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function add(files: FileList | null) {
    if (!files) return;
    const room = MAX_PHOTOS_PER_DESIGN - list.length;
    const chosen = [...files].slice(0, room);
    if (files.length > room) toast.info(`Only ${room} more ${room === 1 ? 'photo fits' : 'photos fit'}: a design can have up to ${MAX_PHOTOS_PER_DESIGN}.`);
    await act(async () => {
      for (const f of chosen) await api.designPhotoAdd(design.id, await photoFromFile(f));
    }, chosen.length > 0 ? `${chosen.length === 1 ? 'Photo' : 'Photos'} added` : undefined);
    if (input.current) input.current.value = '';
  }

  return (
    <Card className="mb-8 p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base">Photos</h2>
        {list.length < MAX_PHOTOS_PER_DESIGN && (
          <>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => void add(e.target.files)} aria-label="Choose photos" />
            <Button icon={<ImagePlus className="h-4 w-4" />} loading={busy} onClick={() => input.current?.click()}>
              Add photo
            </Button>
          </>
        )}
      </div>
      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {list.length === 0 ? (
        <p className="text-ink-muted">No photos yet. The first one is shown next to this design in the Inventory list. Photos are shrunk to a small size before they are kept, so they don't make your backups large.</p>
      ) : (
        <ul className="grid grid-cols-4 gap-4">
          {list.map((p, i) => (
            <li key={p.id} className="overflow-hidden rounded-lg border border-line">
              <div className="relative aspect-[3/4] bg-canvas">
                <img src={p.dataUrl} alt={`${design.name}, photo ${i + 1}`} className="h-full w-full object-cover" />
                {i === 0 && <span className="absolute left-2 top-2 rounded-full bg-surface/90 px-2 py-0.5 text-xs text-brand">Cover</span>}
              </div>
              <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                {i === 0 ? (
                  <span className="text-xs text-ink-muted">Shown in lists</span>
                ) : (
                  <button type="button" disabled={busy} onClick={() => void act(() => api.designPhotoCover(p.id))} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-brand transition-colors hover:bg-brand-tint disabled:opacity-50">
                    <Star className="h-3.5 w-3.5" aria-hidden /> Make cover
                  </button>
                )}
                <button type="button" disabled={busy} aria-label={`Remove photo ${i + 1}`} onClick={() => void act(() => api.designPhotoRemove(p.id))} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-50">
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
