import { oauthCallbackDestination } from '@/lib/mcp-oauth-callback';

export async function GET(request: Request) {
  return new Response(null, {
    status: 302,
    headers: {
      location: oauthCallbackDestination(new URL(request.url)).toString(),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
