'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Check, Clapperboard, Flag, Star, Trophy, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  rankingBadges,
  type ClubRanking,
  type Member,
  type RankingBadge,
  type ShelfKind,
} from '@cenora/shared';
import { api, json, errorMessage } from '@/lib/api';
import { Avatar } from './avatar';
import { Button, Modal, Segmented } from './ui';

const kinds: { value: ShelfKind; label: string }[] = [
  { value: 'movie', label: 'Filmes' },
  { value: 'tv', label: 'Séries' },
  { value: 'anime', label: 'Animes' },
];
const badgeIcons = { debut: Clapperboard, credits: Flag, critic: Star, company: Users };
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
      await qc.invalidateQueries({ queryKey: ['ranking'] });
      if (value.enabled !== undefined)
        toast.success(
          value.enabled
            ? 'Você voltou ao ranking.'
            : 'Você saiu do ranking. Seu progresso continua salvo.',
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
                Você está fora do placar. Seus títulos, notas e progresso não mudam.
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
                const Icon = entry.badge ? badgeIcons[entry.badge] : null;
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
                      {entry.badge && Icon && (
                        <span className="ranking-badge">
                          <Icon size={12} aria-hidden="true" />
                          {rankingBadges[entry.badge].name}
                        </span>
                      )}
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
            <section className="ranking-achievements" aria-labelledby="ranking-achievements-title">
              <h3 id="ranking-achievements-title">
                <Award size={17} aria-hidden="true" /> Suas pequenas conquistas
              </h3>
              <p>Conquistas de todas as categorias. Escolha um selo para acompanhar seu nome.</p>
              <div className="ranking-badge-grid">
                {(Object.keys(rankingBadges) as RankingBadge[]).map((badge) => {
                  const unlocked = data.participation.badges.includes(badge);
                  const selected = data.participation.badge === badge;
                  const Icon = badgeIcons[badge];
                  return (
                    <button
                      key={badge}
                      type="button"
                      className={`ranking-achievement ${unlocked ? 'unlocked' : ''}`}
                      aria-pressed={selected}
                      disabled={!unlocked || busy}
                      onClick={() => void change({ badge: selected ? null : badge })}
                    >
                      <span className="ranking-achievement-icon">
                        <Icon size={19} aria-hidden="true" />
                        {selected && <Check size={12} aria-hidden="true" />}
                      </span>
                      <strong>{rankingBadges[badge].name}</strong>
                      <small>{rankingBadges[badge].description}</small>
                      <span className="ranking-achievement-state">
                        {selected ? 'Seu selo' : unlocked ? 'Desbloqueada' : 'Ainda por conquistar'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
            <div className="ranking-participation">
              <label>
                <input
                  type="checkbox"
                  checked={pendingParticipation ?? data.participation.enabled}
                  disabled={busy}
                  onChange={(e) => void change({ enabled: e.target.checked })}
                />{' '}
                Participar do ranking deste clube
              </label>
              <small>Opcional. Sair do placar não apaga seu histórico.</small>
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
            Registros anteriores ao ranking entram apenas em “Desde sempre”. Importar títulos não
            soma atividade.
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
            As conquistas refletem seu progresso atual. Avaliações altas e baixas valem igual;
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
