import React, { useEffect, useState } from 'react';
import { Building2, History, X, Save } from 'lucide-react';
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
    <div className="liquid-elevated-backdrop fixed inset-0 z-[9999] flex items-end justify-center p-3 sm:p-4 md:items-center" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-change-dialog-title"
        className="liquid-elevated-panel flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="liquid-elevated-header flex items-start justify-between gap-3 border-b border-white/60 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="liquid-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-blue-700">
              <Building2 size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase text-blue-700/75">Name Change</p>
              <h3 id="name-change-dialog-title" className="truncate text-lg font-black text-slate-950">变更企业名称</h3>
            </div>
          </div>
          <button onClick={onClose} className="liquid-glass-control liquid-pressable inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:text-slate-900" aria-label="关闭名称变更"><X size={18}/></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          <div>
            <label className="mb-1.5 block text-xs font-black text-slate-500">当前名称</label>
            <div className="liquid-glass-readable w-full rounded-2xl px-3.5 py-3 text-sm font-bold text-slate-700">{tenant.name}</div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-black text-slate-500">新名称 <span className="text-rose-500">*</span></label>
            <input
              type="text"
              className={`liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-base font-black text-slate-950 outline-none focus:ring-4 focus:ring-blue-500/10 md:text-sm md:font-semibold md:text-slate-900 ${error ? 'border-rose-300 bg-rose-50/80' : ''}`}
              value={newName}
              onChange={e => { setNewName(e.target.value); setError(''); }}
              placeholder="输入新的企业名称"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-black text-slate-500">变更日期 <span className="text-rose-500">*</span></label>
            <input
              type="date"
              className="liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-base font-black tabular-nums text-slate-950 outline-none focus:ring-4 focus:ring-blue-500/10 md:text-sm md:font-semibold md:text-slate-900"
              value={changedAt}
              onChange={e => setChangedAt(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-black text-slate-500">变更原因</label>
            <textarea
              className="liquid-elevated-field w-full resize-none rounded-2xl px-3.5 py-3 text-base font-semibold leading-relaxed text-slate-950 outline-none focus:ring-4 focus:ring-blue-500/10 md:text-sm md:text-slate-900"
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="如：工商变更、业务重组等"
            />
          </div>

          {error && <div className="liquid-elevated-alert rounded-2xl px-3.5 py-2.5 text-sm font-bold">{error}</div>}

          {/* 名称变更历史 */}
          {(tenant.nameHistory && tenant.nameHistory.length > 0) && (
            <div>
              <label className="mb-2 flex items-center gap-1.5 text-xs font-black text-slate-500"><History size={13}/> 历史变更记录</label>
              <div className="liquid-glass-readable max-h-36 space-y-1.5 overflow-y-auto rounded-2xl p-2">
                {[...tenant.nameHistory].reverse().map(r => (
                  <div key={r.id} className="liquid-elevated-history-row rounded-xl p-2 text-xs">
                    <div className="font-bold text-slate-700">
                      <span className="text-slate-500">{r.oldName}</span>
                      <span className="mx-1.5 font-black text-slate-500">→</span>
                      <span className="text-slate-900">{r.newName}</span>
                    </div>
                    <div className="mt-1 text-xs font-bold text-slate-500">{r.changedAt?.slice(0, 10)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="liquid-elevated-footer grid grid-cols-2 gap-2 border-t border-white/60 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:flex sm:justify-end sm:px-5 sm:pb-4">
          <button onClick={onClose} className="liquid-glass-control liquid-pressable rounded-full px-4 py-2.5 text-sm font-black text-slate-600">取消</button>
          <button onClick={handleConfirm} className="liquid-action-strong liquid-pressable flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-black"><Save size={14}/> 确认变更</button>
        </div>
      </section>
    </div>
  );
};
