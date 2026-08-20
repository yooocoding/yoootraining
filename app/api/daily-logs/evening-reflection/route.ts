import { NextResponse } from 'next/server';
import { runAndSaveReflection } from '@/lib/plan-server';
import { todayISO } from '@/lib/date';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/daily-logs/evening-reflection  { date?: string }
 *
 * Called after the evening check-in has already been saved. Always responds
 * 200 with an `ok` flag; a failure here is a quiet absence in the UI, never an
 * error on the save that preceded it.
 */
export async function POST(request: Request) {
  let body: { date?: string } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — default to today
  }
  const date = body.date ?? todayISO();

  try {
    const result = await runAndSaveReflection(date);

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error });
    }
    return NextResponse.json({ ok: true, reflection: result.reflection });
  } catch (error) {
    // Even an unexpected fault degrades quietly — the check-in is already saved.
    console.error('[evening-reflection]', error);
    return NextResponse.json({ ok: false, error: '打卡已保存，今晚的回应没能生成。' });
  }
}
