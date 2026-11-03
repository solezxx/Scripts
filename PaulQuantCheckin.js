/**
 * PaulQuant 自动签到 - 最终稳定版（修复 Cookie 带分号被截断的问题）
 */

const CONFIG = {
  baseUrl: "https://paulquant.com",
  notify: true,
  timeout: 15000
};

// Loon 插件界面中的参数通过 $argument 对象传入，不会自动写入 $persistentStore。
const args =
  typeof $argument === "object" && $argument !== null
    ? $argument
    : {};

const AUTH = String(args.pq_auth || "").trim();
const COOKIE = String(args.pq_cookie || "").trim();

const HEADERS = {
  "Accept": "application/json",
  "Authorization": AUTH,
  "Cookie": COOKIE,
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148  PaulQuantApp/1.0",
  "Origin": "https://paulquant.com",
  "Referer": "https://paulquant.com/app",
  "Accept-Language": "zh-CN,zh-Hans;q=0.9"
};

function notify(title, body) {
  if (CONFIG.notify) $notification.post("PaulQuant签到", title, body);
  console.log(`[PaulQuant] ${title}: ${body}`);
}

function request(method, path, body, cb) {
  const headers = Object.assign({}, HEADERS);
  const options = {
    url: CONFIG.baseUrl + path,
    headers: headers,
    timeout: CONFIG.timeout
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = body;
  }
  const fn = method === "POST" ? $httpClient.post : $httpClient.get;
  fn(options, function (error, response, data) {
    const status = response && (response.status || response.statusCode);
    if (error) return cb(error, status, data);
    if (status && status >= 400) return cb(new Error("HTTP " + status), status, data);
    cb(null, status, data);
  });
}

function parse(data) {
  try { return JSON.parse(data); } catch (e) { return null; }
}

function main() {
  // 仅打印参数类型和长度，避免在日志中泄露 Token 或 Cookie。
  console.log("====== 调试信息 ======");
  console.log("$argument 类型: " + typeof $argument);
  console.log("$argument 字段: " + Object.keys(args).join(","));
  console.log("AUTH 长度: " + AUTH.length);
  console.log("COOKIE 长度: " + COOKIE.length);
  console.log("COOKIE 包含 paolo_user_id: " + COOKIE.includes("paolo_user_id"));
  console.log("======================");

  if (!AUTH || !COOKIE) {
    notify("配置缺失", "AUTH或COOKIE为空，请确保在 Loon 界面中正确填写了内容并保存");
    return $done();
  }

  request("GET", "/api/checkin", undefined, function (err, st, data) {
    if (err) {
      notify("查询失败", err.message + " " + String(data).slice(0, 160));
      return $done();
    }
    const before = parse(data);
    if (!before) {
      notify("查询返回异常", String(data).slice(0, 160));
      return $done();
    }
    if (before.today_signed) {
      notify("今日已签到", `连续 ${before.streak} 天，周期 ${before.cycle_day}/${before.cycle_days}`);
      return $done();
    }

    request("POST", "/api/checkin", "{}", function (err2, st2, data2) {
      if (err2) {
        notify("签到失败", err2.message + " " + String(data2).slice(0, 160));
        return $done();
      }
      const after = parse(data2);
      if (!after) {
        notify("签到返回异常", String(data2).slice(0, 160));
        return $done();
      }
      if (after.ok && after.today_signed) {
        notify("签到成功", `连续 ${after.streak} 天，周期 ${after.cycle_day}/${after.cycle_days}，奖励 ${after.reward_days} 天`);
      } else {
        notify("签到未成功", String(data2).slice(0, 160));
      }
      $done();
    });
  });
}

main();