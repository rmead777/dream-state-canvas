import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';

export default function Auth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const productMoments = [
    'Materialize the right objects from a single prompt',
    'Cross-reference datasets, documents, and risk signals in one canvas',
    'Let Sherpa surface what matters before you ask for it',
  ];
  const isBusy = loading || checkingSession;
  const statusTitle = checkingSession ? 'Restoring workspace' : loading ? 'Redirecting' : 'Secure sign-in';
  const statusDetail = checkingSession
    ? 'Checking for an active session'
    : loading
      ? 'Handing off to Google OAuth'
      : 'Google OAuth with Supabase';

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        navigate('/', { replace: true });
        return;
      }
      setCheckingSession(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/', { replace: true });
      else setCheckingSession(false);
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await lovable.auth.signInWithOAuth('google', {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        setError(result.error.message || 'Sign-in failed');
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(116,115,255,0.16),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(116,115,255,0.12),_transparent_28%)] bg-workspace-bg">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute left-[-12rem] top-[-8rem] h-[26rem] w-[26rem] rounded-full bg-workspace-accent/10 blur-3xl" />
        <div className="absolute bottom-[-10rem] right-[-6rem] h-[24rem] w-[24rem] rounded-full bg-workspace-accent/10 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.35),transparent_30%,transparent_70%,rgba(116,115,255,0.05))]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-center px-6 py-10 lg:flex-row lg:items-center lg:gap-16 lg:px-10">
        <section className="mb-10 max-w-xl space-y-6 lg:mb-0 lg:flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-workspace-accent/15 bg-white/55 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-workspace-accent shadow-[0_10px_30px_rgba(99,102,241,0.08)] backdrop-blur-sm">
            <span className="text-sm leading-none">✦</span>
            Dream State Canvas
          </div>

          <div className="space-y-4">
            <h1 className="max-w-[13ch] text-4xl font-semibold leading-[1.02] tracking-[-0.03em] text-workspace-text sm:text-5xl lg:text-6xl">
              Analysis that feels spatial, not spreadsheet-bound.
            </h1>
            <p className="max-w-[58ch] text-base leading-7 text-workspace-text-secondary sm:text-lg">
              Upload documents, ask what matters, and let the workspace materialize the right metrics, comparisons, alerts, and briefs around you.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {productMoments.map((moment, index) => (
              <div
                key={moment}
                className="rounded-2xl border border-white/70 bg-white/60 px-4 py-4 text-sm leading-6 text-workspace-text-secondary shadow-[0_14px_40px_rgba(15,23,42,0.06)] backdrop-blur-md"
                style={{ animationDelay: `${Math.min(index * 40, 120)}ms` }}
              >
                <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-workspace-accent/70">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-workspace-accent/70" />
                  Signal {index + 1}
                </div>
                <p className="text-sm leading-6 text-workspace-text/80">{moment}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="w-full max-w-md lg:w-[27rem]">
          <div className="rounded-[28px] border border-white/75 bg-white/72 p-7 shadow-[0_24px_90px_rgba(15,23,42,0.12)] backdrop-blur-xl sm:p-8">
            <div className="mb-7 flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-workspace-accent/10 text-lg text-workspace-accent shadow-[0_8px_20px_rgba(99,102,241,0.16)]">
                  ✦
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.02em] text-workspace-text">Welcome back</h2>
                  <p className="mt-1 text-sm leading-6 text-workspace-text-secondary">
                    Sign in to return to your analytical workspace and pick up the thread instantly.
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border border-workspace-accent/10 bg-workspace-accent/5 px-3 py-2 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <div className="text-[10px] uppercase tracking-[0.22em] text-workspace-accent/60">Status</div>
                <div className="mt-1 text-sm font-medium text-workspace-text" aria-live="polite">{statusTitle}</div>
                <div className="mt-0.5 text-[11px] text-workspace-text-secondary/65">{statusDetail}</div>
              </div>
            </div>

            {error && (
              <div role="alert" className="mb-5 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-[0_10px_24px_rgba(220,38,38,0.08)]">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <button
                onClick={handleGoogleSignIn}
                disabled={isBusy}
                aria-busy={isBusy}
                aria-describedby="auth-feedback"
                className="workspace-focus-ring group flex w-full items-center justify-center gap-3 rounded-2xl border border-workspace-border/70 bg-white px-4 py-4 text-sm font-medium text-workspace-text shadow-[0_14px_30px_rgba(15,23,42,0.08)] transition-all duration-200 hover:-translate-y-0.5 hover:border-workspace-accent/20 hover:shadow-[0_18px_40px_rgba(99,102,241,0.14)] disabled:translate-y-0 disabled:opacity-50"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" className="transition-transform duration-200 group-hover:scale-105">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                {checkingSession ? 'Checking session…' : loading ? 'Signing in…' : 'Continue with Google'}
              </button>

              <p id="auth-feedback" className="text-[11px] leading-5 text-workspace-text-secondary/60" aria-live="polite">
                {checkingSession
                  ? 'Looking for an existing workspace session before we offer a new sign-in.'
                  : loading
                    ? 'Opening Google sign-in in a secure redirect flow.'
                    : 'Use your Google account to restore your analytical workspace and continue where you left off.'}
              </p>

              <div className="rounded-2xl border border-workspace-border/50 bg-workspace-surface/35 px-4 py-3 text-xs leading-6 text-workspace-text-secondary">
                {checkingSession ? (
                  <div className="space-y-2.5" aria-hidden="true">
                    <div className="workspace-skeleton h-2.5 w-24 rounded-full" />
                    <div className="workspace-skeleton h-2.5 w-full rounded-full" />
                    <div className="workspace-skeleton h-2.5 w-4/5 rounded-full" />
                  </div>
                ) : (
                  <>
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/70">What happens next</div>
                    Sherpa will observe workspace state, uploaded documents, and object relationships — but only after you invite it in.
                  </>
                )}
              </div>
            </div>

            <p className="mt-5 text-center text-[11px] leading-5 text-workspace-text-secondary/55">
              By continuing, you agree to our terms of service and acknowledge the workspace may use AI to synthesize uploaded materials.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
