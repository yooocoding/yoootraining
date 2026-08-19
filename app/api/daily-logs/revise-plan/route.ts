import { NextResponse } from 'next/server';
import { loadPlanContext, runAndSavePlan } from '@/lib/plan-server';
import { resolveVideos } from '@/lib/plan';
import { todayISO } from '@/lib/date';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/daily-logs/revise-plan  { message: string, date?: string }
 *
 * Same context as generate-plan, plus the plan currently on the row and the
 * athlete's description of what changed. Overwrites the saved plan on success.
 */
export async function POST(request: Request) {
  let body: { message?: string; date?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: '`message` is required' }, { status: 400 });
  }

  const date = body.date ?? todayISO();

  try {
    const context = await loadPlanContext(date);
    const result = await runAndSavePlan(date, context, {
      currentPlan: context.currentPlan,
      message,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error });
    }

    return NextResponse.json({
      ok: true,
      plan: result.plan,
      videos: resolveVideos(result.plan.training_plan.video_ids, context.videos),
    });
  } catch (error) {
    console.error('[revise-plan]', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
