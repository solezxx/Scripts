/******************************

脚本功能：今日油价 · 调价趋势提醒（单文件版）
           一次拉取「当前油价 + 上次调价 + 下次调价窗口」，
           按油品展示涨跌额、涨幅与调价后价格，并给出距下次调价的天数

数据接口：GET https://apis.tianapi.com/oilprice/market?key=KEY&prov=省份
        → result.prov             省份
          result.last_adjusted    上次调价（生效日 yyyyMMdd）
          result.next_adjustment  下次调价（生效日 yyyyMMdd，即窗口日 24 时后）
          result.p0  / p89 / p92 / p95 / p98
                 = { price 调价后价, previous_price 调价前价, price_change 涨跌额 }

        降级接口：GET /oilprice/index → 仅当前价 + 采集时间
                 market 不可用（个别 key 套餐不支持）时自动降级，只报价格不报趋势

适用：Loon（Surge / Quantumult X / 小火箭 亦可，通知与存储已做兼容）
调用：定时任务 cron，argument 填省份名，可附带自己的 key

参数写法（三者任选）：
  1. 纯省份名              argument="江苏"
  2. 省份 + key            argument="prov=江苏&key=你的apikey"
  3. 只写 key              argument="key=你的apikey"（省份取脚本内 DEFAULT_PROV）

说明：调价窗口为「生效日前一天 24 时」，脚本已自动换算并同时显示两个日期；
      下轮涨跌幅度国家发改委公布后才有定论，脚本只呈现已生效的真实涨跌。

使用声明：仅供学习与交流，请勿转载与贩卖。

*******************************/

