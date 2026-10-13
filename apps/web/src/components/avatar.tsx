'use client';
import { useState } from 'react';
import type { Member } from '@cenora/shared';

export function Avatar({
  member,
  className = 'small-avatar',
}: {
  member: Pick<Member, 'name' | 'avatarUrl'>;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={`${className} profile-avatar`} aria-hidden="true">
      {member.avatarUrl && failed !== member.avatarUrl ? (
        <img src={member.avatarUrl} alt="" onError={() => setFailed(member.avatarUrl!)} />
      ) : (
        member.name.charAt(0).toLocaleUpperCase('pt-BR')
      )}
    </span>
  );
}
