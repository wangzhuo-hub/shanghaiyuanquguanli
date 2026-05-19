import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Monitor, Wifi, WifiOff, Loader2, Play, Pause } from 'lucide-react';
import { initCloud, fetchAuthorizedParks, fetchCloudBackup, getCurrentCloudUser, isCloudUserAuthenticated } from '../services/cloudService';
import { mergeStoredCloudConfig } from '../config/deploymentDefaults';
import { generateInitialData } from '../services/mockData';
import {
  buildBigScreenParkData,
  computeTotals,
  type BigScreenParkMetric,
  type BigScreenData,
} from '../services/bigScreenMetrics';
import type { ParkInfo, AuthUser, DashboardData } from '../types';
import { BigScreenSummary } from './big-screen/BigScreenSummary';
import { BigScreenParkCompare } from './big-screen/BigScreenParkCompare';
import { BigScreenParkSlide } from './big-screen/BigScreenParkSlide';
import { BigScreenEventTicker } from './big-screen/BigScreenEventTicker';
import { BigScreenAlerts } from './big-screen/BigScreenAlerts';
import { generateAllEvents, sortEventsByTime } from '../services/bigScreenEvents';
import { generateAllAlerts, generateLowOccupancyAlerts, generateLowCollectionAlerts, sortAlertsByLevel } from '../services/bigScreenAlerts';
import type { BigScreenEvent } from '../services/bigScreenEvents';
import type { BigScreenAlert } from '../services/bigScreenAlerts';

const STORAGE_KEY = 'kingdee_park_data_v1';
const CLOUD_CONFIG_KEY = 'kingdee_park_cloud_config_v2';
const getParkStorageKey = (projectId: string) => `${STORAGE_KEY}:${projectId || 'unknown'}`;

const hasMeaningfulDashboardPayload = (d: DashboardData): boolean =>
  !!(d && (d.tenants?.length || d.buildings?.length));

/** 从 URL query 参数读取大屏配置 */
const parseBigScreenConfig = (): {
  carouselInterval: number;
  refreshInterval: number;
  hideAmount: boolean;
  parkFilter: string[];
  zoom: number;
} => {
  const params = new URLSearchParams(window.location.search);
  return {
    carouselInterval: Math.max(
      5000,
      Math.min(120_000, Number(params.get('carousel')) || 20_000),
    ), // 5s - 120s, default 20s
    refreshInterval: Math.max(
      15000,
      Math.min(600_000, Number(params.get('refresh')) || 60_000),
    ), // 15s - 600s, default 60s
    hideAmount: params.get('hideAmount') === '1',
    parkFilter: params.get('parks')
      ? params
          .get('parks')!
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    zoom: Math.max(0.5, Math.min(3, Number(params.get('zoom')) || 1.0)),
  };
};

