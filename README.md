# DSH Notion AI Subscription 0.4.0（实验版）

安装包下载：[GitHub Releases](https://github.com/PPsz-qqq/dsh-notion-subscription/releases/latest)。

DSH 原生 Provider，使用你本人获授权的 Notion 网页登录态直连 API，不需要常驻 Python 代理。初始实现参考 [pdxjie/notion2api](https://github.com/pdxjie/notion2api)；0.2.0 根据真实账号响应修正协议，并改为读取账号模型目录。

## 安装与升级

需要 Node.js 22+、兼容 DSH 0.2.0-rc.2 的 Host。在插件页安装本地组合包：

    ./dsh-notion-subscription-0.4.0.tgz

升级后重启 DSH，再刷新模型目录。包内含 Host 模块、设置页 factory 和注册 patch，不需要额外 Web 服务。安装包校验不能替代 Host 重载验证。

## 配置

1. 在自己的 Notion 网页确认 AI 可用，并确认个人/组织政策允许此非官方接入。
2. 填写原始 token_v2 或含 token_v2 的单行 Cookie，或使用 Host 启动环境的 NOTION_COOKIE。不要粘贴整个 cURL，不要把凭据发到聊天或提交到 Git。
3. 启用线路。默认通过 loadUserContent 识别用户和工作区；多个工作区时必须指定 spaceId，不静默选择第一项。手工 UUID 优先，实际访问权限由 Notion 校验。
4. 自动模型发现默认开启，选择模型后发送文本消息。

可选环境变量：NOTION_SPACE_ID、NOTION_USER_ID。关闭 autoDiscover 后两个 UUID 都必填。默认请求 app.notion.com，保留 www.notion.so 作为兼容选项；连接重置不能单独证明域名迁移、限流或 Cookie 失效。

身份缓存按域名、凭据和手工身份隔离，5 分钟过期；认证失败时清除。Cookie 是登录凭据：只写/脱敏显示不等于磁盘加密。本插件不读取浏览器 Cookie 数据库，也不续期登录态。

## 0.4.0：输入框下的额度显示与超时修正

输入框正下方显示 Notion 基础 AI 额度：默认 **6 小时**窗口，**点击即可切换为本月**，再点切回。仅当当前会话使用 Notion 模型时出现，其他 Provider 下不显示。

- 数据来自 `getCreditRateLimitStatus`（`{"spaceId": ...}`），读取 `window`（6h，`used`/`limit`/`resetsInSeconds`）与 `billingPeriodWindow`（账期，`periodEndMs`）。按真实 limit 计算百分比，超过额度时保留实际用量、仅把显示剩余压到 0。
- 只读：不消耗 AI 额度，不创建会话，不写入任何 Notion 数据，也不发送推理请求。
- 展示 `used / limit` 与重置时间；`enforcement: preview` 时标注“预览期”。窗口缺失显示“暂无该窗口数据”，不补零、不猜数字。
- 覆盖基础 AI 额度；Custom Agents/Workers 等单独计费项目不在其中。
- 缓存 60 秒（失败 15 秒），读取不重叠；切换工作区、凭据或线路配置后旧结果立即失效，不会串号。
- 浏览器端通过同源只读路由 `/api/dsh-notion-subscription/quota` 读取；拒绝跨站请求与非 GET 方法，响应 `no-store`，不回传 Cookie。
- 超时：首段数据受请求总时限约束，开始收流后受 `idleTimeoutMs` 约束；错误信息区分“首段超时”“流中途停滞（已接收 N 字节）”和“总时限”，不自动重试，避免重复消耗。

本次验收：188 项离线回归通过；真实 Chrome 检查浅色、深色、390px 窄屏及预览期四种额度渲染，无横向溢出、无外部请求，点击切换后标签与数值同步更新。额度接口用当前账号做过一次只读核验（未发送推理请求）。**未在新 Host 会话中实测挂载后的完整交互**，安装后需重启 DSH。

已知限制：额度接口属 Notion 内部接口，随时可能变化；仅 Business/Enterprise 等工作区提供该额度，不适用时明确显示而不是空白。

## 0.3.1：本地文件工具桥接

开启路径：**Notion AI 订阅 → 高级设置 → 实验性文本工具桥接 → 保存**。使用包含本地文件工具的 DSH Agent/编程会话；纯聊天预设不提供工具时，模型仍只能回答文本。安装后重启 DSH 加载新代码。

- Notion 只生成外部客户端的结构化操作提案，不声称自己能直接访问本机，也不调用 Notion 工作区动作来替代本地操作。
- DSH 接收提案后，按当前会话的工具、参数及权限规则执行读写，再把结果交回模型。开启桥接不扩大系统权限，建议限制实际项目可访问的路径和工具。
- Notion 请求仍保持 useReadOnlyMode: true，并保持工作区编辑、搜索和自动化相关开关关闭；没有为解决 Ask mode 拒绝而放开云端编辑能力。
- 这是实验性文本桥接，不是 Notion 官方原生 function calling。未知工具名或非法协议会被拒绝；不保证所有模型都稳定生成工具提案。
- 文件操作在本机，但提供给模型的文件内容与工具结果仍会发送到 Notion，可能进入云端会话记录。完全离线处理需要本地模型或本地固定脚本。

验证：167 项离线回归通过；在 GPT-6.1 Sol 路由上，修正后的适配器生成 read、edit 提案，由本会话 DSH 原生工具实际执行并回读。临时文件的随机标记保留，修改回执正确取自读取内容。3 次获授权请求已用完，其中第 1 次是旧桥接的 Ask mode 拒绝，后 2 次完成新桥接的读、改提案；没有再请求模型最终确认。未使用真实项目文件，未向 Gemini 发送推理请求，未另开 GUI 会话验证完整调度循环。

仅工具提示与协议说明更新，设置界面保持 0.3.0 版本；线上可下载版本以 GitHub Releases 为准。

## 0.3.0：思考强度与新设置页

DSH 聊天页选择本 Provider 的模型后，可使用原生思考强度选项。档位来自 Notion getAvailableModels 返回的 modelConfiguration，而不是根据模型名猜测。本次 36 个未禁用条目中有 33 个声明可选档位；没有声明不等于模型不思考。

- 优先级：会话 reasoningEffort → 手动模型项 reasoningEffort → 插件 defaultReasoningEffort → Notion 自身默认。
- 默认跟随模型：不发送覆盖字段，也不强行使用统一强度。上游 defaultReasoningEffort 仅作能力元数据，不擅自变成插件强制值。
- 显式选择不支持的档位会在推理前报错。统一插件默认值只对支持该档位的模型生效，否则不覆盖上游。
- 已接通的请求字段为 workflow 配置块中的 reasoningEffort；依据官网 app-29290de15d9f4cf7.js 的 workflow targetConfig 及认证模型目录。旧 markdown-chat 兼容路由不宣称支持该控制。
- low/medium/high/xhigh/max 等值按各模型实际公布情况展示，不能理解为固定 token 预算，也不会显示隐藏思考过程。

新界面包含状态概览、只写凭据、模型搜索、思考档位标识、统一默认策略、折叠高级设置和底部保存栏，适配浅色、深色和窄屏。模型卡片列出可用档位，具体会话仍在 DSH 原生模型菜单中选择。

空 Cookie 不覆盖已保存凭据；清除需要二次确认。外部配置更新时保留本地草稿与原始修订号；只读状态禁止保存。保存成功但刷新目录失败会单独提示。凭据已配置不等于 AI 连通已验证。

本版通过 166 项离线回归，并用真实 Chrome 在 1280px 浅/深主题和 390px 窄屏检查了渲染、折叠区溢出及搜索/保存交互。浏览器预览使用合成配置，不读取真实 Cookie，也不请求外部服务。

**本次思考强度功能未发送真实 AI 请求：已核实能力来源、原生参数声明和请求映射，但未以真实推理测量不同档位的效果。** 安装后仍需重启 DSH 加载新版 Host/客户端模块。

开发目录可执行：

    npm run test:ui

使用 Node.js 22+；可通过 CHROME_PATH 指定 Chrome/Chromium。脚本使用独立临时浏览器 profile，保存 verification/ui-0.3.0-*.png 及无凭据报告，并清理临时 profile。

## 模型目录

开启 autoModels 时调用 getAvailableModels，使用账号返回的名称和内部 ID，过滤 isDisabled 条目。缓存 5 分钟；失败时显示标记为离线的快照，30 秒后允许重试。模型元数据请求不是 AI 对话，但仍使用登录态。

离线快照来自本次认证接口返回的 36 个未禁用条目，包含 GPT-6.1 Sol、GPT-6 Luna、Sonnet 5.5、Opus 5.5、DeepSeek V4.1 Flash 等。**这不是 36 个模型均通过实测的声明**；具体可用性、权限和计费以上游为准。

旧的 claude-sonnet4.6、claude-opus4.6、gemini-3.1pro、gpt-5.2、gpt-5.4 本地 ID 保留。旧五模型配置不会遮住新目录；手工别名合并，自定义未知映射标记为手动配置，禁用项不会由旧配置重新引入。别名冲突报错，不静默调用另一模型。

关闭 autoModels 后只使用手工 models 数组。不要根据食物代号猜模型身份。例如：

    [{"id":"my-sol","name":"My Sol","upstreamModel":"omniberry-sundae","threadType":"workflow"}]

threadType 留空默认 workflow。markdown-chat 仅作为显式兼容选项保留；旧的按模型家族自动路由规则已取消，因为真实对比中旧路由返回空流。

## 0.2.0 修复

- 以 patch-start.data 初始化服务端状态；它与请求中的 config/context/历史 transcript 不是同一数组，不能共用初始索引。
- 支持 a/p/x/r，正确处理删除后的数组移动及隐藏历史边界；非法索引仍拒绝，并只报告脱敏路径、类型和长度。
- 支持路径别名、JSON Pointer、空文本初始化、跨帧 lang 标签；排除显式思考、工具/检索、标题和内部状态段落。
- 最终文本优先级 markdown-chat > text > agent-inference，不把工具结果伪装成原生工具调用，不输出隐藏思考。
- 非前缀重写已输出正文时明确失败，不重复追加伪造结果。取消、截断、协议错误不会生成成功 finish。
- JSON 元数据请求的取消和超时覆盖响应体读取，限制大小，禁止重定向，不自动重试推理。
- 修正设置默认值、身份缓存隔离、多工作区选择和旧域名/Cookie 提示。

## 完成检测

| 模式 | 判定 |
|---|---|
| stream-end（默认） | 数据流正常结束且有可见正文 |
| final-record | 额外要求最终记录或完整顶层 markdown-chat 段落 |
| verified-marker | 额外匹配本人确认的结束帧/路径/值 |

空流不是成功；失败不会伪造用量或完成事件。

## 本地诊断与隐私

captureDir 留空不记录。启用后保存请求体和响应帧，过滤认证头、递归遮盖敏感字段和已知登录凭据；使用唯一文件名及大小限制。保存失败不破坏生成结果。

**文件仍可能包含完整对话、工作区 ID、检索资料或其他隐私，不保证自动识别所有敏感文字。不要直接上传或贴进聊天。** 诊断后清空设置并删除不再需要的文件。插件抓包仅记录插件自己的请求，不能捕获网页模型选择器；模型发现由 getAvailableModels 单独完成。

## 自检与边界

    npm run check
    npm test
    npm run build

离线测试覆盖真实响应脱敏回放、协议安全边界、模型发现/缓存、身份歧义、取消超时、抓包和设置页。smoke 脚本默认拒绝联网，只有显式设置 NOTION_ALLOW_LIVE_TEST=1 才消耗真实配额。

0.2.0 修复阶段获授权的真实请求验证了 GPT-6.1 Sol、Sonnet 5.5 及两条兼容路由；并非所有模型均已验证，也不保证未来网页 API 不变。

仅支持文本输入；不支持图像/文件/语音、账号池或服务端记忆。不续期 Cookie、不删除 Notion 会话，不绕过验证码、访问限制或付费权限。推理可能创建 Notion 会话并消耗订阅额度或积分，请确认组织数据政策和 Notion 条款。

## 界面预览

以下截图使用合成配置与合成额度数值，不含真实 Cookie、工作区或额度信息，也不是 AI 连通性证明。

- [设置页 · 浅色](verification/ui-0.4.0-settings-light.png)
- [设置页 · 深色](verification/ui-0.4.0-settings-dark.png)
- [设置页 · 390px 窄屏](verification/ui-0.4.0-settings-mobile.png)
- [输入框额度 · 6 小时（浅色）](verification/ui-0.4.0-quota-light.png)
- [输入框额度 · 深色](verification/ui-0.4.0-quota-dark.png)
- [输入框额度 · 390px 窄屏](verification/ui-0.4.0-quota-mobile.png)
