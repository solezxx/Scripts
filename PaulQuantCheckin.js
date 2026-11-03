/**
 * PaulQuant 自动签到 - 最终稳定版（修复 Cookie 带分号被截断的问题）
 */

const CONFIG = {
  baseUrl: "https://paulquant.com",
  notify: true,
  timeout: 15000
};

function getArg(name) {
  // 1. 优先从 Loon 底层持久化存储读（UI填写的通常存这里，最稳）
  const p = $persistentStore.read(name);
  if (p) return p;

  if (typeof $argument === "undefined" || !$argument) return "";

  // 2. 如果是对象 {"pq_auth":"xxx", "pq_cookie":"yyy"}
  if (typeof $argument === "object" && $argument !== null) {
    if ($argument[name]) return $argument[name];
  }

  // 3. 如果是字符串，Loon 会传成 "val1,val2" 的形式
  if (typeof $argument === "string") {
    // 去掉可能存在的方括号
    let argStr = $argument.replace(/^\[|\]$/g, '');
    const parts = argStr.split(",");
    
    if (name === "pq_auth") {
      return parts[0] ? parts[0].trim() : "";
    } else if (name === "pq_cookie") {
      // 关键修复：将逗号后面的内容完整合并，因为 Cookie 内部自带分号和等号，绝不能再次切分！
      return parts.length >= 2 ? parts.slice(1).join(",").trim() : "";
    }
  }
  return "";
}

const AUTH = getArg("pq_auth") || "";
const COOKIE = getArg("pq_cookie") || "";

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
  // 调试打印
  console.log("====== 调试信息 ======");
  console.log("解析出的 COOKIE 是否包含 user_id: " + (COOKIE.indexOf("paolo_user_id") > -1));
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