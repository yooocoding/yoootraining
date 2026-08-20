import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { DailyLog } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/daily-logs            -> list, newest first (default 60)
 * GET /api/daily-logs?date=...   -> a single day (null if not logged yet)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const limit = Number(searchParams.get('limit') ?? 60);

  const supabase = createServerClient();

  if (date) {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('date', date)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ log: data ?? null });
  }

  const { data, error } = await supabase
    .from('daily_logs')
    .select('*')
    .order('date', { ascending: false })
    .limit(Number.isFinite(limit) ? limit : 60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data ?? [] });
}

/**
 * POST /api/daily-logs
 * Upserts one day. Body: a partial DailyLog that must include `date`.
 * Only the fields present in the body are written, so the morning form and the
 * evening form can each save without clobbering the other.
 */
export async function POST(request: Request) {
  let body: Partial<DailyLog>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body?.date) {
    return NextResponse.json({ error: '`date` is required' }, { status: 400 });
  }

  const allowed: (keyof DailyLog)[] = [
    'date',
    'weight',
    'sleep_hours',
    'energy',
    'training_status',
    'felt',
    'water',
    'morning_note',
    'evening_note',
    'ai_training_plan',
    'ai_food_plan',
    'ai_evening_reflection',
    'is_period',
  ];

  const payload: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) payload[key] = body[key];
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('daily_logs')
    .upsert(payload as DailyLog, { onConflict: 'date' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ log: data });
}
