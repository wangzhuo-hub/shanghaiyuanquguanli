import fs from 'node:fs/promises';
import path from 'node:path';
import { RESOURCES_DIR } from './config.js';

export interface RuleResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  filename: string;
}

const RULE_FILES: RuleResource[] = [
  {
    uri: 'park://rules/data',
    name: '招商看板数据读写规则',
    description: '楼宇/单元/租户/收款等字段约束与写入铁律（无密钥）',
    mimeType: 'text/markdown',
    filename: 'park-data-rules.md',
  },
  {
    uri: 'park://rules/overview',
    name: '园区助手使用守则',
    description: '园区隔离、读写谨慎、用户交互规范摘要',
    mimeType: 'text/markdown',
    filename: 'park-agent-overview.md',
  },
  {
    uri: 'park://rules/facility',
    name: '设备设施报修规范',
    description: '报修工单字段、优先级与状态机（无 SSH 密钥）',
    mimeType: 'text/markdown',
    filename: 'facility-repair-rules.md',
  },
  {
    uri: 'park://rules/property',
    name: '物业水电系统说明',
    description: '水电费/物业费集合与访问说明（无 SSH 密钥）',
    mimeType: 'text/markdown',
    filename: 'property-system-rules.md',
  },
];

export function listRuleResources(): RuleResource[] {
  return RULE_FILES;
}

export async function readRuleResource(uri: string): Promise<{ text: string; mimeType: string }> {
  const meta = RULE_FILES.find((r) => r.uri === uri);
  if (!meta) throw new Error(`未知资源: ${uri}`);
  const filePath = path.join(RESOURCES_DIR, meta.filename);
  const text = await fs.readFile(filePath, 'utf8');
  return { text, mimeType: meta.mimeType };
}
