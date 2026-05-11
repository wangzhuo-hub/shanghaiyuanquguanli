import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:1001');
await pb.collection('_superusers').authWithPassword('admin@kdpark.fun', 'Temp@2026!');

const parks = await pb.collection('pb_parks').getFullList({ filter: 'enabled = true' });
console.log('园区列表:');
parks.forEach(p => console.log(`  ${p.project_id} - ${p.name}`));

for (const park of parks) {
    const pid = park.project_id;
    console.log(`\n=== ${park.name} (${pid}) ===`);

    const tenants = await pb.collection('pb_tenants').getFullList({ filter: `project_id = "${pid}"` });
    const assumptions = await pb.collection('pb_budget_assumptions').getFullList({
        filter: `project_id = "${pid}" && target_type = "Existing"`,
    });
    const adjustments = await pb.collection('pb_budget_adjustments').getFullList({
        filter: `project_id = "${pid}"`,
    });

    console.log(`  租户: ${tenants.length}, 存量假设: ${assumptions.length}, 调整: ${adjustments.length}`);

    let migrated = 0;
    let skipped = 0;

    for (const t of tenants) {
        const tenantId = t.original_id;
        if (!tenantId) continue;

        const asm = assumptions.find(a => a.target_id === tenantId);
        const adjs = adjustments.filter(a =>
            a.tenant_id === tenantId &&
            (a.adjustment_kind === 'period_shift' || (a.original_year != null && a.original_year >= 0))
        );

        const currentAdjs = Array.isArray(t.payment_period_adjustments) ? t.payment_period_adjustments : [];
        const currentShift = typeof t.payment_period_shift_months === 'number' ? t.payment_period_shift_months : 0;
        const patch = {};

        const shiftMonths = (asm?.billing_cycle_shift_months != null && Number(asm.billing_cycle_shift_months) !== 0)
            ? Number(asm.billing_cycle_shift_months) : 0;

        if (shiftMonths !== 0 && currentShift === 0) {
            patch.payment_period_shift_months = shiftMonths;
            console.log(`  ${t.name}: 整体偏移 ${shiftMonths > 0 ? '后移' : '前移'}${Math.abs(shiftMonths)}月`);
        }

        const newAdjs = [...currentAdjs];
        for (const adj of adjs) {
            const adjId = `migrated_${adj.original_id || adj.id}`;
            if (newAdjs.some(a => a.id === adjId)) continue;
            newAdjs.push({
                id: adjId,
                originalYear: Number(adj.original_year) >= 0 ? Number(adj.original_year) : new Date().getFullYear(),
                originalMonth: Number(adj.original_month) >= 0 ? Number(adj.original_month) : 0,
                adjustedYear: typeof adj.adjusted_year === 'number' ? adj.adjusted_year : new Date().getFullYear(),
                adjustedMonth: typeof adj.adjusted_month === 'number' ? adj.adjusted_month : 0,
                amount: Math.round(Number(adj.amount || 0)),
                reason: String(adj.reason || '从存量调优迁移'),
            });
        }

        if (newAdjs.length > currentAdjs.length) {
            patch.payment_period_adjustments = newAdjs;
            console.log(`  ${t.name}: 迁移 ${newAdjs.length - currentAdjs.length} 笔单月调整`);
        }

        if (Object.keys(patch).length > 0) {
            await pb.collection('pb_tenants').update(t.id, patch, { requestKey: null });
            migrated++;
        } else {
            skipped++;
        }
    }

    console.log(`  结果: 迁移 ${migrated} 个, 跳过 ${skipped} 个`);
}

console.log('\n✅ 迁移完成');
process.exit(0);
