/**
 * 最终验证：检查 ID 是否一致
 */

const { execSync } = require('child_process');

// 获取 pb_tenants 中的 original_id
const tenantsOutput = execSync(
    `cd "/Volumes/pocketbase数据库/招商管理信息化/上海园区招商管理看板（本地部署及千问AI）/pocketbase/pb_data" && sqlite3 data.db "SELECT name, original_id FROM pb_tenants WHERE name LIKE '%管易%' OR name LIKE '%禅定%';"`,
    { encoding: 'utf-8' }
);

// 获取快照中的 ID
const snapshotOutput = execSync(
    `cd "/Volumes/pocketbase数据库/招商管理信息化/上海园区招商管理看板（本地部署及千问AI）/pocketbase/pb_data" && sqlite3 data.db "SELECT base_data_snapshot FROM pb_budget_scenarios WHERE is_active = 1;"`,
    { encoding: 'utf-8' }
);

const snapshot = JSON.parse(snapshotOutput);
const snapshotTenants = snapshot.tenants || [];

console.log('=== ID 一致性验证 ===\n');

// 检查管易云
const gyTenant = tenantsOutput.split('\n').find(line => line.includes('管易'));
const gySnapshot = snapshotTenants.find(t => t.name && t.name.includes('管易'));

console.log('管易云:');
console.log('  pb_tenants.original_id:', gyTenant ? gyTenant.split('|')[1] : '未找到');
console.log('  快照中的 id:', gySnapshot ? gySnapshot.id : '未找到');
console.log('  一致:', gyTenant && gySnapshot && gyTenant.split('|')[1] === gySnapshot.id ? '✅ 是' : '❌ 否');

// 检查禅定信息
const zdTenant = tenantsOutput.split('\n').find(line => line.includes('禅定'));
const zdSnapshot = snapshotTenants.find(t => t.name && t.name.includes('禅定'));

console.log('\n禅定信息:');
console.log('  pb_tenants.original_id:', zdTenant ? zdTenant.split('|')[1] : '未找到');
console.log('  快照中的 id:', zdSnapshot ? zdSnapshot.id : '未找到');
console.log('  一致:', zdTenant && zdSnapshot && zdTenant.split('|')[1] === zdSnapshot.id ? '✅ 是' : '❌ 否');

// 统计所有不匹配的租户
console.log('\n=== 检查所有租户 ID 是否匹配 ===');

const tenantLines = execSync(
    `cd "/Volumes/pocketbase数据库/招商管理信息化/上海园区招商管理看板（本地部署及千问AI）/pocketbase/pb_data" && sqlite3 data.db "SELECT name, original_id FROM pb_tenants;"`,
    { encoding: 'utf-8' }
).trim().split('\n');

const tenantMap = {};
tenantLines.forEach(line => {
    const [name, originalId] = line.split('|');
    if (name && originalId) {
        tenantMap[name] = originalId;
    }
});

const snapshotTenantMap = {};
snapshotTenants.forEach(t => {
    if (t.name && t.id) {
        snapshotTenantMap[t.name] = t.id;
    }
});

let mismatchCount = 0;
Object.keys(snapshotTenantMap).forEach(name => {
    if (tenantMap[name] && tenantMap[name] !== snapshotTenantMap[name]) {
        mismatchCount++;
        console.log(`⚠️ ${name}: 快照=${snapshotTenantMap[name]}, 实时=${tenantMap[name]}`);
    }
});

if (mismatchCount === 0) {
    console.log('✅ 所有租户 ID 都匹配！');
} else {
    console.log(`\n发现 ${mismatchCount} 个不匹配的租户`);
}