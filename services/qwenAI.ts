import { AppData, OpportunityStage, ActivityType, UnitStatus, OpportunitySource } from '../types';

const QWEN_API_KEY = 'sk-sp-1b86ef09510e4e1683454766f375ad1b';
// 使用Vite代理路径解减CORS问题
// 开发环境：检测端口是否为Vite开发服务器端口（3000-3010）
const port = window.location.port;
const isDev = port !== '' && parseInt(port) >= 3000 && parseInt(port) <= 3010;
const QWEN_BASE_URL = isDev ? '/api/qwen' : 'https://coding.dashscope.aliyuncs.com/v1';
const QWEN_MODEL = 'qwen3-max-2026-01-23';

interface QwenMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 调用千问AI API
 */
export const callQwenAPI = async (messages: QwenMessage[]): Promise<string> => {
  try {
    console.log('=== 开始调用千问API ===');
    console.log('当前环境:', {
      hostname: window.location.hostname,
      port: window.location.port,
      isDev,
      baseUrl: QWEN_BASE_URL
    });
    console.log('请求URL:', `${QWEN_BASE_URL}/chat/completions`);
    console.log('消息数量:', messages.length);
    
    const response = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QWEN_API_KEY}`
      },
      body: JSON.stringify({
        model: QWEN_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 4000
      }),
      mode: 'cors' as RequestMode
    });

    console.log('API响应状态:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API错误响应:', errorText);
      throw new Error(`API请求失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('API响应成功');
    return data.choices[0]?.message?.content || '无响应';
  } catch (error: any) {
    console.error('千问API调用失败:', error);
    console.error('错误详情:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    // 更友好的错误提示
    if (error.message.includes('Failed to fetch') || error.message.includes('Load failed')) {
      throw new Error('网络连接失败，请检查：\n1. 网络连接是否正常\n2. API Key是否正确\n3. 是否存在CORS跨域问题');
    }
    
    throw new Error(`AI分析失败: ${error.message}`);
  }
};

/**
 * 生成数据分析提示词
 */
const generateDataSummary = (data: AppData): string => {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  
  // 商机统计
  const totalOpps = data.opportunities?.length || 0;
  const activeOpps = data.opportunities?.filter(o => o.stage !== OpportunityStage.CLOSED_LOST && o.stage !== OpportunityStage.CONTRACT).length || 0;
  const wonOpps = data.opportunities?.filter(o => o.stage === OpportunityStage.CONTRACT).length || 0;
  const lostOpps = data.opportunities?.filter(o => o.stage === OpportunityStage.CLOSED_LOST).length || 0;
  
  // 本月数据
  const thisMonthOpps = data.opportunities?.filter(o => {
    const date = new Date(o.createdAt);
    return date.getFullYear() === currentYear && date.getMonth() + 1 === currentMonth;
  }).length || 0;
  
  // 带看统计
  const totalVisits = data.activities?.filter(a => a.type === ActivityType.VISIT).length || 0;
  const thisMonthVisits = data.activities?.filter(a => {
    const date = new Date(a.date);
    return a.type === ActivityType.VISIT && date.getFullYear() === currentYear && date.getMonth() + 1 === currentMonth;
  }).length || 0;
  
  // 成交面积
  const totalArea = data.opportunities?.filter(o => o.stage === OpportunityStage.CONTRACT && o.dealParams)
    .reduce((sum, o) => sum + (o.dealParams?.finalArea || 0), 0) || 0;
  
  // 渠道统计
  const totalChannels = data.channels?.length || 0;
  const channelOpps = data.opportunities?.filter(o => o.source === OpportunitySource.CHANNEL).length || 0;
  
  // 房源统计
  const totalUnits = data.units?.length || 0;
  const vacantUnits = data.units?.filter(u => u.status === UnitStatus.VACANT).length || 0;
  const occupiedUnits = data.units?.filter(u => u.status === UnitStatus.OCCUPIED).length || 0;
  
  return `
# 上海商机及渠道管理系统 - 数据概览

## 商机数据
- 累计商机总数: ${totalOpps}
- 活跃商机数: ${activeOpps}
- 成交商机数: ${wonOpps}
- 流失商机数: ${lostOpps}
- 本月新增商机: ${thisMonthOpps}
- 成交转化率: ${totalOpps > 0 ? ((wonOpps / totalOpps) * 100).toFixed(1) : 0}%

## 客户带看
- 累计带看次数: ${totalVisits}
- 本月带看次数: ${thisMonthVisits}
- 平均每商机带看次数: ${totalOpps > 0 ? (totalVisits / totalOpps).toFixed(1) : 0}

## 成交业绩
- 累计成交面积: ${totalArea.toFixed(0)} m²
- 年度目标: ${data.settings?.annualTargetArea || 30000} m²
- 目标完成率: ${((totalArea / (data.settings?.annualTargetArea || 30000)) * 100).toFixed(1)}%

## 渠道合作
- 合作渠道商数量: ${totalChannels}
- 渠道推荐商机数: ${channelOpps}
- 渠道商机占比: ${totalOpps > 0 ? ((channelOpps / totalOpps) * 100).toFixed(1) : 0}%

## 房源销控
- 房源总数: ${totalUnits}
- 待租房源: ${vacantUnits}
- 已租房源: ${occupiedUnits}
- 出租率: ${totalUnits > 0 ? ((occupiedUnits / totalUnits) * 100).toFixed(1) : 0}%

当前时间: ${currentYear}年${currentMonth}月
`;
};

