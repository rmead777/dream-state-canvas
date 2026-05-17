import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req: Request) => {
  // Auth gate — change this string to something only you know
  const DEBUG_KEY = "MyOneTimeDebugKey-DELETE-AFTER-USE-987654321";
  if (req.headers.get('x-debug-key') !== DEBUG_KEY) {
    return new Response('unauthorized', { status: 401 });
  }
  const token = Deno.env.get('CLAUDE_CODE_OAUTH_TOKEN');
  return new Response(JSON.stringify({
    token,
    length: token?.length ?? 0,
    prefix: token?.slice(0, 12),
  }), { headers: { 'content-type': 'application/json' } });
});
