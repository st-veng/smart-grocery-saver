import {
  DashboardBreakdown,
  DashboardSeries,
  DashboardSummary,
  TripResponse,
  TripsResponse,
  type CommitTripRequest,
} from '@sgs/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface Range {
  readonly from: string;
  readonly to: string;
}

/** Today's calendar date in America/Chicago (prices and trips use DFW dates). */
export function chicagoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const qs = (r: Range, extra: Record<string, string> = {}) =>
  new URLSearchParams({ from: r.from, to: r.to, ...extra }).toString();

export const tripsKey = ['trips'] as const;
export const dashboardKey = ['dashboard'] as const;

export function useDashboardSummary(r: Range) {
  return useQuery({
    queryKey: [...dashboardKey, 'summary', r],
    queryFn: ({ signal }) =>
      api('GET', `/dashboard/summary?${qs(r)}`, DashboardSummary, undefined, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useDashboardSeries(
  r: Range,
  metric: 'savings' | 'spend',
  interval: 'week' | 'month',
) {
  return useQuery({
    queryKey: [...dashboardKey, 'series', r, metric, interval],
    queryFn: ({ signal }) =>
      api('GET', `/dashboard/series?${qs(r, { metric, interval })}`, DashboardSeries, undefined, {
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useDashboardBreakdown(r: Range, by: 'store' | 'category') {
  return useQuery({
    queryKey: [...dashboardKey, 'breakdown', r, by],
    queryFn: ({ signal }) =>
      api('GET', `/dashboard/breakdown?${qs(r, { by })}`, DashboardBreakdown, undefined, {
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export const exportUrl = (kind: 'csv' | 'pdf', r: Range) =>
  `/api/v1/exports/savings.${kind}?${qs(r)}`;

export function useTrips() {
  return useQuery({
    queryKey: tripsKey,
    queryFn: ({ signal }) => api('GET', '/trips?limit=100', TripsResponse, undefined, { signal }),
  });
}

export function useTrip(id: string) {
  return useQuery({
    queryKey: [...tripsKey, id],
    queryFn: ({ signal }) =>
      api('GET', `/trips/${id}`, TripResponse, undefined, { signal }).then((r) => r.trip),
  });
}

export function useCommitTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CommitTripRequest) =>
      api('POST', '/trips', TripResponse, v).then((r) => r.trip),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tripsKey });
      void qc.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}

export function useDeleteTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('DELETE', `/trips/${id}`, null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tripsKey });
      void qc.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}
