/**
 * PaulQuant 自动签到 - Loon 终极兼容版
 */

const CONFIG = {
  baseUrl: "https://paulquant.com",
  notify: true,
  timeout: 15000
};

// 强大的参数读取，兼容各种格式（对象、数组、JSON字符串、URL字符串）
function readArg(name) {
  // 优先从 Loon 底层持久化存储读（最稳）
  const storeVal = $persistentStore.read(name);
  if (storeVal) return storeVal;

  if (typeof $argument === "undefined" || !$argument) return "";

  // 如果是对象或数组
  if (typeof $argument === "object" && $argument !== null) {
    if ($argument[name] !== undefined) return $argument[name];
    if ($argument.length >= 2) return name === "pq_auth" ? $argument[0] : $argument[1];
  }

  // 如果是字符串
  if (typeof $argument === "string") {
    // 尝试解析 JSON 字符串
    try {
      const parsed = JSON.parse($argument);
      if (parsed[name] !== undefined) return parsed[name];
    } catch (e) {}

    // 尝试解析 URL 格式
    try {
      const urlParams = new URLSearchParams($argument);
      const val = urlParams.get(name);
      if (val) return val;
    } catch (e) {}

    // 尝试逗号分隔 (Loon 有时候会传 "val1,val2")
    const parts = $argument.split(",");
    if (parts.length >= 2) return name === "pq_auth" ? parts[0].trim() : parts[1].trim();

    // 尝试 & 分隔
    const map = {};
    $argument.split("&").forEach(function (kv) {
      const i = kv.indexOf("=");
      if (i > 0) map[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    return map[name] || "";
  }

  return "";
}

const AUTH = readArg("pq_auth") || "";
const COOKIE = readArg("pq_cookie") || "";

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
  console.log("====== 调试信息 ======");
  console.log("$argument 类型: " + typeof $argument);
  console.log("$argument 内容: " + JSON.stringify($argument));
  console.log("解析出的 AUTH: " + AUTH);
  console.log("解析出的 COOKIE: " + COOKIE);
  console.log("======================");

  if (!AUTH || !COOKIE) {
    notify("配置缺失", "AUTH或COOKIE为空，请检查插件变量名及内容");
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