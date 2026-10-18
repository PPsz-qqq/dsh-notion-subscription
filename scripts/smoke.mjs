// Explicit opt-in only. This command consumes real Notion AI allowance/credits.
import { NotionSubscriptionAdapter } from '../src/index.js';
import { DEFAULT_CLIENT_VERSION, DEFAULT_MODELS } from '../src/options.js';

if (process.env.NOTION_ALLOW_LIVE_TEST !== '1') {
  console.error('未发送任何请求。若已确认协议、风险与额度，请设置 NOTION_ALLOW_LIVE_TEST=1 后手动运行；不要把 Cookie 发到聊天。');
  process.exitCode = 1;
} else {
  // Defaults come from the ported notion2api catalog, so a smoke run needs no
  // model id of its own; NOTION_MODEL_ID still overrides it.
  const upstreamModel = process.env.NOTION_MODEL_ID || DEFAULT_MODELS[0].upstreamModel;
  const completionMode = process.env.NOTION_COMPLETION_MODE || 'stream-end';
  const adapter = new NotionSubscriptionAdapter({
    enabled: true,
    clientVersion: process.env.NOTION_CLIENT_VERSION || DEFAULT_CLIENT_VERSION,
    completionMode,
    terminalType: process.env.NOTION_TERMINAL_TYPE || '',
    terminalPath: process.env.NOTION_TERMINAL_PATH || '',
    terminalValue: process.env.NOTION_TERMINAL_VALUE || '',
    models: [{ id: 'notion-test', name: 'Notion 手动自检', upstreamModel }],
  });
  try {
    for await (const chunk of adapter.stream({ provider: 'notion-subscription', model: 'notion-test', messages: [{ role: 'user', content: [{ type: 'text', text: '你好，请只回复 OK。' }] }] })) {
      if (chunk.type === 'text-delta') process.stdout.write(chunk.text);
      if (chunk.type === 'finish') console.log(`\nFinish: ${chunk.reason.kind}`);
    }
  } catch (error) { console.error(`\n${error.code ?? 'ERROR'}: ${error.message}`); process.exitCode = 1; }
}