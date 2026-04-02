import PocketBase from 'pocketbase';
import { DashboardData, CloudBackupMetadata } from '../types';
import type { IntegrationFullSnapshotV1 } from './integrationSnapshot';
import { INTEGRATION_FULL_SNAPSHOT_KIND } from './integrationSnapshot';

let pb: PocketBase | null = null;

export const initPocketBase = (url: string) => {
    try {
        console.log('=== Initializing PocketBase ===');
        console.log('URL:', url);
        console.log('Old pb instance:', pb ? 'exists' : 'null');
        
        // 强制重新创建实例
        pb = new PocketBase(url);
        
        console.log('New pb instance created');
        console.log('pb.baseUrl:', pb.baseUrl);
        console.log('pb instance:', pb);
        
        return true;
    } catch (e) {
        console.error("PocketBase init failed:", e);
        return false;
    }
};

// 调试用：获取当前 PocketBase 实例信息
export const getPocketBaseInfo = () => {
    return {
        initialized: pb !== null,
        baseUrl: pb?.baseUrl || 'not initialized',
        isValid: pb?.authStore?.isValid || false,
        model: pb?.authStore?.model || null
    };
};

export const authenticatePocketBase = async (email: string, password: string) => {
    if (!pb) return false;
    const safeEmail = (email || '').trim();
    const safePassword = (password || '').trim();
    if (!safeEmail || !safePassword) {
        console.warn('PocketBase 登录已跳过：未填写账号或密码');
        return false;
    }

    const loginByAdminsEndpoint = async (): Promise<boolean> => {
        if (!pb) return false;
        const baseUrl = pb.baseUrl.replace(/\/+$/, '');
        const endpoint = `${baseUrl}/api/admins/auth-with-password`;

        const loginPayloads = [
            { email: safeEmail, password: safePassword },      // 旧版常见格式
            { identity: safeEmail, password: safePassword },   // 新版常见格式
        ];

        let lastError: any = null;
        for (const payload of loginPayloads) {
            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (resp.ok) {
                const data = await resp.json();
                if (data?.token) {
                    pb.authStore.save(data.token, data.admin || data.record || null);
                    return true;
                }
                throw new Error('admins 登录响应缺少 token');
            }

            const message = await resp.text();
            lastError = new Error(`admins 登录失败: ${resp.status} ${resp.statusText}`);
            (lastError as any).status = resp.status;
            (lastError as any).message = message || (lastError as any).message;
        }

        throw lastError || new Error('admins 登录失败');
    };

    try {
        console.log('PocketBase 尝试登录(_superusers):', safeEmail);
        const authData = await pb.collection('_superusers').authWithPassword(safeEmail, safePassword);
        console.log('PocketBase 管理员登录成功:', authData.record?.email || safeEmail);
        console.log('Token:', pb.authStore.token ? '已生成' : '未生成');
        return true;
    } catch (e: any) {
        // 回退 1：兼容旧版本 PocketBase admins 认证端点
        try {
            console.log('PocketBase 回退登录(admins endpoint):', safeEmail);
            await loginByAdminsEndpoint();
            console.log('PocketBase admins 登录成功:', safeEmail);
            console.log('Token:', pb.authStore.token ? '已生成' : '未生成');
            return true;
        } catch (adminErr: any) {
            // 回退 2：兼容使用 users 集合做登录的旧配置
            try {
                console.log('PocketBase 回退登录(users):', safeEmail);
                const authData = await pb.collection('users').authWithPassword(safeEmail, safePassword);
                console.log('PocketBase 用户登录成功:', authData.record?.email || safeEmail);
                console.log('Token:', pb.authStore.token ? '已生成' : '未生成');
                return true;
            } catch (userErr: any) {
                // 认证失败不再打红色 error，避免控制台噪音；保存接口可按 API Rules 直接工作
                console.warn("PocketBase 认证失败（已跳过登录，继续匿名模式）", {
                    superuserStatus: e?.status,
                    superuserMessage: e?.message,
                    adminStatus: adminErr?.status,
                    adminMessage: adminErr?.message,
                    userStatus: userErr?.status,
                    userMessage: userErr?.message,
                });
                return false;
            }
        }
    }
};

export const checkPocketBaseConnection = async (url: string): Promise<boolean> => {
    try {
        const client = new PocketBase(url);
        await client.health.check();
        return true;
    } catch (e) {
        console.warn("PocketBase connection failed:", e);
        return false;
    }
};

