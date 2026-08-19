import { NextResponse } from 'next/server';
import { loadPlanContext, runAndSavePlan } from '@/lib/plan-server';
import { resolveVideos } from '@/lib/plan';
import { todayISO } from '@/lib/date';

export const dynamic = 'force-dynamic';
// Model calls can outrun the default serverless limit.
export const maxDuration = 60;

/**
 * POST /api/daily-logs/generate-plan  { date?: string }
 *
 * Always responds 200 with an `ok` flag — a model failure is a UI state, not a
 * crash. Genuine server faults (database unreachable) still return 500.
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
    const context = await loadPlanContext(date);
    const result = await runAndSavePlan(date, context);

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error });
    }

    return NextResponse.json({
      ok: true,
      plan: result.plan,
      // Resolved server-side as a convenience; the client re-resolves against
      // its own copy of the library regardless.
      videos: resolveVideos(result.plan.training_plan.video_ids, context.videos),
    });
  } catch (error) {
    console.error('[generate-plan]', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
