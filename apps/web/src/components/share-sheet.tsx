'use client';
import { useEffect, useState } from 'react';
import * as m from 'motion/react-m';
import { Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { siInstagram, siWhatsapp } from 'simple-icons';
import {
  blobToDataUrl,
  copyImage,
  downloadImage,
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
  /** Everything else (Discord, X, Telegram...) is a paste away. */
  const copy = async () => {
    if (!blob) return;
    if (await copyImage(blob)) toast.success('Imagem copiada. É só colar.');
    else {
      downloadImage(blob, name);
      toast.success('Imagem salva.');
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
        <Target label="Copiar" className="neutral" onClick={() => void copy()}>
          <Copy size={22} />
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
