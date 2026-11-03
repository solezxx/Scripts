/******************************

脚本功能：薄荷健康 解锁会员（适配 App 15.x 接口字段）
接口：GET https://api.boohee.com/app-interface/v1/user/user_info
适用：Loon（Quantumult X / Surge 亦可直接使用）

改写字段：
  vip.is_member            = true
  vip.state                = "1"
  vip.remain_day           = 36500
  vip.started_at           = "2020-01-01 00:00:00"
  vip.expired_at           = "2099-09-09 09:09:09"
  vip.user_membership_status = "member_active"
  glp_vip.is_vip / expired_at / remain_days
  清理开通引导文案与购买弹窗

使用声明：仅供学习与交流，请勿转载与贩卖。

*******************************/

/* ============ 可调参数 ============ */
const EXPIRE_TIME = '2029-09-09 09:09:09'; // 到期时间
const START_TIME = '2020-01-01 00:00:00'; // 开通时间
const REMAIN_DAY = 36500; // 剩余天数
const MEMBER_STATUS = 'member_active'; // 会员状态；若仍显示未开通，可依次试 member / active / member_ever
const INTEGRAL = 0; // 积分
const UNLOCK_GLP_VIP = true; // 是否同时解锁 GLP-1 会员
const VERBOSE = false; // true 时弹通知，方便确认脚本有没有跑起来
/* ================================= */

const body = typeof $response !== 'undefined' ? $response.body : undefined;
if (!body) {
  $done({});
}

let obj;
try {
  obj = JSON.parse(body);
} catch (e) {
  // 解析失败就原样放行，避免 App 白屏
  $done({});
}

const data = obj.data || (obj.data = {});

/* ---- 1. 主会员 vip ---- */
const vip = data.vip || (data.vip = {});
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

/* ---- 2. GLP-1 会员（新版独立字段） ---- */
if (UNLOCK_GLP_VIP) {
  const glp = data.glp_vip || (data.glp_vip = {});
  glp.is_vip = true;
  glp.expired_at = EXPIRE_TIME;
  glp.remain_days = REMAIN_DAY;
}

/* ---- 3. 首页购买弹窗 ---- */
if (data.vip_purchase_popup) {
  data.vip_purchase_popup = { link: '', ratio: 0 };
}

if (VERBOSE && typeof $notify !== 'undefined') {
  $notify('薄荷健康', '会员数据已改写', 'user_info → ' + MEMBER_STATUS);
}

$done({ body: JSON.stringify(obj) });
