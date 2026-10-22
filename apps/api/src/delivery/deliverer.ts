import { signatureHeaders } from './signature.js';

export interface OutgoingWebhook {
  url: string;
  secret: string;
  messageId: string;
  contentType: string | null;
  body: Buffer;
  timeoutMs: number;
}

export interface SendResult {
  statusCode?: number;
  error?: string;
  retryAfterHeader?: string | null;
  responseSnippet?: string;
  durationMs: number;
}

const SNIPPET_BYTES = 2048;

/** One HTTP attempt. Never throws: every failure mode becomes data for the retry policy. */
export async function send(webhook: OutgoingWebhook, fetchImpl = fetch): Promise<SendResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const response = await fetchImpl(webhook.url, {
      method: 'POST',
      headers: {
        'content-type': webhook.contentType ?? 'application/octet-stream',
        'user-agent': 'HookRelay/0.1',
        ...signatureHeaders({
          secret: webhook.secret,
          messageId: webhook.messageId,
          timestamp: Math.floor(Date.now() / 1000),
          body: webhook.body,
        }),
      },
      body: new Uint8Array(webhook.body),
      // A redirect is a configuration problem; following it could leak the payload elsewhere.
      redirect: 'manual',
      signal: AbortSignal.timeout(webhook.timeoutMs),
    });
    const text = await response.text().catch(() => '');
    return {
      statusCode: response.status,
      retryAfterHeader: response.headers.get('retry-after'),
      responseSnippet: text.slice(0, SNIPPET_BYTES),
      durationMs: elapsed(),
    };
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
    return {
      error: isTimeout ? `timeout after ${webhook.timeoutMs} ms` : describe(error),
      durationMs: elapsed(),
    };
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
    return cause?.code ? `${error.message} (${cause.code})` : error.message;
  }
  return String(error);
}
