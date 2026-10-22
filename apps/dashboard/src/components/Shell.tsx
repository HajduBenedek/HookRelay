import { useQuery } from '@tanstack/react-query';
import { Inbox, LayoutGrid, Menu, Moon, Search, Send, Skull, Sun, X } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { href, navigate, type Route } from '../lib/router';
import { type Theme, useTheme } from '../lib/theme';
import { Mark } from './Mark';

const NAV: Array<{ route: Route; label: string; icon: typeof Inbox; match: Route['name'][] }> = [
  { route: { name: 'overview' }, label: 'Overview', icon: LayoutGrid, match: ['overview'] },
  {
    route: { name: 'events', filter: 'all' },
    label: 'Events',
    icon: Inbox,
    match: ['events', 'event'],
  },
  { route: { name: 'dead-letters' }, label: 'Dead letters', icon: Skull, match: ['dead-letters'] },
  { route: { name: 'destinations' }, label: 'Destinations', icon: Send, match: ['destinations'] },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  // The dead-letter count is the one nav badge: it is the queue that needs a person.
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: api.overview,
    refetchInterval: 3000,
  });
  const dead = overview.data?.deliveries.dead ?? 0;

  // Close the phone menu whenever navigation happens, including back/forward.
  useEffect(() => {
    const close = () => setMenuOpen(false);
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, []);

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ route: target, label, icon: Icon, match }) => {
        const active = match.includes(route.name);
        return (
          <a
            key={label}
            href={href(target)}
            aria-current={active ? 'page' : undefined}
            className={`flex h-8 items-center gap-2.5 rounded-[8px] px-2.5 text-sm transition-colors ${
              active ? 'bg-active text-ink' : 'text-muted hover:bg-raised hover:text-ink'
            }`}
          >
            <Icon size={16} strokeWidth={1.5} aria-hidden />
            <span className="flex-1">{label}</span>
            {label === 'Dead letters' && dead > 0 && (
              <span className="num text-xs font-medium text-negative">{dead}</span>
            )}
          </a>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-ground lg:grid lg:grid-cols-[228px_1fr] lg:grid-rows-[48px_1fr]">
      {/* Sidebar: part of the tinted L-frame, no rule against the top bar. */}
      <aside className="hidden lg:row-span-2 lg:flex lg:flex-col lg:gap-6 lg:px-3 lg:pt-3 lg:pb-4">
        <Brand />
        {nav}
        <div className="mt-auto flex flex-col gap-3 px-2.5">
          <ThemeSwitch theme={theme} setTheme={setTheme} />
          <p className="text-xs text-muted">Self-hosted · v0.1.0</p>
        </div>
      </aside>

      {/* Top bar on the frame tint. On a phone it carries the menu and the title. */}
      <header className="sticky top-0 z-20 flex h-12 items-center gap-3 bg-ground px-4 lg:static lg:px-0 lg:pr-2">
        <button
          type="button"
          className="-ml-1 grid size-11 place-items-center rounded-control lg:hidden"
          aria-label="Open menu"
          onClick={() => setMenuOpen(true)}
        >
          <Menu size={20} strokeWidth={1.5} />
        </button>
        <div className="lg:hidden">
          <Brand compact />
        </div>
        <EventSearch />
      </header>

      {/* The sheet: white, 1px edge, 16px corners, inset 8px from the right and bottom. */}
      <main className="min-w-0 bg-surface lg:mr-2 lg:mb-2 lg:rounded-sheet lg:border lg:border-border">
        <div className="mx-auto max-w-[1360px] px-5 pt-5 pb-10 sm:px-6 lg:pt-6">{children}</div>
      </main>

      {menuOpen && (
        <div className="fixed inset-0 z-30 flex flex-col gap-6 bg-ground p-4 lg:hidden">
          <div className="flex items-center justify-between">
            <Brand />
            <button
              type="button"
              className="grid size-11 place-items-center"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            >
              <X size={20} strokeWidth={1.5} />
            </button>
          </div>
          {nav}
          <div className="mt-auto">
            <ThemeSwitch theme={theme} setTheme={setTheme} />
          </div>
        </div>
      )}
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a href="#/" className="flex items-center gap-2.5 px-2.5 py-1">
      <Mark />
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold">HookRelay</span>
        {!compact && <span className="text-xs text-muted">localhost · demo shop</span>}
      </span>
    </a>
  );
}

function EventSearch() {
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = value.trim();
    if (!UUID.test(id)) return setInvalid(true);
    setInvalid(false);
    setValue('');
    navigate({ name: 'event', id });
  };
  return (
    <form onSubmit={submit} className="relative ml-auto w-full max-w-[420px] lg:mx-auto">
      <Search
        size={14}
        strokeWidth={1.5}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
        aria-label="Find an event by id"
        aria-invalid={invalid}
        placeholder="Jump to an event by id…"
        className={`h-8 w-full rounded-control border bg-surface pr-3 pl-8 font-mono text-[13px] placeholder:font-sans placeholder:text-muted ${
          invalid ? 'border-negative' : 'border-control'
        }`}
      />
    </form>
  );
}

function ThemeSwitch({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="flex h-8 items-center gap-2 text-sm text-muted hover:text-ink"
    >
      {theme === 'dark' ? (
        <Sun size={16} strokeWidth={1.5} />
      ) : (
        <Moon size={16} strokeWidth={1.5} />
      )}
      {theme === 'dark' ? 'Light theme' : 'Dark theme'}
    </button>
  );
}
