import { createClient } from '@supabase/supabase-js';
import PocketBase from 'pocketbase';

// 从 App.tsx 中复制的 Supabase 凭证
const SUPABASE_URL = 'https://drbugbbsvnnheuasgvwg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyYnVnYmJzdm5uaGV1YXNndndnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MjI1ODIsImV4cCI6MjA3OTk5ODU4Mn0.fZF27k7dtbzoMK5ZKh_UARPLpy5OxmF9fvVkJMTOIO4';

// PocketBase 配置（需要根据实际情况修改）
const POCKETBASE_URL = 'http://127.0.0.1:8090';
const POCKETBASE_EMAIL = 'admin@example.com';  // 需要修改
const POCKETBASE_PASSWORD = 'your-password';   // 需要修改

// 项目 ID
const PROJECT_ID = 'park_data_main';

async function migrate() {
    console.log('开始数据迁移...\n');
    
    try {
        // 1. 从 Supabase 读取所有备份
        console.log('步骤 1: 连接到 Supabase...');
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        
        const { data: backups, error } = await supabase
            .from('park_backups')
            .select('*')
            .eq('project_id', PROJECT_ID)
            .order('created_at', { ascending: true });
        
        if (error) {
            console.error('❌ 读取 Supabase 数据失败:', error);
            return;
        }
        
        console.log(`✓ 找到 ${backups?.length || 0} 条备份记录\n`);
        
        if (!backups || backups.length === 0) {
            console.log('没有需要迁移的数据');
            return;
        }
        
        // 2. 连接到 PocketBase
        console.log('步骤 2: 连接到 PocketBase...');
        const pb = new PocketBase(POCKETBASE_URL);
        
        // 需要先在 PocketBase Admin UI 中创建用户
        try {
            await pb.collection('users').authWithPassword(POCKETBASE_EMAIL, POCKETBASE_PASSWORD);
            console.log('✓ PocketBase 认证成功\n');
        } catch (authError) {
            console.error('❌ PocketBase 认证失败:', authError);
            console.log('\n请确保：');
            console.log('1. PocketBase 服务器正在运行');
            console.log('2. 已在 Admin UI 中创建用户账号');
            console.log('3. 脚本中的邮箱和密码正确');
            return;
        }
        
        // 3. 迁移数据
        console.log('步骤 3: 开始迁移数据...\n');
        let successCount = 0;
        let failCount = 0;
        
        for (const backup of backups) {
            try {
                await pb.collection('park_backups').create({
                    project_id: backup.project_id,
                    data: backup.data,
                    note: backup.note || '',
                    // PocketBase 会自动设置 created 和 updated 字段
                });
                successCount++;
                console.log(`✓ [${successCount}/${backups.length}] 迁移备份: ${backup.note || backup.id}`);
            } catch (e: any) {
                failCount++;
                console.error(`✗ [${successCount + failCount}/${backups.length}] 迁移备份失败: ${backup.note || backup.id}`, e.message);
            }
        }
        
        // 4. 总结
        console.log('\n================================');
        console.log('迁移完成！');
        console.log(`✓ 成功: ${successCount} 条`);
        console.log(`✗ 失败: ${failCount} 条`);
        console.log('================================\n');
        
        if (successCount > 0) {
            console.log('现在可以在应用的设置面板中：');
            console.log('1. 选择 "PocketBase（推荐）"');
            console.log('2. 填入配置信息');
            console.log('3. 保存配置并测试连接');
        }
        
    } catch (error: any) {
        console.error('❌ 迁移过程发生错误:', error.message);
    }
}

// 执行迁移
console.log('========================================');
console.log('Supabase → PocketBase 数据迁移工具');
console.log('========================================\n');

console.log('注意事项：');
console.log('1. 请确保 PocketBase 服务器正在运行');
console.log('2. 本脚本会向 PocketBase 写入 park_backups；当前产品已废弃该集合，请改用 JSON + scripts/migrate-json-to-pb.mjs 导入 pb_*');
console.log('3. 请修改脚本中的 POCKETBASE_EMAIL 和 POCKETBASE_PASSWORD\n');

const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

readline.question('确认要开始迁移吗？(y/n): ', (answer: string) => {
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        migrate().then(() => {
            readline.close();
            process.exit(0);
        });
    } else {
        console.log('已取消迁移');
        readline.close();
        process.exit(0);
    }
});
