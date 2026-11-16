import { groceryLists, listItems, products, type Db } from '@sgs/db';
import { FAMILY_WEEK, type FixtureLine } from '../catalog/family-fixture.js';
import { SYSTEM_TEMPLATES } from '../catalog/templates.js';

async function insertList(
  db: Db,
  opts: {
    userId: string | null;
    name: string;
    description: string | null;
    isTemplate: boolean;
    items: readonly FixtureLine[];
    now: Date;
  },
): Promise<string> {
  const rows = await db
    .select({ id: products.id, slug: products.slug, name: products.name })
    .from(products);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const [list] = await db
    .insert(groceryLists)
    .values({
      userId: opts.userId,
      name: opts.name,
      description: opts.description,
      isTemplate: opts.isTemplate,
      createdAt: opts.now,
      updatedAt: opts.now,
    })
    .returning({ id: groceryLists.id });
  if (!list) throw new Error('list insert failed');
  await db.insert(listItems).values(
    opts.items.map((line, position) => {
      const p = bySlug.get(line.product);
      if (!p) throw new Error(`unknown product ${line.product} in "${opts.name}"`);
      return {
        listId: list.id,
        position,
        rawText: p.name,
        productId: p.id,
        quantity: line.quantity,
        unit: line.unit,
        createdAt: opts.now,
        updatedAt: opts.now,
      };
    }),
  );
  return list.id;
}

export async function seedSystemTemplates(db: Db, now: Date): Promise<number> {
  for (const t of SYSTEM_TEMPLATES) {
    await insertList(db, {
      userId: null,
      name: t.name,
      description: t.description,
      isTemplate: true,
      items: t.items,
      now,
    });
  }
  return SYSTEM_TEMPLATES.length;
}

export async function seedDemoList(db: Db, userId: string, now: Date): Promise<string> {
  return insertList(db, {
    userId,
    name: 'Family week',
    description: 'A typical DFW family week (35 items).',
    isTemplate: false,
    items: FAMILY_WEEK,
    now,
  });
}
