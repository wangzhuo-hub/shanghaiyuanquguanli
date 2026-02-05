
import { Tenant, BudgetAssumption, BudgetAdjustment, RentFreePeriod, Building, DepositStatus, ContractStatus } from '../types';

// Helper to parse "YYYY-MM-DD" string into a Local Date object (00:00:00)
// This avoids UTC offsets issues where "2026-06-01" becomes "2026-05-31" in some timezones
const parseDateLocal = (dateInput: string | Date | undefined): Date => {
    if (!dateInput) return new Date(); // Fallback
    if (dateInput instanceof Date) return new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate());
    
    // Handle string "YYYY-MM-DD"
    const parts = dateInput.split('-').map(Number);
    if (parts.length === 3) {
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return new Date(dateInput);
};

export const getDaysDiff = (start: Date, end: Date): number => {
    // Reset hours to ensure pure date difference
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const diffTime = Math.abs(e.getTime() - s.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
};

export const getOverlapDays = (start1: Date, end1: Date, start2: Date, end2: Date): number => {
    const s1 = new Date(start1.getFullYear(), start1.getMonth(), start1.getDate());
    const e1 = new Date(end1.getFullYear(), end1.getMonth(), end1.getDate());
    const s2 = new Date(start2.getFullYear(), start2.getMonth(), start2.getDate());
    const e2 = new Date(end2.getFullYear(), end2.getMonth(), end2.getDate());

    const overlapStart = s1 > s2 ? s1 : s2;
    const overlapEnd = e1 < e2 ? e1 : e2;

    if (overlapStart <= overlapEnd) {
        return getDaysDiff(overlapStart, overlapEnd);
    }
    return 0;
};

export const isRentFreeDate = (date: Date, rentFreePeriods: RentFreePeriod[]): boolean => {
    if (!rentFreePeriods || rentFreePeriods.length === 0) return false;
    // Normalize check date
    const checkTime = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    
    return rentFreePeriods.some(rf => {
        const start = parseDateLocal(rf.start).getTime();
        const end = parseDateLocal(rf.end).getTime();
        return checkTime >= start && checkTime <= end;
    });
};

export const calculateRentForDuration = (start: Date, end: Date, monthlyRent: number): number => {
    // UPDATED: Use 30-day standard for partial month calculations
    // This ensures that 15 days = 0.5 * Monthly Rent
    const dailyRent = monthlyRent / 30;
    
    let total = 0;
    // Ensure we start with clean dates
    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const finalEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    
    let safety = 0;
    while (cursor <= finalEnd && safety < 1000) {
        safety++;
        const currentMonthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        const segmentEnd = currentMonthEnd < finalEnd ? currentMonthEnd : finalEnd;
        
        const isFirstDay = cursor.getDate() === 1;
        const isLastDay = segmentEnd.getDate() === currentMonthEnd.getDate();
        
        // If it covers the full month (1st to Last Day), charge exactly Monthly Rent
        // This avoids issues where 31-day months would charge 31/30 * Rent
        if (isFirstDay && isLastDay) {
            total += monthlyRent;
        } else {
            const days = getDaysDiff(cursor, segmentEnd);
            total += days * dailyRent;
        }
        
        cursor = new Date(segmentEnd);
        cursor.setDate(cursor.getDate() + 1);
    }
    return total;
};

export const generateBudgetedBills = (
    tenant: Tenant,
    assumptions: BudgetAssumption[],
    adjustments: BudgetAdjustment[],
    startDateConstraint: Date,
    endDateConstraint: Date
): {date: Date; amount: number; originalDate?: Date}[] => {
    const bills: {date: Date; amount: number; originalDate?: Date}[] = [];

    if (!tenant.leaseStart) return [];

    // Parse lease dates strictly as Local Time to avoid timezone shifts
    const leaseStart = parseDateLocal(tenant.leaseStart);
    const leaseEnd = tenant.leaseEnd ? parseDateLocal(tenant.leaseEnd) : new Date('2099-12-31');
    
    const terminationDate = tenant.terminationDate ? parseDateLocal(tenant.terminationDate) : null;
    const effectiveLeaseEnd = terminationDate && terminationDate < leaseEnd ? terminationDate : leaseEnd;

    let monthlyRent = tenant.monthlyRent || 0;
    if (monthlyRent === 0 && tenant.unitPrice && tenant.totalArea) {
        monthlyRent = (tenant.unitPrice * tenant.totalArea * 365) / 12;
    }

    const existingAssumption = assumptions.find(a => a.targetId === tenant.id && a.targetType === 'Existing');
    const billingShift = existingAssumption?.billingCycleShiftMonths || 0;

    // FIX: Enforce cycle months based on PaymentCycle Type to override any stale data in paymentCycleMonths
    let regularCycleMonths = 3; // Default to Quarterly
    if (tenant.paymentCycle === 'Monthly') regularCycleMonths = 1;
    else if (tenant.paymentCycle === 'SemiAnnual') regularCycleMonths = 6;
    else if (tenant.paymentCycle === 'Annual') regularCycleMonths = 12;
    else if (tenant.paymentCycleMonths) regularCycleMonths = tenant.paymentCycleMonths; // Fallback for custom

    const firstCycleMonths = tenant.firstPaymentMonths && tenant.firstPaymentMonths > 0 ? tenant.firstPaymentMonths : regularCycleMonths;

    if (monthlyRent > 0) {
        // 支持新的 freeRentHandling 字段
        const isDeferMode = tenant.freeRentHandling === 'Defer';
        
        if (isDeferMode) {
            // Strategy: Defer billing cycle when encountering rent-free periods
            let cursor = new Date(leaseStart);
            let isFirstCycle = true;
            let safetyCounter = 0;

            const loopLimitDate = new Date(endDateConstraint);
            loopLimitDate.setFullYear(loopLimitDate.getFullYear() + 2); 

            while (cursor <= effectiveLeaseEnd && cursor <= loopLimitDate && safetyCounter < 300) {
                safetyCounter++;

                // 1. Skip Rent Free Gap
                let inRentFreeGap = true;
                while (inRentFreeGap && cursor <= effectiveLeaseEnd) {
                    if (isRentFreeDate(cursor, tenant.rentFreePeriods)) {
                        cursor.setDate(cursor.getDate() + 1);
                    } else {
                        inRentFreeGap = false;
                    }
                }

                if (cursor > effectiveLeaseEnd) break;

                // 2. Determine Bill Date (1 month prior)
                let billDate = new Date(cursor);
                billDate.setMonth(billDate.getMonth() - 1);
                
                if (isFirstCycle && tenant.firstPaymentDate) {
                    billDate = parseDateLocal(tenant.firstPaymentDate);
                }

                // 3. Collect Billable Months
                const targetVirtualMonths = isFirstCycle ? firstCycleMonths : regularCycleMonths;
                let collectedVirtualMonths = 0;
                let segmentCursor = new Date(cursor);
                
                while (collectedVirtualMonths < targetVirtualMonths && segmentCursor <= effectiveLeaseEnd) {
                    if (!isRentFreeDate(segmentCursor, tenant.rentFreePeriods)) {
                        const daysInMonth = new Date(segmentCursor.getFullYear(), segmentCursor.getMonth() + 1, 0).getDate();
                        collectedVirtualMonths += (1 / daysInMonth);
                    }
                    segmentCursor.setDate(segmentCursor.getDate() + 1);
                }
                
                if (collectedVirtualMonths < 0.05) break;

                let finalBillableMonths = collectedVirtualMonths;
                if (Math.abs(collectedVirtualMonths - Math.round(collectedVirtualMonths)) < 0.1) {
                    finalBillableMonths = Math.round(collectedVirtualMonths);
                }

                let grossAmount = Math.round(finalBillableMonths * monthlyRent);

                // Assumption Payment Shift
                if (existingAssumption?.paymentShift?.isActive) {
                    const ps = existingAssumption.paymentShift;
                    if (billDate.getFullYear() === ps.fromYear && billDate.getMonth() === ps.fromMonth) {
                        grossAmount -= ps.amount;
                        if (grossAmount < 0) grossAmount = 0;
                        const shiftedDate = new Date(billDate);
                        shiftedDate.setFullYear(ps.toYear);
                        shiftedDate.setMonth(ps.toMonth);
                        shiftedDate.setDate(1);
                        bills.push({ date: shiftedDate, amount: Math.round(ps.amount), originalDate: new Date(billDate) });
                    }
                }

                if (grossAmount > 0) {
                    if (billingShift !== 0) {
                        billDate.setMonth(billDate.getMonth() + billingShift);
                    }
                    bills.push({ date: billDate, amount: Math.round(grossAmount) });
                }

                cursor = new Date(segmentCursor);
                isFirstCycle = false;
            }

        } else {
            // Strategy: Deduct (当期账单扣除模式) - 默认逻辑
            // 免租期从当期账单中扣除，收款时间不变但金额减少
            // Use local date for billing logic
            let currentBillDate = tenant.firstPaymentDate ? parseDateLocal(tenant.firstPaymentDate) : new Date(leaseStart);
            if (!tenant.firstPaymentDate) {
                currentBillDate = new Date(leaseStart);
                currentBillDate.setMonth(currentBillDate.getMonth() - 1);
            }

            let coverageStart = new Date(leaseStart);
            let isFirstCycle = true;
            let safetyCounter = 0;

            const loopLimitDate = new Date(endDateConstraint);
            loopLimitDate.setFullYear(loopLimitDate.getFullYear() + 2); 

            while (coverageStart <= effectiveLeaseEnd && safetyCounter < 200) {
                safetyCounter++;

                const durationMonths = isFirstCycle ? firstCycleMonths : regularCycleMonths;
                const coverageEnd = new Date(coverageStart);
                coverageEnd.setMonth(coverageEnd.getMonth() + durationMonths);
                coverageEnd.setDate(coverageEnd.getDate() - 1);
                
                const effectiveCoverageEnd = coverageEnd > effectiveLeaseEnd ? effectiveLeaseEnd : coverageEnd;

                // Price Adjustment Assumption
                let currentMonthlyRent = monthlyRent;
                if (existingAssumption?.priceAdjustment) {
                    const pa = existingAssumption.priceAdjustment;
                    const paStart = parseDateLocal(pa.startDate);
                    if (paStart <= effectiveCoverageEnd) {
                        currentMonthlyRent = (pa.newUnitPrice * tenant.totalArea * 365) / 12;
                    }
                }

                const fullCycleDays = getDaysDiff(coverageStart, coverageEnd);
                const actualDays = getDaysDiff(coverageStart, effectiveCoverageEnd);
                
                let grossAmount = 0;
                // If it's effectively a full cycle (within few days tolerance for month length diffs), use standard formula
                if (actualDays >= fullCycleDays - 5) {
                    grossAmount = currentMonthlyRent * durationMonths;
                } else {
                    // Use standard calculation for gross to maintain accuracy for partial lease periods
                    grossAmount = calculateRentForDuration(coverageStart, effectiveCoverageEnd, currentMonthlyRent);
                }

                let deduction = 0;
                if (tenant.rentFreePeriods) {
                    tenant.rentFreePeriods.forEach(rf => {
                        // Use strict local parsing for rent free periods
                        const rfStart = parseDateLocal(rf.start);
                        const rfEnd = parseDateLocal(rf.end);
                        
                        const overlapStart = rfStart > coverageStart ? rfStart : coverageStart;
                        const overlapEnd = rfEnd < effectiveCoverageEnd ? rfEnd : effectiveCoverageEnd;

                        if (overlapStart <= overlapEnd) {
                            // Logic Fix: Use calculateRentForDuration for deduction as well.
                            // This ensures that "Gross" calculation and "Deduction" calculation use the EXACT same formula (Full month = MonthlyRent).
                            // This solves the bug where a 31-day rent-free month deducted more (31/30) than the gross charge (1.0).
                            deduction += calculateRentForDuration(overlapStart, overlapEnd, currentMonthlyRent);
                        }
                    });
                }

                let finalAmount = Math.max(0, grossAmount - deduction);
                let finalBillDate = new Date(currentBillDate);

                // Assumption Payment Shift
                if (existingAssumption?.paymentShift?.isActive) {
                    const ps = existingAssumption.paymentShift;
                    if (finalBillDate.getFullYear() === ps.fromYear && finalBillDate.getMonth() === ps.fromMonth) {
                        finalAmount -= ps.amount;
                        if (finalAmount < 0) finalAmount = 0;

                        const shiftedDate = new Date(finalBillDate);
                        shiftedDate.setFullYear(ps.toYear);
                        shiftedDate.setMonth(ps.toMonth);
                        shiftedDate.setDate(1);
                        
                        bills.push({
                            date: shiftedDate,
                            amount: Math.round(ps.amount),
                            originalDate: new Date(currentBillDate)
                        });
                    }
                }

                if (finalAmount > 0) {
                    if (billingShift !== 0) {
                        finalBillDate.setMonth(finalBillDate.getMonth() + billingShift);
                    }
                    bills.push({
                        date: finalBillDate,
                        amount: Math.round(finalAmount)
                    });
                }

                coverageStart = new Date(effectiveCoverageEnd);
                coverageStart.setDate(coverageStart.getDate() + 1);
                currentBillDate = new Date(coverageStart);
                currentBillDate.setMonth(currentBillDate.getMonth() - 1);
                
                isFirstCycle = false;
                
                if (coverageStart > loopLimitDate) break;
            }
        }
    }

    // --- POST-PROCESS ADJUSTMENTS (Robust 2-Pass Method) ---
    const tenantAdjustments = adjustments.filter(a => a.tenantId === tenant.id);
    
    // Pass 1: Additions
    tenantAdjustments.forEach(adj => {
        if (adj.adjustedYear !== -1 && adj.adjustedMonth !== -1) {
            const existingBill = bills.find(b => 
                b.date.getFullYear() === adj.adjustedYear && 
                b.date.getMonth() === adj.adjustedMonth
            );

            if (existingBill) {
                existingBill.amount += adj.amount;
            } else {
                bills.push({
                    date: new Date(adj.adjustedYear, adj.adjustedMonth, 1),
                    amount: adj.amount
                });
            }
        }
    });

    // Pass 2: Subtractions
    tenantAdjustments.forEach(adj => {
        if (adj.originalYear !== -1 && adj.originalMonth !== -1) {
            const sourceBill = bills.find(b => 
                b.date.getFullYear() === adj.originalYear && 
                b.date.getMonth() === adj.originalMonth
            );

            if (sourceBill) {
                sourceBill.amount -= adj.amount;
                if (sourceBill.amount < 0) sourceBill.amount = 0;
            }
        }
    });

    return bills.filter(b => b.amount > 0.01);
};

// Helper to generate virtual tenants from assumptions for Budget Calculation
export const getVirtualTenants = (
    tenants: Tenant[], 
    buildings: Building[], 
    assumptions: BudgetAssumption[]
): Tenant[] => {
    const virtualTenants: Tenant[] = [];
    
    // Helper to shift date by months for First Payment calculation
    const addMonths = (dateStr: string, months: number): string => {
        const d = parseDateLocal(dateStr);
        d.setMonth(d.getMonth() + months);
        return d.toISOString().split('T')[0];
    };

    // 1. Vacancy Assumptions
    // Identify occupied unit IDs to filter for vacancies
    const occupiedUnitIds = new Set<string>();
    tenants.forEach(t => {
        if(t.status === 'Active' || t.status === 'Expiring' || t.status === 'Pending') {
            t.unitIds.forEach(id => occupiedUnitIds.add(id));
        }
    });

    buildings.forEach(b => {
        b.units.forEach(u => {
            // Find truly vacant units (not self-use, not occupied by active tenant)
            if (!u.isSelfUse && !occupiedUnitIds.has(u.id) && u.status !== 'Occupied') {
                // Check for vacancy assumption
                const asm = assumptions.find(a => a.targetId === u.id && a.targetType === 'Vacancy');
                if (asm && asm.projectedSignDate) {
                    const start = parseDateLocal(asm.projectedSignDate);
                    const end = new Date(start);
                    end.setFullYear(end.getFullYear() + 5); // Assume 5 year lease for budget projection
                    
                    // Logic Update: First payment delayed by Rent Free period
                    const firstPayDate = addMonths(asm.projectedSignDate, asm.projectedRentFreeMonths || 0);

                    virtualTenants.push({
                        id: `virt_vac_${u.id}`,
                        name: '待租去化 (预算)',
                        buildingId: b.id,
                        unitIds: [u.id],
                        totalArea: u.area,
                        leaseStart: asm.projectedSignDate,
                        leaseEnd: end.toISOString().split('T')[0],
                        unitPrice: asm.projectedUnitPrice,
                        monthlyRent: 0, // Will be calculated by billing service
                        paymentCycle: 'Quarterly',
                        paymentCycleMonths: 3,
                        firstPaymentMonths: 3,
                        firstPaymentDate: firstPayDate,
                        depositAmount: 0,
                        depositStatus: DepositStatus.Unpaid,
                        status: ContractStatus.Active,
                        rentFreePeriods: asm.projectedRentFreeMonths > 0 ? [{
                            start: asm.projectedSignDate,
                            end: new Date(new Date(start).setMonth(start.getMonth() + asm.projectedRentFreeMonths)).toISOString().split('T')[0],
                            description: 'Budget Rent Free'
                        }] : [],
                        freeRentHandling: 'Defer' // 账期顺延模式
                    });
                }
            }
        });
    });

    // 2. Renewal / Risk Assumptions (Extension of existing tenants)
    assumptions.forEach(asm => {
        if (asm.targetType === 'Vacancy' || asm.targetType === 'Existing') return;

        const tenant = tenants.find(t => t.id === asm.targetId);
        if (!tenant) return;

        let newStart: Date | null = null;
             
        if (asm.targetType === 'Renewal' && asm.strategy !== 'ReLease') {
             // Renewal strategy: Start immediately after current lease (Seamless)
             const le = parseDateLocal(tenant.leaseEnd);
             le.setDate(le.getDate() + 1);
             newStart = le;
        } else if (asm.strategy === 'ReLease' || asm.targetType === 'RiskTermination') {
             // Re-lease / Risk Replacement: Start after gap
             // Logic Update: Gap calculation is added to the previous end date
             const baseDate = asm.targetType === 'RiskTermination' && asm.projectedTerminationDate 
                ? parseDateLocal(asm.projectedTerminationDate) 
                : parseDateLocal(tenant.leaseEnd);
             
             if (isNaN(baseDate.getTime())) return;

             const gap = asm.vacancyGapMonths || 0;
             newStart = new Date(baseDate);
             newStart.setMonth(newStart.getMonth() + gap);
             newStart.setDate(newStart.getDate() + 1);
        }

        if (newStart) {
             const newStartStr = newStart.toISOString().split('T')[0];
             const newEnd = new Date(newStart);
             newEnd.setFullYear(newEnd.getFullYear() + 3); // 3 year projection
             
             // Logic Update: First payment delayed by Rent Free period for Renewals/Re-lease too
             const firstPayDate = addMonths(newStartStr, asm.projectedRentFreeMonths || 0);

             virtualTenants.push({
                 ...tenant,
                 id: `virt_${asm.targetType}_${tenant.id}`,
                 name: `${tenant.name} (${asm.targetType === 'Renewal' ? '续签' : '调改'})`,
                 leaseStart: newStartStr,
                 leaseEnd: newEnd.toISOString().split('T')[0],
                 unitPrice: asm.projectedUnitPrice,
                 monthlyRent: 0,
                 rentFreePeriods: asm.projectedRentFreeMonths > 0 ? [{
                     start: newStartStr,
                     end: new Date(new Date(newStart).setMonth(newStart.getMonth() + asm.projectedRentFreeMonths)).toISOString().split('T')[0],
                     description: 'Assumption Rent Free'
                 }] : [],
                 firstPaymentDate: firstPayDate,
                 freeRentHandling: 'Defer', // 账期顺延模式
                 status: ContractStatus.Active,
                 depositStatus: DepositStatus.Unpaid
             });
        }
    });

    return virtualTenants;
};
