
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

// Embedded Initialization Data based on user provided screenshots for 2024 and 2025
const getFixedInitData = () => {
    const data2024 = [
        { year: 2024, month: 1, revenueTarget: 783100, revenueCollected: 100196.33, occupancyRate: 74 },
        { year: 2024, month: 2, revenueTarget: 1547400, revenueCollected: 1996872.12, occupancyRate: 74 },
        { year: 2024, month: 3, revenueTarget: 2335700, revenueCollected: 2426679.67, occupancyRate: 84.77 },
        { year: 2024, month: 4, revenueTarget: 786800, revenueCollected: 1023807.57, occupancyRate: 84.58 },
        { year: 2024, month: 5, revenueTarget: 1894900, revenueCollected: 2227501.98, occupancyRate: 84.4 },
        { year: 2024, month: 6, revenueTarget: 1871800, revenueCollected: 843058.66, occupancyRate: 84.58 },
        { year: 2024, month: 7, revenueTarget: 1517000, revenueCollected: 2338144.19, occupancyRate: 80.21 },
        { year: 2024, month: 8, revenueTarget: 1827900, revenueCollected: 2006831.3, occupancyRate: 80.21 },
        { year: 2024, month: 9, revenueTarget: 1614600, revenueCollected: 2121112.81, occupancyRate: 84.58 },
        { year: 2024, month: 10, revenueTarget: 1063300, revenueCollected: 963348.33, occupancyRate: 62.39 },
        { year: 2024, month: 11, revenueTarget: 1116300, revenueCollected: 1682132.33, occupancyRate: 66.39 },
        { year: 2024, month: 12, revenueTarget: 243.05, revenueCollected: 2606769.2, occupancyRate: 66.39 },
    ];

    const data2025 = [
        { year: 2025, month: 1, revenueTarget: 901600, revenueCollected: 869498.53, occupancyRate: 84 },
        { year: 2025, month: 2, revenueTarget: 1300300, revenueCollected: 756792.98, occupancyRate: 91.65 },
        { year: 2025, month: 3, revenueTarget: 1435100, revenueCollected: 1508449.36, occupancyRate: 79.81 },
        { year: 2025, month: 4, revenueTarget: 267600, revenueCollected: 1472255.98, occupancyRate: 79.81 },
        { year: 2025, month: 5, revenueTarget: 1033500, revenueCollected: 31481.25, occupancyRate: 68.72 },
        { year: 2025, month: 6, revenueTarget: 1986300, revenueCollected: 1236923, occupancyRate: 81.53 },
        { year: 2025, month: 7, revenueTarget: 377800, revenueCollected: 1339914.35, occupancyRate: 89.16 },
        { year: 2025, month: 8, revenueTarget: 888100, revenueCollected: 1054069.53, occupancyRate: 88.03 },
        { year: 2025, month: 9, revenueTarget: 2001900, revenueCollected: 2214624.81, occupancyRate: 94.12 },
        { year: 2025, month: 10, revenueTarget: 1629300, revenueCollected: 1533037.24, occupancyRate: 91.31 },
        { year: 2025, month: 11, revenueTarget: 530300, revenueCollected: 1873537.55, occupancyRate: 91.31 },
        { year: 2025, month: 12, revenueTarget: 2410269.81, revenueCollected: 153726.75, occupancyRate: 91.31 },
    ];

    return [...data2024, ...data2025];
};

export const generateInitialData = (): DashboardData => {
  // 1. Setup Buildings
  
  // Building 1: 4 Floors. Floor 1 & 2 are Whole, 3-4 are Multi.
  const b1Units = generateCustomUnits('b1', [
      { floor: 1, type: 'whole' },
      { floor: 2, type: 'whole' },
      { floor: 3, type: 'multi', count: 8 },
      { floor: 4, type: 'multi', count: 8 },
  ]);

  // Building 2: 4 Floors. Floor 1 & 3 are Whole, 2 & 4 are Multi.
  const b2Units = generateCustomUnits('b2', [
      { floor: 1, type: 'whole' },
      { floor: 2, type: 'multi', count: 6 },
      { floor: 3, type: 'whole' },
      { floor: 4, type: 'multi', count: 6 },
  ]);

  // Building 3: 2 Floors. Both are Whole.
  const b3Units = generateCustomUnits('b3', [
      { floor: 1, type: 'whole' },
      { floor: 2, type: 'whole' },
  ]);

  // New: Site (Playground/Square)
  const siteUnits: Unit[] = [
      { id: 'site_sq_01', name: '中央广告位', area: 20, status: UnitStatus.Vacant, floor: 1 },
      { id: 'site_sq_02', name: '北广场活动区', area: 150, status: UnitStatus.Vacant, floor: 1 },
      { id: 'site_sq_03', name: '南广场特卖区', area: 50, status: UnitStatus.Vacant, floor: 1 },
  ];

  const buildings: Building[] = [
    { id: 'b1', name: '1号楼', units: b1Units, type: 'Building' },
    { id: 'b2', name: '2号楼', units: b2Units, type: 'Building' },
    { id: 'b3', name: '3号楼', units: b3Units, type: 'Building' },
    { id: 'site1', name: '中央广场', units: siteUnits, type: 'Site' },
  ];

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
    annualRevenueTarget: 16000000,
    annualRevenueCollected: 0,
    annualOccupancyTarget: 92,
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
    budgetAnalysis: {
        occupancy: '',
        revenue: ''
    },
    budgetScenarios: [],
    yearlyTargets: {
        [2024]: { revenue: 16500000, occupancy: 85 },
        [2025]: { revenue: 18000000, occupancy: 92 }
    },
    initializationData: getFixedInitData(),
    invoices: []
  };
};
