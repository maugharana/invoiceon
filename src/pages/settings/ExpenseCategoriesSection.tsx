import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_EXPENSE_CATEGORIES } from '../../../shared/types';
import { Button, Input, MoneyInput } from '../../components/ui';
import type { SectionProps } from './draft';

export function ExpenseCategoriesSection({ draft, set }: SectionProps) {
  const [name, setName] = useState('');
  const list = draft.expenseCategories;
  const trimmed = name.trim();
  const budgets = draft.expenseBudgets;
  const setBudget = (category: string, paise: number) => {
    const { [category]: _old, ...rest } = budgets;
    set('expenseBudgets', paise > 0 ? { ...rest, [category]: paise } : rest);
  };
  const duplicate = list.some((c) => c.toLowerCase() === trimmed.toLowerCase());

  function add() {
    if (!trimmed || duplicate) return;
    set('expenseCategories', [...list, trimmed]);
    setName('');
  }

  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-canvas px-3 py-2 text-ink-muted">These are offered when you record an expense, and used to group them on the dashboard. Renaming or removing one here doesn't change expenses you've already recorded. Give a category a monthly budget and the Expenses page shows how the month is going against it.</p>

      <ul className="overflow-hidden rounded-lg border border-line">
        {list.length === 0 && <li className="px-4 py-3 text-ink-muted">No categories. Add one below, or restore the standard list.</li>}
        {list.map((c, i) => (
          <li key={i} className="flex items-center gap-2 border-b border-line/70 px-2 py-1.5 last:border-0">
            <Input
              value={c}
              aria-label={`Category ${i + 1}`}
              onChange={(e) => {
                const renamed = e.target.value;
                set('expenseCategories', list.map((x, j) => (j === i ? renamed : x)));
                // The budget follows the category when it is renamed.
                if (c in budgets) {
                  const { [c]: kept, ...rest } = budgets;
                  set('expenseBudgets', renamed ? { ...rest, [renamed]: kept! } : rest);
                }
              }}
              className="border-transparent bg-transparent hover:border-line"
            />
            <div className="w-36 shrink-0" title="A monthly limit. You are told when spending nears or passes it. Leave empty for no limit.">
              <MoneyInput value={budgets[c] ?? 0} onChange={(p) => setBudget(c, p)} placeholder="Monthly budget" aria-label={`Monthly budget for ${c || 'category'}`} className="h-8" />
            </div>
            <button type="button" aria-label={`Remove ${c || 'category'}`} onClick={() => set('expenseCategories', list.filter((_, j) => j !== i))} className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-status-overdue-bg hover:text-status-overdue-fg">
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <form
        className="flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="flex-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category, e.g. Repairs" maxLength={40} aria-label="New category" />
          {duplicate && <span className="mt-1 block text-xs text-status-overdue-fg">“{trimmed}” is already in the list.</span>}
        </div>
        <Button type="submit" icon={<Plus className="h-4 w-4" />} disabled={!trimmed || duplicate}>
          Add
        </Button>
      </form>

      <button type="button" onClick={() => set('expenseCategories', DEFAULT_EXPENSE_CATEGORIES)} className="text-xs text-ink-muted underline-offset-2 transition-colors hover:text-ink hover:underline">
        Restore the standard list
      </button>
    </div>
  );
}
