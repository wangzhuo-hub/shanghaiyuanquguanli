import React, { useState, useRef, useEffect } from 'react';
import { AppData, CloudSnapshot, User, UserRole } from '../types';
import { Save, Upload, Download, Cloud, RefreshCw, Trash2, Database, AlertCircle, CheckCircle, X, Globe, History, ShieldCheck, UserPlus, Key, Edit2, Shield, User as UserIcon, AtSign, UserCheck, CloudOff, Sparkles } from 'lucide-react';
import { pb, getAllBackups } from '../services/pocketbase';

interface SettingsProps {
  isAdmin: boolean;
  users: User[];
  onUpdateUsers: (users: User[]) => void;
  currentData: AppData;
  onRestoreData: (data: AppData) => void;
}

const DB_TABLE_NAME = 'park_leasing_backups';

export const Settings: React.FC<SettingsProps> = ({ isAdmin, users = [], onUpdateUsers, currentData, onRestoreData }) => {
  const [snapshots, setSnapshots] = useState<CloudSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Partial<User> | null>(null);
  
  // AI API配置状态
  const [aiProvider, setAiProvider] = useState('qwen');
  const [aiApiKey, setAiApiKey] = useState('sk-sp-1b86ef09510e4e1683454766f375ad1b');
  const [aiBaseUrl, setAiBaseUrl] = useState('https://coding.dashscope.aliyuncs.com/v1');
  const [aiEnabled, setAiEnabled] = useState(true);

  // Retrieve current user from session
  const currentUserJson = localStorage.getItem('park_leasing_auth');
  const currentUser = currentUserJson ? JSON.parse(currentUserJson) : null;

  const [profileForm, setProfileForm] = useState<Partial<User>>({
    username: currentUser?.username || '',
    name: currentUser?.name || '',
    password: currentUser?.password || ''
  });

  useEffect(() => {
    fetchSnapshots();
  }, []);

  const fetchSnapshots = async () => {
    setLoading(true);
    try {
      const backups = await getAllBackups();
      setSnapshots(backups.map((item: any) => ({ 
        id: item.id, 
        name: item.name, 
        createdAt: item.created, 
        data: {} // 不加载完整数据，仅显示列表
      })));
    } catch (error: any) {} finally { setLoading(false); }
  };

  const handleUpdateMyProfile = () => {
    if (!currentUser) return;
    
    // Check if new username is already taken by another user
    const isUsernameTaken = (users || []).some(u => u.username === profileForm.username && u.id !== currentUser.id);
    if (isUsernameTaken) {
      alert('❌ 该用户名已被占用，请尝试其他名称。');
      return;
    }

    const updatedUsers = (users || []).map(u => u.id === currentUser.id ? { 
      ...u, 
      username: profileForm.username!,
      name: profileForm.name!, 
      password: profileForm.password! 
    } : u);
    
    onUpdateUsers(updatedUsers);
    
    // Also update local storage session for the current session consistency
    const updatedMe = { 
      ...currentUser, 
      username: profileForm.username!,
      name: profileForm.name!, 
      password: profileForm.password! 
    };
    localStorage.setItem('park_leasing_auth', JSON.stringify(updatedMe));
    alert('✅ 个人档案已更新！变更将在下次登录时生效，当前会话已实时同步。');
    
    // Refresh page to sync UI
    window.location.reload();
  };

  const handleOpenCreate = () => {
    setEditingUser({ username: '', password: '123', name: '', role: UserRole.USER });
    setIsUserModalOpen(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser({ ...user });
    setIsUserModalOpen(true);
  };

  const handleSaveUser = () => {
    if (!editingUser?.username || !editingUser?.name || !editingUser?.password) return alert('请填写完整信息');
    
    // Check for duplicate username on creation
    if (!editingUser.id && (users || []).some(u => u.username === editingUser.username)) {
      return alert('❌ 登录账号已存在');
    }

    if (editingUser.id) {
      onUpdateUsers((users || []).map(u => u.id === editingUser.id ? (editingUser as User) : u));
    } else {
      const newUser: User = { 
        ...editingUser as User,
        id: `U-${Date.now()}`
      };
      onUpdateUsers([...(users || []), newUser]);
    }
    setIsUserModalOpen(false);
    setEditingUser(null);
  };

  const handleDeleteUser = (id: string) => {
    if (id === 'U-ADMIN') return alert('系统内置管理员账户不可删除');
    if (id === currentUser.id) return alert('您无法删除自己当前正在使用的账号');
    if (confirm('确认注销并删除该招商经理账号？此操作将立即在备份数据中生效。')) {
      onUpdateUsers((users || []).filter(u => u.id !== id));
    }
  };

  // AI API配置保存
  const handleSaveAIConfig = () => {
    // 这里可以保存到localStorage或后端
    localStorage.setItem('ai_config', JSON.stringify({
      provider: aiProvider,
      apiKey: aiApiKey,
      baseUrl: aiBaseUrl,
      enabled: aiEnabled
    }));
    alert('✅ AI配置已保存');
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-10">
      <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2 text-slate-900"><Database className="text-indigo-600"/> 系统设置与管理</h1>
            <p className="text-slate-500 text-sm">个人档案维护、云端同步与招商经理权限管理</p>
          </div>
          {isAdmin && (
            <button onClick={handleOpenCreate} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95">
              <UserPlus size={18}/> 新增招商账户
            </button>
          )}
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-6 py-4 border-b flex justify-between items-center">
              <h2 className="font-bold text-slate-900 flex items-center gap-2 text-sm uppercase tracking-wider"><UserIcon size={18} className="text-indigo-600"/> 我的档案 (My Profile)</h2>
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 bg-white px-2 py-1 rounded-lg border">
                <Shield size={12}/> 当前权限：{currentUser?.role}
              </div>
          </div>
          <div className="p-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                      <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">登录名 (Account)</label>
                      <div className="relative">
                        <AtSign className="absolute left-3 top-3.5 text-slate-300" size={14}/>
                        <input className="w-full border border-slate-200 rounded-xl p-3.5 pl-9 text-sm font-mono font-bold focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50 transition-all" value={profileForm.username} onChange={e=>setProfileForm({...profileForm, username: e.target.value})}/>
                      </div>
                  </div>
                  <div>
                      <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">显示姓名 (Name)</label>
                      <input className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50 transition-all" value={profileForm.name} onChange={e=>setProfileForm({...profileForm, name: e.target.value})}/>
                  </div>
                  <div>
                      <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">登录密码 (Password)</label>
                      <div className="relative">
                        <Key className="absolute left-3 top-3.5 text-slate-300" size={14}/>
                        <input type="password" className="w-full border border-slate-200 rounded-xl p-3.5 pl-9 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50 transition-all" value={profileForm.password} onChange={e=>setProfileForm({...profileForm, password: e.target.value})}/>
                      </div>
                  </div>
              </div>
              <div className="flex justify-end pt-2">
                  <button onClick={handleUpdateMyProfile} className="bg-indigo-600 text-white px-10 py-3 rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center gap-2">
                    <Save size={18}/> 确认修改并保存
                  </button>
              </div>
          </div>
      </section>

      {isAdmin && (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 px-6 py-4 border-b flex justify-between items-center">
                <h2 className="font-bold text-slate-900 flex items-center gap-2 text-sm uppercase tracking-wider"><ShieldCheck size={18} className="text-indigo-600"/> 招商部全员账户管理</h2>
                <div className="px-3 py-1 bg-white border rounded-full text-[10px] font-black text-slate-400">Total: {users?.length || 0} Users</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <tr>
                    <th className="px-6 py-4">人员</th>
                    <th className="px-6 py-4">账号</th>
                    <th className="px-6 py-4">权限角色</th>
                    <th className="px-6 py-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(users || []).map(u => (
                    <tr key={u.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-sm transition-all group-hover:scale-105 ${u.role === UserRole.ADMIN ? 'bg-indigo-600 text-white' : 'bg-white border text-slate-500'}`}>{u.name[0]}</div>
                          <span className="font-black text-slate-900">{u.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-500 text-xs">@{u.username}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 w-fit ${u.role === UserRole.ADMIN ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
                          {u.role === UserRole.ADMIN ? <Shield size={10}/> : <UserCheck size={10}/>}
                          {u.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => handleOpenEdit(u)} className="p-2 text-slate-400 hover:text-indigo-600 transition-all hover:bg-white rounded-lg"><Edit2 size={16}/></button>
                          {u.id !== 'U-ADMIN' && (
                            <button onClick={() => handleDeleteUser(u.id)} className="p-2 text-slate-400 hover:text-rose-500 transition-all hover:bg-white rounded-lg"><Trash2 size={16}/></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </section>
      )}

      {/* AI 助手配置 */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-slate-50 px-6 py-4 border-b flex justify-between items-center">
          <h2 className="font-bold text-slate-900 flex items-center gap-2 text-sm uppercase tracking-wider">
            <Sparkles size={18} className="text-purple-600"/> AI 助手配置
          </h2>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              aiEnabled ? 'bg-emerald-500' : 'bg-slate-300'
            }`}></div>
            <span className="text-xs font-bold text-slate-500">
              {aiEnabled ? '✅ 已启用' : '⚪ 未启用'}
            </span>
          </div>
        </div>
        <div className="p-8 space-y-6">
          <div className="grid grid-cols-1 gap-6">
            <div>
              <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">
                AI 提供商
              </label>
              <select
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50 transition-all"
              >
                <option value="qwen">千问 (Qwen) - 阿里云（推荐）</option>
                <option value="openai">OpenAI</option>
                <option value="claude">Claude</option>
                <option value="custom">自定义</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">
                千问 API Key
              </label>
              <input
                type="password"
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50 transition-all"
                placeholder="sk-sp-..."
              />
              <p className="text-xs text-slate-400 mt-2">
                获取地址：<a href="https://dashscope.aliyun.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">阿里云控制台</a>
              </p>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">
                Base URL
              </label>
              <select
                value={aiBaseUrl}
                onChange={(e) => setAiBaseUrl(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none bg-slate-50 transition-all"
              >
                <option value="https://coding.dashscope.aliyuncs.com/v1">OpenAI 兼容协议（推荐）</option>
                <option value="https://coding.dashscope.aliyuncs.com/apps/anthropic">Anthropic 兼容协议</option>
              </select>
              <p className="text-xs text-slate-400 mt-2">
                选择你的 AI 工具支持的 API 协议
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
            <input
              type="checkbox"
              id="aiEnabled"
              checked={aiEnabled}
              onChange={(e) => setAiEnabled(e.target.checked)}
              className="w-5 h-5 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-500"
            />
            <label htmlFor="aiEnabled" className="text-sm font-bold text-slate-700 cursor-pointer">
              启用 AI 助手
            </label>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSaveAIConfig}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-10 py-3 rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 hover:shadow-xl transition-all flex items-center gap-2 active:scale-95"
            >
              <Save size={18}/> 保存 AI 配置
            </button>
          </div>
        </div>
      </section>

      {isUserModalOpen && isAdmin && editingUser && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white p-8 rounded-2xl w-[450px] shadow-2xl animate-in zoom-in-95 duration-200">
              <h2 className="text-lg font-bold mb-8 flex items-center gap-3 text-slate-900">
                {editingUser.id ? <Edit2 className="text-indigo-600"/> : <UserPlus className="text-indigo-600"/>}
                {editingUser.id ? '编辑账户信息' : '创建招商部新账户'}
              </h2>
              <div className="space-y-5">
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">人员显示姓名</label>
                    <input className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" value={editingUser.name} onChange={e=>setEditingUser({...editingUser, name:e.target.value})} placeholder="例如: 招商经理C" />
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">登录账号 (Username)</label>
                    <input className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-mono font-bold focus:ring-2 focus:ring-indigo-500 outline-none" value={editingUser.username} onChange={e=>setEditingUser({...editingUser, username:e.target.value})} placeholder="唯一登录账号" disabled={editingUser.id === 'U-ADMIN'}/>
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">系统初始密码</label>
                    <div className="relative">
                      <Key className="absolute left-3 top-3.5 text-slate-300" size={14}/>
                      <input type="text" className="w-full border border-slate-200 rounded-xl p-3.5 pl-9 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" value={editingUser.password} onChange={e=>setEditingUser({...editingUser, password:e.target.value})} />
                    </div>
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">职能权限定义</label>
                    <select className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold bg-white focus:ring-2 focus:ring-indigo-500 outline-none appearance-none" value={editingUser.role} onChange={e=>setEditingUser({...editingUser, role:e.target.value as UserRole})} disabled={editingUser.id === 'U-ADMIN'}>
                       {Object.values(UserRole).map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                 </div>
              </div>
              <div className="mt-10 flex justify-end gap-3 pt-6 border-t border-slate-100">
                 <button onClick={()=>setIsUserModalOpen(false)} className="px-6 py-2.5 text-slate-500 text-sm font-bold">取消</button>
                 <button onClick={handleSaveUser} className="bg-indigo-600 text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95">确认保存</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};
