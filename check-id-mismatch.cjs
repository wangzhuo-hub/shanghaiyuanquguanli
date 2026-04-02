/**
 * 修复快照中租户ID不一致的问题
 * 将实时租户数据同步到快照中
 */

const fs = require('fs');

// 读取 PocketBase 数据库
const { execSync } = require('child_process');

// 获取当前快照
const snapshot = execSync(
    `cd "/Volumes/pocketbase数据库/招商管理信息化/上海园区招商管理看板（本地部署及千问AI）/pocketbase/pb_data" && sqlite3 data.db "SELECT base_data_snapshot FROM pb_budget_scenarios WHERE is_active = 1;"`,
    { encoding: 'utf-8' }
);

const snapshotData = JSON.parse(snapshot);

console.log('=== 快照信息 ===');
console.log('快照中租户数:', snapshotData.tenants ? snapshotData.tenants.length : 0);

// 找出快照中有但实时数据中没有的租户
const tenantFile = '/Volumes/pocketbase数据库/招商管理信息化/上海园区招商管理看板（本地部署及千问AI）/park_data_2026-03-11.json';
const liveData = JSON.parse(fs.readFileSync(tenantFile, 'utf-8'));

console.log('实时数据租户数:', liveData.tenants ? liveData.tenants.length : 0);

// 建立名称到实时ID的映射
const nameToLiveId = {};
liveData.tenants.forEach(t => {
    nameToLiveId[t.name] = t.id;
});

// 检查快照中的租户ID是否与实时数据匹配
console.log('\n=== ID 不匹配的租户 ===');
const mismatches = [];
snapshotData.tenants.forEach(t => {
    const liveId = nameToLiveId[t.name];
    if (liveId && liveId !== t.id) {
        console.log(`  ${t.name}: 快照ID=${t.id}, 实时ID=${liveId}`);
        mismatches.push({ name: t.name, oldId: t.id, newId: liveId });
    }
});

if (mismatches.length === 0) {
    console.log('没有发现ID不匹配的租户');
} else {
    console.log(`\n发现 ${mismatches.length} 个ID不匹配的租户`);
    console.log('\n请在应用中重新保存预算方案以更新快照数据');
}