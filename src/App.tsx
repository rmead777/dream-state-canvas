import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/hooks/useAuth";
import { useState, useEffect, type ReactNode } from "react";
import { PublicClientApplication, EventType, type AccountInfo } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { msalConfig } from "@/lib/msal-config";
import { setMsalInstance } from "@/lib/email-store";
import Index from "./pages/Index.tsx";
import Auth from "./pages/Auth.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();
const msalInstance = new PublicClientApplication(msalConfig);

/** Initialize MSAL and handle redirect callback before rendering */
function MsalInitializer({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        await msalInstance.initialize();
        const response = await msalInstance.handleRedirectPromise();
        if (response?.account) {
          msalInstance.setActiveAccount(response.account);
          window.history.replaceState(null, '', window.location.pathname);
        }
        msalInstance.addEventCallback((event) => {
          if (event.eventType === EventType.LOGIN_SUCCESS) {
            const account = (event.payload as { account: AccountInfo })?.account;
            if (account) msalInstance.setActiveAccount(account);
          }
        });
        const accounts = msalInstance.getAllAccounts();
        if (!msalInstance.getActiveAccount() && accounts.length > 0) {
          msalInstance.setActiveAccount(accounts[0]);
        }
        // Make MSAL instance available to email-store (non-React code)
        setMsalInstance(msalInstance);
      } catch (err) {
        console.warn('[MSAL] Init failed (Outlook features disabled):', err);
      }
      setReady(true);
    };
    init();
  }, []);

  if (!ready) return null; // Don't block render — MSAL init is fast
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-workspace-bg">
        <div className="h-6 w-6 rounded-full border-2 border-workspace-accent/30 border-t-workspace-accent animate-spin" />
      </div>
    );
  }
  if (!session) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

const App = () => (
  <ErrorBoundary label="Application">
    <MsalInitializer>
      <MsalProvider instance={msalInstance}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </QueryClientProvider>
      </MsalProvider>
    </MsalInitializer>
  </ErrorBoundary>
);

export default App;
