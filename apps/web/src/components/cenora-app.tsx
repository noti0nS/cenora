'use client';
import { useEffect, useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { LazyMotion, domAnimation, MotionConfig } from 'motion/react';
import * as m from 'motion/react-m';
import {
  Search,
  Plus,
  ChevronDown,
  Check,
  Film,
  Sparkles,
  Tv,
  Heart,
  Moon,
  Sun,
  LogOut,
  SlidersHorizontal,
  ArrowUpRight,
  Settings,
  UserRound,
  BookOpen,
  X,
  Loader2,
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import type { Media, Watchlist, SessionState, Member, Club } from '@cenora/shared';
import { personalLabels, groupLabels } from '@cenora/shared';
import { api, json, errorMessage, RequestError } from '@/lib/api';
import { Dropdown, MenuItem, Separator, Button, Modal, Field } from './ui';
import { Access } from './access';
import { Poster } from './poster';
import { MediaDialog } from './media-dialog';
import { AddMedia } from './add-media';
import { SettingsDialog } from './settings';
import { ImportDialog } from './import-dialog';

export const listIcons = { film: Film, sparkles: Sparkles, tv: Tv, heart: Heart, moon: Moon };
const colorNames: Record<string, string> = {
  lavender: 'Lavanda',
  coral: 'Coral',
  sage: 'Sálvia',
  blue: 'Azul',
  gold: 'Dourado',
};
const iconNames: Record<string, string> = {
  film: 'Filme',
  sparkles: 'Estrela',
  tv: 'Série',
  heart: 'Coração',
  moon: 'Lua',
};
function useDebounced(value: string) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setResult(value), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return result;
}
export default function CenoraApp() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15000,
            retry: (n, error) => n < 1 && (!(error instanceof RequestError) || error.status >= 500),
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation} strict>
          <App />
        </LazyMotion>
      </MotionConfig>
    </QueryClientProvider>
  );
}
function App() {
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api<SessionState>('/auth/session'),
    // Do not hide one-time recovery codes when someone switches apps to save them.
    refetchOnWindowFocus: (query) => Boolean(query.state.data?.member),
  });
  const [theme, setTheme] = useState('light'),
    [selected, setSelected] = useState(''),
    [mine, setMine] = useState(false),
    [mediaId, setMediaId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [sort, setSort] = useState('original');
  const [add, setAdd] = useState(false),
    [editList, setEditList] = useState<Watchlist | 'new' | null>(null),
    [settings, setSettings] = useState(false),
    [importing, setImporting] = useState(false);
  const q = useDebounced(search);
  useEffect(() => {
    const saved = localStorage.getItem('watchlist:theme') || 'light';
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
    const read = () => {
      const url = new URL(window.location.href);
      setSelected(url.searchParams.get('list') || localStorage.getItem('watchlist:list') || '');
      setMine(url.searchParams.get('view') === 'mine');
      setMediaId(url.searchParams.get('media'));
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('watchlist:theme', next);
    document.documentElement.dataset.theme = next;
  };
  const lists = useQuery({
    queryKey: ['lists'],
    queryFn: () => api<Watchlist[]>('/club/lists'),
    enabled: Boolean(session.data?.member),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
  const active = lists.data?.find((l) => l.id === selected) || lists.data?.[0];
  const navigate = (listId: string, personal: boolean, titleId: string | null = null) => {
    setSelected(listId);
    setMine(personal);
    setMediaId(titleId);
    if (listId) localStorage.setItem('watchlist:list', listId);
    const url = new URL(window.location.href);
    url.searchParams.delete('list');
    url.searchParams.delete('view');
    url.searchParams.delete('media');
    if (listId) url.searchParams.set('list', listId);
    if (personal) url.searchParams.set('view', 'mine');
    if (titleId) url.searchParams.set('media', titleId);
    window.history.pushState({}, '', url);
  };
  const media = useInfiniteQuery({
    queryKey: ['media', mine ? 'mine' : active?.id, q, status, sort],
    enabled: Boolean(session.data?.member && (mine || active)),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ offset: String(pageParam), sort });
      if (mine) p.set('mine', 'true');
      else if (active) p.set('list', active.id);
      if (q) p.set('q', q);
      if (status) p.set('status', status);
      return api<{ items: Media[]; nextOffset: number | null }>(`/media?${p}`);
    },
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
  const unauthorized = [lists.error, media.error].some(
    (e) => e instanceof RequestError && e.status === 401,
  );
  useEffect(() => {
    if (unauthorized) {
      qc.setQueryData<SessionState>(['session'], (old) =>
        old ? { ...old, member: null, club: null } : old,
      );
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      setMediaId(null);
      void qc.invalidateQueries({ queryKey: ['session'] });
    }
  }, [unauthorized, qc]);
  const member = session.data?.member;
  const enter = (member: Member, club: Club) => {
    // Preserve the active session observer while discarding previous private data.
    qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
    qc.setQueryData(['session'], { ...session.data, member, club });
    navigate('', false);
    setSearch('');
    setStatus('');
    setSearchOpen(false);
    void qc.invalidateQueries({ queryKey: ['session'] });
  };
  const logout = async () => {
    try {
      await api('/auth/logout', json('POST'));
      qc.setQueryData<SessionState>(['session'], (old) =>
        old ? { ...old, member: null, club: null } : old,
      );
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      setMediaId(null);
      navigate('', false);
      void qc.invalidateQueries({ queryKey: ['session'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const changeList = (id: string, personal = false) => {
    navigate(id, personal);
    setStatus('');
    setSearch('');
    setSearchOpen(false);
  };
  const items = media.data?.pages.flatMap((p) => p.items) || [];
  return (
    <>
      <Toaster
        position="bottom-center"
        richColors
        theme={theme === 'dark' ? 'dark' : 'light'}
        closeButton
      />
      {session.isPending ? (
        <div className="initial-loading">
          <span className="brand-mark">C</span>
          <span className="sr-only">Carregando Cenora</span>
        </div>
      ) : session.error ? (
        <div className="connection-error">
          <h1>Vamos tentar mais uma vez?</h1>
          <p>{errorMessage(session.error)}</p>
          <Button onClick={() => session.refetch()}>Tentar novamente</Button>
        </div>
      ) : !member ? (
        <Access onEnter={enter} />
      ) : (
        <div className="app-shell">
          <a href="#gallery" className="skip-link">
            Ir para os títulos
          </a>
          <header className="app-header">
            <div className="header-left">
              <span className="brand-mini" aria-hidden="true">
                C<span>✳</span>
              </span>
              <Dropdown
                trigger={
                  <button className="list-switcher" aria-label="Selecionar lista">
                    <span>{mine ? 'Minhas histórias' : active?.name || 'Cenora'}</span>
                    <ChevronDown size={18} />
                  </button>
                }
              >
                <div className="menu-caption">NOSSAS LISTAS</div>
                {lists.data?.map((l) => {
                  const Icon = listIcons[l.icon as keyof typeof listIcons] || Film;
                  return (
                    <MenuItem key={l.id} onSelect={() => changeList(l.id)}>
                      <span className={`list-dot ${l.color}`}>
                        <Icon size={15} />
                      </span>
                      <span className="menu-grow">{l.name}</span>
                      <small>{l.count}</small>
                      {!mine && active?.id === l.id && <Check size={14} />}
                    </MenuItem>
                  );
                })}
                <Separator />
                <MenuItem onSelect={() => setEditList('new')}>
                  <Plus size={16} />
                  Criar lista
                </MenuItem>
                {active && !mine && (
                  <MenuItem onSelect={() => setEditList(active)}>
                    <Settings size={16} />
                    Editar esta lista
                  </MenuItem>
                )}
              </Dropdown>
            </div>
            <div className="header-actions">
              <button
                className={`icon-button ${searchOpen ? 'is-active' : ''}`}
                aria-label="Buscar e filtrar"
                aria-expanded={searchOpen}
                onClick={() => setSearchOpen(!searchOpen)}
              >
                <Search size={20} />
              </button>
              <Button
                className="add-button"
                aria-label="Adicionar"
                onClick={() => setAdd(true)}
                disabled={!lists.data?.length}
              >
                <Plus size={18} />
                <span>Adicionar</span>
              </Button>
              <Dropdown
                trigger={
                  <button className="avatar-button" aria-label={`Perfil de ${member.name}`}>
                    {member.name.charAt(0).toLocaleUpperCase('pt-BR')}
                  </button>
                }
              >
                <div className="menu-caption member-name">{member.name}</div>
                {session.data?.club && <div className="menu-caption">{session.data.club.name}</div>}
                <MenuItem onSelect={() => changeList(active?.id || '', true)}>
                  <BookOpen size={16} />
                  Minhas histórias
                </MenuItem>
                <MenuItem onSelect={() => setSettings(true)}>
                  <UserRound size={16} />
                  Meu perfil
                </MenuItem>
                <MenuItem onSelect={toggleTheme}>
                  {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}Usar tema{' '}
                  {theme === 'light' ? 'escuro' : 'claro'}
                </MenuItem>
                {member.role === 'owner' && (
                  <>
                    <Separator />
                    <MenuItem onSelect={() => setImporting(true)}>
                      <ArrowUpRight size={16} />
                      Importar títulos
                    </MenuItem>
                    <MenuItem onSelect={() => setSettings(true)}>
                      <Settings size={16} />
                      Configurações do clube
                    </MenuItem>
                  </>
                )}
                <Separator />
                <MenuItem onSelect={logout}>
                  <LogOut size={16} />
                  Sair do clube
                </MenuItem>
              </Dropdown>
            </div>
          </header>
          {searchOpen && (
            <div className="search-panel">
              <div className="search-input">
                <Search size={18} />
                <input
                  autoFocus
                  aria-label="Buscar nesta lista"
                  placeholder="Qual história você está procurando?"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="icon-button"
                    aria-label="Limpar busca"
                    onClick={() => setSearch('')}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="filter-controls">
                <SlidersHorizontal size={15} />
                <select
                  aria-label="Filtrar por progresso"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">Todos os títulos</option>
                  {Object.entries(mine ? personalLabels : groupLabels).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Ordenar títulos"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="original">Ordem da lista</option>
                  <option value="title">A–Z</option>
                  <option value="recent">Recém-adicionados</option>
                  <option value="rating">Nota do grupo</option>
                </select>
              </div>
            </div>
          )}
          {(q || status) && (
            <div className="active-filter">
              <span>
                {q ? `“${q}”` : ''}
                {q && status ? ' · ' : ''}
                {status
                  ? mine
                    ? personalLabels[status as keyof typeof personalLabels]
                    : groupLabels[status as keyof typeof groupLabels]
                  : ''}
              </span>
              <button
                className="text-button"
                onClick={() => {
                  setSearch('');
                  setStatus('');
                }}
              >
                Limpar
                <X size={12} />
              </button>
            </div>
          )}
          <main
            id="gallery"
            tabIndex={-1}
            aria-label={mine ? 'Minhas histórias' : active?.name || 'Lista'}
          >
            {media.isPending || lists.isPending ? (
              <div className="gallery" aria-label="Carregando títulos">
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className="skeleton-card">
                    <div className="poster skeleton" />
                    <div className="skeleton skeleton-title" />
                  </div>
                ))}
              </div>
            ) : media.error || lists.error ? (
              <div className="empty-state">
                <h2>Essa cena precisa de mais uma tentativa.</h2>
                <p>{errorMessage(media.error || lists.error)}</p>
                <Button
                  onClick={() => {
                    media.refetch();
                    lists.refetch();
                  }}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : items.length ? (
              <>
                <div className="gallery">
                  {items.map((item) => (
                    <m.button
                      key={item.id}
                      className="media-card"
                      onClick={() => navigate(active?.id || '', mine, item.id)}
                      aria-label={`Abrir ${item.title}`}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                      whileHover={{ y: -3 }}
                    >
                      <Poster media={item} />
                      <span className="media-title">{item.title}</span>
                    </m.button>
                  ))}
                </div>
                {media.hasNextPage && (
                  <div className="load-more">
                    <Button
                      className="secondary"
                      busy={media.isFetchingNextPage}
                      onClick={() => media.fetchNextPage()}
                    >
                      Ver mais títulos
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-symbol">
                  <Film size={32} strokeWidth={1.3} />
                  <span>✳</span>
                </div>
                <h2>
                  {q || status
                    ? 'Nenhuma história por aqui.'
                    : mine
                      ? 'Seu capítulo começa aqui.'
                      : 'Qual vai ser a próxima história?'}
                </h2>
                <p>
                  {q || status
                    ? 'Experimente outra busca ou ajuste os filtros.'
                    : mine
                      ? 'Abra um título para guardar sua nota ou seu progresso.'
                      : 'Guarde os filmes e séries que vocês querem assistir juntos.'}
                </p>
                {!q && !status && !mine && (
                  <>
                    <Button onClick={() => setAdd(true)} disabled={!active}>
                      <Plus size={16} />
                      Adicionar um título
                    </Button>
                    {member.role === 'owner' && (
                      <button
                        className="text-button import-empty"
                        onClick={() => setImporting(true)}
                      >
                        Trazer nossa lista do documento
                        <ArrowUpRight size={14} />
                      </button>
                    )}
                    {!active && (
                      <Button className="secondary" onClick={() => setEditList('new')}>
                        Criar uma lista
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </main>
          <MediaDialog
            id={mediaId}
            lists={lists.data || []}
            currentList={mine ? null : active?.id || null}
            onClose={() => navigate(active?.id || '', mine)}
            catalogAvailable={Boolean(session.data?.catalogAvailable)}
          />
          <AddMedia
            open={add}
            onClose={() => setAdd(false)}
            lists={lists.data || []}
            initialList={active?.id || ''}
            catalogAvailable={Boolean(session.data?.catalogAvailable)}
            onAdded={(id) => {
              setAdd(false);
              navigate(active?.id || '', mine, id);
            }}
          />
          <ListEditor
            value={editList}
            onClose={() => setEditList(null)}
            owner={member.role === 'owner'}
            onSaved={(id) => {
              setEditList(null);
              changeList(id);
            }}
          />
          <SettingsDialog
            open={settings}
            onClose={() => setSettings(false)}
            member={member}
            onProfile={(updated) =>
              qc.setQueryData(['session'], { ...session.data, member: updated })
            }
          />
          <ImportDialog
            open={importing}
            onClose={() => setImporting(false)}
            catalogAvailable={Boolean(session.data?.catalogAvailable)}
          />
        </div>
      )}
    </>
  );
}
function ListEditor({
  value,
  onClose,
  onSaved,
  owner,
}: {
  value: Watchlist | 'new' | null;
  onClose: () => void;
  onSaved: (id: string) => void;
  owner: boolean;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(''),
    [color, setColor] = useState('lavender'),
    [icon, setIcon] = useState('film'),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setName(value && value !== 'new' ? value.name : '');
    setColor(value && value !== 'new' ? value.color : 'lavender');
    setIcon(value && value !== 'new' ? value.icon : 'film');
    setConfirm(false);
  }, [value]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ id?: string }>(
        value === 'new' ? '/club/lists' : `/club/lists/${value?.id}`,
        json(value === 'new' ? 'POST' : 'PATCH', {
          name,
          color,
          icon,
          ...(value && value !== 'new' ? { revision: value.revision } : {}),
        }),
      );
      await qc.invalidateQueries({ queryKey: ['lists'] });
      onSaved(result.id || (value && value !== 'new' ? value.id : ''));
      toast.success('Lista salva.');
    } catch (e) {
      toast.error(errorMessage(e));
      void qc.invalidateQueries({ queryKey: ['lists'] });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!value || value === 'new') return;
    setBusy(true);
    try {
      await api(`/club/lists/${value.id}`, json('DELETE'));
      await qc.invalidateQueries({ queryKey: ['lists'] });
      onSaved('');
      toast.success('Lista removida. As notas foram preservadas.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={Boolean(value)}
      onClose={busy ? () => {} : onClose}
      title={value === 'new' ? 'Uma nova lista' : 'Do seu jeito'}
      description="Um pequeno espaço para um novo tipo de história."
    >
      <form onSubmit={save} className="stack">
        <Field label="Nome da lista">
          <input
            data-autofocus
            maxLength={60}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Por exemplo, Domingo à noite"
          />
        </Field>
        <Field label="Um toque de cor">
          <div className="swatches">
            {['lavender', 'coral', 'sage', 'blue', 'gold'].map((c) => (
              <button
                key={c}
                type="button"
                aria-label={colorNames[c]}
                aria-pressed={color === c}
                className={`swatch ${c} ${color === c ? 'selected' : ''}`}
                onClick={() => setColor(c)}
              >
                {color === c && <Check size={16} />}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Ícone">
          <div className="icon-options">
            {Object.entries(listIcons).map(([key, Icon]) => (
              <button
                key={key}
                type="button"
                className={`icon-button ${icon === key ? 'selected' : ''}`}
                aria-label={`Ícone ${iconNames[key]}`}
                aria-pressed={icon === key}
                onClick={() => setIcon(key)}
              >
                <Icon size={20} />
              </button>
            ))}
          </div>
        </Field>
        <Button type="submit" busy={busy}>
          Salvar lista
        </Button>
        {owner &&
          value !== 'new' &&
          (confirm ? (
            <div className="confirm-box">
              <p>Remover a lista? Os títulos e as notas continuam no clube.</p>
              <Button type="button" className="danger-button" busy={busy} onClick={remove}>
                Remover lista
              </Button>
              <button type="button" className="text-button" onClick={() => setConfirm(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" className="text-button danger" onClick={() => setConfirm(true)}>
              Remover esta lista
            </button>
          ))}
      </form>
    </Modal>
  );
}
