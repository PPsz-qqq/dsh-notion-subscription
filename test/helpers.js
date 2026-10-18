// Synthetic fixtures derived from publicly described shapes, NOT a live HAR.
export const config = {
  enabled: true, autoDiscover: false, autoModels: false, cookie: 'synthetic-test-token',
  spaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  completionMode: 'verified-marker',
  terminalType: 'synthetic-completion', terminalPath: '/status', terminalValue: 'completed',
  timeoutMs: 2000, idleTimeoutMs: 500,
};
export const request = {
  provider: 'notion-subscription', model: 'claude-sonnet4.6',
  messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
};
export const terminal = { type: 'synthetic-completion', status: 'completed' };
export function finalRecord(text, threadId, stepType = 'text') {
  return { type: 'record-map', recordMap: { thread_message: {
    answer: { value: { last_edited_time: 1, value: { ...(threadId ? { thread_id: threadId } : {}), step: { type: stepType, value: text } } } },
  } } };
}
export function responseOf(frames, { splitBytes = 0, trailingNewline = true } = {}) {
  const bytes = new TextEncoder().encode(frames.map((frame) => typeof frame === 'string' ? frame : JSON.stringify(frame)).join('\n') + (trailingNewline ? '\n' : ''));
  const stream = new ReadableStream({ start(controller) {
    if (splitBytes) for (let i = 0; i < bytes.length; i += splitBytes) controller.enqueue(bytes.slice(i, i + splitBytes));
    else controller.enqueue(bytes);
    controller.close();
  } });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } });
}
export async function collect(stream) { const items = []; for await (const item of stream) items.push(item); return items; }
