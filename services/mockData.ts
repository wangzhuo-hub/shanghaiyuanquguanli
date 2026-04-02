
import { DashboardData, ContractStatus, UnitStatus, DepositStatus, Building, Tenant, PaymentRecord, MonthlyTrend, Unit } from '../types';

// Helper to generate units with specific configuration
const generateCustomUnits = (buildingPrefix: string, floorsConfig: { floor: number, type: 'whole' | 'multi', count?: number }[]): Unit[] => {
  const units: Unit[] = [];
  
  floorsConfig.forEach(config => {
    if (config.type === 'whole') {
        // Whole floor rental - Single large unit
        // Simply named "1F", "2F" etc.
        units.push({
            id: `${buildingPrefix}-${config.floor}01`,
            name: `${config.floor}F`, 
            area: 1200, // Large area for whole floor
            status: UnitStatus.Vacant,
            floor: config.floor,
        });
    } else {
        // Multi-tenant floor
        const count = config.count || 6;
        for (let u = 1; u <= count; u++) {
            const unitNum = `${config.floor}${u.toString().padStart(2, '0')}`;
            // Random area variation
            const baseArea = 80;
            const randomFactor = Math.random();
            let area = baseArea;
            
            if (randomFactor > 0.8) area = 350; // Large
            else if (randomFactor > 0.5) area = 180; // Medium
            else area = 90 + Math.floor(Math.random() * 40); // Small

            units.push({
                id: `${buildingPrefix}-${unitNum}`,
                name: unitNum,
                area: area, 
                status: UnitStatus.Vacant,
                floor: config.floor,
            });
        }
    }
  });

  return units;
};

// 标准化交付：不内置任何初始化经营数据（由用户在「系统设置→初始化数据」中手动录入）
const getFixedInitData = (): any[] => [];

export const generateInitialData = (): DashboardData => {
  // 标准化交付：不再在前端硬编码任何示例房源/楼宇数据
  const buildings: Building[] = [];

  // 2. Mock Tenants with Basic Info
  // Generate some tenants for demo purposes if empty
  const tenants: Tenant[] = [];

  // 3. Clear Payments
  const payments: PaymentRecord[] = [];

  return {
    buildings,
    tenants,
    payments,
    totalArea: 0, 
    leasedArea: 0, 
    occupancyRate: 0,
    annualRevenueTarget: 0,
    annualRevenueCollected: 0,
    annualOccupancyTarget: 0,
    monthlyRevenueTarget: 0,
    monthlyRevenueCollected: 0,
    collectionRate: 0,
    accumulatedArrears: 0,
    newContractsCount: 0,
    newContractsArea: 0,
    terminatedContractsCount: 0,
    terminatedContractsArea: 0,
    netIncreaseArea: 0,
    expiringSoonCount: 0,
    recentSignings: [],
    expiringSoon: [],
    monthlyTrends: [],
    currentMonthBilling: [],
    parkingStats: {
        totalContractSpaces: 0,
        totalActualSpaces: 0,
        totalMonthlyRevenue: 0,
        details: []
    },
    budgetAssumptions: [],
    budgetAdjustments: [],
    billingPeriodNotes: {},
    budgetAnalysis: {
        occupancy: '',
        revenue: ''
    },
    budgetScenarios: [],
    yearlyTargets: {},
    initializationData: getFixedInitData(),
    invoices: []
  };
};
