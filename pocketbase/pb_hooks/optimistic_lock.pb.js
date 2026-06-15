/// <reference path="../pb_data/types.d.ts" />

/**
 * 服务端乐观锁（CAS / compare-and-swap）。
 *
 * 闭合「客户端预检 updated」与「实际 PATCH 落库」之间的时间窗：两个客户端可能同时通过
 * 客户端预检、后写者静默覆盖。服务端在更新前比对客户端声明的基线 updated 与库内当前 updated，
 * 不一致 → 409 拒绝，前端按既有冲突流程（ConflictDialog）处理。
 *
 * 客户端契约：PATCH 时带请求头 X-PB-Expected-Updated（取自加载基线 recordMeta 的 updated）。
 * 无该头（老客户端 / 批量导入 / notes 合并写）→ 放行，保持兼容。
 *
 * ⚠️ 默认关闭（环境变量 PB_CAS_ENABLED=1 开启）。
 *   原因：updated 的字符串格式必须客户端与服务端 originalCopy().get('updated') 完全一致，
 *   否则会把正常更新误判为冲突而全部拒绝。开启前请按部署清单用两个并发更新验证：
 *   ① 正常单端更新不被拒；② 并发改同一行后写者得到 409。
 *
 * PB hooks 限制：回调内不可访问顶层变量；originalCopy()/header 读取均 try/catch。
 */
onRecordUpdateRequest((e) => {
    let enabled = false;
    try { enabled = String($os.getenv('PB_CAS_ENABLED') || '') === '1'; } catch (_) {}
    if (!enabled) { e.next(); return; }

    let expected = '';
    try {
        const info = e.requestInfo();
        if (info && info.headers) {
            // PB 把头名规范化为小写、连字符转下划线：X-PB-Expected-Updated → x_pb_expected_updated
            expected = String(info.headers['x_pb_expected_updated'] || '');
        }
    } catch (_) { expected = ''; }

    if (expected) {
        let serverUpdated = '';
        try {
            const original = e.record.originalCopy();
            if (original) {
                const u = original.get('updated');
                serverUpdated = u ? String(u) : '';
            }
        } catch (_) { serverUpdated = ''; }
        if (serverUpdated && serverUpdated !== expected) {
            throw new ApiError(409, 'OPTIMISTIC_LOCK_CONFLICT: 记录已被其他端修改，请刷新后重试。', null);
        }
    }
    e.next();
}, 'pb_payments', 'pb_tenants', 'pb_billing_period_notes');
