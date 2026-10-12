import { score } from './api';

export interface ShareCard {
  title: string;
  kind: 'movie' | 'tv';
  year: number | null;
  posterUrl: string | null;
  clubName: string | null;
  clubRating: number | null;
  myRating: number | null;
}
const W = 1080;
const H = 1350;
const heading = '"Space Grotesk", system-ui, sans-serif';
const body = '"Nunito Sans", system-ui, sans-serif';

function loadImage(src: string, cors = false) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    if (cors) image.crossOrigin = 'anonymous';
    // SVGs with only a viewBox need an intrinsic size before drawImage in some browsers.
    image.width = 1520;
    image.height = 645;
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  let line = '';
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines - 1) {
        line = words.slice(i).join(' ');
        break;
      }
    } else line = next;
  }
  lines.push(line);
  return lines.map((l, i) => {
    if (i < maxLines - 1 || ctx.measureText(l).width <= maxWidth) return l;
    let cut = l;
    while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  });
}
/** Draws a 1080×1350 story-style card with the poster, ratings, and the cenora.club logo. */
export async function renderShareCard(card: ShareCard): Promise<Blob> {
  await Promise.all([
    document.fonts.load(`600 56px ${heading}`),
    document.fonts.load(`700 28px ${body}`),
  ]).catch(() => undefined);
  const [poster, logo] = await Promise.all([
    card.posterUrl ? loadImage(card.posterUrl, true) : Promise.resolve(null),
    loadImage('/cenora-logo-dark.svg'),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível montar a imagem neste navegador.');
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#17130d');
  bg.addColorStop(1, '#0a0a0d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 480, 40, W / 2, 480, 620);
  glow.addColorStop(0, 'rgba(255,121,0,0.20)');
  glow.addColorStop(1, 'rgba(255,121,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Poster
  const pw = 480;
  const ph = 720;
  const px = (W - pw) / 2;
  const py = 70;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 28;
  roundRect(ctx, px, py, pw, ph, 28);
  ctx.fillStyle = '#1b1b22';
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 28);
  ctx.clip();
  if (poster) {
    const scale = Math.max(pw / poster.naturalWidth, ph / poster.naturalHeight);
    const dw = poster.naturalWidth * scale;
    const dh = poster.naturalHeight * scale;
    ctx.drawImage(poster, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
  } else {
    const fallback = ctx.createLinearGradient(px, py, px + pw, py + ph);
    fallback.addColorStop(0, '#cf5900');
    fallback.addColorStop(1, '#087c38');
    ctx.fillStyle = fallback;
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = '#f7f2ea';
    ctx.textAlign = 'center';
    ctx.font = `600 48px ${heading}`;
    wrap(ctx, card.title, pw - 80, 5).forEach((l, i, all) =>
      ctx.fillText(l, W / 2, py + ph / 2 + (i - (all.length - 1) / 2) * 58),
    );
  }
  ctx.restore();

  // Title and meta
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f7f2ea';
  ctx.font = `600 58px ${heading}`;
  const lines = wrap(ctx, card.title, 920, 2);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 892 + i * 64));
  const metaY = 892 + (lines.length - 1) * 64 + 48;
  ctx.fillStyle = '#a9a39a';
  ctx.font = `700 26px ${body}`;
  ctx.fillText(
    [card.kind === 'tv' ? 'SÉRIE' : 'FILME', card.year].filter(Boolean).join(' · '),
    W / 2,
    metaY,
  );

  // Ratings: the club's average and this person's own grade, when they exist.
  const boxes: { label: string; value: number }[] = [];
  if (card.clubRating != null)
    boxes.push({
      label: (card.clubName || 'O clube').toLocaleUpperCase('pt-BR'),
      value: card.clubRating,
    });
  if (card.myRating != null) boxes.push({ label: 'MINHA NOTA', value: card.myRating });
  const bw = 330;
  const bh = 120;
  const gap = 32;
  const by = metaY + 34;
  const startX = (W - (boxes.length * bw + (boxes.length - 1) * gap)) / 2;
  boxes.forEach((box, i) => {
    const x = startX + i * (bw + gap);
    roundRect(ctx, x, by, bw, bh, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,194,71,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#a9a39a';
    ctx.font = `700 20px ${body}`;
    let label = box.label;
    while (label.length > 1 && ctx.measureText(label).width > bw - 40) label = label.slice(0, -1);
    ctx.fillText(label === box.label ? label : `${label.trimEnd()}…`, x + bw / 2, by + 36);
    const value = score(box.value);
    ctx.font = `600 54px ${heading}`;
    const valueWidth = ctx.measureText(value).width;
    ctx.font = `700 24px ${body}`;
    const suffixWidth = ctx.measureText('/10').width;
    const left = x + (bw - (valueWidth + 6 + suffixWidth)) / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffc247';
    ctx.font = `600 54px ${heading}`;
    ctx.fillText(value, left, by + 94);
    ctx.fillStyle = '#a9a39a';
    ctx.font = `700 24px ${body}`;
    ctx.fillText('/10', left + valueWidth + 6, by + 94);
    ctx.textAlign = 'center';
  });

  // Footer with the logo
  if (logo) {
    const lw = 250;
    ctx.drawImage(logo, 70, H - 56 - (lw * 645) / 1520, lw, (lw * 645) / 1520);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ff7900';
  ctx.font = `700 34px ${heading}`;
  ctx.fillText('cenora.club', W - 70, H - 84);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível gerar a imagem.'))),
      'image/png',
    ),
  );
}
export const shareUrl = 'https://cenora.club';
/** Text shared alongside the image, without the link. */
export function shareCaption(card: ShareCard) {
  const parts = [card.title];
  if (card.clubRating != null) parts.push(`${card.clubName || 'Clube'}: ${score(card.clubRating)}`);
  if (card.myRating != null) parts.push(`minha nota: ${score(card.myRating)}`);
  return parts.join(' · ');
}
export const shareFileName = (card: ShareCard) =>
  `${card.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'cenora'}.png`;
/** A data URL, because the page CSP allows data: images but not blob: ones. */
export function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível mostrar a prévia.'));
    reader.readAsDataURL(blob);
  });
}
export function downloadImage(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** Puts the PNG on the clipboard so it can be pasted into the target app. */
export async function copyImage(blob: Blob) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
