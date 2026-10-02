import { BellRing, CheckCheck } from 'lucide-react';
import { SEVERITY_DOT } from '../components/NotificationBell';
import { Button, Card, EmptyState, ErrorNote, PageHeader, Spinner } from '../components/ui';
import { openNotification, useNotifications } from '../lib/notifications';
import { plural } from '../lib/format';

const GROUPS = [
  { severity: 'urgent', title: 'Needs you now', note: 'Money or stock is at risk' },
  { severity: 'soon', title: 'Coming up', note: 'Worth doing this week' },
  { severity: 'info', title: 'Good to know', note: '' },
] as const;

/** Everything that wants attention in one place, worked out fresh from your books: it clears itself as you deal with things. */
export function NotificationsPage() {
  const n = useNotifications();
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="What needs you, most urgent first. This list updates itself as you deal with things."
        actions={
          <Button icon={<CheckCheck className="h-4 w-4" />} disabled={n.unread === 0} onClick={n.markAllRead}>
            Mark all read
          </Button>
        }
      />
      {n.error && <ErrorNote>{n.error}</ErrorNote>}
      {n.loading && n.items.length === 0 ? (
        <Spinner />
      ) : n.items.length === 0 ? (
        <Card>
          <EmptyState icon={<BellRing className="h-6 w-6" />} title="All clear" body="No overdue invoices, no low stock, no follow-ups waiting. When something needs you it appears here and in the bell at the top." />
        </Card>
      ) : (
        GROUPS.map((g) => {
          const rows = n.items.filter((i) => i.severity === g.severity);
          if (rows.length === 0) return null;
          return (
            <section key={g.severity} className="mb-8">
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="text-base">{g.title}</h2>
                <span className="text-xs text-ink-muted">
                  {plural(rows.length, 'item')}
                  {g.note && ` · ${g.note}`}
                </span>
              </div>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line/70">
                  {rows.map((item) => {
                    const read = n.isRead(item.id);
                    return (
                      <li key={item.id} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-canvas">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${read ? 'bg-line' : SEVERITY_DOT[item.severity]}`} aria-hidden />
                        <button
                          type="button"
                          onClick={() => {
                            n.markRead([item.id]);
                            openNotification(item.link);
                          }}
                          className={`min-w-0 flex-1 text-left ${read ? 'text-ink-muted' : ''}`}
                        >
                          <span className="block">{item.title}</span>
                          <span className="block text-xs text-ink-muted">{item.detail}</span>
                        </button>
                        <button type="button" onClick={() => (read ? n.markUnread(item.id) : n.markRead([item.id]))} className="shrink-0 text-xs text-ink-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 focus:opacity-100">
                          {read ? 'Mark unread' : 'Mark read'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          );
        })
      )}
    </>
  );
}
