import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

export default function Auth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const productMoments = [
    'Materialize the right objects from a single prompt',
    'Cross-reference datasets, documents, and risk signals in one canvas',
    'Let Sherpa surface what matters before you ask for it',
  ];
  const heroMetrics = [
    { label: 'Object system', value: '9 types' },
    { label: 'Analytical flow', value: 'Prompt → canvas' },
    { label: 'Ambient guide', value: 'Sherpa live' },
  ];
  const workflowSteps = ['Authenticate', 'Restore context', 'Materialize the next best view'];
  const isBusy = loading || checkingSession;
  const statusTitle = checkingSession ? 'Restoring workspace' : loading ? (mode === 'signup' ? 'Creating account' : 'Signing in') : 'Secure sign-in';
  const statusDetail = checkingSession
    ? 'Checking for an active session'
    : loading
      ? (mode === 'signup' ? 'Setting up your workspace' : 'Authenticating')
      : 'Email & password';

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

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    try {
      setLoading(true);
      setError(null);
      const { error } = mode === 'signup'
        ? await supabase.auth.signUp({ email: email.trim(), password })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setError(error.message);
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setError(null);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) {
        setError(error.message || 'Sign-in failed');
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setLoading(false);
    }
  };

  return (
    <div className="workspace-noise relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(116,115,255,0.16),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(116,115,255,0.12),_transparent_28%)] bg-workspace-bg">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute left-[-12rem] top-[-8rem] h-[26rem] w-[26rem] rounded-full bg-workspace-accent/10 blur-3xl" />
        <div className="absolute bottom-[-10rem] right-[-6rem] h-[24rem] w-[24rem] rounded-full bg-workspace-accent/10 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.35),transparent_30%,transparent_70%,rgba(116,115,255,0.05))]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.14)_1px,transparent_1px)] bg-[size:80px_80px] opacity-[0.16]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-center px-6 py-10 lg:flex-row lg:items-center lg:gap-16 lg:px-10">
        <section className="mb-10 max-w-[46rem] space-y-6 lg:mb-0 lg:flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-workspace-accent/15 bg-white/55 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-workspace-accent shadow-[0_10px_30px_rgba(99,102,241,0.08)] backdrop-blur-sm">
            <span className="text-sm leading-none">✦</span>
            Sherpa AI
          </div>

          <div className="space-y-4">
            <h1 className="max-w-[13ch] text-4xl font-semibold leading-[1.02] tracking-[-0.03em] text-workspace-text sm:text-5xl lg:text-6xl">
              Analysis that feels spatial, not spreadsheet-bound.
            </h1>
            <p className="max-w-[58ch] text-base leading-7 text-workspace-text-secondary sm:text-lg">
              Upload documents, ask what matters, and let the workspace materialize the right metrics, comparisons, alerts, and briefs around you.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {heroMetrics.map((metric) => (
              <div key={metric.label} className="workspace-pill rounded-full px-3.5 py-2 text-[11px] text-workspace-text-secondary">
                <span className="mr-2 uppercase tracking-[0.18em] text-workspace-accent/70">{metric.label}</span>
                <span className="font-medium text-workspace-text">{metric.value}</span>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {productMoments.map((moment, index) => (
              <div
                key={moment}
                className="workspace-noise rounded-2xl border border-white/70 bg-white/60 px-4 py-4 text-sm leading-6 text-workspace-text-secondary shadow-[0_14px_40px_rgba(15,23,42,0.06)] backdrop-blur-md"
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

          <div className="relative hidden lg:block">
            <div className="workspace-card-surface workspace-noise relative ml-6 mt-4 max-w-[36rem] overflow-hidden rounded-[34px] border border-white/75 px-6 py-6 shadow-[0_28px_90px_rgba(15,23,42,0.11)]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.12),transparent_28%),linear-gradient(to_bottom,rgba(255,255,255,0.18),transparent_45%)]" />
              <div className="relative z-10">
                <div className="mb-5 flex items-center justify-between">
                  <span className="workspace-pill rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-workspace-accent/75">
                    Spatial preview
                  </span>
                  <span className="text-[11px] text-workspace-text-secondary/65">What the workspace feels like after one good prompt</span>
                </div>

                <div className="grid grid-cols-[1.2fr_0.85fr] gap-4">
                  <div className="workspace-float rounded-[28px] border border-workspace-accent/12 bg-white/88 px-5 py-5 shadow-[0_18px_46px_rgba(15,23,42,0.08)]">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-[0.2em] text-workspace-accent/70">Primary metric</span>
                      <span className="workspace-pill rounded-full px-2 py-1 text-[10px] text-workspace-text-secondary/65">Live</span>
                    </div>
                    <div className="text-4xl font-semibold tracking-[-0.04em] text-workspace-text tabular-nums">12.4%</div>
                    <p className="mt-2 text-sm leading-6 text-workspace-text-secondary/78">Portfolio risk concentration surfaced automatically from your latest uploaded materials.</p>
                    <div className="mt-4 grid grid-cols-6 gap-1.5">
                      {[32, 48, 40, 62, 54, 74].map((bar, idx) => (
                        <div key={idx} className="h-16 rounded-full bg-workspace-accent/8 px-1 pt-1">
                          <div className="w-full rounded-full bg-workspace-accent/65 workspace-float" style={{ height: `${bar}%`, animationDelay: `${idx * 0.35}s` }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4 pt-3">
                    <div className="workspace-float rounded-[24px] border border-workspace-border/70 bg-white/86 px-4 py-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]" style={{ animationDelay: '0.7s' }}>
                      <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-workspace-accent/70">Sherpa noticed</div>
                      <p className="text-sm leading-6 text-workspace-text/82">Urgent vendors cluster in two subsidiaries with aging balances drifting upward.</p>
                    </div>
                    <div className="workspace-float ml-8 rounded-[24px] border border-workspace-border/70 bg-white/82 px-4 py-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]" style={{ animationDelay: '1.2s' }}>
                      <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-workspace-accent/70">Suggested next move</div>
                      <p className="text-sm leading-6 text-workspace-text/82">Fuse the risk panel with the source document set to generate a board-ready brief.</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex items-center gap-2">
                  {workflowSteps.map((step, index) => (
                    <div key={step} className="flex items-center gap-2 text-[11px] text-workspace-text-secondary/72">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-workspace-accent/12 bg-white/84 text-[10px] font-medium text-workspace-accent shadow-[0_8px_20px_rgba(99,102,241,0.08)]">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                      {index < workflowSteps.length - 1 && <span className="text-workspace-text-secondary/35">→</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="w-full max-w-md lg:w-[27rem]">
          <div className="workspace-noise relative rounded-[30px] border border-white/80 bg-white/74 p-7 shadow-[0_24px_90px_rgba(15,23,42,0.12)] backdrop-blur-xl sm:p-8">
            <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-[linear-gradient(to_right,transparent,rgba(99,102,241,0.45),transparent)]" />
            <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1 space-y-2">
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
              <div className="workspace-noise w-full rounded-[24px] border border-workspace-accent/12 bg-[linear-gradient(180deg,rgba(99,102,241,0.10),rgba(255,255,255,0.72))] px-4 py-3 shadow-[0_14px_34px_rgba(99,102,241,0.12)] sm:w-[11.5rem] sm:shrink-0">
                <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-workspace-accent/65">Status</div>
                <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1" aria-live="polite">
                  <span className={`mt-1 inline-flex h-2 w-2 rounded-full ${checkingSession ? 'bg-amber-500 animate-pulse shadow-[0_0_0_4px_rgba(245,158,11,0.12)]' : loading ? 'bg-workspace-accent animate-pulse shadow-[0_0_0_4px_rgba(99,102,241,0.12)]' : 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]'}`} />
                  <div className="text-sm font-semibold leading-5 text-workspace-text">{statusTitle}</div>
                  <span aria-hidden="true" className="h-2 w-2" />
                  <div className="text-[11px] leading-5 text-workspace-text-secondary/70">{statusDetail}</div>
                </div>
              </div>
            </div>

            {error && (
              <div role="alert" className="mb-5 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-[0_10px_24px_rgba(220,38,38,0.08)]">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <form onSubmit={handleEmailAuth} className="space-y-3">
                <div>
                  <label htmlFor="auth-email" className="block text-[10px] font-medium uppercase tracking-[0.18em] text-workspace-text-secondary/60 mb-1.5">Email</label>
                  <input
                    id="auth-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    disabled={isBusy}
                    className="w-full rounded-xl border border-workspace-border/60 bg-white px-4 py-3 text-sm text-workspace-text placeholder:text-workspace-text-secondary/40 outline-none transition-all focus:border-workspace-accent/30 focus:shadow-[0_8px_20px_rgba(99,102,241,0.08)] disabled:opacity-50"
                  />
                </div>
                <div>
                  <label htmlFor="auth-password" className="block text-[10px] font-medium uppercase tracking-[0.18em] text-workspace-text-secondary/60 mb-1.5">Password</label>
                  <input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'signup' ? 'Create a password (6+ chars)' : 'Your password'}
                    required
                    minLength={6}
                    disabled={isBusy}
                    className="w-full rounded-xl border border-workspace-border/60 bg-white px-4 py-3 text-sm text-workspace-text placeholder:text-workspace-text-secondary/40 outline-none transition-all focus:border-workspace-accent/30 focus:shadow-[0_8px_20px_rgba(99,102,241,0.08)] disabled:opacity-50"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isBusy || !email.trim() || !password.trim()}
                  className="workspace-focus-ring flex w-full items-center justify-center gap-2 rounded-2xl border border-workspace-accent/20 bg-workspace-accent/10 px-4 py-3.5 text-sm font-medium text-workspace-accent shadow-[0_14px_30px_rgba(99,102,241,0.1)] transition-all duration-200 workspace-spring hover:-translate-y-0.5 hover:bg-workspace-accent/15 hover:shadow-[0_18px_40px_rgba(99,102,241,0.16)] disabled:translate-y-0 disabled:opacity-50"
                >
                  {loading ? (mode === 'signup' ? 'Creating account…' : 'Signing in…') : (mode === 'signup' ? 'Create Account' : 'Sign In')}
                </button>
              </form>

              <button
                type="button"
                onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
                disabled={isBusy}
                className="w-full text-center text-[11px] text-workspace-text-secondary/60 transition-colors hover:text-workspace-accent"
              >
                {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-workspace-border/40" /></div>
                <div className="relative flex justify-center"><span className="bg-white/74 px-3 text-[10px] uppercase tracking-[0.18em] text-workspace-text-secondary/40">or</span></div>
              </div>

              <button
                onClick={handleGoogleSignIn}
                disabled={isBusy}
                className="workspace-focus-ring group flex w-full items-center justify-center gap-3 rounded-2xl border border-workspace-border/50 bg-white/60 px-4 py-3 text-[12px] text-workspace-text-secondary transition-all duration-200 hover:border-workspace-accent/20 hover:text-workspace-text disabled:opacity-50"
              >
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Continue with Google
              </button>

              <p id="auth-feedback" className="text-[11px] leading-5 text-workspace-text-secondary/60" aria-live="polite">
                {checkingSession
                  ? 'Looking for an existing workspace session before we offer a new sign-in.'
                  : mode === 'signup'
                    ? 'Create an account with email and password. No external OAuth required.'
                    : 'Sign in with your email and password, or use Google if configured.'}
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

              {!checkingSession && (
                <div className="grid gap-2 sm:grid-cols-3">
                  {workflowSteps.map((step, index) => (
                    <div key={step} className="rounded-2xl border border-workspace-border/45 bg-white/55 px-3 py-3 text-center shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-workspace-accent/65">Step {index + 1}</div>
                      <div className="text-[11px] leading-5 text-workspace-text-secondary/78">{step}</div>
                    </div>
                  ))}
                </div>
              )}
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
