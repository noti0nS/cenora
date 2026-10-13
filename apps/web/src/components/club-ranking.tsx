'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trophy, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  type ClubRanking,
  type Member,
  type RankingBadge,
  type SessionState,
  type ShelfKind,
} from '@cenora/shared';
import { api, json, errorMessage } from '@/lib/api';
import { Avatar } from './avatar';
import { Button, Modal, Segmented } from './ui';
import { AchievementCollection, MemberBadge } from './achievement-collection';

const kinds: { value: ShelfKind; label: string }[] = [
  { value: 'movie', label: 'Filmes' },
  { value: 'tv', label: 'Séries' },
  { value: 'anime', label: 'Animes' },
];
const amount = (n: number, singular: string, plural: string) =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : plural}`;

export function ClubRankingDialog({
  open,
  onClose,
  member,
  clubId,
  defaultKind,
}: {
  open: boolean;
  onClose: () => void;
  member: Member;
  clubId: string;
  defaultKind: ShelfKind;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState(defaultKind);
  const [period, setPeriod] = useState<'month' | 'all'>('month');
  const [busy, setBusy] = useState(false);
  const [pendingParticipation, setPendingParticipation] = useState<boolean | null>(null);
  useEffect(() => {
    if (open) {
      setKind(defaultKind);
      setPeriod('month');
    }
  }, [open, defaultKind, clubId]);
  const ranking = useQuery({
    queryKey: ['ranking', clubId, member.id, kind, period],
    queryFn: () => api<ClubRanking>(`/club/ranking?kind=${kind}&period=${period}`),
    enabled: open,
    refetchInterval: open ? 30000 : false,
  });
  const change = async (value: { enabled?: boolean; badge?: RankingBadge | null }) => {
    setBusy(true);
    if (value.enabled !== undefined) setPendingParticipation(value.enabled);
    try {
      await api('/club/ranking/participation', json('PATCH', value));
      if (value.enabled !== undefined) {
        qc.setQueryData<SessionState>(['session'], (old) =>
          old && old.member
            ? { ...old, member: { ...old.member, rankingEnabled: value.enabled } }
            : old,
        );
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['ranking'] }),
        qc.invalidateQueries({ queryKey: ['members'] }),
        qc.invalidateQueries({ queryKey: ['session'] }),
      ]);
      if (value.enabled !== undefined)
        toast.success(
          value.enabled
            ? 'Ranking visível novamente para você.'
            : 'Você ocultou o ranking para você. Você continua participando no clube.',
        );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      setPendingParticipation(null);
    }
  };
  const data = ranking.data;
  const month = data
    ? new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${data.month}-01T12:00:00Z`),
      )
    : 'Este mês';
  const unit = kind === 'movie' ? ['filme', 'filmes'] : ['episódio', 'episódios'];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ranking do clube"
      description="Cada um no seu ritmo. A diversão é acompanhar juntos."
      className="ranking-dialog"
    >
      <div className="ranking-controls">
        <Segmented label="Categoria do ranking" value={kind} options={kinds} onChange={setKind} />
        <Segmented
          label="Período do ranking"
          value={period}
          options={[
            { value: 'month', label: 'Este mês' },
            { value: 'all', label: 'Desde sempre' },
          ]}
          onChange={setPeriod}
        />
      </div>
      <div className="ranking-caption">
        <span>{period === 'month' ? month : 'Toda a história do clube'}</span>
        <span>
          <Trophy size={14} aria-hidden="true" />{' '}
          {kind === 'movie' ? 'Filmes vistos' : 'Episódios registrados'}
        </span>
      </div>
      {ranking.isPending ? (
        <div className="ranking-loading" role="status">
          Preparando o placar…
        </div>
      ) : ranking.error ? (
        <div className="ranking-loading" role="alert">
          <p>{errorMessage(ranking.error)}</p>
          <Button className="secondary" onClick={() => void ranking.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        data && (
          <>
            {!data.participation.enabled && (
              <p className="ranking-notice">
                Você ocultou o ranking para você. Você continua participando do placar do clube.
              </p>
            )}
            {!data.entries.some((entry) => entry.count > 0) && (
              <p className="ranking-notice">
                {period === 'month'
                  ? 'O mês está só começando por aqui. Registre seu progresso para abrir o placar.'
                  : 'Toda história começa com uma sessão. Os primeiros registros vão aparecer aqui.'}
              </p>
            )}
            <ol className="ranking-roster" aria-label="Classificação dos participantes">
              {data.entries.map((entry) => {
                return (
                  <li
                    key={entry.id}
                    className={`ranking-row ${entry.id === member.id ? 'ranking-mine' : ''}`}
                  >
                    <span
                      className={`ranking-position ${entry.position === 1 ? 'ranking-leader' : ''}`}
                      aria-label={
                        entry.position === null ? 'Ainda sem posição' : `${entry.position}º lugar`
                      }
                    >
                      {entry.position === null ? '—' : String(entry.position).padStart(2, '0')}
                    </span>
                    <Avatar member={entry} className="ranking-avatar" />
                    <div className="ranking-person">
                      <strong>
                        {entry.name}
                        {entry.id === member.id && <small> · você</small>}
                      </strong>
                      <MemberBadge badge={entry.featuredBadge} />
                    </div>
                    <div className="ranking-score">
                      <strong>{amount(entry.count, unit[0], unit[1])}</strong>
                      <small>
                        {kind === 'movie'
                          ? amount(entry.rated, 'avaliado', 'avaliados')
                          : amount(entry.seasons, 'temporada concluída', 'temporadas concluídas')}
                      </small>
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="ranking-collective">
              <Users size={16} aria-hidden="true" />
              <span>
                Entre os participantes,{' '}
                {amount(data.clubTitles, 'título diferente', 'títulos diferentes')}{' '}
                {period === 'month' ? 'neste mês' : 'desde o começo'}.
              </span>
            </p>
            <AchievementCollection
              achievements={data.participation.achievements}
              selected={data.participation.badge}
              busy={busy}
              onChoose={(badge) => void change({ badge })}
              headingId="ranking-achievements-title"
            />
            <div className="ranking-participation">
              <label>
                <input
                  type="checkbox"
                  checked={pendingParticipation ?? data.participation.enabled}
                  disabled={busy}
                  onChange={(e) => void change({ enabled: e.target.checked })}
                />{' '}
                Mostrar ranking e conquistas para mim
              </label>
              <small>
                Desativar esconde o ranking para você, mas você continua participando no clube.
              </small>
            </div>
          </>
        )
      )}
      <details className="ranking-rules">
        <summary>Como funciona</summary>
        <ul>
          <li>Só o seu progresso pessoal conta. O progresso do grupo não distribui registros.</li>
          <li>Filmes, séries e animes têm placares separados. Empates dividem a mesma posição.</li>
          <li>
            O mês segue o horário de Brasília e considera quando o progresso foi registrado, não a
            data real da sessão.
          </li>
          <li>
            Registros anteriores ao ranking entram neste mês quando a criação do clube, do perfil ou
            do título comprova esse mês. Sem um mês comprovável, ficam em “Desde sempre”. Importar
            títulos não soma atividade.
          </li>
          <li>
            Corrigir para trás reduz a contagem. Remarcar recupera o registro original, sem contar
            outra vez ou mudar seu mês.
          </li>
          <li>
            Séries manuais contam os episódios conhecidos. Temporadas concluídas precisam de uma
            contagem do catálogo; não inventamos episódios de temporadas anteriores.
          </li>
          <li>
            Conquistas são marcos permanentes do seu perfil neste clube. Corrigir o progresso muda o
            placar, mas não apaga os selos conquistados. Avaliações altas e baixas valem igual;
            reassistidas não somam novamente.
          </li>
          <li>
            O placar é privado, só deste clube. O resumo coletivo inclui apenas quem participa.
          </li>
        </ul>
      </details>
    </Modal>
  );
}
