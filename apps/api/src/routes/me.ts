import { parseLatLng, type LatLng } from '@sgs/core';
import {
  PutMyStoresRequest,
  UpdateProfileRequest,
  type LocationsResponse,
  type MeResponse,
  type MyStoresResponse,
  type StoresResponse,
} from '@sgs/shared';
import { Router } from 'express';
import type { z } from 'zod';
import type { AppDeps } from '../app.js';
import { auth, requireAuth } from '../auth/middleware.js';
import { AppError } from '../errors.js';
import { listLocations, listStores, myStores, saveMyStores } from '../services/stores.js';
import { toUserDto, updateProfile } from '../services/users.js';
import { parse } from '../validate.js';

export function meRouter(deps: AppDeps): Router {
  const r = Router();
  const { db } = deps;
  r.use(requireAuth(db, deps.tokens));

  r.patch('/', async (req, res) => {
    const input = parse(UpdateProfileRequest, req.body);
    const row = await updateProfile(db, auth(res).userId, input, deps.clock());
    const body: MeResponse = { user: await toUserDto(db, row) };
    res.json(body);
  });

  r.get('/stores', async (_req, res) => {
    const body: MyStoresResponse = await myStores(
      db,
      auth(res).userId,
      deps.config.preselectRadiusMiles,
    );
    res.json(body);
  });

  r.put('/stores', async (req, res) => {
    const input = parse(PutMyStoresRequest, req.body);
    await saveMyStores(db, auth(res).userId, input);
    const body: MyStoresResponse = await myStores(
      db,
      auth(res).userId,
      deps.config.preselectRadiusMiles,
    );
    res.json(body);
  });

  return r;
}

export function storesRouter(deps: AppDeps): Router {
  const r = Router();
  r.get('/', async (_req, res) => {
    const body: z.infer<typeof StoresResponse> = { stores: await listStores(deps.db) };
    res.json(body);
  });
  r.get('/:slug/locations', async (req, res) => {
    let near: LatLng | null = null;
    if (typeof req.query.near === 'string') {
      try {
        near = parseLatLng(req.query.near);
      } catch {
        throw new AppError('VALIDATION_FAILED', 400, 'near must be "lat,lng"');
      }
    }
    const body: z.infer<typeof LocationsResponse> = {
      locations: await listLocations(deps.db, req.params.slug, near),
    };
    res.json(body);
  });
  return r;
}
