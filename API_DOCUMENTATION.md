# 园区招商管理系统 - 房源数据API文档

## 概述

本文档描述如何从园区招商管理系统的PocketBase后端获取房源数据。该系统已配置为**无认证模式**，外部应用可以直接访问API。

---

## 服务器信息

### 基础URL
```
开发环境: http://127.0.0.1:8090
生产环境: http://your-server-ip:8090 (替换为实际服务器地址)
```

### Collection信息
- **Collection名称**: `park_backups`
- **Project ID**: `park_data_main`
- **认证**: 无需认证（API Rules已清空）

---

## API端点

### 1. 获取最新数据快照

获取最新的一条数据记录（包含完整的楼宇、租户、合同等信息）。

**请求**

```http
GET /api/collections/park_backups/records?filter=project_id="park_data_main"&sort=-created&perPage=1
```

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| filter | string | 是 | 过滤条件，固定为 `project_id="park_data_main"` |
| sort | string | 是 | 排序方式，`-created` 表示按创建时间降序 |
| perPage | number | 是 | 每页记录数，设为 `1` 获取最新一条 |

**响应示例**

```json
{
  "page": 1,
  "perPage": 1,
  "totalItems": 15,
  "totalPages": 15,
  "items": [
    {
      "id": "qspk6mybz6vqdac",
      "collectionId": "142ldi62xt30fi2",
      "collectionName": "park_backups",
      "created": "2026-02-04 06:49:00.849Z",
      "updated": "2026-02-04 06:49:00.849Z",
      "project_id": "park_data_main",
      "note": "手动保存",
      "data": {
        "buildings": [...],
        "tenants": [...],
        "assumptions": {...},
        "adjustments": [...],
        "payments": [...],
        "initData": [...],
        "virtualTenants": [...],
        "selfUseUnitIds": []
      }
    }
  ]
}
```

---

### 2. 获取指定记录

根据记录ID获取特定的数据快照。

**请求**

```http
GET /api/collections/park_backups/records/{recordId}
```

**路径参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| recordId | string | 是 | 记录的ID，例如：`qspk6mybz6vqdac` |

**响应示例**

```json
{
  "id": "qspk6mybz6vqdac",
  "collectionId": "142ldi62xt30fi2",
  "collectionName": "park_backups",
  "created": "2026-02-04 06:49:00.849Z",
  "updated": "2026-02-04 06:49:00.849Z",
  "project_id": "park_data_main",
  "note": "手动保存",
  "data": {...}
}
```

---

### 3. 获取历史记录列表

获取所有历史数据快照的元数据（不包含完整data字段）。

**请求**

```http
GET /api/collections/park_backups/records?filter=project_id="park_data_main"&sort=-created&fields=id,created,note
```

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| filter | string | 是 | 过滤条件 |
| sort | string | 是 | 排序方式 |
| fields | string | 否 | 指定返回的字段，减少数据量 |

**响应示例**

```json
{
  "page": 1,
  "perPage": 30,
  "totalItems": 15,
  "items": [
    {
      "id": "abc123",
      "created": "2026-02-04 10:30:00.000Z",
      "note": "自动备份"
    },
    {
      "id": "def456",
      "created": "2026-02-03 15:20:00.000Z",
      "note": "手动保存"
    }
  ]
}
```

---

## 数据结构

### 完整数据对象 (data字段)

```typescript
interface DashboardData {
  buildings: Building[];           // 楼宇数据
  tenants: Tenant[];               // 租户合同数据
  assumptions: RevenueAssumptions; // 营收假设
  adjustments: RevenueAdjustment[]; // 营收调整
  payments: PaymentRecord[];       // 收款记录
  initData: MonthlyInitData[];     // 初始化数据
  virtualTenants: VirtualTenant[]; // 虚拟租户
  selfUseUnitIds: string[];        // 自用单元ID
}
```

### 楼宇数据 (Building)

