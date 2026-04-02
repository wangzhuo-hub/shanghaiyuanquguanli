/**
 * 完整模拟 generateMonthlyDetail 在 invoice_dedicated 模式下的流程
 * 追踪管易云是否会被重复处理
 */

const fs = require('fs');
const data = JSON.parse(fs.readFileSync('park_data_2026-03-11.json', 'utf8'));

const ContractStatus = {
    Active: 'Active',
    Expiring: 'Expiring',
    Pending: 'Pending',
    Terminated: 'Terminated',
    Expired: 'Expired'
};

// 管易云数据
const guanyiyunId = 't1772517163739';
const gy = data.tenants.find(t => t.id === guanyiyunId);

console.log('=== 管易云基本信息 ===');
console.log('id:', gy.id);
console.log('name:', gy.name);
console.log('signingDate:', gy.signingDate);
console.log('leaseStart:', gy.leaseStart);
console.log('status:', gy.status);

// 模拟场景：有活跃预算方案，有快照
console.log('\n=== 模拟不同快照日期场景 ===');

const testCutoffs = [
    '2024-10-01',  // 早于签约日期
    '2024-11-01',  // 等于签约日期
    '2024-12-01',  // 晚于签约日期
    '2025-01-01',
    '2026-01-01',
];

testCutoffs.forEach(cutoff => {
    console.log(`\n--- cutoff = ${cutoff} ---`);
    
    // 模拟快照租户集合
    // 假设快照中包含所有租户（包括管易云）
    const snapshotTenants = data.tenants.filter(t => t.signingDate <= cutoff);
    const snapshotIdSet = new Set(snapshotTenants.map(t => t.id));
    
    console.log(`快照中租户数: ${snapshotTenants.length}`);
    console.log(`管易云是否在快照中: ${snapshotIdSet.has(guanyiyunId)}`);
    
    // 第1步：存量客户处理
    const processedTenantIds = new Set();
    let step1Processed = false;
    
    snapshotTenants.forEach(t => {
        if (t.status === ContractStatus.Terminated || t.status === ContractStatus.Expired) return;
        const signDate = t.signingDate || t.leaseStart;
        if (signDate > cutoff) return;  // 签约日期晚于快照日期，跳过
        
        // 通过所有过滤条件，标记为已处理
        processedTenantIds.add(t.id);
        
        if (t.id === guanyiyunId) {
            step1Processed = true;
        }
    });
    
    console.log(`第1步处理后 processedTenantIds.size: ${processedTenantIds.size}`);
    console.log(`管易云在第1步被处理: ${step1Processed}`);
    console.log(`管易云ID是否在 processedTenantIds 中: ${processedTenantIds.has(guanyiyunId)}`);
    
    // 第2步：新签客户处理
    const propTenants = data.tenants;  // 实时租户
    let step2Processed = false;
    
    propTenants.forEach(t => {
        if (t.status === ContractStatus.Terminated || t.status === ContractStatus.Expired) return;
        if (processedTenantIds.has(t.id)) return;  // 已在第1步处理过
        
        const signDate = t.signingDate || t.leaseStart;
        const isNewSign = signDate > cutoff;
        const isNotInSnapshot = !snapshotIdSet.has(t.id);
        
        if (!isNewSign && !isNotInSnapshot) return;  // 存量客户且在快照中，跳过
        
        if (t.id === guanyiyunId) {
            step2Processed = true;
            console.log(`第2步处理管易云: isNewSign=${isNewSign}, isNotInSnapshot=${isNotInSnapshot}`);
        }
    });
    
    console.log(`管易云在第2步被处理: ${step2Processed}`);
    
    // 结论
    if (step1Processed && step2Processed) {
        console.log('⚠️ 重复！管易云在第1步和第2步都被处理了！');
    } else if (step1Processed) {
        console.log('✓ 正常：管易云只在第1步被处理');
    } else if (step2Processed) {
        console.log('✓ 正常：管易云只在第2步被处理（作为新签客户）');
    } else {
        console.log('✗ 异常：管易云没有被任何步骤处理');
    }
});

// 特殊情况：快照中不包含管易云
console.log('\n\n=== 特殊情况：快照中不包含管易云 ===');
const cutoff = '2026-01-01';
const snapshotTenantsWithoutGy = data.tenants.filter(t => t.id !== guanyiyunId);
const snapshotIdSetWithoutGy = new Set(snapshotTenantsWithoutGy.map(t => t.id));

console.log(`快照中租户数: ${snapshotTenantsWithoutGy.length}`);
console.log(`管易云是否在快照中: ${snapshotIdSetWithoutGy.has(guanyiyunId)}`);

const processedTenantIds2 = new Set();
snapshotTenantsWithoutGy.forEach(t => {
    if (t.status === ContractStatus.Terminated || t.status === ContractStatus.Expired) return;
    const signDate = t.signingDate || t.leaseStart;
    if (signDate > cutoff) return;
    processedTenantIds2.add(t.id);
});

console.log(`第1步处理后，管易云ID是否在 processedTenantIds 中: ${processedTenantIds2.has(guanyiyunId)}`);

// 第2步检查
const propTenants = data.tenants;
let step2Processed2 = false;
propTenants.forEach(t => {
    if (t.status === ContractStatus.Terminated || t.status === ContractStatus.Expired) return;
    if (processedTenantIds2.has(t.id)) return;
    
    const signDate = t.signingDate || t.leaseStart;
    const isNewSign = signDate > cutoff;
    const isNotInSnapshot = !snapshotIdSetWithoutGy.has(t.id);
    
    if (!isNewSign && !isNotInSnapshot) return;
    
    if (t.id === guanyiyunId) {
        step2Processed2 = true;
        console.log(`第2步处理管易云: isNewSign=${isNewSign}, isNotInSnapshot=${isNotInSnapshot}`);
    }
});

console.log(`管易云在第2步被处理: ${step2Processed2}`);
console.log('结论：如果快照中不包含管易云，它会在第2步作为新签客户被处理一次');

// 检查实际的预算方案数据
console.log('\n\n=== 检查实际数据中的预算方案 ===');
console.log('budgetScenarios:', data.budgetScenarios ? '存在' : '不存在');
if (data.budgetScenarios && data.budgetScenarios.length > 0) {
    data.budgetScenarios.forEach(s => {
        console.log(`\n方案: ${s.name} (${s.id})`);
        console.log('  isActive:', s.isActive);
        console.log('  snapshotDate:', s.snapshotDate);
        console.log('  createdAt:', s.createdAt);
        if (s.baseDataSnapshot) {
            console.log('  baseDataSnapshot.tenants:', s.baseDataSnapshot.tenants ? s.baseDataSnapshot.tenants.length : '无');
            if (s.baseDataSnapshot.tenants) {
                const gyInSnapshot = s.baseDataSnapshot.tenants.find(t => t.id === guanyiyunId);
                console.log('  管易云在快照中:', gyInSnapshot ? '是' : '否');
            }
        } else {
            console.log('  baseDataSnapshot: 无');
        }
    });
} else {
    console.log('没有预算方案数据');
}