/**
 * PocketBase数据导入脚本
 * 将从Supabase导出的数据导入到PocketBase
 */

import PocketBase from 'pocketbase';
import * as fs from 'fs';
import * as path from 'path';

const POCKETBASE_URL = 'http://127.0.0.1:8091';
const pb = new PocketBase(POCKETBASE_URL);

async function importData() {
  console.log('🔄 正在连接PocketBase...');
  
  try {
    // 检查PocketBase是否运行
    try {
      await fetch(`${POCKETBASE_URL}/api/health`);
    } catch (e) {
      throw new Error('PocketBase未运行，请先启动: ./pocketbase serve --http=127.0.0.1:8091');
    }

    // 读取导出的数据
    const exportPath = path.join(process.cwd(), 'supabase-backup-export.json');
    if (!fs.existsSync(exportPath)) {
      throw new Error(`未找到导出文件: ${exportPath}\n请确保已从Supabase导出数据或使用现有的备份文件`);
    }

    const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
    console.log(`✅ 找到导出数据: ${exportData.name}`);
    console.log(`📅 创建时间: ${exportData.created_at}`);

    // 导入到PocketBase
    console.log('\n📥 正在导入到PocketBase...');
    
    const record = await pb.collection('park_leasing_backups').create({
      name: exportData.name,
      data: exportData.data
    });

    console.log(`✅ 导入成功！记录ID: ${record.id}`);
    
    // 验证导入
    const records = await pb.collection('park_leasing_backups').getList(1, 1, {
      sort: '-created'
    });
    
    console.log(`\n📊 当前PocketBase中共有 ${records.totalItems} 条备份记录`);
    
    if (exportData.data.users && exportData.data.users.length > 0) {
      console.log(`\n👥 用户数据已导入，共 ${exportData.data.users.length} 个用户：`);
      exportData.data.users.forEach((user: any) => {
        console.log(`  - ${user.name} (${user.username})`);
      });
    }

    console.log('\n🎉 导入完成！现在可以使用导入的账号登录了。');

  } catch (error: any) {
    console.error('❌ 导入失败:', error.message);
    process.exit(1);
  }
}

importData();
