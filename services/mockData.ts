
import { Activity, ActivityType, Channel, AgentTier, Commission, CommissionStatus, Opportunity, OpportunityIntent, OpportunitySource, OpportunityStage, Unit, UnitStatus, CommissionRule, User, UserRole } from '../types';

export const MOCK_USERS: User[] = [
  { id: 'U-ADMIN', username: 'admin', password: '123', name: '系统管理员', role: UserRole.ADMIN },
  { id: 'U-USER1', username: 'user1', password: '123', name: '招商经理A', role: UserRole.USER },
  { id: 'U-USER2', username: 'user2', password: '123', name: '招商经理B', role: UserRole.USER }
];

export const MOCK_UNITS: Unit[] = [
  { id: 'U1-403', building: '1号楼', floor: 4, roomNo: '403', area: 360.76, status: UnitStatus.OCCUPIED, tenantName: '上海脉科医疗科技有限公司' },
  { id: 'U1-406', building: '1号楼', floor: 4, roomNo: '406', area: 101.8, status: UnitStatus.VACANT, price: 4.5, vacantSince: '2024-06-15' },
  { id: 'U1-407', building: '1号楼', floor: 4, roomNo: '407-409', area: 507.45, status: UnitStatus.OCCUPIED, tenantName: '上海游牛信息科技有限公司' },
  { id: 'U2-401', building: '2号楼', floor: 4, roomNo: '401', area: 582.25, status: UnitStatus.OCCUPIED, tenantName: '上海列拓科技有限公司' },
  { id: 'U2-402', building: '2号楼', floor: 4, roomNo: '402', area: 245.5, status: UnitStatus.VACANT, price: 4.2, vacantSince: '2024-03-10' },
  { id: 'U3-101', building: '3号楼', floor: 1, roomNo: '101', area: 890.0, status: UnitStatus.VACANT, price: 5.5, vacantSince: '2023-12-01' },
];

export const MOCK_CHANNELS: Channel[] = [
  {
    id: 'CH-001',
    companyName: '仲量联行 (JLL)',
    tier: AgentTier.GOLD,
    baseCommissionRate: 1.0,
    description: '全球五大行之一，合作深入。',
    agents: [
      { id: 'A-001', name: '王小云', phone: '13811112222', title: '资深顾问' },
      { id: 'A-002', name: '李大壮', phone: '13933334444', title: '高级经理' }
    ],
    totalDealsArea: 1500,
    totalCommissionAmt: 450000,
    sharedWithIds: []
  },
  {
    id: 'CH-002',
    companyName: '世邦魏理仕 (CBRE)',
    tier: AgentTier.POTENTIAL,
    baseCommissionRate: 1.0,
    description: '近期开始有带看。',
    agents: [
      { id: 'A-003', name: '张强', phone: '13566667777', title: '招商顾问' }
    ],
    totalDealsArea: 500,
    totalCommissionAmt: 120000,
    sharedWithIds: []
  }
];

export const MOCK_COMMISSION_RULES: CommissionRule[] = [
  { id: 'R1', minArea: 0, maxArea: 300, rate: 1.0, label: '标准面积段', startDate: '2024-01-01', endDate: '2025-12-31', isActive: true, payoutType: 'ONETIME', installments: [] },
  { 
    id: 'R2', minArea: 300, maxArea: 800, rate: 1.2, label: '大面积激励 (分期)', startDate: '2024-01-01', endDate: '2025-12-31', isActive: true, 
    payoutType: 'STAGED', 
    installments: [
      { id: 'inst1', percentage: 50, triggerMonth: 0, label: '签约即付' },
      { id: 'inst2', percentage: 50, triggerMonth: 6, label: '入驻满半年' }
    ] 
  },
  { id: 'R3', minArea: 800, maxArea: 99999, rate: 1.5, label: '大户直通车', startDate: '2024-01-01', endDate: '2025-12-31', isActive: true, payoutType: 'ONETIME', installments: [] },
  { id: 'R4', minArea: 0, maxArea: 99999, rate: 1.5, label: '年终冲刺特惠', startDate: '2025-11-01', endDate: '2025-12-31', isActive: true, payoutType: 'ONETIME', installments: [] }
];

export const MOCK_OPPORTUNITIES: Opportunity[] = [];
export const MOCK_ACTIVITIES: Activity[] = [];
export const MOCK_COMMISSIONS: Commission[] = [];

export const calculateYearTotal = (opps: Opportunity[], year: number) => {
    return opps
        .filter(o => o.stage === OpportunityStage.CONTRACT && o.dealParams && new Date(o.dealParams.signDate).getFullYear() === year)
        .reduce((sum, o) => sum + (o.dealParams?.finalArea || 0), 0);
};

export const isCommissionOverdue = (invoiceDate?: string): boolean => {
  if (!invoiceDate) return false;
  const today = new Date().getTime(); 
  const invoice = new Date(invoiceDate).getTime();
  const diffTime = today - invoice;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
  return diffDays > 15;
};