/** 与 pb_billing_period_notes 中单条记录的 original_id 对应，存 notes_json.version */
const DASHBOARD_DATA_VERSION_OID = 'dashboard_data_version';

const readCloudSaveVersion = async (projectId: string): Promise<number> => {
    if (!pb) return 0;
    const list = await pb.collection('pb_billing_period_notes').getList(1, 1, {
        filter: `project_id = "${projectId}" && original_id = "${DASHBOARD_DATA_VERSION_OID}"`,
        fields: 'notes_json',
    });
    const v = (list.items[0]?.notes_json as { version?: unknown } | undefined)?.version;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
};

export type SaveToPocketBaseOptions = {
    /** 打开数据时从服务器读到的版本；与服务器当前版本不一致则拒绝保存 */
    expectedVersion?: number;
    /** 内部迁移等场景跳过校验（迁移完成后仍会写入新版本号） */
    skipVersionCheck?: boolean;
};

export type SaveToPocketBaseResult = {
    success: boolean;
    message: string;
    conflict?: boolean;
    newVersion?: number;
};

export const saveToPocketBase = async (
    data: DashboardData,
    projectId: string,
    note: string = '',
    options?: SaveToPocketBaseOptions
): Promise<SaveToPocketBaseResult> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化\n\n请点击"保存配置"按钮重新初始化' };

    const skipVersionCheck = options?.skipVersionCheck === true;
    const expectedVersion =
        typeof options?.expectedVersion === 'number' && Number.isFinite(options.expectedVersion)
            ? Math.max(0, Math.floor(options.expectedVersion))
            : typeof data.cloudSaveVersion === 'number' && Number.isFinite(data.cloudSaveVersion)
              ? Math.max(0, Math.floor(data.cloudSaveVersion))
              : 0;

    if (!skipVersionCheck) {
        const serverVersion = await readCloudSaveVersion(projectId);
        if (serverVersion !== expectedVersion) {
            return {
                success: false,
                conflict: true,
                message:
                    '云端数据已被他人更新（或您在其他窗口已保存）。请先加载最新数据后再编辑保存，以免覆盖他人修改。',
            };
        }
    }

    const ensureArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
    const byOriginalId = (id: string) => `project_id = "${projectId}" && original_id = "${id}"`;
    const upsertByOriginalId = async (collection: string, originalId: string, payload: Record<string, any>) => {
        const existing = await pb!.collection(collection).getList(1, 1, {
            filter: byOriginalId(originalId),
            fields: 'id',
        });
        if (existing.items.length > 0) {
            await pb!.collection(collection).update(existing.items[0].id, payload);
            return;
        }
        await pb!.collection(collection).create(payload);
    };
    const replaceCollection = async (collection: string, rows: Record<string, any>[]) => {
        const oldRows = await pb!.collection(collection).getFullList({
            filter: `project_id = "${projectId}"`,
            fields: 'id',
        });
        for (const row of oldRows) {
            await pb!.collection(collection).delete(row.id);
        }
        for (const row of rows) {
            await pb!.collection(collection).create(row);
        }
    };

    try {
        const buildings = ensureArray<any>(data.buildings).map((b) => ({
            original_id: b.id,
            name: b.name,
            type: b.type || 'Building',
            project_id: projectId,
        }));
        const units = ensureArray<any>(data.buildings).flatMap((b) =>
            ensureArray<any>(b.units).map((u) => ({
                original_id: u.id,
                building_id: b.id,
                name: u.name,
                area: u.area || 0,
                status: u.status || 'Vacant',
                floor: u.floor || 1,
                is_self_use: !!u.isSelfUse,
                project_id: projectId,
            }))
        );
        const tenants = ensureArray<any>(data.tenants).map((t) => ({
            original_id: t.id,
            root_id: t.rootId || '',
            name: t.name,
            contact_info: t.contactInfo || '',
            industry: t.industry || '',
            founding_date: t.foundingDate || '',
            legal_rep_name: t.legalRepName || '',
            legal_rep_birthday: t.legalRepBirthday || '',
            contact_name: t.contactName || '',
            contact_birthday: t.contactBirthday || '',
            building_id: t.buildingId,
            unit_ids: t.unitIds || [],
            total_area: t.totalArea || 0,
            signing_date: t.signingDate || '',
            lease_start: t.leaseStart,
            lease_end: t.leaseEnd,
            move_in_date: t.moveInDate || '',
            unit_price: t.unitPrice || 0,
            monthly_rent: t.monthlyRent || 0,
            rent_free_periods: t.rentFreePeriods || [],
            payment_cycle: t.paymentCycle || 'Monthly',
            payment_terms: Array.isArray(t.paymentTerms) ? t.paymentTerms : [],
            payment_cycle_months: t.paymentCycleMonths ?? null,
            first_payment_date: t.firstPaymentDate || '',
            first_payment_months: t.firstPaymentMonths ?? null,
            free_rent_handling: t.freeRentHandling || null,
            deposit_amount: t.depositAmount || 0,
            deposit_status: t.depositStatus || 'Unpaid',
            status: t.status || 'Active',
            termination_date: t.terminationDate || '',
            termination_type: t.terminationType || null,
            termination_reason: t.terminationReason || '',
            special_requirements: t.specialRequirements || '',
            is_risk: !!t.isRisk,
            contract_parking_spaces: t.contractParkingSpaces ?? t.parkingSpaces ?? 0,
            actual_parking_spaces: t.actualParkingSpaces ?? t.parkingSpaces ?? 0,
            parking_unit_price: t.parkingUnitPrice || 0,
            key_moments: t.keyMoments || [],
            project_id: projectId,
        }));
        const payments = ensureArray<any>(data.payments).map((p) => ({
            original_id: p.id,
            tenant_id: p.tenantId,
            tenant_name: p.tenantName || '',
            amount: p.amount || 0,
            type: p.type || 'Rent',
            date: p.date,
            status: p.status || 'Pending',
            invoice_status: p.invoiceStatus || null,
            period: p.period || '',
            remarks: p.remarks || '',
            project_id: projectId,
        }));
        const invoices = ensureArray<any>(data.invoices).map((inv) => ({
            original_id: inv.id,
            tenant_id: inv.tenantId,
            bill_date: inv.billDate,
            target_invoice_date: inv.targetInvoiceDate || '',
            amount: inv.amount || 0,
            status: inv.status || 'Pending',
            invoiced_at: inv.invoicedAt || '',
            defer_reason: inv.deferReason || '',
            project_id: projectId,
        }));
        const yearlyTargets = Object.entries(data.yearlyTargets || {}).map(([year, targets]) => ({
            year: Number(year),
            revenue: (targets as any)?.revenue || 0,
            occupancy: (targets as any)?.occupancy || 0,
            project_id: projectId,
        }));
        const monthlyInitData = ensureArray<any>(data.initializationData).map((d) => ({
            year: d.year,
            month: d.month,
            revenue_target: d.revenueTarget || 0,
            revenue_collected: d.revenueCollected || 0,
            occupancy_rate: d.occupancyRate || 0,
            accumulated_arrears: d.accumulatedArrears || 0,
            project_id: projectId,
        }));
        const budgetAssumptions = ensureArray<any>(data.budgetAssumptions).map((a) => ({
            original_id: a.id,
            target_type: a.targetType || null,
            target_id: a.targetId || '',
            target_name: a.targetName || '',
            strategy: a.strategy || null,
            projected_termination_date: a.projectedTerminationDate || '',
            vacancy_gap_months: a.vacancyGapMonths ?? null,
            projected_sign_date: a.projectedSignDate || '',
            projected_unit_price: a.projectedUnitPrice || 0,
            projected_rent_free_months: a.projectedRentFreeMonths || 0,
            billing_cycle_shift_months: a.billingCycleShiftMonths ?? null,
            price_adjustment: a.priceAdjustment || null,
            payment_shift: a.paymentShift || null,
            project_id: projectId,
        }));
        const budgetAdjustments = ensureArray<any>(data.budgetAdjustments).map((a) => ({
            original_id: a.id,
            tenant_id: a.tenantId,
            tenant_name: a.tenantName || '',
            original_year: a.originalYear,
            original_month: a.originalMonth,
            adjusted_year: a.adjustedYear,
            adjusted_month: a.adjustedMonth,
            amount: a.amount || 0,
            reason: a.reason || '',
            adjustment_kind: a.adjustmentKind || ((a.originalYear === -1 && a.originalMonth === -1) ? 'amount_delta' : 'period_shift'),
            project_id: projectId,
        }));
        const budgetScenarios = ensureArray<any>(data.budgetScenarios).map((s) => ({
            original_id: s.id,
            name: s.name,
            budget_year: s.budgetYear ?? new Date().getFullYear(),
            description: s.description || '',
            scenario_created_at: s.createdAt || '',
            is_active: !!s.isActive,
            assumptions: s.assumptions || [],
            adjustments: s.adjustments || [],
            base_data_snapshot: s.baseDataSnapshot || null,
            project_id: projectId,
        }));

        await replaceCollection('pb_buildings', buildings);
        await replaceCollection('pb_units', units);
        await replaceCollection('pb_tenants', tenants);
        await replaceCollection('pb_payments', payments);
        await replaceCollection('pb_invoices', invoices);
        await replaceCollection('pb_yearly_targets', yearlyTargets);
        await replaceCollection('pb_monthly_init_data', monthlyInitData);
        await replaceCollection('pb_budget_assumptions', budgetAssumptions);
        await replaceCollection('pb_budget_adjustments', budgetAdjustments);
        await replaceCollection('pb_budget_scenarios', budgetScenarios);
        await upsertByOriginalId('pb_billing_period_notes', 'billing_period_notes', {
            original_id: 'billing_period_notes',
            notes_json: data.billingPeriodNotes || {},
            project_id: projectId,
        });

        if (note) {
            await upsertByOriginalId('pb_billing_period_notes', 'last_save_note', {
                original_id: 'last_save_note',
                notes_json: { note, saved_at: new Date().toISOString() },
                project_id: projectId,
            });
        }

        const versionBeforeWrite = skipVersionCheck ? await readCloudSaveVersion(projectId) : expectedVersion;
        const newVersion = versionBeforeWrite + 1;
        await upsertByOriginalId('pb_billing_period_notes', DASHBOARD_DATA_VERSION_OID, {
            original_id: DASHBOARD_DATA_VERSION_OID,
            notes_json: { version: newVersion },
            project_id: projectId,
        });

        return { success: true, message: 'PocketBase 结构化数据保存成功', newVersion };
    } catch (e: any) {
        const errorMsg = e?.data?.message || e?.message || 'Unknown error';
        return { success: false, message: `PocketBase 保存失败: ${errorMsg}` };
    }
};

