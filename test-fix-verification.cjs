/**
 * 完整测试：模拟修复后的 generateInvoiceBillingDetails 函数
 * 验证管易云是否还会重复出现
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
console.log('status:', gy.status);

// 模拟修复后的 generateInvoiceBillingDetails 逻辑
function simulateGenerateInvoiceBillingDetails(cutoff, snapshotTenants, fallbackTenants) {
    console.log('\n--- 模拟 generateInvoiceBillingDetails ---');
    console.log('cutoff:', cutoff);
    console.log('snapshotTenants count:', snapshotTenants.length);
    console.log('fallbackTenants count:', fallbackTenants.length);

    const snapshotIdSet = new Set(snapshotTenants.map(st => st.id));
    const expiredOrTerminatedLiveIds = new Set(
        fallbackTenants
            .filter(lt => lt.status === ContractStatus.Terminated || lt.status === ContractStatus.Expired)
            .map(lt => lt.id)
    );

    const processedIds = new Set();
    const details = [];

    // 第1步：存量客户（修复后的逻辑）
    console.log('\n第1步：存量客户处理（修复后）');
    let gyStep1Processed = false;
    snapshotTenants.forEach(t => {
        if (t.status === ContractStatus.Terminated || t.status === ContractStatus.Expired) return;
        if (expiredOrTerminatedLiveIds.has(t.id)) return;
        const signDate = t.signingDate || t.leaseStart;
        if (signDate > cutoff) return;
        const isSelfUse = false; // 简化处理

        // 关键修复：只要是存量客户，就标记为已处理
        processedIds.add(t.id);

        if (t.id === guanyiyunId) {
            gyStep1Processed = true;
            console.log(`  管易云被标记为已处理（存量客户）`);
            details.push({ tenantId: t.id, tenantName: t.name, source: '第1步-存量客户' });
        }
    });

    // 第2步：新签客户
    console.log('\n第2步：新签客户处理');
    let gyStep2Processed = false;
    fallbackTenants.forEach(t => {
        if (t.status === ContractStatus.Terminated || t.status === ContractStatus.Expired) return;
        if (processedIds.has(t.id)) return; // 防止重复

        const signDate = t.signingDate || t.leaseStart;
        const isNewSign = signDate > cutoff;
        const isNotInSnapshot = !snapshotIdSet.has(t.id);
        if (!isNewSign && !isNotInSnapshot) return;

        if (t.id === guanyiyunId) {
            gyStep2Processed = true;
            console.log(`  管易云被处理为新签客户`);
            console.log(`  isNewSign=${isNewSign}, isNotInSnapshot=${isNotInSnapshot}`);
            details.push({ tenantId: t.id, tenantName: t.name, source: '第2步-新签客户' });
        }
    });

    console.log('\n--- 结果 ---');
    console.log('管易云在第1步被处理:', gyStep1Processed);
    console.log('管易云在第2步被处理:', gyStep2Processed);

    const gyDetails = details.filter(d => d.tenantId === guanyiyunId);
    console.log('管易云出现在结果中的次数:', gyDetails.length);
    if (gyDetails.length > 1) {
        console.log('⚠️ 仍然重复！');
        gyDetails.forEach(d => console.log(`  - ${d.source}`));
        return false;
    } else if (gyDetails.length === 1) {
        console.log('✓ 正常：只出现一次');
        console.log(`  来源: ${gyDetails[0].source}`);
        return true;
    } else {
        console.log('✗ 异常：管易云未出现');
        return false;
    }
}

// 测试场景1：快照包含管易云（典型情况）
console.log('\n\n========== 测试场景1：快照包含管易云 ==========');
const cutoff1 = '2026-01-01';
const snapshotTenants1 = data.tenants.filter(t => t.signingDate <= cutoff1);
const fallbackTenants1 = data.tenants;
const result1 = simulateGenerateInvoiceBillingDetails(cutoff1, snapshotTenants1, fallbackTenants1);

// 测试场景2：快照不包含管易云（边缘情况）
console.log('\n\n========== 测试场景2：快照不包含管易云 ==========');
const cutoff2 = '2026-01-01';
const snapshotTenants2 = data.tenants.filter(t => t.id !== guanyiyunId && t.signingDate <= cutoff2);
const fallbackTenants2 = data.tenants;
const result2 = simulateGenerateInvoiceBillingDetails(cutoff2, snapshotTenants2, fallbackTenants2);

// 测试场景3：管易云签约日期晚于 cutoff
console.log('\n\n========== 测试场景3：管易云签约日期晚于cutoff ==========');
const cutoff3 = '2024-10-01'; // 早于管易云签约日期 2024-11-01
const snapshotTenants3 = data.tenants.filter(t => t.signingDate <= cutoff3);
const fallbackTenants3 = data.tenants;
const result3 = simulateGenerateInvoiceBillingDetails(cutoff3, snapshotTenants3, fallbackTenants3);

console.log('\n\n========== 总结 ==========');
console.log('场景1（快照包含管易云）:', result1 ? '✓ 通过' : '✗ 失败');
console.log('场景2（快照不包含管易云）:', result2 ? '✓ 通过' : '✗ 失败');
console.log('场景3（管易云签约晚于cutoff）:', result3 ? '✓ 通过' : '✗ 失败');

if (result1 && result2 && result3) {
    console.log('\n🎉 所有测试通过！修复有效。');
} else {
    console.log('\n⚠️ 部分测试失败，需要进一步检查。');
}