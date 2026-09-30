import { ImagePlus, Star, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { MAX_PHOTOS_PER_DESIGN } from '../../../shared/catalogue';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote } from '../../components/ui';
import { useAccess } from '../../lib/access';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { preparePhoto } from '../../lib/photo';

/** The photos of one design. The first is the cover: it shows in the lists and in the catalogue. */
export function PhotosPanel({ designId, designName }: { designId: string; designName: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const { can } = useAccess();
  const photos = useQuery(() => api.designPhotos(designId), [designId]);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const list = photos.data ?? [];
  const editable = can('stock');
  if (photos.error && !photos.data) return <ErrorNote>{photos.error}</ErrorNote>;
  if (!editable && list.length === 0) return null;

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files).slice(0, MAX_PHOTOS_PER_DESIGN - list.length)) await api.designPhotoAdd(designId, await preparePhoto(file));
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function act(run: () => Promise<void>) {
    try {
      await run();
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base">Photos</h2>
        {editable && (
          <>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden aria-label="Choose photos" onChange={(e) => void add(e.target.files)} />
            <Button icon={<ImagePlus className="h-4 w-4" />} loading={busy} disabled={list.length >= MAX_PHOTOS_PER_DESIGN} onClick={() => input.current?.click()}>
              Add photos
            </Button>
          </>
        )}
      </div>
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-ink-muted">No photos yet. Add up to {MAX_PHOTOS_PER_DESIGN}: the first one shows in the lists and in the catalogue you can share with customers.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {list.map((p, i) => (
            <li key={p.id} className="group relative h-40 w-32 overflow-hidden rounded-lg border border-line bg-canvas">
              <img src={p.image} alt={`${designName}, photo ${i + 1}`} className="h-full w-full object-cover" />
              {i === 0 && <span className="absolute left-1.5 top-1.5 rounded-full bg-brand px-2 py-0.5 text-[11px] text-white">Cover</span>}
              {editable && (
                <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
                  {i > 0 ? (
                    <button type="button" title="Make this the cover" aria-label="Make this the cover" onClick={() => void act(() => api.designPhotoCover(p.id))} className="rounded-md bg-white/90 p-1.5 text-ink hover:bg-white">
                      <Star className="h-4 w-4" aria-hidden />
                    </button>
                  ) : (
                    <span />
                  )}
                  <button type="button" title="Remove this photo" aria-label="Remove this photo" onClick={() => void act(() => api.designPhotoRemove(p.id))} className="rounded-md bg-white/90 p-1.5 text-status-overdue-fg hover:bg-white">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
