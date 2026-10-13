'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Link2,
  Lock,
  LogIn,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  UserMinus,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Club, ClubInvite, ClubOption, Member, SessionState } from '@cenora/shared';
import { api, json, errorMessage } from '@/lib/api';
import { extractInviteToken, inviteLink } from '@/lib/invite';
import { Button, CodeReveal, Field, Modal, Segmented, copyCode } from './ui';
import { Avatar } from './avatar';
import { MemberBadge } from './achievement-collection';

type Roster = (Member & { active: number; linked?: number })[];
type Tab = 'people' | 'invite' | 'settings';
type AddMode = 'join' | 'create' | 'bring';
type Confirm = { label: string; action: string; run: () => Promise<void> };

export function ClubsDialog({
  open,
  onClose,
  member,
  session,
  onSwitched,
}: {
  open: boolean;
  onClose: () => void;
  member: Member;
  session: SessionState | null;
  onSwitched: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('people');
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>('join');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [code, setCode] = useState<{ label: string; value: string } | null>(null);
  const [joinToken, setJoinToken] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [createName, setCreateName] = useState('');
  const [bringMode, setBringMode] = useState<'claim' | 'recovery'>('claim');
  const [bringCode, setBringCode] = useState('');
  const [passwordEdit, setPasswordEdit] = useState(false);
  const [passwordValue, setPasswordValue] = useState('');

  const user = session?.user ?? null;
  const scoped = Boolean(session?.scoped);
  const isOwner = member.role === 'owner';
  const canManageClubs = Boolean(user) && !scoped;
  const club = session?.club ?? null;
  const clubs: ClubOption[] = session?.clubs.length
    ? session.clubs
    : club
      ? [
          {
            memberId: member.id,
            clubId: club.id,
            name: club.name,
            role: member.role,
            memberCount: 1,
          },
        ]
      : [];
  const tabs: { value: Tab; label: string }[] = isOwner
    ? [
        { value: 'people', label: 'Participantes' },
        { value: 'invite', label: 'Convite' },
        { value: 'settings', label: 'Ajustes' },
      ]
    : [{ value: 'people', label: 'Participantes' }];

  const roster = useQuery({
    queryKey: ['members', club?.id],
    queryFn: () => api<Roster>('/club/members'),
    enabled: open && Boolean(club),
  });
  const invite = useQuery({
    queryKey: ['invite', club?.id],
    queryFn: () => api<{ invite: ClubInvite | null }>('/club/invite'),
    enabled: open && Boolean(club) && isOwner,
  });
  const currentInvite = invite.data?.invite ?? null;

  useEffect(() => {
    if (open) {
      setTab('people');
      setAdding(false);
      setConfirm(null);
      setCode(null);
      setJoinPassword('');
      setPasswordEdit(false);
      setPasswordValue('');
    }
  }, [open]);

  const refresh = () => {
    for (const key of ['session', 'members', 'lists', 'media', 'counts'])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setConfirm(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const switchClub = (target: ClubOption) =>
    run(async () => {
      const data = await api<{ member: Member; club: Club }>(
        '/auth/club',
        json('POST', { memberId: target.memberId }),
      );
      qc.setQueryData<SessionState>(['session'], (old) =>
        old ? { ...old, member: data.member, club: data.club } : old,
      );
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      void qc.invalidateQueries({ queryKey: ['session'] });
      toast.success(`Agora você está em ${data.club.name}.`);
      setTab('people');
      onSwitched();
    });
  const arrived = (message: string) => {
    refresh();
    onSwitched();
    toast.success(message);
    setAdding(false);
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const linked = extractInviteToken(joinToken);
      const data = await api<{ member: Member; club: Club }>(
        linked ? '/auth/invite' : '/auth/join',
        json(
          'POST',
          linked
            ? {
                name: joinName,
                token: linked,
                ...(joinPassword ? { password: joinPassword } : {}),
              }
            : { name: joinName, token: joinToken.trim() },
        ),
      );
      localStorage.setItem('watchlist:name', data.member.name);
      arrived(`Você entrou em ${data.club.name}.`);
      setJoinName('');
      setJoinToken('');
      setJoinPassword('');
    });
  };
  const create = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const data = await api<{ member: Member; club: Club }>(
        '/auth/create',
        json('POST', { name: createName }),
      );
      arrived(`${data.club.name} foi criado.`);
      setCreateName('');
    });
  };
  const bring = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api(
        bringMode === 'claim' ? '/auth/claim' : '/auth/link',
        json(
          'POST',
          bringMode === 'claim' ? { code: bringCode.trim() } : { recoveryCode: bringCode.trim() },
        ),
      );
      arrived('Perfil trazido para esta conta.');
      setBringCode('');
    });
  };
  const exportData = () =>
    run(async () => {
      const data = await api('/club/export');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `cenora-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Cópia exportada.');
    });
  const reveal = (label: string, value: string) => setCode({ label, value });
  const refreshInvite = () => qc.invalidateQueries({ queryKey: ['invite', club?.id] });
  const createInvite = () =>
    run(async () => {
      await api('/club/invite', json('POST'));
      await refreshInvite();
      toast.success('Link de convite criado.');
    });
  const rotateInvite = () =>
    setConfirm({
      label: 'Gerar um novo link? O link atual deixa de funcionar imediatamente.',
      action: 'Gerar novo link',
      run: async () => {
        await api('/club/invite', json('POST'));
        await refreshInvite();
        toast.success('Novo link gerado.');
      },
    });
  const revokeInvite = () =>
    setConfirm({
      label:
        'Revogar o convite? O clube volta a ser privado e ninguém mais entra por este link. Quem já participa continua.',
      action: 'Revogar convite',
      run: async () => {
        await api('/club/invite', json('DELETE'));
        await refreshInvite();
        toast.success('Convite revogado.');
      },
    });
  const savePassword = () =>
    run(async () => {
      await api('/club/invite', json('PATCH', { password: passwordValue.trim() || null }));
      await refreshInvite();
      setPasswordEdit(false);
      setPasswordValue('');
      toast.success('Senha do convite atualizada.');
    });
  const clearPassword = () =>
    run(async () => {
      await api('/club/invite', json('PATCH', { password: null }));
      await refreshInvite();
      toast.success('Senha removida.');
    });

  const peopleList = (
    <div className="roster" aria-live="polite">
      {roster.isPending ? (
        <p className="muted-note">Carregando participantes…</p>
      ) : roster.error ? (
        <p role="alert" className="error-note">
          {errorMessage(roster.error)}
        </p>
      ) : (
        roster.data?.map((person) => (
          <div className="roster-row" key={person.id}>
            <Avatar member={person} />
            <span className="roster-name">
              {person.name}
              <MemberBadge badge={person.featuredBadge} />
              <small>
                {person.id === member.id && 'Você'}
                {person.id === member.id && (person.role === 'owner' || isOwner) && ' · '}
                {person.role === 'owner' && 'Responsável'}
                {person.role === 'owner' && isOwner && person.id !== member.id && ' · '}
                {isOwner && person.id !== member.id && (person.linked ? 'Com conta' : 'Sem e-mail')}
              </small>
            </span>
            {isOwner && person.id !== member.id && (
              <span className="roster-actions">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      label: person.linked
                        ? `Gerar um código de reacesso para ${person.name}? Ele abre só este clube, por 7 dias, uma vez.`
                        : `Gerar um código de reacesso para ${person.name}? Quem tiver uma conta pode usá-lo em Trazer perfil para assumir este perfil, por 7 dias, uma vez.`,
                      action: 'Gerar código',
                      run: async () => {
                        const r = await api<{ claimCode: string }>(
                          `/club/members/${person.id}/claim`,
                          json('POST'),
                        );
                        reveal(`Reacesso de ${person.name} · envie para a pessoa`, r.claimCode);
                      },
                    })
                  }
                >
                  <KeyRound size={13} />
                  Reacesso
                </button>
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      label: `Remover ${person.name} do clube? O perfil não poderá entrar novamente.`,
                      action: 'Remover',
                      run: async () => {
                        await api(`/club/members/${person.id}`, json('DELETE'));
                        refresh();
                        toast.success('Perfil removido.');
                      },
                    })
                  }
                >
                  <UserMinus size={13} />
                  Remover
                </button>
              </span>
            )}
          </div>
        ))
      )}
    </div>
  );

  const addForm = (
    <div className="stack club-add">
      <Segmented
        value={addMode}
        onChange={setAddMode}
        label="O que você quer fazer"
        options={[
          { value: 'join', label: 'Entrar com código' },
          { value: 'create', label: 'Criar clube' },
          { value: 'bring', label: 'Trazer perfil' },
        ]}
      />
      {addMode === 'join' && (
        <form className="stack" onSubmit={join}>
          <Field
            label="Código ou link do convite"
            hint="Cole o código do clube ou o link que alguém compartilhou."
          >
            <input
              autoComplete="off"
              spellCheck={false}
              value={joinToken}
              onChange={(e) => setJoinToken(e.target.value)}
            />
          </Field>
          {Boolean(extractInviteToken(joinToken)) && (
            <Field label="Senha do convite" hint="Só se o convite tiver senha.">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
              />
            </Field>
          )}
          <Field label="Seu nome neste clube">
            <input
              autoComplete="nickname"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            busy={busy}
            disabled={joinToken.trim().length < 12 || joinName.trim().length < 2}
          >
            <LogIn size={15} />
            Entrar no clube
          </Button>
        </form>
      )}
      {addMode === 'create' && (
        <form className="stack" onSubmit={create}>
          <Field label="Seu nome no novo clube">
            <input
              autoComplete="nickname"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
            />
          </Field>
          <Button type="submit" busy={busy} disabled={createName.trim().length < 2}>
            <Plus size={15} />
            Criar clube
          </Button>
        </form>
      )}
      {addMode === 'bring' && (
        <form className="stack" onSubmit={bring}>
          <Segmented
            value={bringMode}
            onChange={setBringMode}
            label="Tipo de código"
            options={[
              { value: 'claim', label: 'Código do dono' },
              { value: 'recovery', label: 'Código de recuperação' },
            ]}
          />
          <Field
            label={bringMode === 'claim' ? 'Código de reacesso' : 'Código de recuperação'}
            hint={
              bringMode === 'claim'
                ? 'Peça ao dono do clube, em Participantes › Reacesso. O perfil passa a ser da sua conta.'
                : 'O código do perfil ou do aparelho antigo. Basta ele, sem nome nem código do clube.'
            }
          >
            <input
              autoComplete="off"
              spellCheck={false}
              value={bringCode}
              onChange={(e) => setBringCode(e.target.value)}
            />
          </Field>
          <Button type="submit" busy={busy} disabled={bringCode.trim().length < 12}>
            <Link2 size={15} />
            Trazer para esta conta
          </Button>
        </form>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={busy || code ? () => {} : onClose}
      title="Seus clubes"
      description="Troque de clube e cuide de quem participa."
      className="clubs-modal"
    >
      {code ? (
        <CodeReveal label={code.label} value={code.value} onDone={() => setCode(null)} />
      ) : (
        <div className="clubs-layout">
          <nav className="club-list" aria-label="Seus clubes">
            {clubs.map((option) => {
              const current = option.memberId === member.id;
              return (
                <button
                  key={option.memberId}
                  className={`club-card${current ? ' current' : ''}`}
                  aria-current={current ? 'true' : undefined}
                  disabled={busy || (!current && scoped)}
                  onClick={() => {
                    setAdding(false);
                    if (!current) void switchClub(option);
                  }}
                >
                  <span className="small-avatar">
                    {option.name.charAt(0).toLocaleUpperCase('pt-BR')}
                  </span>
                  <span className="club-card-text">
                    {option.name}
                    <small>
                      {option.role === 'owner' ? 'Responsável' : 'Participante'} ·{' '}
                      {option.memberCount === 1 ? '1 pessoa' : `${option.memberCount} pessoas`}
                    </small>
                  </span>
                  {current && <Check size={15} aria-label="Clube atual" />}
                </button>
              );
            })}
            {canManageClubs && (
              <button
                className={`club-card add${adding ? ' current' : ''}`}
                disabled={busy}
                onClick={() => setAdding(true)}
              >
                <span className="small-avatar">
                  <Plus size={14} />
                </span>
                <span className="club-card-text">
                  Criar, entrar ou trazer
                  <small>Código de convite, clube novo ou perfil antigo</small>
                </span>
              </button>
            )}
          </nav>
          <section className="club-detail">
            {scoped && (
              <p role="status" className="muted-note">
                <Shield size={14} /> Este acesso vale só para este clube. Entre com o e-mail já
                vinculado ou com seu código de recuperação para liberar os outros.
              </p>
            )}
            {!user && !scoped && (
              <p className="muted-note">
                Vincule um e-mail em Meu perfil para participar de mais de um clube.
              </p>
            )}
            {adding ? (
              <>
                <h3>Adicionar um clube</h3>
                {addForm}
              </>
            ) : (
              club && (
                <>
                  <h3>{club.name}</h3>
                  <Segmented
                    value={tab}
                    onChange={(value) => {
                      setTab(value);
                      setConfirm(null);
                    }}
                    label="Seções do clube"
                    options={tabs}
                  />
                  {tab === 'people' && peopleList}
                  {tab === 'invite' && isOwner && (
                    <div className="stack">
                      {invite.isPending ? (
                        <p className="muted-note">Carregando o convite…</p>
                      ) : invite.error ? (
                        <p role="alert" className="error-note">
                          {errorMessage(invite.error)}
                        </p>
                      ) : currentInvite ? (
                        <>
                          <p className="muted-note">
                            Quem abrir este link entra como participante, escolhendo o próprio nome.
                            O link não expira: revogue quando quiser que o clube volte a ser
                            privado.
                          </p>
                          <div className="code-block">
                            <span>
                              Link de convite{' '}
                              <small>
                                {currentInvite.passwordProtected ? 'Com senha' : 'Sem senha'}
                              </small>
                            </span>
                            <code>{inviteLink(currentInvite.token)}</code>
                            <Button
                              className="secondary"
                              onClick={() => copyCode(inviteLink(currentInvite.token))}
                            >
                              <Copy size={15} />
                              Copiar link
                            </Button>
                          </div>
                          {passwordEdit ? (
                            <form
                              className="stack"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void savePassword();
                              }}
                            >
                              <Field
                                label={
                                  currentInvite.passwordProtected
                                    ? 'Nova senha'
                                    : 'Senha do convite'
                                }
                                hint="Pelo menos 4 caracteres. Quem abrir o link vai precisar dela."
                              >
                                <input
                                  type="password"
                                  autoComplete="off"
                                  value={passwordValue}
                                  onChange={(e) => setPasswordValue(e.target.value)}
                                />
                              </Field>
                              <Button
                                type="submit"
                                busy={busy}
                                disabled={passwordValue.trim().length < 4}
                              >
                                Salvar senha
                              </Button>
                              <button
                                type="button"
                                className="text-button"
                                disabled={busy}
                                onClick={() => {
                                  setPasswordEdit(false);
                                  setPasswordValue('');
                                }}
                              >
                                Cancelar
                              </button>
                            </form>
                          ) : (
                            <button
                              className="settings-action"
                              disabled={busy}
                              onClick={() => {
                                setPasswordValue('');
                                setPasswordEdit(true);
                              }}
                            >
                              <Lock size={16} />
                              {currentInvite.passwordProtected
                                ? 'Trocar a senha'
                                : 'Exigir uma senha'}
                            </button>
                          )}
                          {!passwordEdit && currentInvite.passwordProtected && (
                            <button
                              className="settings-action"
                              disabled={busy}
                              onClick={clearPassword}
                            >
                              <Lock size={16} />
                              Remover a senha
                            </button>
                          )}
                          <button
                            className="settings-action"
                            disabled={busy}
                            onClick={rotateInvite}
                          >
                            <RefreshCw size={16} />
                            Gerar um novo link
                          </button>
                          <button
                            className="settings-action danger"
                            disabled={busy}
                            onClick={revokeInvite}
                          >
                            <Trash2 size={16} />
                            Revogar o convite
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="muted-note">
                            Gere um link para convidar amigos. Você pode exigir uma senha e revogar
                            quando quiser — o clube volta a ser privado.
                          </p>
                          <button
                            className="settings-action"
                            disabled={busy}
                            onClick={createInvite}
                          >
                            <Link2 size={16} />
                            Criar link de convite
                          </button>
                        </>
                      )}
                      <details className="disclosure">
                        <summary>Código do clube</summary>
                        <div className="stack">
                          <p className="muted-note">
                            Quem tiver o código entra como participante, escolhendo o próprio nome.
                            Por segurança, o código só aparece quando é gerado.
                          </p>
                          <button
                            className="settings-action"
                            disabled={busy}
                            onClick={() =>
                              setConfirm({
                                label:
                                  'Gerar um novo código do clube? O anterior deixa de valer e os outros participantes são desconectados deste clube: eles voltam com o e-mail ou o código pessoal.',
                                action: 'Gerar novo código',
                                run: async () => {
                                  const r = await api<{ clubToken: string }>(
                                    '/club/token',
                                    json('POST'),
                                  );
                                  reveal(
                                    'Novo código do clube · compartilhe com seus amigos',
                                    r.clubToken,
                                  );
                                },
                              })
                            }
                          >
                            <RefreshCw size={16} />
                            Gerar novo código do clube
                          </button>
                        </div>
                      </details>
                    </div>
                  )}
                  {tab === 'settings' && isOwner && (
                    <div className="stack">
                      <button className="settings-action" disabled={busy} onClick={exportData}>
                        <Download size={16} />
                        Exportar uma cópia em JSON
                      </button>
                    </div>
                  )}
                  {confirm && (
                    <div className="confirm-box">
                      <p>{confirm.label}</p>
                      <Button busy={busy} onClick={() => void run(confirm.run)}>
                        {confirm.action}
                      </Button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setConfirm(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </>
              )
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
