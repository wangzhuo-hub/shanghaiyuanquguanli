/**
 * 调试：检查管易云的签约日期和快照日期的关系
 */

const fs = require('fs');
const data = JSON.parse(fs.readFileSync('park_data_2026-03-11.json', 'utf8'));

const guanyiyunId = 't1772517163739';
const gy = data.tenants.find(t => t.id === guanyiyunId);

console.log('=== 管易云关键数据 ===');
console.log('signingDate:', gy.signingDate);
console.log('leaseStart:', gy.leaseStart);
console.log('status:', gy.status);

// 模拟不同场景
const cutoffDates = [
    '2026-01-01',  // 典型快照日期
    '2025-01-01',
    '2024-11-01',  // 与签约日期相同
    '2024-10-01',  // 早于签约日期
];

cutoffDates.forEach(cutoff => {
    const signDate = gy.signingDate || gy.leaseStart;
    const isNewSign = signDate > cutoff;
    
    console.log(`\ncutoff = ${cutoff}:`);
    console.log(`  signDate (${signDate}) > cutoff: ${isNewSign}`);
    
    if (isNewSign) {
        console.log('  → 管易云会被判断为"新签客户"');
    } else {
        console.log('  → 管易云会被判断为"存量客户"');
    }
});

// 检查用户实际的预算方案快照日期
console.log('\n=== 检查预算方案 ===');
console.log('budgetScenarios:', data.budgetScenarios ? '存在' : '不存在');

// 如果快照日期早于签约日期，就会导致问题
console.log('\n=== 问题分析 ===');
console.log('如果快照日期早于 2024-11-01（管易云签约日期）:');
console.log('  第1步: signDate > cutoff 为 true，管易云不会被添加到 processedTenantIds');
console.log('  第2步: isNewSign = true，管易云会被添加为新签客户');
console.log('  但是! 如果管易云在 snapshotIdSet 中，第2步的条件 !isNewSign && !isNotInSnapshot 为 false');
console.log('  所以第2步应该不会处理管易云...');

// 重新模拟逻辑
console.log('\n=== 完整逻辑模拟 ===');

const signDate = gy.signingDate; // 2024-11-01
const cutoff = '2026-01-01'; // 假设的快照日期

console.log('signDate:', signDate);
console.log('cutoff:', cutoff);

// 假设管易云在快照中
const inSnapshot = true;
const inProcessedTenantIds = false; // 第1步会跳过，因为 signDate <= cutoff

console.log('\n第1步判断:');
console.log('  signDate <= cutoff:', signDate <= cutoff);
if (signDate <= cutoff) {
    console.log('  → 进入第1步处理');
    console.log('  → 会被添加到 processedTenantIds');
}

console.log('\n第2步判断:');
console.log('  signDate > cutoff:', signDate > cutoff);
console.log('  inSnapshot:', inSnapshot);
console.log('  isNotInSnapshot:', !inSnapshot);
console.log('  条件 !isNewSign && !isNotInSnapshot:', !inSnapshot && !(signDate > cutoff));
console.log('  → 如果条件为 true，跳过第2步');
console.log('  → 如果条件为 false，进入第2步处理');

// 关键：检查 signDate > cutoff 的值
console.log('\n=== 关键判断 ===');
console.log('signDate > cutoff:', signDate > cutoff);
console.log('由于 2024-11-01 < 2026-01-01，所以 signDate > cutoff = false');
console.log('isNewSign = false');
console.log('isNotInSnapshot 取决于管易云是否在快照中');

// 假设管易云在快照中
const isNewSign = signDate > cutoff; // false
const isNotInSnapshot = false; // 在快照中

console.log('\n最终判断:');
console.log('isNewSign:', isNewSign);
console.log('isNotInSnapshot:', isNotInSnapshot);
console.log('!isNewSign && !isNotInSnapshot:', !isNewSign && !isNotInSnapshot);

if (!isNewSign && !isNotInSnapshot) {
    console.log('→ 条件为 true，第2步会 return，跳过管易云');
} else {
    console.log('→ 条件为 false，第2步会处理管易云 ⚠️');
}

console.log('\n=== 结论 ===');
console.log('如果管易云在快照中，且 signDate <= cutoff:');
console.log('  第1步会处理，添加到 processedTenantIds');
console.log('  第2步会因为 !isNewSign && !isNotInSnapshot = true 而跳过');
console.log('');
console.log('问题可能在于：快照数据与实时数据不一致！');
console.log('或者 snapshotIdSet 的计算有问题');