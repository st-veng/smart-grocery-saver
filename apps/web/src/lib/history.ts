import {
  AlertResponse,
  AlertsResponse,
  HistoryResponse,
  NotificationsResponse,
  type CreateAlertRequest,
  type HistoryRange,
} from '@sgs/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export function useHistory(productId: string, range: HistoryRange) {
  return useQuery({
    queryKey: ['history', productId, range],
    queryFn: ({ signal }) =>
      api('GET', `/products/${productId}/history?range=${range}`, HistoryResponse, undefined, {
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export const alertsKey = ['alerts'] as const;
export const notificationsKey = ['notifications'] as const;

export function useAlerts() {
  return useQuery({
    queryKey: alertsKey,
    queryFn: ({ signal }) =>
      api('GET', '/alerts', AlertsResponse, undefined, { signal }).then((r) => r.alerts),
  });
}

export function useCreateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CreateAlertRequest) =>
      api('POST', '/alerts', AlertResponse, v).then((r) => r.alert),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: alertsKey });
    },
  });
}

export function useUpdateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api('PATCH', `/alerts/${id}`, AlertResponse, { active }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: alertsKey });
    },
  });
}

export function useDeleteAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('DELETE', `/alerts/${id}`, null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: alertsKey });
    },
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: notificationsKey,
    queryFn: ({ signal }) =>
      api('GET', '/notifications', NotificationsResponse, undefined, { signal }),
    refetchInterval: 60_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string /* or 'all' */) =>
      api('POST', id === 'all' ? '/notifications/read-all' : `/notifications/${id}/read`, null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationsKey });
    },
  });
}
