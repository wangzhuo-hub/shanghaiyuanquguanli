import React, { useEffect, useMemo, useState } from 'react';
import { resolveTenantAssetLabels } from './ContractSummaryModal';
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

type Theme = 'emerald' | 'indigo';

const themeClasses: Record<
  Theme,
  { border: string; hover: string; selectedBg: string; label: string }
> = {
  emerald: {
    border: 'border-emerald-200',
    hover: 'hover:bg-emerald-50/60',
    selectedBg: 'bg-white',
    label: 'text-emerald-700',
  },
  indigo: {
    border: 'border-indigo-200',
    hover: 'hover:bg-indigo-50/60',
    selectedBg: 'bg-white',
    label: 'text-indigo-700',
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
    <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
      <span className="font-mono">合同 {meta.contractCode}</span>
      <span className="text-slate-300 mx-1">·</span>
      <span>房号 {meta.unitNames}</span>
      {meta.buildingLabel && meta.buildingLabel !== '未知楼宇' ? (
        <>
          <span className="text-slate-300 mx-1">·</span>
          <span>{meta.buildingLabel}</span>
        </>
      ) : null}
      {suffix ? (
        <>
          <span className="text-slate-300 mx-1">·</span>
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
  theme = 'emerald',
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
      <div className={`border rounded-lg p-2 ${classes.border} ${classes.selectedBg}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-800 truncate">{selectedTenant.name}</div>
            <TenantPickerSubline tenant={selectedTenant} buildings={buildings} suffix={suffix} />
          </div>
          <button
            type="button"
            onClick={handleReselect}
            className={`text-[11px] shrink-0 hover:underline ${classes.label}`}
          >
            重选
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <input
        type="search"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder={placeholder}
        className={`w-full p-2 rounded border text-sm ${classes.border} bg-white`}
        autoComplete="off"
      />
      <div
        className={`max-h-[240px] overflow-y-auto rounded-lg border bg-white divide-y divide-slate-100 ${classes.border}`}
      >
        {candidates.length === 0 ? (
          <div className="p-3 text-center text-slate-400 text-xs">无匹配客户</div>
        ) : (
          candidates.map((t) => {
            const suffix = getOptionSuffix?.(t);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelect(t.id)}
                className={`w-full text-left px-2 py-2 ${classes.hover}`}
              >
                <div className="text-sm font-medium text-slate-800 leading-snug">{t.name}</div>
                <TenantPickerSubline tenant={t} buildings={buildings} suffix={suffix} />
              </button>
            );
          })
        )}
      </div>
      {!keyword.trim() && sortedTenants.length > maxResults ? (
        <p className="text-[10px] text-slate-400">输入关键字可缩小范围（默认展示前 {maxResults} 条）</p>
      ) : null}
    </div>
  );
}
