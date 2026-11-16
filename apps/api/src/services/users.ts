import { zipCentroid } from '@sgs/core';
import { authIdentities, stores, users, type Db } from '@sgs/db';
import type { UpdateProfileRequest, User } from '@sgs/shared';
import { eq } from 'drizzle-orm';
import type { GoogleIdentity } from '../auth/google.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { AppError } from '../errors.js';

type UserRow = typeof users.$inferSelect;

export async function toUserDto(db: Db, row: UserRow): Promise<User> {
  const ids = await db
    .select({ provider: authIdentities.provider })
    .from(authIdentities)
    .where(eq(authIdentities.userId, row.id));
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    homeZip: row.homeZip,
    home:
      row.homeLat !== null && row.homeLng !== null ? { lat: row.homeLat, lng: row.homeLng } : null,
    vehicleMpg: row.vehicleMpg,
    fuelCentsPerGal: row.fuelCentsPerGal,
    baselineStoreId: row.baselineStoreId,
    theme: row.theme,
    onboarded: row.onboardedAt !== null,
    hasPassword: row.passwordHash !== null,
    providers: ids.map((i) => i.provider),
  };
}

export async function findUser(db: Db, id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

function isUniqueViolation(e: unknown): boolean {
  const cause = e instanceof Error && 'cause' in e ? e.cause : e;
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505';
}

export async function registerUser(
  db: Db,
  input: { email: string; password: string; displayName: string },
  now: Date,
): Promise<UserRow> {
  const passwordHash = await hashPassword(input.password);
  try {
    const [row] = await db
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('user insert failed');
    return row;
  } catch (e) {
    if (isUniqueViolation(e))
      throw new AppError('CONFLICT', 409, 'An account with this email already exists');
    throw e;
  }
}

export const BAD_CREDENTIALS = 'Email or password is incorrect';

/** Same message and (via the dummy hash) similar timing whether or not the account exists. */
export async function authenticate(db: Db, email: string, password: string): Promise<UserRow> {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  const ok = await verifyPassword(row?.passwordHash ?? null, password);
  if (!row || !ok) throw new AppError('UNAUTHENTICATED', 401, BAD_CREDENTIALS);
  return row;
}

export type GoogleLoginOutcome = 'existing' | 'linked' | 'created';

/**
 * Find or create the user for a Google identity. A verified Google email equal to an existing
 * account's email links to that account (SPEC Phase 2); an unverified one never links or creates.
 */
export async function loginWithGoogle(
  db: Db,
  identity: GoogleIdentity,
  now: Date,
): Promise<{ user: UserRow; outcome: GoogleLoginOutcome }> {
  return db.transaction(async (tx) => {
    const [linked] = await tx
      .select({ user: users })
      .from(authIdentities)
      .innerJoin(users, eq(users.id, authIdentities.userId))
      .where(eq(authIdentities.providerSubject, identity.sub));
    if (linked) return { user: linked.user, outcome: 'existing' as const };
    if (!identity.emailVerified) {
      throw new AppError('FORBIDDEN', 403, 'Your Google email address is not verified');
    }
    const [existing] = await tx.select().from(users).where(eq(users.email, identity.email));
    let user = existing;
    let outcome: GoogleLoginOutcome = 'linked';
    if (!user) {
      const [created] = await tx
        .insert(users)
        .values({
          email: identity.email,
          passwordHash: null,
          displayName: identity.name?.trim() || identity.email.split('@')[0] || 'Shopper',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error('user insert failed');
      user = created;
      outcome = 'created';
    }
    await tx.insert(authIdentities).values({
      userId: user.id,
      provider: 'google',
      providerSubject: identity.sub,
      email: identity.email,
      createdAt: now,
    });
    return { user, outcome };
  });
}

export async function updateProfile(
  db: Db,
  userId: string,
  input: UpdateProfileRequest,
  now: Date,
): Promise<UserRow> {
  const current = await findUser(db, userId);
  if (!current) throw new AppError('UNAUTHENTICATED', 401, 'Not signed in');
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: now };
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.vehicleMpg !== undefined) patch.vehicleMpg = input.vehicleMpg;
  if (input.fuelCentsPerGal !== undefined) patch.fuelCentsPerGal = input.fuelCentsPerGal;
  if (input.theme !== undefined) patch.theme = input.theme;
  if (input.homeZip !== undefined) {
    const c = zipCentroid(input.homeZip);
    if (!c) {
      throw new AppError(
        'VALIDATION_FAILED',
        422,
        'We only cover the Dallas–Fort Worth area for now',
        [{ path: ['homeZip'], message: 'ZIP code is not in the DFW service area' }],
      );
    }
    patch.homeZip = input.homeZip;
    patch.homeLat = c.lat;
    patch.homeLng = c.lng;
  }
  if (input.baselineStoreId !== undefined && input.baselineStoreId !== null) {
    const [s] = await db
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.id, input.baselineStoreId));
    if (!s) {
      throw new AppError('VALIDATION_FAILED', 422, 'Unknown store', [
        { path: ['baselineStoreId'], message: 'Unknown store' },
      ]);
    }
  }
  if (input.baselineStoreId !== undefined) patch.baselineStoreId = input.baselineStoreId;
  if (input.completeOnboarding) {
    const hasHome = patch.homeLat !== undefined || current.homeLat !== null;
    if (!hasHome) {
      throw new AppError('VALIDATION_FAILED', 422, 'Add your ZIP code before finishing setup', [
        { path: ['homeZip'], message: 'Required to finish onboarding' },
      ]);
    }
    patch.onboardedAt = current.onboardedAt ?? now;
  }
  const [row] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  if (!row) throw new AppError('UNAUTHENTICATED', 401, 'Not signed in');
  return row;
}
