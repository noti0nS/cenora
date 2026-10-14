'use client';
import { useEffect, useRef, useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  AnimatePresence,
  LazyMotion,
  domMax,
  MotionConfig,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
} from 'motion/react';
import * as m from 'motion/react-m';
import {
  Search,
  Plus,
  Check,
  Clapperboard,
  Tv,
  Sparkles,
  Moon,
  Sun,
  LogOut,
  ArrowUpRight,
  UserRound,
  X,
  Play,
  Star,
  Dices,
  ShieldAlert,
  Users,
  Trophy,
  Ellipsis,
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import type { Media, Watchlist, SessionState, Member, Club, ShelfKind } from '@cenora/shared';
import { api, json, errorMessage, RequestError, score } from '@/lib/api';
import { Dropdown, MenuItem, MenuCheckboxItem, MenuRadioItems, Separator, Button } from './ui';
import { Access } from './access';
import { Poster } from './poster';
import { Wordmark, CarrotMark } from './brand';
import { TitleStage } from './title-stage';
import { AddMedia } from './add-media';
import { SettingsDialog } from './settings';
import { ClubsDialog } from './clubs-panel';
import { ImportDialog } from './import-dialog';
import { Roleta } from './roleta';
import { Avatar } from './avatar';
import { ClubRankingDialog } from './club-ranking';
import { DiscoverySection } from './discovery-section';

type Kind = ShelfKind;
type Page = { items: Media[]; nextOffset: number | null };
const kindCopy: Record<
  Kind,
  { tab: string; title: string; line: (n: number) => string; empty: string }
> = {
  movie: {
    tab: 'Filmes',
    title: 'Uma sessão, uma noite.',
    line: (n) =>
      n === 0
        ? 'Nenhum filme na estante'
        : n === 1
          ? '1 filme na estante'
          : `${n} filmes na estante`,
    empty: 'Nenhum filme por aqui ainda.',
  },
  tv: {
    tab: 'Séries',
    title: 'Um episódio de cada vez.',
    line: (n) =>
      n === 0
        ? 'Nenhuma série na estante'
        : n === 1
          ? '1 série na estante'
          : `${n} séries na estante`,
    empty: 'Nenhuma série por aqui ainda.',
  },
  anime: {
    tab: 'Animes',
    title: 'Um episódio, um novo mundo.',
    line: (n) =>
      n === 0
        ? 'Nenhum anime na estante'
        : n === 1
          ? '1 anime na estante'
          : `${n} animes na estante`,
    empty: 'Nenhum anime por aqui ainda.',
  },
};
const chipsFor = (mine: boolean) =>
  mine
    ? [
        ['', 'Todos'],
        ['want', 'Quero ver'],
        ['watched', 'Vistos'],
        ['dropped', 'Abandonados'],
      ]
    : [
        ['', 'Todos'],
        ['planned', 'Na fila'],
        ['watched', 'Vistos'],
      ];
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
        <LazyMotion features={domMax} strict>
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
  const [theme, setTheme] = useState('dark'),
    [kind, setKind] = useState<Kind>('movie'),
    [mine, setMine] = useState(false),
    [mediaId, setMediaId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [sort, setSort] = useState('recent');
  const [add, setAdd] = useState(false),
    [settings, setSettings] = useState(false),
    [clubsOpen, setClubsOpen] = useState(false),
    [rankingOpen, setRankingOpen] = useState(false),
    [importing, setImporting] = useState(false),
    [spinning, setSpinning] = useState(false),
    [inviteOpen, setInviteOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const q = useDebounced(search);
  useEffect(() => {
    const saved = localStorage.getItem('watchlist:theme') || 'dark';
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
    const read = () => {
      const url = new URL(window.location.href);
      const saved = localStorage.getItem('watchlist:kind');
      const selected = url.searchParams.get('kind') || saved;
      setKind(selected === 'tv' || selected === 'anime' ? selected : 'movie');
      setMine(url.searchParams.get('view') === 'mine');
      setMediaId(url.searchParams.get('media'));
      // Um link de convite aberto com clube ativo abre a tela de convite.
      setInviteOpen(Boolean(url.searchParams.get('convite')));
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || event.metaKey || event.ctrlKey) return;
      if (target?.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      event.preventDefault();
      setSearchOpen(true);
      searchInput.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
  });
  const counts = useQuery({
    queryKey: ['counts'],
    queryFn: () => api<Record<Kind, number>>('/media/counts'),
    enabled: Boolean(session.data?.member),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
  const navigate = (next: { kind?: Kind; mine?: boolean; media?: string | null }) => {
    const nextKind = next.kind ?? kind;
    const nextMine = next.mine ?? mine;
    const nextMedia = next.media === undefined ? null : next.media;
    setKind(nextKind);
    setMine(nextMine);
    setMediaId(nextMedia);
    localStorage.setItem('watchlist:kind', nextKind);
    const url = new URL(window.location.href);
    url.searchParams.set('kind', nextKind);
    url.searchParams.delete('view');
    url.searchParams.delete('media');
    url.searchParams.delete('convite');
    if (nextMine) url.searchParams.set('view', 'mine');
    if (nextMedia) url.searchParams.set('media', nextMedia);
    window.history.pushState({}, '', url);
  };
  const chips = chipsFor(mine);
  const activeStatus = chips.some(([value]) => value === status) ? status : '';
  const media = useInfiniteQuery<Page, Error, InfiniteData<Page, number>, unknown[], number>({
    queryKey: ['media', kind, mine, q, activeStatus, sort],
    enabled: Boolean(session.data?.member),
    initialPageParam: 0,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === kind ? previous : undefined,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ offset: String(pageParam), sort, kind });
      if (mine) p.set('mine', 'true');
      if (q) p.set('q', q);
      if (activeStatus) p.set('status', activeStatus);
      return api<Page>(`/media?${p}`);
    },
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
  // Titles in progress: the group's, and the ones this person is watching themselves.
  const progress = (mineOnly: boolean) => ({
    queryKey: ['media', 'watching', mineOnly],
    enabled: Boolean(session.data?.member),
    queryFn: () => api<Page>(`/media?status=watching&sort=recent${mineOnly ? '&mine=true' : ''}`),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
  const watchingGroup = useQuery(progress(false));
  const watchingMine = useQuery(progress(true));
  const unauthorized = [counts.error, media.error].some(
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
    navigate({ kind: 'movie', mine: false });
    setSearch('');
    setStatus('');
    setSearchOpen(false);
    setInviteOpen(false);
    void qc.invalidateQueries({ queryKey: ['session'] });
  };
  const logout = async () => {
    try {
      await api('/auth/logout', json('POST'));
      qc.setQueryData<SessionState>(['session'], (old) =>
        old ? { ...old, member: null, club: null } : old,
      );
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      navigate({ kind: 'movie', mine: false });
      void qc.invalidateQueries({ queryKey: ['session'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const switchClub = async (memberId: string) => {
    try {
      const data = await api<{ member: Member; club: Club }>(
        '/auth/club',
        json('POST', { memberId }),
      );
      qc.setQueryData<SessionState>(['session'], (old) =>
        old ? { ...old, member: data.member, club: data.club } : old,
      );
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      navigate({ kind: 'movie', mine: false });
      setSearch('');
      setStatus('');
      void qc.invalidateQueries({ queryKey: ['session'] });
      toast.success(`Agora você está em ${data.club.name}.`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  // The shelf is unified, so the list behind each title is an implementation detail.
  const ensureList = async () => {
    const existing = lists.data?.[0]?.id;
    if (existing) return existing;
    const created = await api<{ id: string }>(
      '/club/lists',
      json('POST', { name: 'Estante', color: 'lavender', icon: 'film' }),
    );
    await qc.invalidateQueries({ queryKey: ['lists'] });
    return created.id;
  };
  const items = media.data?.pages.flatMap((p) => p.items) || [];
  const preview = items.find((item) => item.id === mediaId) ?? null;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !media.hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !media.isFetchingNextPage) void media.fetchNextPage();
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [media.hasNextPage, media.isFetchingNextPage, media.fetchNextPage, items.length]);
  const total = counts.data?.[kind] ?? 0;
  const filtered = Boolean(q || activeStatus);
  const mineIds = new Set((watchingMine.data?.items ?? []).map((item) => item.id));
  const watchingItems = filtered
    ? []
    : [
        ...(watchingMine.data?.items ?? []),
        ...(watchingGroup.data?.items ?? []).filter((item) => !mineIds.has(item.id)),
      ];
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
          <CarrotMark size={56} />
          <span className="sr-only">Carregando Cenora</span>
        </div>
      ) : session.error ? (
        <div className="connection-error">
          <h1>Vamos tentar mais uma vez?</h1>
          <p>{errorMessage(session.error)}</p>
          <Button onClick={() => session.refetch()}>Tentar novamente</Button>
        </div>
      ) : !member || inviteOpen ? (
        <Access
          onEnter={enter}
          session={session.data ?? null}
          onInviteDismissed={() => setInviteOpen(false)}
        />
      ) : (
        <div className="app-shell" data-kind={kind}>
          <a href="#shelf" className="skip-link">
            Ir para os títulos
          </a>
          <header className="app-header">
            <a
              href="?kind=movie"
              className="wordmark"
              aria-label="Cenora — início (Filmes)"
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                navigate({ kind: 'movie', mine: false });
                setSearch('');
                setSearchOpen(false);
                setStatus('');
                setSort('recent');
                window.scrollTo({ top: 0 });
              }}
            >
              <Wordmark />
            </a>
            <div className="kind-switch" role="tablist" aria-label="Tipo de título">
              {(['movie', 'tv', 'anime'] as const).map((value) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={kind === value}
                  className={kind === value ? 'selected' : ''}
                  onClick={() => {
                    if (kind !== value) {
                      setStatus('');
                      navigate({ kind: value });
                    }
                  }}
                >
                  {kind === value && (
                    <m.span
                      layoutId="kind-thumb"
                      className="kind-thumb"
                      transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                    />
                  )}
                  <span className="kind-label">
                    {value === 'movie' ? (
                      <Clapperboard size={16} />
                    ) : value === 'anime' ? (
                      <Sparkles size={16} />
                    ) : (
                      <Tv size={16} />
                    )}
                    {kindCopy[value].tab}
                    <small>{counts.data?.[value] ?? ''}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className={`search ${searchOpen || search ? 'open' : ''}`} role="search">
              <button
                className="icon-button"
                aria-label="Buscar"
                onClick={() => {
                  setSearchOpen(true);
                  searchInput.current?.focus();
                }}
              >
                <Search size={19} />
              </button>
              <input
                ref={searchInput}
                aria-label="Buscar na estante"
                tabIndex={searchOpen || search ? 0 : -1}
                placeholder={
                  kind === 'anime'
                    ? 'Buscar animes'
                    : kind === 'tv'
                      ? 'Buscar séries'
                      : 'Buscar filmes'
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => !search && setSearchOpen(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearch('');
                    setSearchOpen(false);
                    e.currentTarget.blur();
                  }
                }}
              />
              {search && (
                <button
                  className="icon-button"
                  aria-label="Limpar busca"
                  onClick={() => {
                    setSearch('');
                    searchInput.current?.focus();
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <div className="header-actions">
              {session.data?.club?.rankingEnabled && member.rankingEnabled !== false && (
                <button
                  className="icon-button ranking-trigger"
                  aria-label="Ranking do clube"
                  title="Ranking do clube"
                  onClick={() => setRankingOpen(true)}
                >
                  <Trophy size={18} />
                </button>
              )}
              <Button className="add-button" aria-label="Adicionar" onClick={() => setAdd(true)}>
                <Plus size={18} />
                <span>Adicionar</span>
              </Button>
              <Dropdown
                trigger={
                  <button className="avatar-button" aria-label={`Perfil de ${member.name}`}>
                    <Avatar member={member} className="header-avatar" />
                  </button>
                }
              >
                <div className="menu-identity">
                  <Avatar member={member} className="menu-identity-avatar" />
                  <div className="menu-identity-copy">
                    <strong className="member-name">{member.name}</strong>
                    {session.data?.club && <span>{session.data.club.name}</span>}
                  </div>
                  <MenuItem
                    className="menu-theme-toggle"
                    ariaLabel={`Usar tema ${theme === 'light' ? 'escuro' : 'claro'}`}
                    title={`Usar tema ${theme === 'light' ? 'escuro' : 'claro'}`}
                    onSelect={toggleTheme}
                  >
                    {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
                  </MenuItem>
                </div>
                {(session.data?.clubs.length ?? 0) > 1 && (
                  <>
                    <Separator />
                    <div className="menu-section-label">Trocar de clube</div>
                    {session.data!.clubs.map((option) => {
                      const active = option.memberId === member.id;
                      return (
                        <MenuItem
                          key={option.memberId}
                          className={active ? 'menu-club-item active' : 'menu-club-item'}
                          onSelect={() => void switchClub(option.memberId)}
                        >
                          <Clapperboard size={15} />
                          <span className="menu-club">
                            {option.name}
                            {active && <span className="sr-only"> atual</span>}
                          </span>
                          {active && (
                            <span className="menu-selection" aria-hidden="true">
                              <Check size={15} />
                            </span>
                          )}
                        </MenuItem>
                      );
                    })}
                  </>
                )}
                <Separator />
                <MenuItem onSelect={() => setSettings(true)}>
                  <UserRound size={16} />
                  Meu perfil
                </MenuItem>
                <MenuItem onSelect={() => setClubsOpen(true)}>
                  <Users size={16} />
                  Clubes e participantes
                </MenuItem>
                {session.data?.club?.rankingEnabled && member.rankingEnabled !== false && (
                  <MenuItem onSelect={() => setRankingOpen(true)}>
                    <Trophy size={16} />
                    Ranking do clube
                  </MenuItem>
                )}
                {member.role === 'owner' && (
                  <MenuItem onSelect={() => setImporting(true)}>
                    <ArrowUpRight size={16} />
                    Importar títulos
                  </MenuItem>
                )}
                <Separator />
                <MenuItem onSelect={logout}>
                  <LogOut size={16} />
                  Sair do clube
                </MenuItem>
              </Dropdown>
            </div>
          </header>
          {session.data?.scoped && (
            <div className="scoped-banner" role="status">
              <ShieldAlert size={16} />
              <span>
                Este acesso vale só para este clube. Entre com o e-mail já vinculado ou com seu
                código de recuperação da identidade para ver os outros.
              </span>
              <button className="text-button" onClick={() => setSettings(true)}>
                Abrir meu perfil
              </button>
            </div>
          )}
          <section className="shelf-intro" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={kind}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <h1>{kindCopy[kind].title}</h1>
                <p>{counts.data ? kindCopy[kind].line(total) : ' '}</p>
              </m.div>
            </AnimatePresence>
          </section>
          <div className="toolbar">
            <div className="chips" role="group" aria-label="Filtrar por progresso">
              {chips.map(([value, label]) => (
                <button
                  key={value || 'all'}
                  className={`chip ${activeStatus === value ? 'on' : ''}`}
                  aria-pressed={activeStatus === value}
                  onClick={() => setStatus(value)}
                >
                  {activeStatus === value && (
                    <m.span
                      layoutId="chip-thumb"
                      className="chip-thumb"
                      transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                    />
                  )}
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="toolbar-end">
              <div
                className="shelf-desktop-controls"
                role="group"
                aria-label="Ferramentas da estante"
              >
                <button className="chip roleta-chip" onClick={() => setSpinning(true)}>
                  <Dices size={14} />
                  <span>Roleta</span>
                </button>
                <button
                  className={`chip mine ${mine ? 'on' : ''}`}
                  aria-pressed={mine}
                  onClick={() => {
                    setStatus('');
                    navigate({ mine: !mine });
                  }}
                >
                  <UserRound size={13} />
                  <span>Só os meus</span>
                </button>
                <select
                  className="sort"
                  aria-label="Ordenar títulos"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="recent">Recentes</option>
                  <option value="title">A–Z</option>
                  <option value="rating">Nota do grupo</option>
                </select>
              </div>
              <div className="shelf-mobile-controls">
                <Dropdown
                  trigger={
                    <button
                      className={`icon-button shelf-tools-trigger ${mine || sort !== 'recent' ? 'has-selection' : ''}`}
                      aria-label="Opções da estante"
                      title="Opções da estante"
                    >
                      <Ellipsis size={21} />
                    </button>
                  }
                >
                  <div className="menu-caption">{mine ? 'Sua fila' : 'Estante do clube'}</div>
                  <MenuItem onSelect={() => setSpinning(true)}>
                    <Dices size={16} /> Roleta
                  </MenuItem>
                  <Separator />
                  <MenuCheckboxItem
                    checked={mine}
                    onCheckedChange={(checked) => {
                      setStatus('');
                      navigate({ mine: checked });
                    }}
                  >
                    <UserRound size={16} /> Só os meus
                  </MenuCheckboxItem>
                  <Separator />
                  <div className="menu-caption">Ordenar por</div>
                  <MenuRadioItems
                    label="Ordenar títulos"
                    value={sort}
                    onChange={setSort}
                    options={[
                      { value: 'recent', label: 'Recentes' },
                      { value: 'title', label: 'A–Z' },
                      { value: 'rating', label: 'Nota do grupo' },
                    ]}
                  />
                </Dropdown>
              </div>
            </div>
          </div>
          {watchingItems.length > 0 && (
            <section className="watching-now" aria-label="Assistindo agora">
              <h2>Assistindo agora</h2>
              <ul className="watching-strip">
                {watchingItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`orb ${mineIds.has(item.id) ? 'mine' : ''}`}
                      aria-label={`Continuar ${item.title}`}
                      onClick={() => navigate({ media: item.id })}
                    >
                      <span className="orb-art">
                        {item.posterUrl ? (
                          <img src={item.posterUrl} alt="" loading="lazy" />
                        ) : (
                          <span>{item.title.charAt(0)}</span>
                        )}
                      </span>
                      <span className="orb-title">{item.title}</span>
                      <small>{mineIds.has(item.id) ? 'Você' : 'Grupo'}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <DiscoverySection
            key={`${member.id}:${kind}`}
            kind={kind}
            memberId={member.id}
            ensureList={ensureList}
            onPick={(id, selectedKind) => navigate({ media: id, kind: selectedKind })}
          />
          <main id="shelf" tabIndex={-1} aria-label={kindCopy[kind].tab}>
            {media.isPending ? (
              <div className="shelf" aria-label="Carregando títulos">
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className="skeleton-card">
                    <div className="poster skeleton" />
                    <div className="skeleton skeleton-title" />
                  </div>
                ))}
              </div>
            ) : media.error ? (
              <div className="empty-state">
                <h2>Essa cena precisa de mais uma tentativa.</h2>
                <p>{errorMessage(media.error)}</p>
                <Button onClick={() => media.refetch()}>Tentar novamente</Button>
              </div>
            ) : items.length ? (
              <>
                <ul className="shelf" key={`${kind}-${mine}-${activeStatus}-${sort}`}>
                  {items.map((item, index) => (
                    <PosterCard
                      key={item.id}
                      item={item}
                      index={index}
                      mine={mine}
                      onOpen={() => navigate({ media: item.id })}
                    />
                  ))}
                </ul>
                {media.hasNextPage && (
                  <div className="load-more" ref={sentinel}>
                    <Button
                      className="secondary"
                      busy={media.isFetchingNextPage}
                      onClick={() => media.fetchNextPage()}
                    >
                      Ver mais
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <CarrotMark size={64} />
                <h2>
                  {filtered || mine ? 'Nada por aqui com esse filtro.' : kindCopy[kind].empty}
                </h2>
                <p>
                  {filtered || mine
                    ? 'Experimente outra busca ou limpe os filtros.'
                    : kind === 'anime'
                      ? 'Adicione o primeiro anime e acompanhe episódio por episódio. Filmes de anime ficam em Filmes.'
                      : kind === 'tv'
                        ? 'Adicione a primeira série e acompanhe episódio por episódio.'
                        : 'Adicione o primeiro filme e dê uma nota depois da sessão.'}
                </p>
                {filtered || mine ? (
                  <Button
                    className="secondary"
                    onClick={() => {
                      setSearch('');
                      setStatus('');
                      if (mine) navigate({ mine: false });
                    }}
                  >
                    Limpar filtros
                  </Button>
                ) : (
                  <>
                    <Button onClick={() => setAdd(true)}>
                      <Plus size={16} />
                      {kind === 'anime'
                        ? 'Adicionar um anime'
                        : kind === 'tv'
                          ? 'Adicionar uma série'
                          : 'Adicionar um filme'}
                    </Button>
                    {member.role === 'owner' && (
                      <button className="text-button" onClick={() => setImporting(true)}>
                        Importar títulos
                        <ArrowUpRight size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </main>
          <TitleStage
            id={mediaId}
            preview={preview}
            onClose={() => navigate({ media: null })}
            catalogAvailable={Boolean(session.data?.catalogAvailable)}
            clubName={session.data?.club?.name ?? null}
            canRemove={member.role === 'owner'}
            ensureList={ensureList}
            onRecommended={(id, recommendedKind) => navigate({ media: id, kind: recommendedKind })}
          />
          <Roleta
            open={spinning}
            onClose={() => setSpinning(false)}
            kind={kind}
            mine={mine}
            onPick={(id) => {
              setSpinning(false);
              navigate({ media: id });
            }}
          />
          <AddMedia
            open={add}
            onClose={() => setAdd(false)}
            defaultKind={kind}
            ensureList={ensureList}
            catalogAvailable={Boolean(session.data?.catalogAvailable)}
            onAdded={(id, addedKind) => {
              setAdd(false);
              setSearch('');
              setStatus('');
              navigate({ kind: addedKind, mine: false, media: id });
            }}
          />
          <SettingsDialog
            open={settings}
            onClose={() => setSettings(false)}
            member={member}
            session={session.data ?? null}
            onProfile={(updated) =>
              qc.setQueryData(['session'], { ...session.data, member: updated })
            }
          />
          <ClubsDialog
            open={clubsOpen}
            onClose={() => setClubsOpen(false)}
            member={member}
            session={session.data ?? null}
            onSwitched={() => {
              navigate({ kind: 'movie', mine: false });
              setSearch('');
              setStatus('');
            }}
          />
          {session.data?.club && (
            <ClubRankingDialog
              key={session.data.club.id}
              open={rankingOpen}
              onClose={() => setRankingOpen(false)}
              member={member}
              clubId={session.data.club.id}
              defaultKind={kind}
            />
          )}
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
function PosterCard({
  item,
  index,
  mine,
  onOpen,
}: {
  item: Media;
  index: number;
  mine: boolean;
  onOpen: () => void;
}) {
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const spring = { stiffness: 220, damping: 20, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [0, 1], [7, -7]), spring);
  const rotateY = useSpring(useTransform(px, [0, 1], [-7, 7]), spring);
  const gx = useTransform(px, [0, 1], [0, 100]);
  const gy = useTransform(py, [0, 1], [0, 100]);
  const glare = useMotionTemplate`radial-gradient(circle at ${gx}% ${gy}%, rgb(255 255 255 / 0.24), transparent 58%)`;
  const reset = () => {
    px.set(0.5);
    py.set(0.5);
  };
  const state = mine ? item.personal?.status : item.groupStatus;
  const checkpoint = mine
    ? { season: item.personal?.season, episode: item.personal?.episode }
    : { season: item.groupSeason, episode: item.groupEpisode };
  const shownScore = mine ? (item.personal?.rating ?? item.average) : item.average;
  return (
    <m.li
      className="cell"
      layout="position"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: 'spring',
        stiffness: 260,
        damping: 26,
        delay: Math.min(index, 14) * 0.035,
      }}
    >
      <m.button
        className={`card kind-${item.kind}`}
        aria-label={`Abrir ${item.title}`}
        style={{ rotateX, rotateY, transformPerspective: 900 }}
        whileTap={{ scale: 0.97 }}
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse') return;
          const box = e.currentTarget.getBoundingClientRect();
          px.set((e.clientX - box.left) / box.width);
          py.set((e.clientY - box.top) / box.height);
        }}
        onPointerLeave={reset}
        onClick={() => {
          rotateX.jump(0);
          rotateY.jump(0);
          reset();
          onOpen();
        }}
      >
        <span className="card-art">
          <Poster media={item} layoutId={`poster-${item.id}`} />
          <m.span className="glare" style={{ backgroundImage: glare }} aria-hidden="true" />
          {state === 'watched' && (
            <span className="badge done" aria-hidden="true">
              <Check size={13} />
            </span>
          )}
          {state === 'watching' && (
            <span className="badge live" aria-hidden="true">
              <Play size={11} fill="currentColor" />
            </span>
          )}
        </span>
        <span className="card-title">{item.title}</span>
        <span className="card-meta">
          {item.kind === 'tv' && checkpoint.season && checkpoint.episode ? (
            <span className="pill progress">
              T{checkpoint.season} · E{checkpoint.episode}
            </span>
          ) : (
            item.year && <span>{item.year}</span>
          )}
          {shownScore != null && (
            <span className={`pill score ${mine && item.personal?.rating != null ? 'mine' : ''}`}>
              <Star size={10} fill="currentColor" />
              {score(shownScore)}
            </span>
          )}
        </span>
      </m.button>
    </m.li>
  );
}