const BigScreenDashboard: React.FC = () => {
  const [screenConfig] = useState(parseBigScreenConfig);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [parks, setParks] = useState<ParkInfo[]>([]);
  const [bigScreenData, setBigScreenData] = useState<BigScreenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentSlide, setCurrentSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [online, setOnline] = useState(true);
  const carouselRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dataRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializingRef = useRef(false);

  const year = new Date().getFullYear();
  const billingMonth = `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  const loadAllParkData = useCallback(async () => {
    if (initializingRef.current) return;
    initializingRef.current = true;
    try {
      const authValid = isCloudUserAuthenticated();
      const currentUser = getCurrentCloudUser();
      if (!authValid || !currentUser?.enabled) {
        setError('请先在管理后台登录后查看大屏');
        setLoading(false);
        initializingRef.current = false;
        return;
      }
      setAuthUser(currentUser);

      const parksRes = await fetchAuthorizedParks();
      if (!parksRes.success) {
        setError(parksRes.message || '获取园区列表失败');
        setLoading(false);
        initializingRef.current = false;
        return;
      }

      let enabledParks = parksRes.parks
        .filter((p) => p.enabled);

      // Park filter from URL config
      if (screenConfig.parkFilter.length > 0) {
        enabledParks = enabledParks.filter((p) =>
          screenConfig.parkFilter.includes(p.projectId),
        );
      }

      enabledParks = enabledParks.filter((p) => {
          if (currentUser.role === 'platform_admin') return true;
          if (currentUser.role === 'group_admin')
            return currentUser.allowedProjectIds.includes(p.projectId);
          return p.projectId === currentUser.projectId;
        });

      setParks(enabledParks);

      const config = mergeStoredCloudConfig(
        localStorage.getItem(CLOUD_CONFIG_KEY),
      );
      const metrics: BigScreenParkMetric[] = [];
      const allEvents: BigScreenEvent[] = [];
      const allAlerts: BigScreenAlert[] = [];

      for (const park of enabledParks) {
        try {
          const parkConfig = { ...config, projectId: park.projectId };
          const res = await fetchCloudBackup(parkConfig, park.projectId);
          const cloudData: DashboardData | null =
            res.success && res.data
              ? { ...generateInitialData(), ...res.data }
              : null;
          if (cloudData && hasMeaningfulDashboardPayload(cloudData)) {
            const parkData = buildBigScreenParkData(park, cloudData, year, billingMonth);
            metrics.push(parkData.metrics);
            allEvents.push(
              ...generateAllEvents(
                {
                  tenants: cloudData.tenants || [],
                  payments: cloudData.payments || [],
                  invoices: cloudData.invoices || [],
                  billingDetails: parkData.billingDetails,
                },
                park.projectId,
                park.name || park.projectId,
              ),
            );
            allAlerts.push(
              ...generateAllAlerts(
                cloudData.tenants || [],
                parkData.billingDetails,
                park.projectId,
                park.name || park.projectId,
              ),
            );
            continue;
          }
          // fallback to localStorage
          const cached = localStorage.getItem(getParkStorageKey(park.projectId));
          const cachedData: DashboardData | null = cached
            ? { ...generateInitialData(), ...JSON.parse(cached) }
            : null;
          if (cachedData && hasMeaningfulDashboardPayload(cachedData)) {
            const parkData = buildBigScreenParkData(park, cachedData, year, billingMonth);
            metrics.push(parkData.metrics);
            allEvents.push(
              ...generateAllEvents(
                {
                  tenants: cachedData.tenants || [],
                  payments: cachedData.payments || [],
                  invoices: cachedData.invoices || [],
                  billingDetails: parkData.billingDetails,
                },
                park.projectId,
                park.name || park.projectId,
              ),
            );
            allAlerts.push(
              ...generateAllAlerts(
                cachedData.tenants || [],
                parkData.billingDetails,
                park.projectId,
                park.name || park.projectId,
              ),
            );
          }
        } catch {
          // skip individual park errors
        }
      }

      // KPI-level alerts
      allAlerts.push(...generateLowOccupancyAlerts(metrics));
      allAlerts.push(...generateLowCollectionAlerts(metrics));

      const totals = computeTotals(metrics);
      setBigScreenData({
        year,
        parks: metrics,
        totals,
        events: sortEventsByTime(allEvents),
        alerts: sortAlertsByLevel(allAlerts),
        refreshedAt: new Date().toISOString(),
      });
      setOnline(true);
      setError('');
    } catch (e) {
      console.warn('[bigscreen] 加载失败', e);
      setError('数据加载失败');
      setOnline(false);
    } finally {
      setLoading(false);
      initializingRef.current = false;
    }
  }, [year, billingMonth]);

  // Init PocketBase + first load
  useEffect(() => {
    const stored = localStorage.getItem(CLOUD_CONFIG_KEY);
    const config = mergeStoredCloudConfig(stored);
    initCloud(config).then((ok) => {
      if (!ok) {
        setError('无法连接到 PocketBase，请检查网络');
        setLoading(false);
        return;
      }
      loadAllParkData();
    });
  }, [loadAllParkData]);

  // Carousel rotation
  useEffect(() => {
    if (paused || !bigScreenData) return;
    const totalSlides = 3 + bigScreenData.parks.length; // summary + compare + parks + alerts
    carouselRef.current = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % totalSlides);
    }, screenConfig.carouselInterval);
    return () => {
      if (carouselRef.current) clearInterval(carouselRef.current);
    };
  }, [paused, bigScreenData]);

  // Data refresh
  useEffect(() => {
    dataRefreshRef.current = setInterval(() => {
      loadAllParkData();
    }, screenConfig.refreshInterval);
    return () => {
      if (dataRefreshRef.current) clearInterval(dataRefreshRef.current);
    };
  }, [loadAllParkData]);

  // Keyboard controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === 'ArrowLeft') {
        setCurrentSlide((p) =>
          p === 0 ? (bigScreenData ? 2 + bigScreenData.parks.length : 0) : p - 1,
        );
      } else if (e.key === 'ArrowRight') {
        setCurrentSlide((p) => {
          const max = bigScreenData ? 2 + bigScreenData.parks.length : 0;
          return p >= max ? 0 : p + 1;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bigScreenData]);

  if (loading) {
    return (
      <div className="h-screen w-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 size={48} className="animate-spin text-sky-400 mx-auto" />
          <p className="text-slate-400 text-lg">正在加载多园区经营数据...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md px-6">
          <Monitor size={48} className="text-slate-600 mx-auto" />
          <p className="text-red-400 text-lg">{error}</p>
          <button
            onClick={loadAllParkData}
            className="px-6 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-500 transition"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!bigScreenData || bigScreenData.parks.length === 0) {
    return (
      <div className="h-screen w-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Monitor size={48} className="text-slate-600 mx-auto" />
          <p className="text-slate-400 text-lg">暂无园区数据</p>
        </div>
      </div>
    );
  }

  const totalSlides = 3 + bigScreenData.parks.length; // summary + compare + parks + alerts
  const slide = currentSlide % totalSlides;

  return (
    <div className="h-screen w-screen bg-slate-950 text-white overflow-hidden grid grid-rows-[44px_minmax(0,1fr)_auto_36px]" style={{ zoom: screenConfig.zoom }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 md:px-6 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-3">
          <Monitor size={18} className="text-sky-400" />
          <span className="text-base font-semibold text-slate-200">
            多园区经营大屏
          </span>
          <span className="text-xs text-slate-500">
            · {bigScreenData.year}年度
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span>
            园区 {bigScreenData.parks.length} 个
          </span>
          <span
            className="cursor-pointer hover:text-white transition"
            onClick={() => setPaused((p) => !p)}
            title={paused ? '继续轮播' : '暂停轮播 (空格键)'}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </span>
          <span className="flex items-center gap-1">
            {online ? (
              <Wifi size={12} className="text-emerald-400" />
            ) : (
              <WifiOff size={12} className="text-red-400" />
            )}
            更新{' '}
            {bigScreenData.refreshedAt
              ? new Date(bigScreenData.refreshedAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : '—'}
          </span>
        </div>
      </div>

      {/* Slide area */}
      <div className="min-h-0 overflow-hidden">
        {slide === 0 && (
          <BigScreenSummary
            totals={bigScreenData.totals}
            parkCount={bigScreenData.parks.length}
            year={bigScreenData.year}
            hideAmount={screenConfig.hideAmount}
          />
        )}
        {slide === 1 && (
          <BigScreenParkCompare
            parks={bigScreenData.parks}
            year={bigScreenData.year}
            hideAmount={screenConfig.hideAmount}
          />
        )}
        {slide >= 2 && slide < 2 + bigScreenData.parks.length && (
          <BigScreenParkSlide
            park={bigScreenData.parks[slide - 2]}
            year={bigScreenData.year}
            hideAmount={screenConfig.hideAmount}
          />
        )}
        {slide === 2 + bigScreenData.parks.length && (
          <BigScreenAlerts alerts={bigScreenData.alerts} />
        )}
      </div>

      {/* Event ticker */}
      <BigScreenEventTicker events={bigScreenData.events} />

      {/* Bottom slide indicator */}
      <div className="flex items-center justify-center gap-2 border-t border-white/10 bg-white/5">
        {Array.from({ length: totalSlides }).map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentSlide(i)}
            className={`w-2 h-2 rounded-full transition-all ${
              i === slide
                ? 'bg-sky-400 w-6'
                : 'bg-white/20 hover:bg-white/40'
            }`}
            title={
              i === 0
                ? '集团总览'
                : i === 1
                  ? '园区对比'
                  : i < 2 + bigScreenData.parks.length
                    ? bigScreenData.parks[i - 2]?.parkName || `园区 ${i - 1}`
                    : '智能预警'
            }
          />
        ))}
      </div>
    </div>
  );
};

export default BigScreenDashboard;
