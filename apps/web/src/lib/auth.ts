import {
  MeResponse,
  MyStoresResponse,
  type LoginRequest,
  type PutMyStoresRequest,
  type RegisterRequest,
  type UpdateProfileRequest,
  type User,
} from '@sgs/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, refreshSession } from './api';
import { applyTheme, storeTheme } from './theme';

export const ME_KEY = ['me'] as const;
export const MY_STORES_KEY = ['me', 'stores'] as const;

/** The signed-in user, or null when signed out (a 401 is not an error here). */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async ({ signal }): Promise<User | null> => {
      try {
        return (await api('GET', '/auth/me', MeResponse, undefined, { signal })).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          // Access token expired: try one silent refresh (the /auth/* path is exempt from auto-refresh).
          if (await refreshSession())
            return (await api('GET', '/auth/me', MeResponse, undefined, { signal })).user;
          return null;
        }
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

function useSetUser() {
  const qc = useQueryClient();
  return (user: User) => {
    qc.setQueryData(ME_KEY, user);
    // The account's theme wins at sign-in (SPEC §6: stored on the user, mirrored to localStorage).
    storeTheme(user.theme);
    applyTheme(user.theme);
  };
}

export function useLogin() {
  const setUser = useSetUser();
  return useMutation({
    mutationFn: (input: LoginRequest) => api('POST', '/auth/login', MeResponse, input),
    onSuccess: (r) => {
      setUser(r.user);
    },
  });
}

export function useRegister() {
  const setUser = useSetUser();
  return useMutation({
    mutationFn: (input: RegisterRequest) => api('POST', '/auth/register', MeResponse, input),
    onSuccess: (r) => {
      setUser(r.user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('POST', '/auth/logout', null),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(ME_KEY, null);
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileRequest) => api('PATCH', '/me', MeResponse, input),
    onSuccess: (r) => {
      qc.setQueryData(ME_KEY, r.user);
      void qc.invalidateQueries({ queryKey: MY_STORES_KEY });
    },
  });
}

export function useMyStores(enabled = true) {
  return useQuery({
    queryKey: MY_STORES_KEY,
    queryFn: ({ signal }) => api('GET', '/me/stores', MyStoresResponse, undefined, { signal }),
    enabled,
  });
}

export function useSaveMyStores() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PutMyStoresRequest) => api('PUT', '/me/stores', MyStoresResponse, input),
    onSuccess: (r) => {
      qc.setQueryData(MY_STORES_KEY, r);
    },
  });
}

export const GOOGLE_ERRORS: Record<string, string> = {
  google: 'Google sign-in failed. Please try again.',
  google_state: 'Your Google sign-in expired. Please try again.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_unverified: 'Your Google email address is not verified, so we could not sign you in.',
};