```typescript
interface Building {
  id: string;                    // 楼宇ID
  name: string;                  // 楼宇名称（如：1号楼、2号楼）
  totalArea: number;             // 总面积（㎡）
  units: Unit[];                 // 房源单元列表
}
```

### 房源单元 (Unit)

```typescript
interface Unit {
  id: string;                    // 单元ID
  unitNumber: string;            // 房间号（如：403、407-409、301-303）
  area: number;                  // 面积（㎡）
  floor: number;                 // 楼层（如：4表示4楼）
  status: UnitStatus;            // 状态
  type: 'office' | 'warehouse' | 'retail'; // 类型
}

enum UnitStatus {
  Available = 'Available',       // 可租
  Occupied = 'Occupied',         // 已租
  Reserved = 'Reserved'          // 预留
}
```

### 租户合同 (Tenant)

```typescript
interface Tenant {
  id: string;                    // 合同ID
  tenantName: string;            // 租户名称
  buildingId: string;            // 所属楼宇ID
  unitIds: string[];             // 租赁的单元ID列表
  totalArea: number;             // 总租赁面积（㎡）
  signingDate: string;           // 签约日期（ISO格式）
  leaseStart: string;            // 租期开始日期
  leaseEnd: string;              // 租期结束日期
  baseRent: number;              // 基础月租金（元/㎡/月）
  status: ContractStatus;        // 合同状态
  terminationDate?: string;      // 退租日期（如已退租）
}

enum ContractStatus {
  Active = 'Active',             // 在租
  Terminated = 'Terminated',     // 已退租
  Upcoming = 'Upcoming'          // 未开始
}
```

---

## 使用示例

### JavaScript/TypeScript

#### 示例1：获取所有可用房源

```javascript
async function getAvailableUnits() {
  // 1. 获取最新数据
  const response = await fetch(
    'http://127.0.0.1:8090/api/collections/park_backups/records?filter=project_id="park_data_main"&sort=-created&perPage=1'
  );
  
  const result = await response.json();
  
  if (!result.items || result.items.length === 0) {
    throw new Error('未找到数据');
  }
  
  const data = result.items[0].data;
  
  // 2. 提取所有楼宇的单元
  const allUnits = data.buildings.flatMap(building => 
    building.units.map(unit => ({
      buildingName: building.name,
      buildingId: building.id,
      ...unit
    }))
  );
  
  // 3. 筛选可用房源
  const availableUnits = allUnits.filter(unit => 
    unit.status === 'Available'
  );
  
  // 4. 按楼层分组
  const unitsByFloor = availableUnits.reduce((acc, unit) => {
    const floor = unit.floor;
    if (!acc[floor]) acc[floor] = [];
    acc[floor].push(unit);
    return acc;
  }, {});
  
  return {
    total: availableUnits.length,
    totalArea: availableUnits.reduce((sum, u) => sum + u.area, 0),
    units: availableUnits,
    byFloor: unitsByFloor
  };
}

// 使用
getAvailableUnits().then(result => {
  console.log(`可用房源: ${result.total}间`);
  console.log(`可用面积: ${result.totalArea}㎡`);
  console.log('按楼层分布:', result.byFloor);
});
```

#### 示例2：获取特定楼宇的房源

```javascript
async function getUnitsByBuilding(buildingName) {
  const response = await fetch(
    'http://127.0.0.1:8090/api/collections/park_backups/records?filter=project_id="park_data_main"&sort=-created&perPage=1'
  );
  
  const result = await response.json();
  const data = result.items[0].data;
  
  const building = data.buildings.find(b => b.name === buildingName);
  
  if (!building) {
    throw new Error(`未找到楼宇: ${buildingName}`);
  }
  
  return {
    buildingId: building.id,
    buildingName: building.name,
    totalArea: building.totalArea,
    units: building.units,
    availableUnits: building.units.filter(u => u.status === 'Available'),
    occupiedUnits: building.units.filter(u => u.status === 'Occupied')
  };
}

// 使用
getUnitsByBuilding('1号楼').then(result => {
  console.log(`${result.buildingName} 总面积: ${result.totalArea}㎡`);
  console.log(`可租: ${result.availableUnits.length}间`);
  console.log(`已租: ${result.occupiedUnits.length}间`);
});
```

