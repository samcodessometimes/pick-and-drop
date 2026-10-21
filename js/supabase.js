import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !SUPABASE_URL.startsWith('YOUR_');
export const db = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
