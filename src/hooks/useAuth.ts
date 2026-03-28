import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { decayStaleMemories } from '@/lib/memory-store';
import type { Session, User } from '@supabase/supabase-js';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      // Run daily memory decay on first load (Phase 5)
      if (session?.user) {
        const lastDecay = localStorage.getItem('sherpa-last-decay');
        const today = new Date().toDateString();
        if (lastDecay !== today) {
          decayStaleMemories(session.user.id).catch(() => {});
          localStorage.setItem('sherpa-last-decay', today);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return { session, user, loading, signOut };
}
