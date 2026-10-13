'use client';

import { useRef, useState } from 'react';
import Atropos from 'atropos/react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  Film,
  Heart,
  LockKeyhole,
  Play,
  Plus,
  Star,
  Tv,
  Users,
} from 'lucide-react';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { Wordmark } from './brand';
import { Modal } from './ui';

const titles = [
  { image: 'grand-budapest', name: 'O Grande Hotel Budapeste', year: '2014', score: '8,5' },
  { image: 'interstellar', name: 'Interestelar', year: '2014', score: '9,2' },
  {
    image: 'everything-everywhere',
    name: 'Tudo em Todo o Lugar ao Mesmo Tempo',
    year: '2022',
    score: '8,8',
  },
];

export function Landing({ onStart }: { onStart: (mode: 'email' | 'create' | 'join') => void }) {
  const reducedMotion = useReducedMotion();
  const [previewKind, setPreviewKind] = useState<'movie' | 'tv'>('movie');
  const [selectedTitle, setSelectedTitle] = useState<(typeof titles)[number] | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [episodes, setEpisodes] = useState([true, true, true, true, true, true, false, false]);
  const watchedEpisodes = episodes.filter(Boolean).length;
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const changeKind = (kind: 'movie' | 'tv') => setPreviewKind(kind);
  return (
    <main className="landing-page">
      <header className="landing-nav">
        <a href="#" aria-label="Cenora, início">
          <Wordmark size={42} />
        </a>
        <nav aria-label="Navegação da apresentação">
          <a href="#como-funciona">Como funciona</a>
          <a href="#sua-estante">Um lugar para sua turma</a>
        </nav>
        <button className="landing-login" onClick={() => onStart('email')}>
          Entrar <ArrowRight size={16} />
        </button>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <m.div
          className="landing-hero-copy"
          initial={reducedMotion ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="landing-kicker">
            <span /> O PRÓXIMO PLAY É EM BOA COMPANHIA
          </span>
          <h1 id="landing-title">
            Boas histórias.
            <br />
            <span>Boa companhia.</span>
          </h1>
          <p>
            O filme que alguém indicou. A série que virou assunto.
            <br className="landing-desktop-break" /> Um cantinho só de vocês para guardar tudo isso.
          </p>
          <div className="landing-hero-actions">
            <button className="landing-primary" onClick={() => onStart('create')}>
              Criar meu clube <ArrowRight size={19} />
            </button>
            <button className="landing-invite" onClick={() => onStart('join')}>
              Tenho um código de convite <ArrowRight size={16} />
            </button>
          </div>
          <div className="landing-small-print">
            <LockKeyhole size={13} /> Privado, gratuito e sem precisar de e-mail.
          </div>
          <button
            className="landing-demo-link"
            onClick={(event) => {
              previewTrigger.current = event.currentTarget;
              setSelectedTitle(titles[1]);
            }}
          >
            <Play size={13} /> Experimente dar uma nota
          </button>
          <div className="landing-friends">
            <div className="landing-avatars" aria-hidden="true">
              <span>A</span>
              <span>B</span>
              <span>L</span>
              <span>J</span>
            </div>
            <p>
              Menos “o que a gente vai ver?”.
              <br />
              <strong>Mais “esse você precisa ver”.</strong>
            </p>
          </div>
        </m.div>

        <m.div
          className="landing-scene"
          initial={reducedMotion ? false : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
        >
          <div className="landing-orbit" aria-hidden="true" />
          <div className="landing-scene-note">
            histórias boas merecem companhia <Heart size={16} />
          </div>
          <Atropos
            className="landing-parallax"
            activeOffset={reducedMotion ? 0 : 18}
            rotate={!reducedMotion}
            rotateTouch={false}
            rotateXMax={5}
            rotateYMax={5}
            shadow={false}
            highlight={!reducedMotion}
            duration={reducedMotion ? 0 : 350}
          >
            <div className="landing-shelf">
              <div className="landing-shelf-top">
                <span className="landing-club-icon">
                  <Users size={17} />
                </span>
                <div>
                  <strong>Clube do sofá</strong>
                  <span>Uma estante. Todos os nossos gostos.</span>
                </div>
                <span className="landing-shelf-private">
                  <LockKeyhole size={11} /> Privado
                </span>
              </div>
              <div
                className="landing-preview-tabs"
                role="tablist"
                aria-label="Prévia da estante"
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const nextKind =
                    event.key === 'Home'
                      ? 'movie'
                      : event.key === 'End'
                        ? 'tv'
                        : previewKind === 'movie'
                          ? 'tv'
                          : 'movie';
                  changeKind(nextKind);
                  document
                    .getElementById(
                      nextKind === 'movie' ? 'landing-movies-tab' : 'landing-shows-tab',
                    )
                    ?.focus();
                }}
              >
                <button
                  role="tab"
                  aria-selected={previewKind === 'movie'}
                  aria-controls="landing-preview"
                  id="landing-movies-tab"
                  tabIndex={previewKind === 'movie' ? 0 : -1}
                  onClick={() => changeKind('movie')}
                >
                  {previewKind === 'movie' && (
                    <m.span
                      className="landing-tab-indicator"
                      layoutId="landing-tab"
                      transition={{ duration: reducedMotion ? 0 : 0.25 }}
                    />
                  )}
                  <Film size={14} /> Filmes <span>12</span>
                </button>
                <button
                  role="tab"
                  aria-selected={previewKind === 'tv'}
                  aria-controls="landing-preview"
                  id="landing-shows-tab"
                  tabIndex={previewKind === 'tv' ? 0 : -1}
                  onClick={() => changeKind('tv')}
                >
                  {previewKind === 'tv' && (
                    <m.span
                      className="landing-tab-indicator"
                      layoutId="landing-tab"
                      transition={{ duration: reducedMotion ? 0 : 0.25 }}
                    />
                  )}
                  <Tv size={14} /> Séries <span>8</span>
                </button>
                <span className="landing-preview-plus">Experimente</span>
              </div>
              <div
                id="landing-preview"
                role="tabpanel"
                aria-labelledby={
                  previewKind === 'movie' ? 'landing-movies-tab' : 'landing-shows-tab'
                }
                tabIndex={0}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {previewKind === 'movie' ? (
                    <m.div
                      className="landing-posters"
                      key="movies"
                      initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reducedMotion ? 0 : 0.18 }}
                    >
                      {titles.map((title) => (
                        <m.button
                          className="landing-poster"
                          key={title.image}
                          aria-label={`Experimentar uma nota para ${title.name}`}
                          onClick={(event) => {
                            previewTrigger.current = event.currentTarget;
                            setSelectedTitle(title);
                          }}
                          whileHover={reducedMotion ? undefined : { y: -8 }}
                          whileTap={reducedMotion ? undefined : { scale: 0.96 }}
                        >
                          <img
                            src={`/landing/${title.image}.jpg`}
                            alt={`Pôster de ${title.name}`}
                            width={500}
                            height={750}
                            data-atropos-offset={reducedMotion ? undefined : '2'}
                          />
                          <span className="landing-poster-score">
                            <Star size={10} fill="currentColor" />{' '}
                            {ratings[title.image]?.toFixed(1).replace('.', ',') ?? title.score}
                          </span>
                          <strong>{title.name}</strong>
                          <small>{title.year} · Filme</small>
                        </m.button>
                      ))}
                      <p className="landing-preview-hint">
                        Toque em um filme e experimente dar sua nota.
                      </p>
                    </m.div>
                  ) : (
                    <m.div
                      className="landing-series-preview"
                      key="shows"
                      initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reducedMotion ? 0 : 0.18 }}
                    >
                      <Tv size={30} />
                      <strong>Um episódio de cada vez.</strong>
                      <p>O progresso de cada pessoa, temporada por temporada.</p>
                      <div>
                        <span>Temporada 1</span>
                        <span>{watchedEpisodes} de 8 episódios</span>
                      </div>
                      <div
                        className="landing-progress"
                        role="progressbar"
                        aria-label="Progresso da temporada"
                        aria-valuemin={0}
                        aria-valuemax={8}
                        aria-valuenow={watchedEpisodes}
                      >
                        <m.span
                          animate={{ width: `${(watchedEpisodes / 8) * 100}%` }}
                          transition={{ duration: reducedMotion ? 0 : 0.35 }}
                        />
                      </div>
                      <div className="landing-episodes">
                        {episodes.map((watched, index) => (
                          <m.button
                            key={index}
                            aria-label={`Episódio ${index + 1}`}
                            aria-pressed={watched}
                            onClick={() =>
                              setEpisodes((previous) =>
                                previous.map((value, position) =>
                                  position === index ? !value : value,
                                ),
                              )
                            }
                            whileTap={reducedMotion ? undefined : { scale: 0.9 }}
                          >
                            {watched ? <Check size={15} /> : index + 1}
                          </m.button>
                        ))}
                      </div>
                      <p className="landing-preview-hint">
                        Marque os episódios. Cada play fica guardado.
                      </p>
                    </m.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="landing-shelf-bottom">
                <span>
                  <span className="landing-mini-dot" /> A próxima sessão começa aqui.
                </span>
                <span>Prévia ilustrativa</span>
              </div>
            </div>
          </Atropos>
          <div className="landing-floating-rating">
            <span className="landing-rating-avatar">B</span>
            <div>
              <strong>Uma indicação da Bia</strong>
              <span>
                “Esse é a nossa cara.” <Heart size={12} fill="currentColor" />
              </span>
            </div>
            <span className="landing-rating-value">
              <Star size={13} fill="currentColor" /> 9,0
            </span>
          </div>
          <div className="landing-ticket" aria-hidden="true">
            <Film size={20} />
            <span>
              VALE UMA
              <br />
              <strong>boa sessão.</strong>
            </span>
            <span className="landing-ticket-dashes" />
          </div>
        </m.div>
      </section>

      <div className="landing-interlude">
        <span>PARA QUEM SEMPRE TEM UMA INDICAÇÃO</span>
        <span>
          <Film size={16} /> Filmes que ficam
        </span>
        <span>
          <Tv size={16} /> Séries que viciam
        </span>
        <span>
          <Users size={16} /> Gente que importa
        </span>
        <a href="#como-funciona" aria-label="Conheça como funciona">
          <ArrowDown size={18} />
        </a>
      </div>

      <section className="landing-how" id="como-funciona" aria-labelledby="landing-how-title">
        <div className="landing-section-heading">
          <span className="landing-kicker">SIMPLES COMO DAR PLAY</span>
          <h2 id="landing-how-title">
            Da indicação à sessão.
            <br />
            <span>Sem se perder no grupo.</span>
          </h2>
          <p>
            As boas histórias não precisam ficar esquecidas
            <br className="landing-desktop-break" /> entre uma mensagem e outra.
          </p>
        </div>
        <div className="landing-steps">
          {[
            {
              icon: Users,
              title: 'Junte sua turma',
              text: 'Crie um clube e compartilhe o convite. Só quem você chama entra.',
              number: '01',
            },
            {
              icon: Plus,
              title: 'Guarde as indicações',
              text: 'Filmes e séries, cada um no seu lugar. Uma estante que tem a cara de vocês.',
              number: '02',
            },
            {
              icon: Star,
              title: 'Dê play. Dê sua nota.',
              text: 'Marque o que viu, acompanhe os episódios e descubra os favoritos da turma.',
              number: '03',
            },
          ].map(({ icon: Icon, title, text, number }) => (
            <m.article
              key={number}
              initial={reducedMotion ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.45, delay: reducedMotion ? 0 : (Number(number) - 1) * 0.1 }}
              whileHover={reducedMotion ? undefined : { y: -6 }}
            >
              <div className="landing-step-top">
                <span className="landing-step-icon">
                  <Icon size={22} strokeWidth={1.6} />
                </span>
                <span>{number}</span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </m.article>
          ))}
        </div>
      </section>

      <section
        className="landing-together"
        id="sua-estante"
        aria-labelledby="landing-together-title"
      >
        <div className="landing-film-stack" aria-hidden="true">
          <img src="/landing/spirited-away.jpg" alt="" width={500} height={750} loading="lazy" />
          <img src="/landing/dune.jpg" alt="" width={500} height={750} loading="lazy" />
          <span>
            <Heart size={16} fill="currentColor" /> gosto bom é gosto compartilhado.
          </span>
        </div>
        <div>
          <span className="landing-kicker">O ALGORITMO AQUI É A AMIZADE</span>
          <h2 id="landing-together-title">
            Sua turma.
            <br />
            Seu próprio <em>cult.</em>
          </h2>
          <p>
            Não é mais uma rede social. É a estante particular de quem divide o sofá com você —
            mesmo de longe.
          </p>
          <ul>
            <li>
              <Check size={16} /> Seu clube é privado, de verdade.
            </li>
            <li>
              <Check size={16} /> Cada pessoa tem suas notas e seu progresso.
            </li>
            <li>
              <Check size={16} /> Sem feed infinito. Só as histórias de vocês.
            </li>
          </ul>
          <button className="landing-primary" onClick={() => onStart('create')}>
            Vamos criar nosso clube <ArrowRight size={18} />
          </button>
        </div>
      </section>
      <footer className="landing-footer">
        <Wordmark size={31} />
        <p>Feita para boas histórias. E para quem divide elas com você.</p>
        <span>
          Prepare a pipoca. <Heart size={13} />
        </span>
      </footer>
      <Modal
        open={Boolean(selectedTitle)}
        onClose={() => setSelectedTitle(null)}
        title={selectedTitle?.name ?? 'Experimente a estante'}
        description="Esta é uma demonstração. Suas notas aqui não alteram a estante de nenhum clube."
        className="landing-rating-modal"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          previewTrigger.current?.focus();
        }}
      >
        {selectedTitle && (
          <div className="landing-rating-demo">
            <img
              src={`/landing/${selectedTitle.image}.jpg`}
              alt={`Pôster de ${selectedTitle.name}`}
              width={500}
              height={750}
            />
            <div>
              <p className="eyebrow">A SESSÃO É DE VOCÊS. A NOTA É SUA.</p>
              <h3>O que você achou?</h3>
              <p>Arraste para encontrar sua nota.</p>
              <m.output
                key={ratings[selectedTitle.image] ?? 8}
                initial={reducedMotion ? false : { scale: 0.9 }}
                animate={{ scale: 1 }}
              >
                {(ratings[selectedTitle.image] ?? 8).toFixed(1).replace('.', ',')}
                <Star size={18} fill="currentColor" />
              </m.output>
              <label htmlFor="landing-rating">Sua nota</label>
              <input
                id="landing-rating"
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={ratings[selectedTitle.image] ?? 8}
                onChange={(event) =>
                  setRatings((previous) => ({
                    ...previous,
                    [selectedTitle.image]: Number(event.target.value),
                  }))
                }
              />
              <small>Só uma prévia. No seu clube, a nota fica salva para você e sua turma.</small>
            </div>
          </div>
        )}
      </Modal>
    </main>
  );
}
