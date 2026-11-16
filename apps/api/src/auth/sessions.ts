/** Refresh-token sessions with rotation and family-wide reuse detection (SPEC §3 Auth). */
import { randomUUID } from 'node:crypto';
import { sessions, type Db } from '@sgs/db';
import { and, eq, isNull } from 'drizzle-orm';
import { hashToken, randomToken, REFRESH_TTL_S } from './tokens.js';

/** The DB handle or an open transaction. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** A rotated token presented again within this window is treated as a benign multi-tab race. */
export const ROTATION_GRACE_MS = 10_000;

export interface SessionMeta {
  readonly userAgent: string | null;
  readonly ip: string | null;
}

export interface IssuedSession {
  readonly userId: string;
  readonly sessionId: string;
  readonly familyId: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
}

export async function createSession(
  db: Executor,
  userId: string,
  now: Date,
  meta: SessionMeta,
  familyId: string = randomUUID(),
): Promise<IssuedSession> {
  const refreshToken = randomToken();
  const expiresAt = new Date(now.getTime() + REFRESH_TTL_S * 1000);
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      familyId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip,
      createdAt: now,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error('session insert failed');
  return { userId, sessionId: row.id, familyId, refreshToken, expiresAt };
}

export type RotateResult =
  | { readonly kind: 'ok'; readonly session: IssuedSession }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'race' }
  | { readonly kind: 'reuse'; readonly familyId: string };

/** Exchange a refresh token for a new one in the same family. */
export async function rotateSession(
  db: Db,
  refreshToken: string,
  now: Date,
  meta: SessionMeta,
): Promise<RotateResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, hashToken(refreshToken)))
      .for('update');
    if (!row || row.revokedAt !== null || row.expiresAt.getTime() <= now.getTime())
      return { kind: 'invalid' } as const;
    if (row.rotatedAt !== null) {
      if (now.getTime() - row.rotatedAt.getTime() <= ROTATION_GRACE_MS)
        return { kind: 'race' } as const;
      // Replay of an old token: assume theft and kill the whole family.
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.familyId, row.familyId), isNull(sessions.revokedAt)));
      return { kind: 'reuse', familyId: row.familyId } as const;
    }
    await tx.update(sessions).set({ rotatedAt: now }).where(eq(sessions.id, row.id));
    const next = await createSession(tx, row.userId, now, meta, row.familyId);
    return { kind: 'ok', session: next } as const;
  });
}

export async function revokeFamily(db: Db, familyId: string, now: Date): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
}

export async function familyOfRefreshToken(db: Db, refreshToken: string): Promise<string | null> {
  const [row] = await db
    .select({ familyId: sessions.familyId })
    .from(sessions)
    .where(eq(sessions.refreshTokenHash, hashToken(refreshToken)));
  return row?.familyId ?? null;
}

/** The session behind an access token is usable unless its family was revoked (logout / reuse). */
export async function sessionUsable(
  db: Db,
  sessionId: string,
): Promise<{ familyId: string } | null> {
  const [row] = await db
    .select({ familyId: sessions.familyId, revokedAt: sessions.revokedAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return row && row.revokedAt === null ? { familyId: row.familyId } : null;
}
