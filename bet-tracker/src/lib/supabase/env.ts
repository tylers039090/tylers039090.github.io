export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
/** Publishable (new) or anon (legacy) key — both are safe in the browser. */
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
