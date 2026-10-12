// O convite viaja como `?convite=<token>` na raiz. O app é exportado estático, então
// um caminho dedicado exigiria reescrever rotas no Worker; o parâmetro na query basta.
export function inviteLink(token: string) {
  const url = new URL(window.location.origin);
  url.searchParams.set('convite', token);
  return url.toString();
}

export function extractInviteToken(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const token = new URL(trimmed, window.location.origin).searchParams.get('convite');
    return token && token.length >= 12 ? token : null;
  } catch {
    return null;
  }
}

export function clearInviteParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('convite')) return;
  url.searchParams.delete('convite');
  window.history.replaceState({}, '', url);
}
