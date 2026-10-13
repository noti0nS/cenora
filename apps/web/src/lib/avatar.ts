import { AVATAR_SIZE, AVATAR_SOURCE_BYTES, AVATAR_UPLOAD_BYTES } from '@cenora/shared';

export const avatarAccept =
  'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/x-icon,image/vnd.microsoft.icon,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.ico';

export async function prepareAvatar(file: File): Promise<Blob> {
  const supported = /\.(png|jpe?g|webp|gif|avif|bmp|ico)$/i.test(file.name);
  if (!supported || file.type === 'image/svg+xml')
    throw new Error('Escolha uma imagem PNG, JPEG, WebP, GIF, AVIF, BMP ou ICO.');
  if (!file.size || file.size > AVATAR_SOURCE_BYTES)
    throw new Error('Escolha uma imagem de até 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error('Não foi possível abrir essa imagem. Tente outro arquivo.');
    });
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 40_000_000
    )
      throw new Error('A imagem é grande demais. Escolha uma versão menor.');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(AVATAR_SIZE, side);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a imagem neste navegador.');
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85),
    );
    if (!blob || blob.type !== 'image/webp' || blob.size > AVATAR_UPLOAD_BYTES)
      throw new Error(
        'Não foi possível preparar a imagem. Tente uma imagem menor ou outro navegador.',
      );
    // Chromium includes its generated color profile. Remove metadata chunks so
    // only pixels and the optional alpha channel leave the browser.
    const bytes = await blob.arrayBuffer();
    const view = new DataView(bytes);
    const data = new Uint8Array(bytes);
    const chunks: Uint8Array[] = [];
    for (let at = 12; at < bytes.byteLength;) {
      const length = view.getUint32(at + 4, true);
      const end = at + 8 + length + (length % 2);
      const kind = String.fromCharCode(...data.subarray(at, at + 4));
      if (!['ICCP', 'EXIF', 'XMP '].includes(kind)) {
        const chunk = data.slice(at, end);
        if (kind === 'VP8X') chunk[8] &= 0x10;
        chunks.push(chunk);
      }
      at = end;
    }
    const size = 12 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const clean = new Uint8Array(size);
    clean.set(data.subarray(0, 12));
    new DataView(clean.buffer).setUint32(4, size - 8, true);
    let offset = 12;
    for (const chunk of chunks) {
      clean.set(chunk, offset);
      offset += chunk.length;
    }
    return new Blob([clean], { type: 'image/webp' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
