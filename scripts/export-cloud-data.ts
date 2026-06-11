/**
 * 从云服务器拉取所有园区的备份数据到本地 JSON 文件。
 * 用法: PB_URL=http://127.0.0.1:1001 PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... npx tsx scripts/export-cloud-data.ts
 */
import { initPocketBase, authenticatePocketBase, fetchPocketBaseBackup } from '../services/pocketbaseService';
import { generateInitialData } from '../services/mockData';
import * as fs from 'fs';
import * as path from 'path';

const URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';

const PARKS = ['shanghai_park', 'shenzhen_park', 'beijing_park'];
const OUT_DIR = path.join(__dirname, 'cloud-exports');

async function main() {
    if (!EMAIL || !PASSWORD) {
        console.error('缺少 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD');
        process.exit(1);
    }
    initPocketBase(URL);
    const ok = await authenticatePocketBase(EMAIL, PASSWORD);
    if (!ok) {
        console.error('认证失败');
        process.exit(1);
    }
    console.error(`已连接: ${URL}`);

    fs.mkdirSync(OUT_DIR, { recursive: true });

    for (const park of PARKS) {
        console.error(`\n拉取 ${park}...`);
        const start = performance.now();
        const res = await fetchPocketBaseBackup(park);
        const elapsed = (performance.now() - start) / 1000;

        if (!res.success || !res.data) {
            console.error(`  FAIL: ${res.message}`);
            continue;
        }

        const safe = { ...generateInitialData(), ...res.data };
        const outPath = path.join(OUT_DIR, `${park}.json`);
        fs.writeFileSync(outPath, JSON.stringify(safe, null, 2), 'utf-8');

        const tenants = (safe.tenants || []).length;
        const payments = (safe.payments || []).length;
        const buildings = (safe.buildings || []).length;
        console.error(`  OK: ${tenants} tenants, ${payments} payments, ${buildings} buildings (${elapsed.toFixed(1)}s) → ${outPath}`);
    }
    console.error('\n完成');
}

main().catch(e => { console.error(e); process.exit(1); });