export const getPocketBaseHistory = async (
    projectId: string
): Promise<{success: boolean, data?: CloudBackupMetadata[], message: string}> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    
    try {
        const noteRecord = await pb.collection('pb_billing_period_notes').getList(1, 1, {
            filter: `project_id = "${projectId}" && original_id = "last_save_note"`,
            fields: 'updated,notes_json',
        });
        const notePayload = noteRecord.items[0]?.notes_json || {};
        const createdAt = notePayload.saved_at || noteRecord.items[0]?.updated || new Date().toISOString();
        const note = notePayload.note || '结构化数据最新版本';
        return {
            success: true,
            data: [{ id: projectId, created_at: createdAt, note }],
            message: '加载成功',
        };
    } catch (e: any) {
        return { success: true, data: [{ id: projectId, created_at: new Date().toISOString(), note: '结构化数据' }], message: '加载成功' };
    }
};

export const fetchPocketBaseBackup = async (
    projectId: string
): Promise<{success: boolean, data?: DashboardData, message: string}> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    const client = pb;

    const mapList = async (collection: string) => client.collection(collection).getFullList({
        filter: `project_id = "${projectId}"`,
    });

    try {
        const buildingsRows = await mapList('pb_buildings');
        const unitsRows = await mapList('pb_units');
        const tenantsRows = await mapList('pb_tenants');
        const paymentsRows = await mapList('pb_payments');
        const invoicesRows = await mapList('pb_invoices');
        const yearlyRows = await mapList('pb_yearly_targets');
        const monthlyInitRows = await mapList('pb_monthly_init_data');
        const assumptionRows = await mapList('pb_budget_assumptions');
        const adjustmentRows = await mapList('pb_budget_adjustments');
        const scenarioRows = await mapList('pb_budget_scenarios');
        const notesRows = await client.collection('pb_billing_period_notes').getList(1, 1, {
            filter: `project_id = "${projectId}" && original_id = "billing_period_notes"`,
        });
        const versionRows = await client.collection('pb_billing_period_notes').getList(1, 1, {
            filter: `project_id = "${projectId}" && original_id = "${DASHBOARD_DATA_VERSION_OID}"`,
            fields: 'notes_json',
        });
        const cloudSaveVersionRaw = (versionRows.items[0]?.notes_json as { version?: unknown } | undefined)?.version;
        const cloudSaveVersion =
            typeof cloudSaveVersionRaw === 'number' && Number.isFinite(cloudSaveVersionRaw) && cloudSaveVersionRaw >= 0
                ? Math.floor(cloudSaveVersionRaw)
                : 0;

        const unitsByBuilding = new Map<string, any[]>();
        for (const row of unitsRows) {
            const arr = unitsByBuilding.get(row.building_id) || [];
            arr.push({
                id: row.original_id,
                name: row.name,
                area: row.area || 0,
                status: row.status || 'Vacant',
                floor: row.floor || 1,
                isSelfUse: !!row.is_self_use,
            });
            unitsByBuilding.set(row.building_id, arr);
        }

        const rebuilt: Partial<DashboardData> = {
            buildings: buildingsRows.map((b: any) => ({
                id: b.original_id,
                name: b.name,
                type: b.type || 'Building',
                units: unitsByBuilding.get(b.original_id) || [],
            })),
            tenants: tenantsRows.map((t: any) => ({
                id: t.original_id,
                rootId: t.root_id || '',
                name: t.name,
                contactInfo: t.contact_info || '',
                industry: t.industry || '',
                foundingDate: t.founding_date || '',
                legalRepName: t.legal_rep_name || '',
                legalRepBirthday: t.legal_rep_birthday || '',
                contactName: t.contact_name || '',
                contactBirthday: t.contact_birthday || '',
                buildingId: t.building_id,
                unitIds: Array.isArray(t.unit_ids) ? t.unit_ids : [],
                totalArea: t.total_area || 0,
                signingDate: t.signing_date || '',
                leaseStart: t.lease_start,
                leaseEnd: t.lease_end,
                moveInDate: t.move_in_date || '',
                unitPrice: t.unit_price || 0,
                monthlyRent: t.monthly_rent || 0,
                rentFreePeriods: Array.isArray(t.rent_free_periods) ? t.rent_free_periods : [],
                paymentCycle: t.payment_cycle || 'Monthly',
                paymentTerms: Array.isArray(t.payment_terms) ? t.payment_terms : [],
                paymentCycleMonths: t.payment_cycle_months ?? undefined,
                firstPaymentDate: t.first_payment_date || '',
                firstPaymentMonths: t.first_payment_months ?? undefined,
                freeRentHandling: t.free_rent_handling || undefined,
                depositAmount: t.deposit_amount || 0,
                depositStatus: t.deposit_status || 'Unpaid',
                status: t.status || 'Active',
                terminationDate: t.termination_date || undefined,
                terminationType: t.termination_type || undefined,
                terminationReason: t.termination_reason || '',
                specialRequirements: t.special_requirements || '',
                isRisk: !!t.is_risk,
                contractParkingSpaces: t.contract_parking_spaces ?? 0,
                actualParkingSpaces: t.actual_parking_spaces ?? 0,
                parkingUnitPrice: t.parking_unit_price || 0,
                keyMoments: Array.isArray(t.key_moments) ? t.key_moments : [],
            })),
            payments: paymentsRows.map((p: any) => ({
                id: p.original_id,
                tenantId: p.tenant_id,
                tenantName: p.tenant_name || '',
                amount: p.amount || 0,
                type: p.type || 'Rent',
                date: p.date,
                period: p.period || '',
                status: p.status || 'Pending',
                invoiceStatus: p.invoice_status || undefined,
                remarks: p.remarks || '',
            })),
            invoices: invoicesRows.map((inv: any) => ({
                id: inv.original_id,
                tenantId: inv.tenant_id,
                billDate: inv.bill_date,
                targetInvoiceDate: inv.target_invoice_date || '',
                amount: inv.amount || 0,
                status: inv.status || 'Pending',
                invoicedAt: inv.invoiced_at || undefined,
                deferReason: inv.defer_reason || '',
            })),
            yearlyTargets: yearlyRows.reduce((acc: Record<number, { revenue: number; occupancy: number }>, row: any) => {
                acc[Number(row.year)] = {
                    revenue: row.revenue || 0,
                    occupancy: row.occupancy || 0,
                };
                return acc;
            }, {}),
            initializationData: monthlyInitRows.map((row: any) => ({
                year: row.year,
                month: row.month,
                revenueTarget: row.revenue_target || 0,
                revenueCollected: row.revenue_collected || 0,
                occupancyRate: row.occupancy_rate || 0,
                accumulatedArrears: row.accumulated_arrears || 0,
            })),
            budgetAssumptions: assumptionRows.map((a: any) => ({
                id: a.original_id,
                targetType: a.target_type,
                targetId: a.target_id || '',
                targetName: a.target_name || '',
                strategy: a.strategy || undefined,
                projectedTerminationDate: a.projected_termination_date || '',
                vacancyGapMonths: a.vacancy_gap_months ?? undefined,
                projectedSignDate: a.projected_sign_date || '',
                projectedUnitPrice: a.projected_unit_price || 0,
                projectedRentFreeMonths: a.projected_rent_free_months || 0,
                billingCycleShiftMonths: a.billing_cycle_shift_months ?? undefined,
                priceAdjustment: a.price_adjustment || undefined,
                paymentShift: a.payment_shift || undefined,
            })),
            budgetAdjustments: adjustmentRows.map((a: any) => ({
                id: a.original_id,
                tenantId: a.tenant_id,
                tenantName: a.tenant_name || '',
                originalYear: a.original_year,
                originalMonth: a.original_month,
                adjustedYear: a.adjusted_year,
                adjustedMonth: a.adjusted_month,
                amount: a.amount || 0,
                reason: a.reason || '',
                adjustmentKind: a.adjustment_kind || undefined,
            })),
            budgetScenarios: scenarioRows.map((s: any) => ({
                id: s.original_id,
                name: s.name,
                budgetYear: Number.isFinite(Number(s.budget_year)) ? Number(s.budget_year) : new Date().getFullYear(),
                description: s.description || '',
                createdAt: s.scenario_created_at || '',
                isActive: !!s.is_active,
                assumptions: Array.isArray(s.assumptions) ? s.assumptions : [],
                adjustments: Array.isArray(s.adjustments) ? s.adjustments : [],
                baseDataSnapshot: s.base_data_snapshot || undefined,
            })),
            billingPeriodNotes: (notesRows.items[0]?.notes_json || {}) as Record<string, string>,
            cloudSaveVersion,
        };

        return { success: true, data: rebuilt as DashboardData, message: '获取成功' };
    } catch (e: any) {
        return { success: false, message: 'PocketBase 数据获取失败: ' + e.message };
    }
};

