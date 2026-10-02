import { Copy } from 'lucide-react';
import { useMemo } from 'react';
import { buildListing } from '../../../shared/websiteText';
import type { DesignDetail } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { useQuery } from '../../lib/data';

function Block({ title, hint, text, children }: { title: string; hint?: string; text: string; children?: React.ReactNode }) {
  const toast = useToast();
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <button
          type="button"
          onClick={async () => ((await copyText(text)) ? toast.success(`${title} copied`) : toast.error('Couldn’t copy to the clipboard'))}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-brand transition-colors hover:bg-brand-tint"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
        </button>
      </div>
      {children ?? <p className="whitespace-pre-line rounded-lg bg-canvas px-3 py-2 text-sm">{text}</p>}
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </section>
  );
}

/** The words for this saree's page on a website, built from its choices. Meant to be read and adjusted, then pasted. */
export function WebsiteTextModal({ design, onClose }: { design: DesignDetail; onClose: () => void }) {
  const settings = useQuery(() => api.getSettings());
  const listing = useMemo(() => buildListing(design, { name: settings.data?.businessName ?? '', gstRatePercent: settings.data?.gstRatePercent ?? 5 }), [design, settings.data]);
  const description = listing.paragraphs.join('\n\n');
  const details = listing.details.map((d) => `${d.label}: ${d.value}`).join('\n');
  const noChoices = !design.weaveStyle && !design.technique && !design.pattern && !design.work;

  return (
    <Modal
      title="Website text"
      size="lg"
      onClose={onClose}
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      <div className="space-y-5">
        <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-ink-muted">
          Built from what you have recorded about this saree. Read it before you publish, and add what only you know: handwoven or not, the weaver, whether a blouse piece comes with it. {noChoices && 'This design has no weave style, technique, pattern or work yet, so the text is short. Add them from Edit.'}
        </p>

        <Block title="Product name" text={listing.title} hint="The same words every time: weave style, fabric, technique, pattern, then Saree, then work, then your own name last.">
          <p className="rounded-lg bg-canvas px-3 py-2 text-sm font-medium">{listing.title}</p>
        </Block>

        <Block title="Search result" text={`${listing.seoTitle}\n${listing.seoDescription}`} hint={`Title ${listing.seoTitle.length} of about 60 characters. Description ${listing.seoDescription.length} of about 155. Longer ones are cut off in search results, so the words shoppers search come first.`}>
          <div className="rounded-lg border border-line px-3 py-2">
            <div className="text-sm text-[#1a0dab]">{listing.seoTitle}</div>
            <div className="text-xs text-ink-muted">{listing.seoDescription}</div>
          </div>
        </Block>

        <Block title="Description" text={description}>
          <div className="space-y-2 rounded-lg bg-canvas px-3 py-2 text-sm">
            {listing.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </Block>

        <Block title="Details" text={details}>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 rounded-lg bg-canvas px-3 py-2 text-sm">
            {listing.details.map((d) => (
              <div key={d.label} className="contents">
                <dt className="text-ink-muted">{d.label}</dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>
        </Block>

        <Block title="Tags" text={listing.tags.join(', ')} />
        <Block title="Web address ending" text={listing.handle} hint="Lower case words, so the address says what the page is about." />
        <Block title="Product data for search engines" text={listing.jsonLd} hint="schema.org Product data, a block of JSON for the product page. Search engines and AI assistants read it for the name, material, colours, price and whether it is in stock.">
          <pre className="max-h-48 overflow-auto rounded-lg bg-canvas px-3 py-2 text-xs">{listing.jsonLd}</pre>
        </Block>
      </div>
    </Modal>
  );
}
