import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { Goal } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** GET /api/goals -> all sprints, newest start date first. */
export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .order('sprint_start_date', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goals: data ?? [] });
}

/** POST /api/goals -> create a sprint. */
export async function POST(request: Request) {
  let body: Partial<Goal>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sprint_start_date, sprint_end_date, phase_definitions } = body;
  if (!sprint_start_date || !sprint_end_date) {
    return NextResponse.json(
      { error: '`sprint_start_date` and `sprint_end_date` are required' },
      { status: 400 },
    );
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('goals')
    .insert({
      sprint_start_date,
      sprint_end_date,
      phase_definitions: phase_definitions ?? [],
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goal: data });
}