/** 历史：`pb_billing_period_notes` 中 openclaw_kpi_snapshot；现已由 pb_integration_snapshots 全量快照替代，保留常量供文档/脚本检索 */
export const OPENCLAW_KPI_SNAPSHOT_OID = 'openclaw_kpi_snapshot';

export { INTEGRATION_FULL_SNAPSHOT_KIND } from './integrationSnapshot';

const integrationSnapshotCollection = 'pb_integration_snapshots';

export const upsertIntegrationFullSnapshot = async (
    projectId: string,
    snapshot: IntegrationFullSnapshotV1
): Promise<void> => {
    if (!pb) return;
    const pid = (projectId || '').trim();
    if (!pid) return;

    const filter = `project_id = "${pid}" && snapshot_kind = "${INTEGRATION_FULL_SNAPSHOT_KIND}"`;
    const existing = await pb.collection(integrationSnapshotCollection).getList(1, 1, {
        filter,
        fields: 'id',
    });
    const row = {
        project_id: pid,
        snapshot_kind: INTEGRATION_FULL_SNAPSHOT_KIND,
        payload: snapshot as unknown as Record<string, unknown>,
    };
    if (existing.items.length > 0) {
        await pb.collection(integrationSnapshotCollection).update(existing.items[0].id, row);
    } else {
        await pb.collection(integrationSnapshotCollection).create(row);
    }
};

let integrationSnapshotDebounce: ReturnType<typeof setTimeout> | null = null;
let pendingIntegrationSnapshot: { projectId: string; snapshot: IntegrationFullSnapshotV1 } | null = null;

/** 合并短时间内的多次重算，避免频繁写 PocketBase（与保存成功后 recalculateMetrics 对齐） */
export const scheduleUpsertIntegrationFullSnapshot = (
    projectId: string,
    snapshot: IntegrationFullSnapshotV1
): void => {
    const pid = (projectId || '').trim();
    if (!pid) return;
    pendingIntegrationSnapshot = { projectId: pid, snapshot };
    if (integrationSnapshotDebounce) clearTimeout(integrationSnapshotDebounce);
    integrationSnapshotDebounce = setTimeout(async () => {
        integrationSnapshotDebounce = null;
        const job = pendingIntegrationSnapshot;
        pendingIntegrationSnapshot = null;
        if (!job) return;
        try {
            await upsertIntegrationFullSnapshot(job.projectId, job.snapshot);
        } catch (e) {
            console.warn('[integration_snapshot] 同步失败（可忽略：未初始化 PB 或规则拒绝）', e);
        }
    }, 1600);
};
