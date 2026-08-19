import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { BODY_PARTS, DIFFICULTIES, type Video } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/videos/:id */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;

  let body: Partial<Video>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.body_part && !BODY_PARTS.includes(body.body_part)) {
    return NextResponse.json(
      { error: `\`body_part\` must be one of: ${BODY_PARTS.join(', ')}` },
      { status: 400 },
    );
  }
  if (body.difficulty && !DIFFICULTIES.includes(body.difficulty)) {
    return NextResponse.json(
      { error: `\`difficulty\` must be one of: ${DIFFICULTIES.join(', ')}` },
      { status: 400 },
    );
  }

  const patch: Partial<Video> = {};
  for (const key of [
    'title',
    'url',
    'body_part',
    'difficulty',
    'duration_minutes',
    'notes',
  ] as const) {
    if (key in body) Object.assign(patch, { [key]: body[key] });
  }
  if ('duration_minutes' in patch) {
    patch.duration_minutes = Number(patch.duration_minutes) || 0;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('video_library')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ video: data });
}

/** DELETE /api/videos/:id */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = createServerClient();
  const { error } = await supabase.from('video_library').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
