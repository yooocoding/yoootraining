import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { Goal } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/goals/:id */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;

  let body: Partial<Goal>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: Partial<Goal> = {};
  for (const key of ['sprint_start_date', 'sprint_end_date', 'phase_definitions'] as const) {
    if (key in body) Object.assign(patch, { [key]: body[key] });
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('goals')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goal: data });
}

/** DELETE /api/goals/:id */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = createServerClient();
  const { error } = await supabase.from('goals').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
