import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { BODY_PARTS, DIFFICULTIES, type BodyPart, type Video } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** GET /api/videos -> the whole library. Optional ?body_part= filter. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bodyPart = searchParams.get('body_part') as BodyPart | null;

  const supabase = createServerClient();
  let query = supabase.from('video_library').select('*').order('title');
  if (bodyPart && BODY_PARTS.includes(bodyPart)) query = query.eq('body_part', bodyPart);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ videos: data ?? [] });
}

/** POST /api/videos -> add a video. */
export async function POST(request: Request) {
  let body: Partial<Video>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { title, url, body_part, difficulty, duration_minutes, notes } = body;

  if (!title || !url) {
    return NextResponse.json({ error: '`title` and `url` are required' }, { status: 400 });
  }
  if (!body_part || !BODY_PARTS.includes(body_part)) {
    return NextResponse.json(
      { error: `\`body_part\` must be one of: ${BODY_PARTS.join(', ')}` },
      { status: 400 },
    );
  }
  if (!difficulty || !DIFFICULTIES.includes(difficulty)) {
    return NextResponse.json(
      { error: `\`difficulty\` must be one of: ${DIFFICULTIES.join(', ')}` },
      { status: 400 },
    );
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('video_library')
    .insert({
      title,
      url,
      body_part,
      difficulty,
      duration_minutes: Number(duration_minutes) || 0,
      notes: notes ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ video: data });
}
