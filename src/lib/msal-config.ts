/**
 * MSAL Configuration — Microsoft 365 auth for Outlook email access.
 *
 * Uses Tarn's existing Azure AD app registration with delegated Mail.Read
 * permission. No admin consent required — user signs in via popup and
 * grants access to their own mailbox only.
 */

import { Configuration, LogLevel } from '@azure/msal-browser';

export const msalConfig: Configuration = {
  auth: {
    clientId: 'f62b40cb-7685-4cda-b7ce-fc91124c6477',
    authority: 'https://login.microsoftonline.com/common',
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        if (level === LogLevel.Error) console.error('[MSAL]', message);
        else if (level === LogLevel.Warning) console.warn('[MSAL]', message);
        // Suppress Info/Verbose to avoid noise in DSC's console
      },
      logLevel: LogLevel.Warning,
    },
  },
};

/** Scopes requested during login — Mail.Read + offline_access for token refresh */
export const loginRequest = {
  scopes: ['https://graph.microsoft.com/Mail.Read', 'offline_access'],
};
