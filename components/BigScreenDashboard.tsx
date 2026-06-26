import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Monitor, Wifi, WifiOff, Loader2, Play, Pause } from 'lucide-react';
import {
  initCloud,
  fetchAuthorizedParks,
  getCurrentCloudUser,
  isCloudUserAuthenticated,
} from '../services/cloudService';
import { fetchCloudBigScreenData } from '../services/cloudComputeClient';
import { mergeStoredCloudConfig } from '../config/deploymentDefaults';
import { type BigScreenData } from '../services/bigScreenMetrics';
import { shouldRunLocalBigScreenFallback } from '../services/computeFallbackPolicy';
import type { ParkInfo, AuthUser } from '../types';
import { BigScreenSummary } from './big-screen/BigScreenSummary';
import { BigScreenParkCompare } from './big-screen/BigScreenParkCompare';
import { BigScreenParkSlide } from './big-screen/BigScreenParkSlide';
import { BigScreenEventTicker } from './big-screen/BigScreenEventTicker';
import { BigScreenAlerts } from './big-screen/BigScreenAlerts';

const CLOUD_CONFIG_KEY = 'kingdee_park_cloud_config_v2';

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

      const canUseServerBigScreen = authValid && !!currentUser?.enabled;
      let serverAttempted = false;
      const serverRes = await fetchCloudBigScreenData(config, {
        year,
        billingMonth,
        parkIds: enabledParks.map((park) => park.projectId),
      });
      serverAttempted = true;
      if (serverRes.success && serverRes.data) {
        setBigScreenData(serverRes.data);
        setOnline(true);
        setError('');
        return;
      }

      if (!shouldRunLocalBigScreenFallback({ canUseServer: canUseServerBigScreen, serverAttempted })) {
        setBigScreenData(null);
        setOnline(false);
        setError(serverRes.message || '后台大屏数据计算失败，未执行前端本地汇总');
        return;
      }
      setBigScreenData(null);
      setOnline(false);
      setError(serverRes.message || '大屏数据不可用');
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
      <div className="liquid-bigscreen-shell flex h-screen w-screen items-center justify-center">
        <div className="liquid-bigscreen-panel rounded-[28px] px-8 py-7 text-center">
          <Loader2 size={48} className="animate-spin text-sky-400 mx-auto" />
          <p className="mt-4 text-lg font-semibold text-slate-300">正在加载多园区经营数据...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="liquid-bigscreen-shell flex h-screen w-screen items-center justify-center">
        <div className="liquid-bigscreen-panel max-w-md rounded-[28px] px-8 py-7 text-center">
          <Monitor size={48} className="text-slate-500 mx-auto" />
          <p className="mt-4 text-lg font-semibold text-red-300">{error}</p>
          <button
            onClick={loadAllParkData}
            className="mt-4 rounded-full bg-sky-500 px-6 py-2 font-bold text-white transition hover:bg-sky-400"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!bigScreenData || bigScreenData.parks.length === 0) {
    return (
      <div className="liquid-bigscreen-shell flex h-screen w-screen items-center justify-center">
        <div className="liquid-bigscreen-panel rounded-[28px] px-8 py-7 text-center">
          <Monitor size={48} className="text-slate-500 mx-auto" />
          <p className="mt-4 text-lg font-semibold text-slate-300">暂无园区数据</p>
        </div>
      </div>
    );
  }

  const totalSlides = 3 + bigScreenData.parks.length; // summary + compare + parks + alerts
  const slide = currentSlide % totalSlides;

  return (
    <div className="liquid-bigscreen-shell grid h-screen w-screen grid-rows-[48px_minmax(0,1fr)_auto_40px] overflow-hidden text-white" style={{ zoom: screenConfig.zoom }}>
      {/* Top bar */}
      <div className="liquid-bigscreen-chrome flex items-center justify-between border-x-0 border-t-0 px-3 md:px-6">
        <div className="flex items-center gap-3">
          <Monitor size={18} className="text-sky-400" />
          <span className="text-base font-black text-slate-100">
            多园区经营大屏
          </span>
          <span className="text-xs font-semibold text-slate-400">
            · {bigScreenData.year}年度
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-semibold text-slate-400">
          <span>
            园区 {bigScreenData.parks.length} 个
          </span>
          <span
            className="liquid-pressable cursor-pointer rounded-full p-1 transition hover:bg-white/10 hover:text-white"
            onClick={() => setPaused((p) => !p)}
            title={paused ? '继续轮播' : '暂停轮播 (空格键)'}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </span>
          <span className="flex items-center gap-1">
            {online ? (
              <Wifi size={12} className="text-cyan-300" />
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
      <div className="liquid-bigscreen-chrome flex items-center justify-center gap-2 border-x-0 border-b-0">
        {Array.from({ length: totalSlides }).map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentSlide(i)}
            className={`liquid-pressable h-2 rounded-full transition-all ${
              i === slide
                ? 'w-7 bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.55)]'
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
