import { db } from './supabase.js';

// Customers get an anonymous Supabase session so RLS can scope orders to them.
// Phone or email login can be linked to the same account later.
export async function ensureSession() {
  const { data: { session } } = await db.auth.getSession();
  if (session) return session.user;
  const { data, error } = await db.auth.signInAnonymously();
  if (error) throw new Error('Could not start a session. Please try again.');
  return data.user;
}

// Staff, riders and admins sign in with email and password (users are created
// by an admin in Supabase Auth). Signing in replaces any anonymous customer session.
export async function signInStaff(email, password) {
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error('Sign in failed. Check your email and password.');
  return data.user;
}
