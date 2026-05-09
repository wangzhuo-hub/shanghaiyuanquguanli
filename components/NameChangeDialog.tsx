import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { Tenant, NameChangeRecord } from '../types';

interface Props {
  tenant: Tenant;
  onConfirm: (newName: string, record: NameChangeRecord) => void;
  onClose: () => void;
}

export const NameChangeDialog: React.FC<Props> = ({ tenant, onConfirm, onClose }) => {
  const [newName, setNewName] = useState('');
  const [changedAt, setChangedAt] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const handleConfirm = () => {
    const trimmed = newName.trim();
    if (!trimmed) { setError('请输入新名称'); return; }
    if (trimmed === tenant.name) { setError('新名称与当前名称相同'); return; }
    if (!changedAt) { setError('请选择变更日期'); return; }

    const record: NameChangeRecord = {
      id: `nc_${Date.now()}`,
      oldName: tenant.name,
      newName: trimmed,
      changedAt,
      reason: reason.trim() || undefined,
    };

    onConfirm(trimmed, record);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="text-lg font-bold text-slate-800">变更企业名称</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"><X size={20}/></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">当前名称</label>
            <div className="w-full p-2.5 rounded-lg text-sm bg-slate-50 text-slate-500 border border-slate-200">{tenant.name}</div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">新名称 <span className="text-red-500">*</span></label>
            <input
              type="text"
              className={`w-full border p-2.5 rounded-lg text-sm ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'}`}
              value={newName}
              onChange={e => { setNewName(e.target.value); setError(''); }}
              placeholder="输入新的企业名称"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">变更日期 <span className="text-red-500">*</span></label>
            <input
              type="date"
              className="w-full border border-slate-300 p-2.5 rounded-lg text-sm"
              value={changedAt}
              onChange={e => setChangedAt(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">变更原因</label>
            <textarea
              className="w-full border border-slate-300 p-2.5 rounded-lg text-sm"
              rows={2}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="如：工商变更、业务重组等"
            />
          </div>

          {error && <div className="text-red-500 text-sm">{error}</div>}

          {/* 名称变更历史 */}
          {(tenant.nameHistory && tenant.nameHistory.length > 0) && (
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-2">历史变更记录</label>
              <div className="max-h-32 overflow-y-auto space-y-1.5">
                {[...tenant.nameHistory].reverse().map(r => (
                  <div key={r.id} className="text-xs bg-slate-50 p-2 rounded border border-slate-100">
                    <span className="text-slate-500">{r.oldName}</span>
                    <span className="mx-1.5 text-slate-300">→</span>
                    <span className="font-medium text-slate-700">{r.newName}</span>
                    <span className="ml-2 text-slate-400">{r.changedAt?.slice(0, 10)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg">取消</button>
          <button onClick={handleConfirm} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1.5"><Save size={14}/> 确认变更</button>
        </div>
      </div>
    </div>
  );
};
