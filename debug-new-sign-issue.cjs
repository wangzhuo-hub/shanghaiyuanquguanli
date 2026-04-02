/**
 * 检查管易云为什么被当作新签客户
 */

const fs = require('fs');
const data = JSON.parse(fs.readFileSync('park_data_2026-03-11.json', 'utf8'));

const guanyiyunId = 't1772517163739';
const gy = data.tenants.find(t => t.id === guanyiyunId);

console.log('=== 管易云签约信息 ===');
console.log('signingDate:', gy.signingDate);
console.log('leaseStart:', gy.leaseStart);

// 检查所有预算方案
console.log('\n=== 预算方案检查 ===');

if (data.budgetScenarios && data.budgetScenarios.length > 0) {
    data.budgetScenarios.forEach(s => {
        console.log(`\n--- 方案: ${s.name} (${s.id}) ---`);
        console.log('isActive:', s.isActive);
        console.log('snapshotDate:', s.snapshotDate);
        console.log('createdAt:', s.createdAt);
        
        if (s.baseDataSnapshot) {
            const snapshotTenantIds = s.baseDataSnapshot.tenants ? s.baseDataSnapshot.tenants.map(t => t.id) : [];
            console.log('快照中租户数:', snapshotTenantIds.length);
            console.log('管易云在快照中:', snapshotTenantIds.includes(guanyiyunId) ? '是' : '否');
            
            // 检查快照中管易云的数据
            if (s.baseDataSnapshot.tenants) {
                const gyInSnapshot = s.baseDataSnapshot.tenants.find(t => t.id === guanyiyunId);
                if (gyInSnapshot) {
                    console.log('快照中管易云的 signingDate:', gyInSnapshot.signingDate);
                    console.log('快照中管易云的 leaseStart:', gyInSnapshot.leaseStart);
                }
            }
        } else {
            console.log('baseDataSnapshot: 无快照数据');
        }
        
        // 计算 cutoff
        const cutoff = s.snapshotDate || (s.createdAt ? s.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
        console.log('计算得到的 cutoff:', cutoff);
        
        // 判断管易云是新签还是存量
        const signDate = gy.signingDate || gy.leaseStart;
        const isNewSign = signDate > cutoff;
        console.log(`signDate (${signDate}) > cutoff (${cutoff}):`, isNewSign);
        console.log('结论: 管易云被判定为', isNewSign ? '新签客户' : '存量客户');
    });
} else {
    console.log('没有 budgetScenarios 数据');
    
    // 检查其他可能的方案存储位置
    console.log('\n检查其他可能的方案存储位置...');
    const possibleKeys = ['scenarios', 'budgets', 'plans'];
    possibleKeys.forEach(key => {
        if (data[key]) {
            console.log(`找到 ${key}:`, typeof data[key], Array.isArray(data[key]) ? `数组 ${data[key].length} 项` : '');
        }
    });
}

// 模拟前端代码中的 effectiveData 计算
console.log('\n\n=== 模拟 effectiveData 计算 ===');

// 假设 scenarios 来自某个地方
// 检查是否有存储的方案数据

// 模拟 invoice_dedicated 模式下的 effectiveData
const scenarios = data.budgetScenarios || [];
const activeScenario = scenarios.find(s => s.isActive);

console.log('找到活跃方案:', activeScenario ? activeScenario.name : '无');

if (activeScenario) {
    const cutoff = activeScenario.snapshotDate || activeScenario.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const snapshotTenants = activeScenario.baseDataSnapshot?.tenants || data.tenants;
    const snapshotIdSet = new Set(snapshotTenants.map(st => st.id));
    
    console.log('cutoff:', cutoff);
    console.log('snapshotTenants count:', snapshotTenants.length);
    console.log('管易云在 snapshotIdSet 中:', snapshotIdSet.has(guanyiyunId));
    
    // 检查第1步逻辑
    const signDate = gy.signingDate || gy.leaseStart;
    const signDateBeforeCutoff = signDate <= cutoff;
    console.log(`\n第1步检查: signDate (${signDate}) <= cutoff (${cutoff}): ${signDateBeforeCutoff}`);
    
    if (signDateBeforeCutoff) {
        console.log('→ 管易云应该在第1步被处理（存量客户）');
    } else {
        console.log('→ 管易云会在第2步被处理（新签客户）');
    }
    
    // 检查第2步逻辑
    const isNewSign = signDate > cutoff;
    const isNotInSnapshot = !snapshotIdSet.has(guanyiyunId);
    console.log(`\n第2步检查:`);
    console.log(`  isNewSign (signDate > cutoff): ${isNewSign}`);
    console.log(`  isNotInSnapshot: ${isNotInSnapshot}`);
    console.log(`  条件 !isNewSign && !isNotInSnapshot: ${!isNewSign && !isNotInSnapshot}`);
    
    if (!isNewSign && !isNotInSnapshot) {
        console.log('→ 第2步会 return，跳过管易云');
    } else {
        console.log('→ 管易云会在第2步被处理为新签客户 ⚠️');
    }
}