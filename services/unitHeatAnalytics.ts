import { Opportunity, Activity, Unit, UnitStatus, UnitHeatStats } from '../types';

/**
 * 客户关注点关键词词库
 */
const CONCERN_KEYWORDS = [
  '价格', '租金', '费用', '成本', '便宜', '贵', '优惠',
  '位置', '地段', '交通', '地铁', '公交', '停车',
  '环境', '采光', '通风', '安静', '噪音', '装修', '设施',
  '面积', '大小', '空间', '布局', '格局',
  '楼层', '高', '低',
  '配套', '周边', '餐饮', '商场', '银行',
  '合同', '签约', '租期', '付款', '押金',
  '物业', '管理', '服务', '维修',
  '网络', '宽带', '空调', '电梯'
];

/**
 * 从带看描述中提取客户关注点关键词
 */
export const extractConcerns = (description: string): string[] => {
  const concerns: string[] = [];
  const lowerDesc = description.toLowerCase();
  
  CONCERN_KEYWORDS.forEach(keyword => {
    if (description.includes(keyword) || lowerDesc.includes(keyword.toLowerCase())) {
      concerns.push(keyword);
    }
  });
  
  return [...new Set(concerns)]; // 去重
};

/**
 * 计算房源热度统计
 */
export const calculateUnitHeatStats = (
  units: Unit[],
  opportunities: Opportunity[],
  activities: Activity[]
): UnitHeatStats[] => {
  const stats: Map<string, UnitHeatStats> = new Map();
  
  // 收集所有被商机关联的房源ID（包括待租和已租）
  const relatedUnitIds = new Set<string>();
  opportunities.forEach(opp => {
    if (opp.relatedUnitIds) {
      opp.relatedUnitIds.forEach(id => relatedUnitIds.add(id));
    }
    if (opp.targetUnitId) {
      relatedUnitIds.add(opp.targetUnitId);
    }
  });
  
  // 初始化所有被关联房源的统计（不论状态）
  units.forEach(unit => {
    if (relatedUnitIds.has(unit.id)) {
      stats.set(unit.id, {
        unitId: unit.id,
        building: unit.building,
        roomNo: unit.roomNo,
        area: unit.area,
        opportunityCount: 0,
        visitCount: 0,
        topConcerns: [],
        lastVisitDate: undefined
      });
    }
  });
  
  // 统计商机关联
  opportunities.forEach(opp => {
    // 统计 relatedUnitIds
    if (opp.relatedUnitIds && opp.relatedUnitIds.length > 0) {
      opp.relatedUnitIds.forEach(unitId => {
        const stat = stats.get(unitId);
        if (stat) {
          stat.opportunityCount++;
        }
      });
    }
    
    // 兼容旧数据：统计 targetUnitId
    if (opp.targetUnitId && stats.has(opp.targetUnitId)) {
      const stat = stats.get(opp.targetUnitId)!;
      stat.opportunityCount++;
    }
  });
  
  // 统计带看活动和关注点
  const concernsMap: Map<string, Map<string, number>> = new Map(); // unitId -> {keyword -> count}
  
  activities.forEach(activity => {
    if (activity.type === '带看') {
      // 获取该商机关联的房源
      const opp = opportunities.find(o => o.id === activity.opportunityId);
      if (!opp) return;
      
      const relatedUnits = [...(opp.relatedUnitIds || []), opp.targetUnitId].filter(Boolean) as string[];
      
      // 如果活动有具体的visitedUnitIds，使用它；否则使用商机的关联房源
      const visitedUnits = activity.visitedUnitIds && activity.visitedUnitIds.length > 0
        ? activity.visitedUnitIds
        : relatedUnits;
      
      visitedUnits.forEach(unitId => {
        const stat = stats.get(unitId);
        if (stat) {
          // 增加带看次数
          stat.visitCount++;
          
          // 更新最近带看日期
          if (!stat.lastVisitDate || activity.date > stat.lastVisitDate) {
            stat.lastVisitDate = activity.date;
          }
          
          // 提取客户关注点
          const concerns = activity.customerConcerns || extractConcerns(activity.description);
          
          if (!concernsMap.has(unitId)) {
            concernsMap.set(unitId, new Map());
          }
          const unitConcerns = concernsMap.get(unitId)!;
          
          concerns.forEach(keyword => {
            unitConcerns.set(keyword, (unitConcerns.get(keyword) || 0) + 1);
          });
        }
      });
    }
  });
  
  // 整理关注点排行
  concernsMap.forEach((concerns, unitId) => {
    const stat = stats.get(unitId);
    if (stat) {
      stat.topConcerns = Array.from(concerns.entries())
        .map(([keyword, count]) => ({ keyword, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5); // 只保留前5个关注点
    }
  });
  
  // 转换为数组并按热度排序（商机数 + 带看次数）
  return Array.from(stats.values())
    .filter(s => s.opportunityCount > 0 || s.visitCount > 0) // 只返回有数据的房源
    .sort((a, b) => {
      const heatA = a.opportunityCount * 2 + a.visitCount; // 商机权重更高
      const heatB = b.opportunityCount * 2 + b.visitCount;
      return heatB - heatA;
    });
};

/**
 * 获取房源的详细热度信息
 */
export const getUnitHeatDetails = (
  unitId: string,
  opportunities: Opportunity[],
  activities: Activity[]
): {
  relatedOpportunities: Opportunity[];
  visitActivities: Activity[];
  totalVisits: number;
  concernsSummary: Array<{ keyword: string; count: number }>;
} => {
  // 找到关联的商机
  const relatedOpportunities = opportunities.filter(opp =>
    (opp.relatedUnitIds && opp.relatedUnitIds.includes(unitId)) ||
    opp.targetUnitId === unitId
  );
  
  const oppIds = new Set(relatedOpportunities.map(o => o.id));
  
  // 找到相关的带看活动
  const visitActivities = activities.filter(act =>
    act.type === '带看' &&
    oppIds.has(act.opportunityId) &&
    ((act.visitedUnitIds && act.visitedUnitIds.includes(unitId)) || 
     relatedOpportunities.find(o => o.id === act.opportunityId)?.targetUnitId === unitId)
  );
  
  // 统计关注点
  const concernsCount = new Map<string, number>();
  visitActivities.forEach(act => {
    const concerns = act.customerConcerns || extractConcerns(act.description);
    concerns.forEach(keyword => {
      concernsCount.set(keyword, (concernsCount.get(keyword) || 0) + 1);
    });
  });
  
  const concernsSummary = Array.from(concernsCount.entries())
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count);
  
  return {
    relatedOpportunities,
    visitActivities,
    totalVisits: visitActivities.length,
    concernsSummary
  };
};
