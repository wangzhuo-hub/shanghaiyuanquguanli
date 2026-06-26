import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { resolveTenantAssetLabels } from './contractSummaryHelpers';
import type { Building, Tenant } from '../types';

function tenantPickerMeta(tenant: Tenant, buildings: Building[] | undefined) {
  const { buildingLabel, unitNamesLabel } = resolveTenantAssetLabels(tenant, buildings);
  const unitNames = unitNamesLabel?.trim() || '—';
  const contractCode = tenant.id?.trim() || '—';
  const searchHaystack = [tenant.name, contractCode, buildingLabel, unitNames, ...(tenant.unitIds || [])]
    .join(' ')
    .toLowerCase();
  return { contractCode, unitNames, buildingLabel, searchHaystack };
}

type Theme = 'blue' | 'cyan';

const themeClasses: Record<
  Theme,
  { accent: string; option: string; selectedRing: string; label: string }
> = {
  blue: {
    accent: 'text-blue-700',
    option: 'liquid-tenant-picker-option-blue',
    selectedRing: 'ring-blue-100/80',
    label: 'text-blue-700',
  },
  cyan: {
    accent: 'text-cyan-700',
    option: 'liquid-tenant-picker-option-cyan',
    selectedRing: 'ring-cyan-100/80',
    label: 'text-cyan-700',
  },
};

export interface SearchableTenantSelectProps {
  tenants: Tenant[];
  value: string;
  onChange: (tenantId: string) => void;
  /** 用于解析楼宇名、房号及合同编码检索 */
  buildings?: Building[];
  placeholder?: string;
  theme?: Theme;
  filterTenant?: (tenant: Tenant) => boolean;
  getOptionSuffix?: (tenant: Tenant) => string | undefined;
  maxResults?: number;
}

function TenantPickerSubline({
  tenant,
  buildings,
  suffix,
}: {
  tenant: Tenant;
  buildings: Building[] | undefined;
  suffix?: string;
}) {
  const meta = tenantPickerMeta(tenant, buildings);
  return (
    <div className="mt-0.5 text-xs font-semibold leading-snug text-slate-500">
      <span className="font-mono">合同 {meta.contractCode}</span>
      <span className="mx-1 text-slate-400">·</span>
      <span>房号 {meta.unitNames}</span>
      {meta.buildingLabel && meta.buildingLabel !== '未知楼宇' ? (
        <>
          <span className="mx-1 text-slate-400">·</span>
          <span>{meta.buildingLabel}</span>
        </>
      ) : null}
      {suffix ? (
        <>
          <span className="mx-1 text-slate-400">·</span>
          <span>{suffix}</span>
        </>
      ) : null}
    </div>
  );
}

export function SearchableTenantSelect({
  tenants,
  value,
  onChange,
  buildings,
  placeholder = '搜索客户、合同编码或房号…',
  theme = 'blue',
  filterTenant,
  getOptionSuffix,
  maxResults = 80,
}: SearchableTenantSelectProps) {
  const [keyword, setKeyword] = useState('');
  const [isReselecting, setIsReselecting] = useState(false);
  const classes = themeClasses[theme];

  const selectedTenant = useMemo(
    () => tenants.find((t) => t.id === value) ?? null,
    [tenants, value]
  );

  const sortedTenants = useMemo(
    () => [...tenants].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN')),
    [tenants]
  );

  const candidates = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return sortedTenants
      .filter((t) => (filterTenant ? filterTenant(t) : true))
      .filter((t) => {
        if (!kw) return true;
        return tenantPickerMeta(t, buildings).searchHaystack.includes(kw);
      })
      .slice(0, maxResults);
  }, [sortedTenants, keyword, filterTenant, maxResults, buildings]);

  const showPicker = !value || isReselecting;

  useEffect(() => {
    if (value) {
      setIsReselecting(false);
      setKeyword('');
    }
  }, [value]);

  const handleSelect = (tenantId: string) => {
    onChange(tenantId);
    setIsReselecting(false);
    setKeyword('');
  };

  const handleReselect = () => {
    onChange('');
    setIsReselecting(true);
    setKeyword('');
  };

  if (!showPicker && selectedTenant) {
    const suffix = getOptionSuffix?.(selectedTenant);
    return (
      <div className={`liquid-tenant-picker-selected rounded-2xl p-3 ring-1 ${classes.selectedRing}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-slate-950">{selectedTenant.name}</div>
            <TenantPickerSubline tenant={selectedTenant} buildings={buildings} suffix={suffix} />
          </div>
          <button
            type="button"
            onClick={handleReselect}
            className={`liquid-tenant-picker-reselect liquid-pressable inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-black ${classes.label}`}
          >
            <RotateCcw size={12} />
            重选
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="liquid-tenant-picker-input flex min-h-11 items-center gap-2 rounded-2xl px-3.5 py-2.5">
        <Search size={15} className={`shrink-0 ${classes.accent}`} />
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-500"
          autoComplete="off"
        />
      </label>
      <div
        className="liquid-tenant-picker-list max-h-[240px] overflow-y-auto rounded-2xl divide-y divide-slate-100/80"
      >
        {candidates.length === 0 ? (
          <div className="liquid-tenant-picker-empty p-4 text-center text-xs font-bold text-slate-500">无匹配客户</div>
        ) : (
          candidates.map((t) => {
            const suffix = getOptionSuffix?.(t);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelect(t.id)}
                className={`liquid-tenant-picker-option liquid-pressable w-full px-3 py-2.5 text-left transition ${classes.option} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40`}
              >
                <div className="text-sm font-black leading-snug text-slate-950">{t.name}</div>
                <TenantPickerSubline tenant={t} buildings={buildings} suffix={suffix} />
              </button>
            );
          })
        )}
      </div>
      {!keyword.trim() && sortedTenants.length > maxResults ? (
        <p className="liquid-tenant-picker-hint px-1 text-xs font-semibold text-slate-500">输入关键字可缩小范围（默认展示前 {maxResults} 条）</p>
      ) : null}
    </div>
  );
}