/**
 * 生成周报
 */
export const generateWeeklyReport = async (data: AppData): Promise<string> => {
  const dataSummary = generateDataSummary(data);
  
  const messages: QwenMessage[] = [
    {
      role: 'system',
      content: '你是一个专业的招商数据分析专家。请基于提供的数据，生成一份详细的周报。周报应包含：核心数据摘要、本周亮点、待改进项、下周工作建议。使用HTML格式输出，包含标题、表格、列表等元素，样式要专业美观。'
    },
    {
      role: 'user',
      content: `请根据以下数据生成本周招商工作周报：\n\n${dataSummary}`
    }
  ];
  
  return await callQwenAPI(messages);
};

/**
 * 生成月度报告
 */
export const generateMonthlyReport = async (data: AppData): Promise<string> => {
  const dataSummary = generateDataSummary(data);
  
  const messages: QwenMessage[] = [
    {
      role: 'system',
      content: '你是一个专业的招商数据分析专家。请基于提供的数据，生成一份详细的月度报告。报告应包含：月度核心指标、同比环比分析、商机漏斗分析、渠道效能评估、房源销控情况、下月策略建议。使用HTML格式输出，包含图表建议、数据表格等，样式要专业正式。'
    },
    {
      role: 'user',
      content: `请根据以下数据生成本月招商工作月度报告：\n\n${dataSummary}`
    }
  ];
  
  return await callQwenAPI(messages);
};

/**
 * 生成季度报告
 */
export const generateQuarterlyReport = async (data: AppData): Promise<string> => {
  const dataSummary = generateDataSummary(data);
  
  const messages: QwenMessage[] = [
    {
      role: 'system',
      content: '你是一个专业的招商数据分析专家。请基于提供的数据，生成一份详细的季度报告。报告应包含：季度核心业绩、目标达成分析、商机转化漏斗、渠道合作成效、市场趋势洞察、下季度战略规划。使用HTML格式输出，包含执行摘要、详细数据分析、可视化建议等，样式要高管级别。'
    },
    {
      role: 'user',
      content: `请根据以下数据生成本季度招商工作季度报告：\n\n${dataSummary}`
    }
  ];
  
  return await callQwenAPI(messages);
};

/**
 * 生成年度报告
 */
export const generateAnnualReport = async (data: AppData): Promise<string> => {
  const dataSummary = generateDataSummary(data);
  
  const messages: QwenMessage[] = [
    {
      role: 'system',
      content: '你是一个专业的招商数据分析专家。请基于提供的数据，生成一份详细的年度报告。报告应包含：年度业绩总结、目标完成情况、全年商机分析、渠道合作复盘、房源运营回顾、市场竞争分析、明年战略规划。使用HTML格式输出，包含完整的执行摘要、详细分析章节、数据可视化建议、战略建议等，样式要董事会级别。'
    },
    {
      role: 'user',
      content: `请根据以下数据生成年度招商工作总结报告：\n\n${dataSummary}`
    }
  ];
  
  return await callQwenAPI(messages);
};

/**
 * 自定义AI对话
 */
export const chatWithAI = async (userMessage: string, data: AppData): Promise<string> => {
  const dataSummary = generateDataSummary(data);
  
  const messages: QwenMessage[] = [
    {
      role: 'system',
      content: `你是上海商机及渠道管理系统的AI智能助手。你可以帮助用户：
1. 分析招商区域数据
2. 评估商机质量和转化情况
3. 分析渠道合作效能
4. 提供业务改进建议

当前系统数据概览：
${dataSummary}

请基于这些数据回答用户问题，提供专业的分析和建议。`
    },
    {
      role: 'user',
      content: userMessage
    }
  ];
  
  return await callQwenAPI(messages);
};