(function () {
  'use strict';

  /* ============ 可调参数 ============ */
  const DEFAULT_PROV = '江苏'; // 默认省份，不带“省”字；argument 留空时生效
  const KEYS = [
    // 天行 apikey 池，按顺序轮询，失败自动换下一个；建议换成自己申请的 key
    'a2bc7a0e01be908881ff752677cf94b7',
    '1bcc67c0114bc39a8818c8be12c2c9ac',
    '3c5ee42145c852de4147264f25b858dc',
    'd718b0f7c2b6d71cb3a9814e90bf847f',
    '231de491563c35731436829ac52aad43'
  ];
  const SHOW = ['p92', 'p95', 'p98', 'p0']; // 通知里展示的油品及顺序
  const SHOW_PCT = true; // 涨跌后附带百分比
  const SHOW_PREV = true; // 显示调价前价格（即“涨跌后的价格”对照）
  const SHOW_COUNTDOWN = true; // 显示距下次调价天数
  const SHOW_HISTORY = true; // 显示自建调价记录（从安装后开始累积）
  const HISTORY_MAX = 4; // 调价记录最多保留条数
  const ALERT_ON_CHANGE = true; // 检测到价格变动时标题加「已调价」
  const DEBUG = false; // true 时把接口原始返回打到日志
  /* ================================= */

  const GRADE = {
    p0: { name: '0号', full: '0号柴油' },
    p89: { name: '89号', full: '89号汽油' },
    p92: { name: '92号', full: '92号汽油' },
    p95: { name: '95号', full: '95号汽油' },
    p98: { name: '98号', full: '98号汽油' }
  };

  const STORE_KEY = 'oil_trend_cache_v1';
  const UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  let lastErr = null;

  main();

  /* ============ 主流程 ============ */
  function main() {
    const args = parseArgs(typeof $argument !== 'undefined' ? $argument : '');
    const prov = normProv(args.prov || DEFAULT_PROV);
    const keys = args.key ? [args.key].concat(KEYS) : KEYS;

    console.log('[oil] 省份=' + prov + '，key 数=' + keys.length);

    fetchMarket(prov, keys)
      .then(function (res) {
        renderMarket(prov, res);
      })
      .catch(function (e) {
        console.log('[oil] market 接口失败：' + e.message + '，降级 index');
        return fetchIndex(prov, keys)
          .then(function (res) {
            renderIndex(prov, res);
          })
          .catch(function (e2) {
            console.log('[oil] index 接口亦失败：' + e2.message);
            notify('油价获取失败', prov, '网络或 apikey 异常：' + e2.message);
          });
      })
      .then(
        function () {
          done({});
        },
        function () {
          done({});
        }
      );
  }

  /* ============ 请求 ============ */
  function fetchMarket(prov, keys) {
    return tryKeys(function (key) {
      return 'https://apis.tianapi.com/oilprice/market?key=' + key + '&prov=' + encodeURIComponent(prov);
    }, keys, 0, prov);
  }

  function fetchIndex(prov, keys) {
    return tryKeys(function (key) {
      return 'https://apis.tianapi.com/oilprice/index?key=' + key + '&prov=' + encodeURIComponent(prov);
    }, keys, 0, prov);
  }

  // 依次换 key 重试：密钥无效 / 次数不足 / 频率超限 / 网络错误 都会跳到下一个
  function tryKeys(build, keys, i, prov) {
    if (i >= keys.length) {
      return Promise.reject(lastErr || new Error('所有 apikey 均不可用'));
    }
    const url = build(keys[i]);
    return requestJSON(url).then(
      function (o) {
        if (o && Number(o.code) === 200 && o.result) {
          if (DEBUG) console.log('[oil] key#' + (i + 1) + ' 命中，result=' + JSON.stringify(o.result));
          return o.result;
        }
        const code = o && o.code;
        const msg = (o && o.msg) || '未知错误';
        console.log('[oil] key#' + (i + 1) + ' 返回 code=' + code + ' ' + msg);
        lastErr = new Error(
          Number(code) === 250 ? '省份「' + prov + '」暂无油价数据（' + msg + '）' : msg + '（code ' + code + '）'
        );
        return tryKeys(build, keys, i + 1, prov);
      },
      function (err) {
        console.log('[oil] key#' + (i + 1) + ' 网络异常：' + err);
        lastErr = new Error('网络异常：' + err);
        return tryKeys(build, keys, i + 1, prov);
      }
    );
  }

  function requestJSON(url) {
    return httpGet(url).then(function (txt) {
      let o;
      try {
        o = JSON.parse(txt);
      } catch (e) {
        throw new Error('返回内容非 JSON');
      }
      return o;
    });
  }

  function httpGet(url) {
    const opt = { url: url, headers: { 'User-Agent': UA, Accept: 'application/json' } };
    return new Promise(function (resolve, reject) {
      if (typeof $task !== 'undefined' && $task.fetch) {
        $task.fetch(opt).then(
          function (r) {
            resolve(r.body || r.bodyBytes || '');
          },
          function (e) {
            reject(new Error(String((e && (e.error || e.message)) || e)));
          }
        );
      } else if (typeof $httpClient !== 'undefined') {
        $httpClient.get(opt, function (err, resp, data) {
          if (err) {
            reject(new Error(String(err)));
          } else {
            resolve(data || '');
          }
        });
      } else if (typeof $httpAPI !== 'undefined') {
        $httpAPI('GET', url, { 'User-Agent': UA }, null, function (err, resp, data) {
          if (err) {
            reject(new Error(String(err)));
          } else {
            resolve(data || '');
          }
        });
      } else {
        reject(new Error('当前运行环境不支持网络请求'));
      }
    });
  }

  /* ============ 渲染：market（含调价趋势） ============ */
  function renderMarket(prov, r) {
    const lastD = parseYmd(r.last_adjusted);
    const nextD = parseYmd(r.next_adjustment);
    const windowD = nextD ? addDays(nextD, -1) : null; // 窗口日 = 生效日前一天 24 时

    const grades = SHOW.map(function (g) {
      const it = r[g];
      if (!it) return null;
      const price = num(it.price);
      if (!(price > 0)) return null; // 部分省份不发布 89 号，价格为 0 直接跳过
      const prev = num(it.previous_price);
      const delta = num(it.price_change);
      return {
        key: g,
        name: GRADE[g].name,
        price: price,
        prev: prev,
        delta: delta,
        pct: prev > 0 ? (delta / prev) * 100 : 0
      };
    }).filter(Boolean);

    if (!grades.length) {
      notify('油价数据异常', prov, '接口未返回价格，该省份可能无油价数据');
      return;
    }

    const cache = readCache();
    const rec = { d: fmtKey(lastD), price: grades[0].price, delta: grades[0].delta };
    const adjChanged = !!(cache && cache.adj && cache.adj !== rec.d);
    const priceChanged = adjChanged && Math.abs(num(cache.price) - rec.price) >= 0.005;
    const hist = mergeHistory(cache, rec, lastD);
    writeCache({ adj: rec.d, price: rec.price, hist: hist });

    const today = new Date();
    const left = nextD ? dayDiff(today, nextD) : null;
    const main = grades[0];

    /* --- 标题 / 副标题 --- */
    let title = prov + '油价';
    if (ALERT_ON_CHANGE) {
      if (priceChanged) title += ' · 已调价';
      else if (adjChanged) title += ' · 本轮搁浅';
    }
    let subtitle =
      main.name + ' ¥' + main.price.toFixed(2) + ' ' + trendArrow(main.delta) + Math.abs(main.delta).toFixed(2);
    if (nextD) {
      subtitle += '｜' + subNextText(windowD, left);
    }

    /* --- 正文 --- */
    const lines = [];
    grades.forEach(function (g) {
      let s = g.name + ' ¥' + g.price.toFixed(2) + ' ' + trendArrow(g.delta) + Math.abs(g.delta).toFixed(2);
      if (SHOW_PCT && g.pct) s += ' (' + (g.pct > 0 ? '+' : '') + g.pct.toFixed(1) + '%)';
      if (SHOW_PREV && g.prev > 0) s += ' 前¥' + g.prev.toFixed(2);
      lines.push(s);
    });

    if (lastD) {
      let s =
        '上次调价 ' +
        md(lastD) +
        ' 24时 · ' +
        trendWord(main.delta) +
        ' ' +
        Math.abs(main.delta).toFixed(2) +
        ' 元/升';
      if (main.prev > 0) s += '（' + main.name + ' ' + main.prev.toFixed(2) + '→' + main.price.toFixed(2) + '）';
      lines.push(s);
    }
    if (nextD) {
      lines.push(bodyNextText(windowD, nextD, left));
    }
    if (SHOW_HISTORY && hist.length >= 2) {
      lines.push(
        '近' +
          hist.length +
          '次：' +
          hist
            .slice(-HISTORY_MAX)
            .map(function (h) {
              return md(parseYmd(h.d)) + trendArrow(h.delta) + Math.abs(h.delta).toFixed(2);
            })
            .join(' ')
      );
    }
    if (r.time) lines.push('数据 ' + String(r.time).slice(0, 16));

    notify(title, subtitle, lines.join('\n'));
  }

  /* ============ 渲染：index（降级，无调价趋势） ============ */
  function renderIndex(prov, r) {
    const grades = SHOW.map(function (g) {
      const price = num(r[g]);
      return price > 0 ? { name: GRADE[g].name, price: price } : null;
    }).filter(Boolean);

    if (!grades.length) {
      notify('油价数据异常', prov, '接口未返回价格，该省份可能无油价数据');
      return;
    }
    const lines = grades.map(function (g) {
      return g.name + ' ¥' + g.price.toFixed(2);
    });
    if (r.time) lines.push('数据 ' + String(r.time).slice(0, 16));
    lines.push('当前 apikey 不支持调价趋势接口，仅显示现价');
    notify(prov + '油价', '调价趋势不可用', lines.join('\n'));
  }

  /* ============ 调价记录（本地累积） ============ */
  function mergeHistory(cache, rec, lastD) {
    let hist = (cache && Array.isArray(cache.hist) ? cache.hist : []).filter(function (h) {
      return h && h.d && h.d !== rec.d;
    });
    // 有明确的调价日期才记账，避免把接口抖动写成一次“调价”
    if (lastD) hist.push(rec);
    hist.sort(function (a, b) {
      return String(a.d).localeCompare(String(b.d));
    });
    return hist.slice(-HISTORY_MAX);
  }

  /* ============ 参数 ============ */
  function parseArgs(raw) {
    const out = { prov: '', key: '' };
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return out;
    s = s.replace(/^['"]|['"]$/g, '');
    if (s.indexOf('=') > -1) {
      s.split(/[&,;]/).forEach(function (kv) {
        const i = kv.indexOf('=');
        if (i < 0) return;
        const k = kv.slice(0, i).trim().toLowerCase();
        const v = kv.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
        if (k === 'prov' || k === 'province' || k === 'p') out.prov = v;
        if (k === 'key' || k === 'apikey' || k === 'token') out.key = v;
      });
    } else {
      out.prov = s;
    }
    return out;
  }

  function normProv(p) {
    return String(p == null ? '' : p)
      .trim()
      .replace(/^中国/, '')
      .replace(/(维吾尔自治区|回族自治区|壮族自治区|特别行政区|自治区|省|市)$/, '');
  }

  /* ============ 工具 ============ */
  function num(v) {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function parseYmd(s) {
    const t = String(s == null ? '' : s).replace(/[^0-9]/g, '');
    if (t.length < 8) return null;
    const y = Number(t.slice(0, 4));
    const m = Number(t.slice(4, 6));
    const d = Number(t.slice(6, 8));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function fmtKey(d) {
    if (!d) return '';
    return (
      d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2)
    );
  }

  function md(d) {
    if (!d) return '';
    const m = ('0' + (d.getMonth() + 1)).slice(-2);
    const dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + '-' + m + '-' + dd : m + '-' + dd;
  }

  function addDays(d, n) {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function dayDiff(a, b) {
    const x = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const y = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((y - x) / 86400000);
  }

  function trendArrow(v) {
    if (v > 0) return '↑';
    if (v < 0) return '↓';
    return '—';
  }

  function trendWord(v) {
    if (v > 0) return '上调';
    if (v < 0) return '下调';
    return '搁浅';
  }

  // 距调价窗口的天数文案：next_adjustment 为生效日，窗口是其前一天 24 时
  function subNextText(windowD, left) {
    if (!SHOW_COUNTDOWN || left === null || left === undefined) return '下次 ' + md(windowD) + ' 24时';
    if (left > 1) return '下次 ' + md(windowD) + ' 24时（剩 ' + left + ' 天）';
    if (left === 1) return '今晚 24 时调价';
    if (left === 0) return '本轮已调价';
    if (left < 0) return '调价日历待更新';
    return '下次 ' + md(windowD) + ' 24时';
  }

  function bodyNextText(windowD, nextD, left) {
    if (!SHOW_COUNTDOWN || left === null || left === undefined) {
      return '下次调价 ' + md(windowD) + ' 24时（' + md(nextD) + ' 生效）';
    }
    if (left > 1) {
      return '下次调价 ' + md(windowD) + ' 24时，剩 ' + left + ' 天（' + md(nextD) + ' 生效）';
    }
    if (left === 1) return '下次调价 今晚 24 时（' + md(nextD) + ' 生效）';
    if (left === 0) return '本轮调价 今日已生效（' + md(nextD) + '）';
    return '下轮调价日期待接口更新';
  }

  /* ============ 存储 ============ */
  function readCache() {
    try {
      const raw = storeRead(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(obj) {
    try {
      storeWrite(STORE_KEY, JSON.stringify(obj));
    } catch (e) {
      /* 忽略写入失败 */
    }
  }

  function storeRead(k) {
    if (typeof $persistentStore !== 'undefined') return $persistentStore.read(k);
    if (typeof $prefs !== 'undefined') return $prefs.valueForKey(k);
    if (typeof $cache !== 'undefined' && $cache.read) return $cache.read(k);
    return null;
  }

  function storeWrite(k, v) {
    if (typeof $persistentStore !== 'undefined') return $persistentStore.write(v, k);
    if (typeof $prefs !== 'undefined') return $prefs.setValueForKey(v, k);
    if (typeof $cache !== 'undefined' && $cache.write) return $cache.write(v, k);
    return false;
  }

  /* ============ 通知 / 结束 ============ */
  function notify(title, subtitle, body) {
    console.log('[oil] ' + title + ' | ' + subtitle + ' | ' + String(body).replace(/\n/g, ' / '));
    if (typeof $notification !== 'undefined' && $notification.post) {
      $notification.post(title, subtitle, body);
    } else if (typeof $notify !== 'undefined') {
      $notify(title, subtitle, body);
    }
  }

  function done(v) {
    if (typeof $done !== 'undefined') $done(v);
  }
})();
