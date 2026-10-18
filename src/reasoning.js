export const EFFORT_LABELS = Object.freeze({none:'关闭',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高'});
export function normalizeEfforts(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(value=>typeof value==='string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value)))];
}
export function reasoningConfiguration(configuration) {
  const supportedReasoningEfforts=normalizeEfforts(configuration?.supportedReasoningEfforts);
  const defaultReasoningEffort=supportedReasoningEfforts.includes(configuration?.defaultReasoningEffort) ? configuration.defaultReasoningEffort : undefined;
  return {supportedReasoningEfforts,...(defaultReasoningEffort ? {defaultReasoningEffort} : {})};
}
export function reasoningInfo(model, preferredDefault) {
  if(model.threadType && model.threadType !== 'workflow') return undefined;
  const levels=normalizeEfforts(model.supportedReasoningEfforts);
  if(!levels.length) return undefined;
  const selected=model.reasoningEffort || preferredDefault;
  return {efforts:levels.map(id=>({id,name:Object.hasOwn(EFFORT_LABELS,id) ? EFFORT_LABELS[id] : id})),...(levels.includes(selected) ? {defaultEffort:selected} : {})};
}
