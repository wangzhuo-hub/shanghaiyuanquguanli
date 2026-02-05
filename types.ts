
export enum ResistanceType {
  PRICE = '价格',
  LOCATION = '地段',
  PRODUCT = '产品',
  FACILITIES = '配套',
  NONE = '无'
}

export enum OpportunityStage {
  LEAD = '线索',
  VISIT = '带看',
  NEGOTIATION = '谈判',
  CONTRACT = '签约',
  CLOSED_LOST = '流失'
}

export enum OpportunityIntent {
  HIGH = '高意向',
  MEDIUM = '一般意向',
  LOW = '不确定'
}

export enum OpportunitySource {
  CHANNEL = '渠道推荐',
  SELF_HUNT = '自拓',
  REFERRAL = '园区客户转介绍',
  VISIT = '线下主动拜访',
  SOCIAL_MEDIA = '线上自媒体渠道',
  OTHER = '其他'
}

export enum CommissionStatus {
  PENDING = '待确认',
  TRIGGERED = '已触发',
  APPROVING = '审批中',
  PAYABLE = '待打款',
  PAID = '已结清'
}

export enum AgentTier {
  GOLD = '金牌',
  POTENTIAL = '潜力',
  INEFFICIENT = '低效'
}

export enum ActivityType {
  VISIT = '带看',
  CALL = '电访',
  QUOTATION = '报价',
  NEGOTIATION = '谈判',
  SIGNING = '签约'
}

export enum UnitStatus {
  VACANT = '待租',
  OCCUPIED = '已租',
  RESERVED = '预留',
  SELF_USE = '自用'
}

export enum UserRole {
  ADMIN = '管理员',
  USER = '一般账户'
}

export interface User {
  id: string;
  username: string;
  password?: string;
  name: string;
  role: UserRole;
  annualTargetArea?: number;
  monthlyTargetArea?: number;
  annualTargetVisits?: number;
}

export interface Unit {
  id: string;
  building: string;
  floor: number;
  roomNo: string;
  area: number;
  status: UnitStatus;
  tenantName?: string;
  price?: number;
  vacantSince?: string;
}

export interface Agent {
  id: string;
  name: string;
  phone: string;
  title?: string;
  company?: string;
  tier?: AgentTier;
  commissionRate?: number;
  totalDealsArea?: number;
  totalCommissionAmt?: number;
  totalVisits?: number;
}

export interface Channel {
  id: string;
  creatorId?: string;
  sharedWithIds?: string[];
  companyName: string;
  tier: AgentTier;
  baseCommissionRate: number;
  description?: string;
  agents: Agent[];
  totalDealsArea: number;
  totalCommissionAmt: number;
}

export interface PayoutInstallment {
  id: string;
  percentage: number; // 0-100
  triggerMonth: number; // 延后月数，0表示签约当月
  label: string; // 节点名称，如“签约后首笔”、“入驻后尾款”
}

export interface CommissionRule {
  id: string;
  minArea: number;
  maxArea: number;
  rate: number;
  label: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  payoutType: 'ONETIME' | 'STAGED';
  installments: PayoutInstallment[];
}

export interface PolicyChangeLog {
  id: string;
  timestamp: string;
  ruleId: string;
  ruleLabel: string;
  changeType: 'CREATE' | 'UPDATE' | 'EXTEND' | 'DELETE';
  description: string;
  previousValue?: string;
  newValue?: string;
}

export interface RentFreePeriod {
  id: string;
  startDate: string;
  endDate: string;
}

export interface DealParameters {
  unitIds: string[];
  buildingName: string;
  finalArea: number;
  signDate: string;
  leaseStartDate: string;
  leaseEndDate: string;
  finalPrice: number;
  monthlyRent: number;
  paymentCycleMonths: number;
  firstPaymentCount: number;
  firstPaymentDate: string;
  isRentFreeDeferred: boolean;
  rentFreePeriods: RentFreePeriod[];
  depositAmount: string;
  depositStatus: string;
  remarks: string;
  isHighRisk?: boolean;
  industry?: string;
  establishedDate?: string;
  legalRepresentative?: string;
  mainContact?: string;
}

export interface DealLog {
  id: string;
  timestamp: string;
  operator: string;
  changeDescription: string;
}

export interface Opportunity {
  id: string;
  creatorId: string;
  companyName: string;
  industry: string;
  requiredArea: number;
  budget: number;
  moveInDate: string;
  source: OpportunitySource;
  intent: OpportunityIntent;
  channelId?: string;
  agentId?: string;
  agentName?: string; 
  agentPhone?: string;
  leasingManager: string;
  targetUnitId?: string;
  relatedUnitIds?: string[]; // 新增：关联房源ID列表
  isExported?: boolean;
  stage: OpportunityStage;
  dealParams?: DealParameters;
  dealLogs?: DealLog[];
  lossReason?: string;
  lossDate?: string;
  tags: string[];
  lastVisitDate?: string;
  createdAt: string;
  isPinned?: boolean;
}

export interface Activity {
  id: string;
  opportunityId: string;
  creatorId: string;
  date: string;
  type: ActivityType;
  hostName: string;
  description: string;
  tags?: string[];
  visitedUnitIds?: string[]; // 新增：带看的房源ID列表
  customerConcerns?: string[]; // 新增：客户关注点（提取的关键词）
}

export interface Commission {
  id: string;
  contractId: string;
  roomNumber: string;
  signDate: string;
  plannedPayoutDate: string;
  channelId: string;
  amount: number;
  area: number;
  status: CommissionStatus;
  rateUsed: number;
  installmentLabel: string; // 标识分期，如 "1/2" 或 "一次性"
  invoiceDate?: string;
  paymentDate?: string;
  paymentProofUploaded: boolean;
}

export interface AppData {
  opportunities: Opportunity[];
  channels: Channel[];
  commissions: Commission[];
  units: Unit[];
  commissionRules: CommissionRule[];
  policyHistory: PolicyChangeLog[];
  activities: Activity[];
  users: User[];
  settings: {
    annualTargetArea: number;
  };
  deletedIds?: string[]; // 核心修复：追踪已删除ID
}

export interface CloudSnapshot {
  id: string;
  name: string;
  createdAt: string;
  data: AppData;
}

// 房源热度统计
export interface UnitHeatStats {
  unitId: string;
  building: string;
  roomNo: string;
  area: number;
  opportunityCount: number; // 累积商机数
  visitCount: number; // 累积带看次数
  topConcerns: Array<{ keyword: string; count: number }>; // 客户关注点排行
  lastVisitDate?: string; // 最近带看日期
}
