import {
  ImportPreviewResponse,
  ItemResponse,
  ListResponse,
  ListsResponse,
  ProductsResponse,
  TemplatesResponse,
  type AddItemRequest,
  type CreateListRequest,
  type ImportCommitRequest,
  type ImportPreviewRequest,
  type ListDetail,
  type ProductSummary,
  type UpdateItemRequest,
  type UpdateListRequest,
} from '@sgs/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const listsKey = ['lists'] as const;
export const listKey = (id: string) => ['lists', id] as const;
export const templatesKey = ['templates'] as const;

export function useLists() {
  return useQuery({
    queryKey: listsKey,
    queryFn: ({ signal }) => api('GET', '/lists?limit=100', ListsResponse, undefined, { signal }),
  });
}

export function useList(id: string, enabled = true) {
  return useQuery({
    queryKey: listKey(id),
    queryFn: ({ signal }) =>
      api('GET', `/lists/${id}`, ListResponse, undefined, { signal }).then((r) => r.list),
    enabled: enabled && id !== '',
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: templatesKey,
    queryFn: ({ signal }) =>
      api('GET', '/templates', TemplatesResponse, undefined, { signal }).then((r) => r.templates),
  });
}

export function useTemplate(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...templatesKey, id],
    queryFn: ({ signal }) =>
      api('GET', `/templates/${id}`, ListResponse, undefined, { signal }).then((r) => r.list),
    enabled,
  });
}

export function useProductSearch(q: string) {
  const term = q.trim();
  return useQuery<ProductSummary[]>({
    queryKey: ['products', term],
    queryFn: async ({ signal }): Promise<ProductSummary[]> =>
      (
        await api(
          'GET',
          `/products?limit=8&q=${encodeURIComponent(term)}`,
          ProductsResponse,
          undefined,
          { signal },
        )
      ).products,
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

function useListMutation<V>(fn: (v: V) => Promise<ListDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (list) => {
      qc.setQueryData(listKey(list.id), list);
      void qc.invalidateQueries({ queryKey: listsKey, exact: true });
      if (list.isTemplate) void qc.invalidateQueries({ queryKey: templatesKey });
    },
  });
}

export const useCreateList = () =>
  useListMutation((v: CreateListRequest) =>
    api('POST', '/lists', ListResponse, v).then((r) => r.list),
  );

export const useUpdateList = (id: string) =>
  useListMutation((v: UpdateListRequest) =>
    api('PATCH', `/lists/${id}`, ListResponse, v).then((r) => r.list),
  );

export const useDuplicateList = (id: string) =>
  useListMutation(() => api('POST', `/lists/${id}/duplicate`, ListResponse).then((r) => r.list));

export const useSaveAsTemplate = (id: string) =>
  useListMutation((name?: string) =>
    api('POST', `/lists/${id}/save-as-template`, ListResponse, name ? { name } : {}).then(
      (r) => r.list,
    ),
  );

export const useReorder = (id: string) =>
  useListMutation((itemIds: string[]) =>
    api('PUT', `/lists/${id}/items/order`, ListResponse, { itemIds }).then((r) => r.list),
  );

export function useDeleteList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('DELETE', `/lists/${id}`, null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listsKey });
    },
  });
}

/** Item changes refetch the list (grouping and counts are computed by the server). */
function useItemMutation<V>(listId: string, fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: listKey(listId) });
      void qc.invalidateQueries({ queryKey: listsKey, exact: true });
    },
  });
}

export const useAddItem = (listId: string) =>
  useItemMutation(listId, (v: AddItemRequest) =>
    api('POST', `/lists/${listId}/items`, ItemResponse, v),
  );

export function useUpdateItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: UpdateItemRequest }) =>
      api('PATCH', `/lists/${listId}/items/${itemId}`, ItemResponse, patch),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: listKey(listId) });
      void qc.invalidateQueries({ queryKey: listsKey, exact: true });
    },
  });
}

export const useDeleteItem = (listId: string) =>
  useItemMutation(listId, (itemId: string) =>
    api('DELETE', `/lists/${listId}/items/${itemId}`, null),
  );

export function useImportPreview() {
  return useMutation({
    mutationFn: (v: ImportPreviewRequest) =>
      api('POST', '/imports/preview', ImportPreviewResponse, v),
  });
}

export const useImportCommit = () =>
  useListMutation((v: ImportCommitRequest) =>
    api('POST', '/imports/commit', ListResponse, v).then((r) => r.list),
  );
