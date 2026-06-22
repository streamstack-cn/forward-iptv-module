WidgetMetadata = {
  id: "forward.iptv.v7",
  title: "IPTV 直播",
  version: "1.0.1",
  requiredVersion: "0.0.1",
  author: "StreamStack",
  site: "https://github.com/streamstack-cn/forward-iptv-module",
  description: "M3U 直播源，支持 HTTP/HTTPS 与 WebDAV 认证，附带 EPG 节目单。",
  detailCacheDuration: 300,
  globalParams: [
    { name: "m3uUrl", title: "M3U 订阅链接", type: "input", value: "" },
    { name: "username", title: "账号（选填）", type: "input", value: "" },
    { name: "password", title: "密码（选填）", type: "input", value: "" },
    { name: "epgUrl", title: "EPG 节目单链接", type: "input", value: "http://epg.51zmt.top:8000/e.xml" }
  ],
  modules: [
    {
      id: "loadList",
      title: "全部频道",
      functionName: "loadList",
      cacheDuration: 3600,
      params: []
    }
  ],
  search: {
    title: "搜索频道",
    functionName: "searchChannels",
    params: [{ name: "keyword", title: "关键词", type: "input" }]
  }
};

var m3uCache = { key: "", data: [] };
var epgCache = { url: "", xml: "" };

function parseM3U(content) {
  var lines = String(content || "").split(/\r?\n/);
  var channels = [];
  var currentInfo = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.indexOf("#EXTINF:") === 0) {
      var idMatch = line.match(/tvg-id="([^"]+)"/);
      var nameMatch = line.match(/tvg-name="([^"]+)"/);
      var logoMatch = line.match(/tvg-logo="([^"]+)"/);
      var groupMatch = line.match(/group-title="([^"]+)"/);
      var parts = line.split(",");
      var title = parts[parts.length - 1].trim();

      currentInfo = {
        id: idMatch ? idMatch[1] : "",
        name: nameMatch ? nameMatch[1] : "",
        logo: logoMatch ? logoMatch[1] : "",
        group: groupMatch ? groupMatch[1] : "未分类",
        title: title || (nameMatch ? nameMatch[1] : "未知频道")
      };
      if (!currentInfo.name) currentInfo.name = currentInfo.title;
    } else if (line.trim() !== "" && line.indexOf("#") !== 0) {
      if (currentInfo) {
        currentInfo.url = line.trim();
        channels.push(currentInfo);
        currentInfo = null;
      }
    }
  }
  return channels;
}

var b64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function btoa(input) {
  var str = String(input);
  var block;
  var charCode;
  var idx = 0;
  var map = b64Chars;
  var output = "";
  for (; str.charAt(idx | 0) || ((map = "="), idx % 1); output += map.charAt(63 & (block >> (8 - (idx % 1) * 8)))) {
    charCode = str.charCodeAt((idx += 3 / 4));
    if (charCode > 255) throw new Error("btoa failed");
    block = (block << 8) | charCode;
  }
  return output;
}

function getCacheKey(url, username, password) {
  return String(url || "") + "|" + String(username || "") + "|" + String(password || "");
}

async function fetchM3UContent(url, username, password) {
  if (!url) throw new Error("请先在模块设置中填写 M3U 订阅链接");
  if (url.indexOf("file://") === 0 || (url.indexOf("/") === 0 && url.indexOf("http") !== 0)) {
    throw new Error("M3U 仅支持 http(s):// 网络链接");
  }

  var requestUrl = url.replace(/ /g, "%20");
  var headers = {};
  if (username && password) {
    headers.Authorization = "Basic " + btoa(username + ":" + password);
  }

  var res = await Widget.http.get(requestUrl, { allow_redirects: true, headers: headers });
  var content = res.data;
  if (content && content.indexOf("#EXTM3U") === -1 && content.indexOf("<html") !== -1) {
    throw new Error("M3U 获取失败：返回的是网页而不是播放列表，请检查链接或账号密码");
  }
  return content;
}

async function getChannels(params) {
  params = params || {};
  var key = getCacheKey(params.m3uUrl, params.username, params.password);
  if (m3uCache.key === key && m3uCache.data.length > 0) return m3uCache.data;

  var content = await fetchM3UContent(params.m3uUrl, params.username, params.password);
  m3uCache.key = key;
  m3uCache.data = parseM3U(content);
  return m3uCache.data;
}

function makeChannelId(channel) {
  if (channel.id) return "epg_" + channel.id;
  return "url_" + encodeURIComponent(channel.url);
}

function encodeLink(data) {
  return "ch:" + encodeURIComponent(JSON.stringify(data));
}

function decodeLink(link) {
  if (!link || link.indexOf("ch:") !== 0) return null;
  try {
    return JSON.parse(decodeURIComponent(link.substring(3)));
  } catch (e) {
    return null;
  }
}

