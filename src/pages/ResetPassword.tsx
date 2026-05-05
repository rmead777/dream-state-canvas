import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Supabase parses the recovery token from the URL hash and emits a PASSWORD_RECOVERY event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    // Also check existing session (link may have already been processed)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    try {
      setLoading(true);
      setError(null);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { setError(error.message); setLoading(false); return; }
      setSuccess(true);
      setLoading(false);
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password');
      setLoading(false);
    }
  };

  return (
    <div className="workspace-noise relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(116,115,255,0.16),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(116,115,255,0.12),_transparent_28%)] bg-workspace-bg">
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10">
        <div className="workspace-noise relative rounded-[30px] border border-white/80 bg-white/74 p-7 shadow-[0_24px_90px_rgba(15,23,42,0.12)] backdrop-blur-xl sm:p-8">
          <div className="mb-6">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-workspace-accent/10 text-lg text-workspace-accent shadow-[0_8px_20px_rgba(99,102,241,0.16)]">✦</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-workspace-text">Set a new password</h2>
            <p className="mt-1 text-sm leading-6 text-workspace-text-secondary">
              {ready ? 'Choose a new password for your workspace.' : 'Verifying your reset link…'}
            </p>
          </div>

          {error && (
            <div role="alert" className="mb-5 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {success ? (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
              Password updated. Redirecting to your workspace…
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label htmlFor="new-password" className="block text-[10px] font-medium uppercase tracking-[0.18em] text-workspace-text-secondary/60 mb-1.5">New password</label>
                <input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={!ready || loading}
                  className="w-full rounded-xl border border-workspace-border/60 bg-white px-4 py-3 text-sm text-workspace-text outline-none transition-all focus:border-workspace-accent/30 focus:shadow-[0_8px_20px_rgba(99,102,241,0.08)] disabled:opacity-50"
                />
              </div>
              <div>
                <label htmlFor="confirm-password" className="block text-[10px] font-medium uppercase tracking-[0.18em] text-workspace-text-secondary/60 mb-1.5">Confirm password</label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                  disabled={!ready || loading}
                  className="w-full rounded-xl border border-workspace-border/60 bg-white px-4 py-3 text-sm text-workspace-text outline-none transition-all focus:border-workspace-accent/30 focus:shadow-[0_8px_20px_rgba(99,102,241,0.08)] disabled:opacity-50"
                />
              </div>
              <button
                type="submit"
                disabled={!ready || loading || !password || !confirm}
                className="workspace-focus-ring flex w-full items-center justify-center gap-2 rounded-2xl border border-workspace-accent/20 bg-workspace-accent/10 px-4 py-3.5 text-sm font-medium text-workspace-accent shadow-[0_14px_30px_rgba(99,102,241,0.1)] transition-all duration-200 workspace-spring hover:-translate-y-0.5 hover:bg-workspace-accent/15 disabled:translate-y-0 disabled:opacity-50"
              >
                {loading ? 'Updating…' : 'Update password'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/auth', { replace: true })}
                className="w-full text-center text-[11px] text-workspace-text-secondary/60 transition-colors hover:text-workspace-accent"
              >
                Back to sign in
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
