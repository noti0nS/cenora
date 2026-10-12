'use client';
import { useEffect, useState } from 'react';
import * as m from 'motion/react-m';
import { Download, Link2, Loader2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { siDiscord, siInstagram, siWhatsapp, siX } from 'simple-icons';
import {
  blobToDataUrl,
  canNativeShare,
  copyImage,
  downloadImage,
  nativeShare,
  renderShareCard,
  shareCaption,
  shareFileName,
  shareUrl,
  type ShareCard,
} from '@/lib/share-card';
import { errorMessage } from '@/lib/api';
import { Modal } from './ui';

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
const enc = encodeURIComponent;

function Brand({ icon }: { icon: { path: string } }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="currentColor">
      <path d={icon.path} />
    </svg>
  );
}
function Target({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="share-target" onClick={onClick}>
      <span className={`share-orb ${className}`}>{children}</span>
      <span>{label}</span>
    </button>
  );
}
function ShareBody({ card }: { card: ShareCard }) {
  const [image, setImage] = useState<{ blob: Blob; preview: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    renderShareCard(card)
      .then(async (blob) => alive && setImage({ blob, preview: await blobToDataUrl(blob) }))
      .catch((e) => alive && setFailed(errorMessage(e)));
    return () => {
      alive = false;
    };
    // The card is built once per opening; later rating edits do not change an open preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const name = shareFileName(card);
  const caption = shareCaption(card);
  const text = `${caption} — ${shareUrl}`;
  const blob = image?.blob;
  const save = () => {
    if (!blob) return;
    downloadImage(blob, name);
    toast.success('Imagem salva.');
  };
  /** Web apps cannot attach files to other apps, so the image goes to the clipboard to paste. */
  const pasteInto = async (app: string, go: () => void) => {
    if (!blob) return;
    const copied = copyImage(blob);
    go();
    if (await copied) toast.success(`Imagem copiada. Cole no ${app}.`);
    else {
      downloadImage(blob, name);
      toast.success('Imagem salva. Anexe no app.');
    }
  };
  const instagram = () => {
    if (!blob) return;
    downloadImage(blob, name);
    open(isMobile() ? 'instagram://story-camera' : 'https://www.instagram.com/');
    toast.success('Imagem salva. Escolha ela no seu story.');
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Link copiado.');
    } catch {
      toast.error('Não foi possível copiar o link.');
    }
  };
  const more = async () => {
    if (!blob) return;
    try {
      await nativeShare(card, blob);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="share-sheet">
      <div className="share-preview">
        {image ? (
          <m.img
            src={image.preview}
            alt={`Prévia do cartão de ${card.title}`}
            initial={{ opacity: 0, y: 14, rotate: -1.5, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          />
        ) : failed ? (
          <p role="alert" className="error-note">
            {failed}
          </p>
        ) : (
          <div className="share-loading" role="status">
            <Loader2 size={22} className="spin" />
            <span>Montando o cartão…</span>
          </div>
        )}
      </div>
      <div className="share-targets" role="group" aria-label="Compartilhar em">
        <Target
          label="WhatsApp"
          className="whatsapp"
          onClick={() => void pasteInto('WhatsApp', () => open(`https://wa.me/?text=${enc(text)}`))}
        >
          <Brand icon={siWhatsapp} />
        </Target>
        <Target label="Instagram" className="instagram" onClick={instagram}>
          <Brand icon={siInstagram} />
        </Target>
        <Target
          label="Discord"
          className="discord"
          onClick={() => void pasteInto('Discord', () => open('https://discord.com/channels/@me'))}
        >
          <Brand icon={siDiscord} />
        </Target>
        <Target
          label="X"
          className="x"
          onClick={() =>
            void pasteInto('X', () =>
              open(`https://x.com/intent/post?text=${enc(caption)}&url=${enc(shareUrl)}`),
            )
          }
        >
          <Brand icon={siX} />
        </Target>
        {blob && canNativeShare(blob, name) && (
          <Target label="Mais" className="neutral" onClick={() => void more()}>
            <Share2 size={22} />
          </Target>
        )}
        <Target label="Copiar link" className="neutral" onClick={() => void copyLink()}>
          <Link2 size={22} />
        </Target>
        <Target label="Salvar imagem" className="neutral" onClick={save}>
          <Download size={22} />
        </Target>
      </div>
    </div>
  );
}
export function ShareSheet({
  open: isOpen,
  onClose,
  card,
}: {
  open: boolean;
  onClose: () => void;
  card: ShareCard;
}) {
  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Compartilhar"
      description="Veja o cartão e escolha onde enviar."
      className="share-modal"
    >
      <ShareBody card={card} />
    </Modal>
  );
}
