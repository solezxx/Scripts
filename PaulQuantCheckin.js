/**
 * PaulQuant 自动签到 - Loon 远程脚本
 * 兼容 Loon 新版 [Argument] 传参对象格式
 */

const CONFIG = {
  baseUrl: "https://paulquant.com",
  notify: true,
  timeout: 15000
};

// 兼容读取参数（支持对象、字符串等格式）
function readArg(name) {
  if (typeof $argument === "undefined" || !$argument) return "";

  // 1. 如果是 Loon 新版 [Argument] 传过来的对象
  if (typeof $argument === "object" && $argument !== null) {
    // 如果是对象格式 {"pq_auth":"xxx", "pq_cookie":"yyy"}
    if (!$argument.length && $argument[name] !== undefined) {
      return $argument[name];
    }
    // 如果是数组格式 [{pq_auth},{pq_cookie}]（取决于插件写法）
    if ($argument.length >= 2) {
      return name === "pq_auth" ? $argument[0] : $argument[1];
    }
  }

  // 2. 如果是传统的字符串格式 "pq_auth=xxx&pq_cookie=yyy"
  if (typeof $argument === "string") {
    try {
      // 尝试用 URLSearchParams 解析
      const urlParams = new URLSearchParams($argument);
      const val = urlParams.get(name);
      if (val) return val;
    } catch (e) {}

    // 字符串分割兜底
    const map = {};
    $argument.split("&").forEach(function (kv) {
      const i = kv.indexOf("=");
      if (i > 0) map[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    return map[name] || "";
  }

  return "";
}

const AUTH = readArg("pq_auth") || $persistentStore.read("pq_auth") || "";
const COOKIE = readArg("pq_cookie") || $persistentStore.read("pq_cookie") || "";

const HEADERS = {
  "Accept": "application/json",
  "Authorization": AUTH,
  "Cookie": COOKIE,
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148  PaulQuantApp/1.0",
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
  // 调试用，如果再次失败，可以在 Loon 日志里看到到底拿到了什么
  console.log("AUTH: " + AUTH);
  console.log("COOKIE: " + COOKIE);

  if (!AUTH || !COOKIE) {
    notify("配置缺失", "请在插件中重新填写 pq_auth 与 pq_cookie");
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
      notify("今日已签到",
        `连续 ${before.streak} 天，周期 ${before.cycle_day}/${before.cycle_days}`);
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
        notify("签到成功",
          `连续 ${after.streak} 天，周期 ${after.cycle_day}/${after.cycle_days}，奖励 ${after.reward_days} 天`);
      } else {
        notify("签到未成功", String(data2).slice(0, 160));
      }
      $done();
    });
  });
}

main();