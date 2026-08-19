import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Browser-side client. Uses the publishable (anon) key.
 *
 * Note: with RLS enabled and no policies, this client cannot read or write any
 * table — that is intentional for v1. It exists so client code has a Supabase
 * handle available (realtime, storage, future auth). All data access in the app
 * goes through the /api routes below instead.
 */
export function createBrowserClient(): SupabaseClient<Database> {
  if (!url || !publishableKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. ' +
        'Copy .env.local.example to .env.local and fill it in.',
    );
  }
  return createClient<Database>(url, publishableKey);
}

let serverClient: SupabaseClient<Database> | null = null;

/**
 * Server-side client. Uses the secret (service role) key and bypasses RLS.
 * Only ever call this from route handlers / server components — never from
 * a "use client" file.
 */
export function createServerClient(): SupabaseClient<Database> {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY. ' +
        'Copy .env.local.example to .env.local and fill it in.',
    );
  }
  if (!serverClient) {
    serverClient = createClient<Database>(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serverClient;
}