#### 示例3：获取租户信息

```javascript
async function getTenantInfo(tenantName) {
  const response = await fetch(
    'http://127.0.0.1:8090/api/collections/park_backups/records?filter=project_id="park_data_main"&sort=-created&perPage=1'
  );
  
  const result = await response.json();
  const data = result.items[0].data;
  
  const tenant = data.tenants.find(t => t.tenantName === tenantName);
  
  if (!tenant) {
    throw new Error(`未找到租户: ${tenantName}`);
  }
  
  // 获取租赁的楼宇信息
  const building = data.buildings.find(b => b.id === tenant.buildingId);
  
  // 获取租赁的单元信息
  const units = building.units.filter(u => tenant.unitIds.includes(u.id));
  
  return {
    tenantName: tenant.tenantName,
    buildingName: building.name,
    units: units.map(u => u.unitNumber),
    totalArea: tenant.totalArea,
    baseRent: tenant.baseRent,
    monthlyRent: tenant.totalArea * tenant.baseRent,
    leaseStart: tenant.leaseStart,
    leaseEnd: tenant.leaseEnd,
    status: tenant.status
  };
}

// 使用
getTenantInfo('上海某科技有限公司').then(tenant => {
  console.log(`租户: ${tenant.tenantName}`);
  console.log(`楼宇: ${tenant.buildingName}`);
  console.log(`房间: ${tenant.units.join(', ')}`);
  console.log(`月租金: ¥${tenant.monthlyRent.toLocaleString()}`);
});
```

### Python

```python
import requests
from typing import List, Dict, Optional

class PropertyAPI:
    def __init__(self, base_url: str = "http://127.0.0.1:8090"):
        self.base_url = base_url
        self.collection = "park_backups"
        self.project_id = "park_data_main"
    
    def get_latest_data(self) -> Dict:
        """获取最新数据快照"""
        url = f"{self.base_url}/api/collections/{self.collection}/records"
        params = {
            "filter": f'project_id="{self.project_id}"',
            "sort": "-created",
            "perPage": 1
        }
        
        response = requests.get(url, params=params)
        response.raise_for_status()
        
        result = response.json()
        
        if not result.get("items"):
            raise ValueError("未找到数据")
        
        return result["items"][0]["data"]
    
    def get_available_units(self) -> List[Dict]:
        """获取所有可用房源"""
        data = self.get_latest_data()
        
        available_units = []
        
        for building in data["buildings"]:
            for unit in building["units"]:
                if unit["status"] == "Available":
                    available_units.append({
                        "buildingName": building["name"],
                        "buildingId": building["id"],
                        **unit
                    })
        
        return available_units
    
    def get_units_by_floor(self, floor: int) -> List[Dict]:
        """获取指定楼层的房源"""
        data = self.get_latest_data()
        
        floor_units = []
        
        for building in data["buildings"]:
            for unit in building["units"]:
                if unit["floor"] == floor:
                    floor_units.append({
                        "buildingName": building["name"],
                        **unit
                    })
        
        return floor_units
    
    def get_occupancy_rate(self) -> Dict:
        """计算出租率"""
        data = self.get_latest_data()
        
        total_units = 0
        occupied_units = 0
        total_area = 0
        occupied_area = 0
        
        for building in data["buildings"]:
            for unit in building["units"]:
                total_units += 1
                total_area += unit["area"]
                
                if unit["status"] == "Occupied":
                    occupied_units += 1
                    occupied_area += unit["area"]
        
        return {
            "unitOccupancyRate": (occupied_units / total_units * 100) if total_units > 0 else 0,
            "areaOccupancyRate": (occupied_area / total_area * 100) if total_area > 0 else 0,
            "totalUnits": total_units,
            "occupiedUnits": occupied_units,
            "totalArea": total_area,
            "occupiedArea": occupied_area
        }

# 使用示例
api = PropertyAPI()

# 获取可用房源
available = api.get_available_units()
print(f"可用房源: {len(available)}间")

# 获取4楼房源
floor_4 = api.get_units_by_floor(4)
print(f"4楼房源: {len(floor_4)}间")

# 计算出租率
occupancy = api.get_occupancy_rate()
print(f"出租率: {occupancy['areaOccupancyRate']:.1f}%")
```

