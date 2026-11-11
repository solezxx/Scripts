/******************************

脚本功能：薄荷健康 会员解锁 + AI 不限次（单文件版）
           一个脚本按 URL 区分处理两套接口，插件只需对应规则

接口 1：GET  https://api.boohee.com/app-interface/v1/user/user_info
        → 会员身份、到期时间、剩余天数、GLP-1 会员、积分会员、购买弹窗

接口 2：POST https://api.boohee.com/ai-interface/v1/frequency-limited
        → is_vip_member、到期时间、不限次（max_count）、去掉推广入口

关于开屏广告（15.10.x 实测，勿再走 status.boohee.com）：
        - status.boohee.com/api/v1/app_square/start_up_with_ad 恒返回空结构，已废弃；
        - 开屏是多 SDK 竞价：穿山甲/GroMore、优量汇 GDT、快手联盟、TopOn、倍孜、掌宇同时出价，
          冷启动 1.5~2.2 秒内下载素材，最终展示哪家不确定；
        - 这些流量都是二进制/加密体，脚本改不了，只能在插件 [Rule] 里按域名 REJECT。

适用：Loon（Quantumult X / Surge 亦可直接用，规则写法不同）

使用声明：仅供学习与交流，请勿转载与贩卖。

*******************************/

(function () {
  'use strict';

  /* ============ 可调参数 ============ */
  const EXPIRE_TIME = '2099-09-09 09:09:09'; // 到期时间
  const START_TIME = '2020-01-01 00:00:00'; // 开通时间（仅接口 1）
  const REMAIN_DAY = 36500; // 剩余天数
  const MEMBER_STATUS = 'member_active'; // 会员状态枚举，可选 member / active / member_ever
  const INTEGRAL = 0; // 积分
  const UNLOCK_GLP_VIP = true; // 是否解锁 GLP-1 会员
  const UNLIMITED_COUNT = true; // AI 次数是否拉到最大
  const MAX_COUNT = 999999; // AI 可用次数
  const REMOVE_SALES_URL = true; // 是否去掉会员推广链接
  const VERBOSE = false; // true 时弹通知，显示本次命中哪个接口
  /* ================================= */

  const url = (typeof $request !== 'undefined' && $request && $request.url) || '';

  const body = typeof $response !== 'undefined' && $response ? $response.body : '';
  if (!body) {
    return $done({});
  }

  let obj;
  try {
    obj = JSON.parse(body);
  } catch (e) {
    // 非 JSON（例如 502 错误页）原样放行，避免 App 白屏
    return $done({});
  }

  const data = obj.data || (obj.data = {});

  const kind = pick(url, data);
  if (kind === 'vip') {
    fixUserInfo(data);
  } else if (kind === 'ai') {
    fixAi(data);
  } else {
    // 认不出是哪个接口，不动
    return $done({});
  }

  if (VERBOSE) {
    notify('薄荷健康', kind === 'vip' ? '会员状态已改写' : 'AI 频次已改写', kind);
  }

  $done({ body: JSON.stringify(obj) });

  /* ============ 路由 ============ */
  function pick(u, d) {
    // 优先按 URL 判断
    if (u.indexOf('frequency-limited') > -1) return 'ai';
    if (u.indexOf('user_info') > -1) return 'vip';
    // 拿不到 $request.url 时，按响应字段特征兜底
    if (d && 'is_vip_member' in d) return 'ai';
    if (d && ('vip' in d || 'user' in d)) return 'vip';
    return '';
  }

  /* ============ 接口 1：user_info ============ */
  function fixUserInfo(d) {
    const vip = d.vip || (d.vip = {});
    vip.is_member = true;
    vip.state = '1';
    vip.remain_day = REMAIN_DAY;
    vip.started_at = START_TIME;
    vip.expired_at = EXPIRE_TIME;
    vip.user_membership_status = MEMBER_STATUS;
    vip.period_type = vip.period_type || 'year';

    // 去掉"开通会员"引导
    vip.not_vip_tips = '';
    vip.notices = [];
    vip.notices_tips = [];

    // 积分/懒人会员：保留原有 url、success，避免 App 取不到字段
    vip.integral_member = Object.assign(
      {
        integral: INTEGRAL,
        level: 1,
        url: 'https://member.boohee.com/integral-center',
        success: true,
        level_name: '蓝钻会员'
      },
      vip.integral_member || {},
      {
        integral: INTEGRAL,
        level: 1,
        success: true,
        level_name: '蓝钻会员'
      }
    );

    // GLP-1 会员（新版独立字段）
    if (UNLOCK_GLP_VIP) {
      const glp = d.glp_vip || (d.glp_vip = {});
      glp.is_vip = true;
      glp.expired_at = EXPIRE_TIME;
      glp.remain_days = REMAIN_DAY;
    }

    // 首页购买弹窗
    if (d.vip_purchase_popup) {
      d.vip_purchase_popup = { link: '', ratio: 0 };
    }
  }

  /* ============ 接口 2：frequency-limited ============ */
  function fixAi(d) {
    d.is_vip_member = true;
    d.vip_expired_at = EXPIRE_TIME;
    d.is_limited = false;
    d.curr_count = 0;
    if (UNLIMITED_COUNT) {
      d.max_count = MAX_COUNT;
    }
    if (REMOVE_SALES_URL) {
      d.vip_sales_url = '';
    }
    d.usage_tips = '';
  }

  /* ============ 通知 ============ */
  function notify(title, subtitle, body) {
    if (typeof $notify !== 'undefined') {
      $notify(title, subtitle, String(body));
    }
  }
})();
