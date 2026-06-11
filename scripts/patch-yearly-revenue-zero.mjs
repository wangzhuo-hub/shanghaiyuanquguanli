/**
 * 将指定园区 pb_yearly_targets.revenue 清零（清除历史手工/导入脏值）
 * 用法: PB_URL=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/patch-yearly-revenue-zero.mjs [project_id...]
 */
import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:1001';
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const YEAR = Number(process.env.YEAR || 2026);
const parks = process.argv.slice(2).length ? process.argv.slice(2) : ['beijing_park', 'shenzhen_park'];

if (!EMAIL || !PASSWORD) {
    console.error('需要 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD');
    process.exit(1);
}

const pb = new PocketBase(PB_URL);

async function auth() {
    try {
        await pb.admins.authWithPassword(EMAIL, PASSWORD);
        return;
    } catch {
        await pb.collection('users').authWithPassword(EMAIL, PASSWORD);
    }
}

async function main() {
    await auth();
    for (const projectId of parks) {
        const rows = await pb.collection('pb_yearly_targets').getList(1, 20, {
            filter: `project_id="${projectId}" && year=${YEAR}`,
        });
        for (const row of rows.items) {
            const prev = row.revenue;
            await pb.collection('pb_yearly_targets').update(row.id, {
                revenue: 0,
                initial_budget: row.initial_budget ?? 0,
                occupancy: row.occupancy ?? 0,
            });
            console.log(`${projectId} ${YEAR}: revenue ${prev} -> 0`);
        }
        if (!rows.items.length) console.log(`${projectId} ${YEAR}: 无记录`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