function buildChannelItem(channel, params) {
  var linkData = {
    u: params.m3uUrl,
    e: params.epgUrl,
    usr: params.username,
    pwd: params.password,
    id: channel.id,
    n: channel.name,
    c: channel.url,
    g: channel.group,
    l: channel.logo,
    t: channel.title
  };

  return {
    id: makeChannelId(channel),
    type: "url",
    title: channel.title,
    posterPath: channel.logo,
    description: channel.group,
    link: encodeLink(linkData)
  };
}

function filterChannels(channels, keyword) {
  var kw = String(keyword || "").trim().toLowerCase();
  if (!kw) return channels;
  return channels.filter(function(c) {
    return (
      String(c.title || "").toLowerCase().indexOf(kw) !== -1 ||
      String(c.name || "").toLowerCase().indexOf(kw) !== -1 ||
      String(c.group || "").toLowerCase().indexOf(kw) !== -1
    );
  });
}

async function loadList(params) {
  params = params || {};
  var channels = await getChannels(params);
  return channels.map(function(c) {
    return buildChannelItem(c, params);
  });
}

async function searchChannels(params) {
  params = params || {};
  var channels = await getChannels(params);
  return filterChannels(channels, params.keyword).map(function(c) {
    return buildChannelItem(c, params);
  });
}

function formatTime(str) {
  if (!str) return "";
  return str.substring(8, 10) + ":" + str.substring(10, 12);
}

function getNowStr() {
  var now = new Date();
  var cnDate = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }
  return (
    cnDate.getFullYear().toString() +
    pad(cnDate.getMonth() + 1) +
    pad(cnDate.getDate()) +
    pad(cnDate.getHours()) +
    pad(cnDate.getMinutes()) +
    pad(cnDate.getSeconds())
  );
}

async function getEPGText(epgUrl, channelId, channelName) {
  if (!epgUrl) return "未配置 EPG 节目单";
  try {
    var xml = "";
    if (epgCache.url === epgUrl && epgCache.xml) {
      xml = epgCache.xml;
    } else {
      var res = await Widget.http.get(epgUrl, { allow_redirects: true });
      xml = res.data;
      epgCache.url = epgUrl;
      epgCache.xml = xml;
    }

    var regex = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/g;
    var match;
    var programs = [];
    while ((match = regex.exec(xml)) !== null) {
      var attrs = match[1];
      var inner = match[2];
      var channelMatch = attrs.match(/channel="([^"]+)"/);
      if (!channelMatch) continue;

      var matched =
        (channelId && channelMatch[1] === channelId) ||
        (channelName && channelMatch[1] === channelName);
      if (!matched) continue;

      var startM = attrs.match(/start="([^"\s]+)/);
      var stopM = attrs.match(/stop="([^"\s]+)/);
      var titleM = inner.match(/<title[^>]*>([^<]+)<\/title>/);
      if (startM && stopM && titleM) {
        programs.push({ start: startM[1], stop: stopM[1], title: titleM[1] });
      }
    }

    if (programs.length === 0) return "今日暂无节目单（tvg-id: " + (channelId || "无") + "）";
    programs.sort(function(a, b) {
      return a.start.localeCompare(b.start);
    });

    var nowStr = getNowStr();
    return programs
      .map(function(p) {
        var playing = nowStr >= p.start && nowStr <= p.stop;
        return "[" + formatTime(p.start) + "] " + p.title + (playing ? " 👈 正在播出" : "");
      })
      .join("\n");
  } catch (e) {
    return "节目单加载失败";
  }
}

async function loadDetail(link) {
  var data = decodeLink(link);
  if (!data) return null;

  var params = {
    m3uUrl: data.u,
    epgUrl: data.e,
    username: data.usr,
    password: data.pwd
  };

  var epgText = await getEPGText(data.e, data.id, data.n);
  var episodeItems = [];

  try {
    var channels = await getChannels(params);
    episodeItems = channels.map(function(c) {
      return {
        id: makeChannelId(c),
        type: "url",
        title: c.title,
        videoUrl: c.url,
        posterPath: c.logo,
        description: c.group
      };
    });
  } catch (e) {
    episodeItems = [
      {
        id: makeChannelId({ id: data.id, url: data.c }),
        type: "url",
        title: data.t || data.n,
        videoUrl: data.c,
        posterPath: data.l
      }
    ];
  }

  return {
    id: makeChannelId({ id: data.id, url: data.c }),
    type: "url",
    title: data.t || data.n,
    link: link,
    posterPath: data.l,
    videoUrl: data.c,
    playerType: "system",
    description: "分组: " + (data.g || "未分类") + "\n\n节目单:\n" + epgText,
    episodeItems: episodeItems
  };
}