---

## 错误处理

### 常见错误

| HTTP状态码 | 错误说明 | 解决方案 |
|-----------|---------|---------|
| 404 | Collection不存在 | 确认PocketBase服务已启动，collection已创建 |
| 500 | 服务器内部错误 | 检查PocketBase日志 |
| 0 | 无法连接 | 确认服务器地址正确，防火墙允许访问 |

### 错误响应示例

```json
{
  "code": 404,
  "message": "The requested resource wasn't found.",
  "data": {}
}
```

---

## CORS配置

如果从Web应用访问API且遇到CORS问题，需要配置PocketBase：

1. 访问PocketBase管理后台：`http://127.0.0.1:8090/_/`
2. 进入 **Settings** → **Application**
3. 在 **Allowed origins** 中添加您的应用域名，例如：
   ```
   http://localhost:3000
   https://your-app-domain.com
   ```
4. 点击 **Save changes**

---

## 数据更新频率

- **实时性**: 数据每次保存时创建新快照
- **保留策略**: 保留所有历史快照
- **推荐**: 
  - 实时查询：每次请求获取最新数据
  - 缓存策略：可在客户端缓存5-10分钟
  - 轮询间隔：建议不少于30秒

---

## 安全建议

⚠️ **重要提示**

当前配置为**无认证模式**，适合内部网络使用。如果需要公网部署，建议：

1. 启用PocketBase认证
2. 配置API Rules限制访问
3. 使用HTTPS加密传输
4. 配置防火墙规则
5. 定期备份数据

---

## 技术支持

- **PocketBase版本**: 0.22.x
- **数据格式**: JSON
- **编码**: UTF-8
- **时区**: UTC

---

## 附录

### 完整TypeScript类型定义

```typescript
// 详见 types.ts 文件

export interface Building {
  id: string;
  name: string;
  totalArea: number;
  units: Unit[];
}

export interface Unit {
  id: string;
  unitNumber: string;
  area: number;
  floor: number;
  status: 'Available' | 'Occupied' | 'Reserved';
  type: 'office' | 'warehouse' | 'retail';
}

export interface Tenant {
  id: string;
  tenantName: string;
  buildingId: string;
  unitIds: string[];
  totalArea: number;
  signingDate: string;
  leaseStart: string;
  leaseEnd: string;
  baseRent: number;
  status: 'Active' | 'Terminated' | 'Upcoming';
  terminationDate?: string;
}

export interface DashboardData {
  buildings: Building[];
  tenants: Tenant[];
  assumptions: RevenueAssumptions;
  adjustments: RevenueAdjustment[];
  payments: PaymentRecord[];
  initData: MonthlyInitData[];
  virtualTenants: VirtualTenant[];
  selfUseUnitIds: string[];
}
```

### 快速测试

使用curl测试API：

```bash
# 获取最新数据
curl "http://127.0.0.1:8090/api/collections/park_backups/records?filter=project_id=%22park_data_main%22&sort=-created&perPage=1"

# 美化输出（需要安装jq）
curl "http://127.0.0.1:8090/api/collections/park_backups/records?filter=project_id=%22park_data_main%22&sort=-created&perPage=1" | jq .

# 只获取楼宇数据
curl "http://127.0.0.1:8090/api/collections/park_backups/records?filter=project_id=%22park_data_main%22&sort=-created&perPage=1" | jq '.items[0].data.buildings'
```

---

**文档版本**: 1.0.0  
**最后更新**: 2026-02-04  
**维护者**: 园区招商管理系统团队
