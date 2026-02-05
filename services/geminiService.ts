
import { GoogleGenAI, Type } from "@google/genai";
import { DashboardData, KeyMoment } from "../types";

// 注意：此服务已废弃，默认使用千问 AI
// 为了避免浏览器环境中的 API Key 错误，所有函数返回提示信息
const DEPRECATED_MESSAGE = "当前不支持 Gemini AI，请在系统设置中配置千问 AI。";

export const analyzeDashboard = async (data: DashboardData, userQuery?: string): Promise<string> => {
  return DEPRECATED_MESSAGE;
};

export const analyzeBudget = async (data: any, type: 'Occupancy' | 'Revenue' | 'Execution'): Promise<string> => {
    return DEPRECATED_MESSAGE;
};

export interface TenantSearchResult {
    moments: KeyMoment[];
    foundingDate?: string;
    industry?: string;
}

export const searchTenantInsights = async (tenantName: string): Promise<TenantSearchResult> => {
  return { moments: [] };
};
