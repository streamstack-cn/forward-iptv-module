WidgetMetadata = {
  id: "forward.iptv.v11",
  title: "IPTV 直播",
  version: "1.0.12",
  requiredVersion: "0.0.1",
  author: "StreamStack",
  site: "https://github.com/streamstack-cn/forward-iptv-module",
  description: "M3U 直播源，支持 HTTP/HTTPS 与 WebDAV 认证，附带 EPG 节目单。",
  detailCacheDuration: 0,
  globalParams: [
    { name: "m3uUrl", title: "M3U 订阅链接", type: "input", value: "" },
    { name: "username", title: "账号（选填）", type: "input", value: "" },
    { name: "password", title: "密码（选填）", type: "input", value: "" },
    { name: "epgUrl", title: "EPG 节目单链接", type: "input", value: "http://epg.112114.xyz/pp.xml" }
  ],
  modules: [
    {
      id: "loadResource",
      title: "直播流",
      functionName: "loadResource",
      type: "stream",
      cacheDuration: 0,
      params: []
    },
    {
      id: "loadList",
      title: "全部频道",
      functionName: "loadList",
      cacheDuration: 0,
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
var epgCache = { url: "", xml: "", channelMap: null };

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

function normalizeName(name) {
  return String(name || "")
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .toUpperCase();
}

function cleanProgramName(title) {
  if (!title) return "";
  return title
    .replace(/[-_]?\d{4}[-年]?\d{1,2}[-月]?\d{1,2}日?/g, "")
    .replace(/[-_]?\d{4}[-]\d{1,4}/g, "")
    .trim();
}

function withPlayToken(url) {
  if (!url) return url;
  var sep = url.indexOf("#") === -1 ? "#" : "&";
  return url + sep + "_fwd=" + Date.now();
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

async function getChannels(params, forceRefresh) {
  params = params || {};
  var key = getCacheKey(params.m3uUrl, params.username, params.password);
  if (!forceRefresh && m3uCache.key === key && m3uCache.data.length > 0) {
    return m3uCache.data;
  }

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
  if (!link) return null;
  if (link.indexOf("ch:") === 0) {
    try {
      return JSON.parse(decodeURIComponent(link.substring(3)));
    } catch (e) {
      return null;
    }
  }
  return null;
}

function buildParamsFromData(data) {
  return {
    m3uUrl: data.u,
    epgUrl: data.e,
    username: data.usr,
    password: data.pwd
  };
}

function channelFromData(data) {
  return {
    id: data.id || "",
    name: data.n || "",
    title: data.t || data.n || "未知频道",
    url: data.c || "",
    logo: data.l || "",
    group: data.g || "未分类"
  };
}

async function resolveChannel(data, forceRefresh) {
  var fallback = channelFromData(data);
  if (!data.u) return fallback;

  try {
    var params = buildParamsFromData(data);
    var channels = await getChannels(params, forceRefresh);
    for (var i = 0; i < channels.length; i++) {
      var c = channels[i];
      if (data.c && c.url === data.c) return c;
      if (data.id && c.id === data.id) return c;
      if (data.t && c.title === data.t) return c;
      if (data.n && c.name === data.n) return c;
    }
  } catch (e) {
    console.error("[resolveChannel]", e.message || e);
  }
  return fallback;
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
    mediaType: "movie",
    title: channel.title,
    coverUrl: channel.logo,
    posterPath: channel.logo,
    backdropPath: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
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

function parseEPGChannelMap(xml) {
  var map = {};
  var re = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/g;
  var match;
  while ((match = re.exec(xml)) !== null) {
    var id = match[1];
    var inner = match[2];
    var names = inner.match(/<display-name[^>]*>([^<]+)<\/display-name>/g);
    if (!names) continue;
    for (var i = 0; i < names.length; i++) {
      var nameMatch = names[i].match(/>([^<]+)</);
      if (nameMatch) map[normalizeName(nameMatch[1])] = id;
    }
    map[normalizeName(id)] = id;
  }
  return map;
}

function resolveEPGChannelIds(channelId, channelName, channelTitle, channelMap) {
  var ids = {};
  function addId(id) {
    if (id) ids[String(id)] = true;
  }

  addId(channelId);
  addId(channelName);
  addId(channelTitle);

  if (channelMap) {
    addId(channelMap[normalizeName(channelName)]);
    addId(channelMap[normalizeName(channelTitle)]);
    addId(channelMap[normalizeName(channelId)]);
  }

  var result = [];
  for (var key in ids) {
    if (ids[key]) result.push(key);
  }
  return result;
}

async function getEPGPrograms(epgUrl, channelId, channelName, channelTitle) {
  if (!epgUrl) return { current: null, upcoming: [], past: [] };

  try {
    var xml = "";
    var channelMap = null;
    if (epgCache.url === epgUrl && epgCache.xml) {
      xml = epgCache.xml;
      channelMap = epgCache.channelMap;
    } else {
      var res = await Widget.http.get(epgUrl, { allow_redirects: true });
      xml = res.data;
      channelMap = parseEPGChannelMap(xml);
      epgCache.url = epgUrl;
      epgCache.xml = xml;
      epgCache.channelMap = channelMap;
    }

    var targetIds = resolveEPGChannelIds(channelId, channelName, channelTitle, channelMap);
    var idLookup = {};
    for (var t = 0; t < targetIds.length; t++) {
      idLookup[targetIds[t]] = true;
    }

    var regex = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/g;
    var match;
    var programs = [];
    while ((match = regex.exec(xml)) !== null) {
      var attrs = match[1];
      var inner = match[2];
      var channelMatch = attrs.match(/channel="([^"]+)"/);
      if (!channelMatch || !idLookup[channelMatch[1]]) continue;

      var startM = attrs.match(/start="([^"\s]+)/);
      var stopM = attrs.match(/stop="([^"\s]+)/);
      var titleM = inner.match(/<title[^>]*>([^<]+)<\/title>/);
      if (startM && stopM && titleM) {
        programs.push({ start: startM[1], stop: stopM[1], title: titleM[1] });
      }
    }

    programs.sort(function(a, b) {
      return a.start.localeCompare(b.start);
    });

    var nowStr = getNowStr();
    var current = null;
    var upcoming = [];
    var past = [];

    for (var i = 0; i < programs.length; i++) {
      var p = programs[i];
      if (nowStr >= p.start && nowStr <= p.stop) {
        current = p;
      } else if (p.start > nowStr) {
        upcoming.push(p);
      } else {
        past.push(p);
      }
    }

    return { current: current, upcoming: upcoming, past: past };
  } catch (e) {
    console.error("[getEPGPrograms]", e.message || e);
    return { current: null, upcoming: [], past: [] };
  }
}

function getCurrentProgramTitle(epg) {
  if (epg.current && epg.current.title) return epg.current.title;
  if (epg.upcoming.length > 0 && epg.upcoming[0].title) return epg.upcoming[0].title;
  return "暂无节目信息";
}

function formatEPGDescription(channelTitle, groupName, epg) {
  var lines = [];

  lines.push("────────────────────────");
  lines.push("  " + channelTitle + "  ·  " + (groupName || "未分类"));
  lines.push("────────────────────────");
  lines.push("");

  if (epg.current) {
    var cTime = formatTime(epg.current.start) + " - " + formatTime(epg.current.stop);
    lines.push("[ LIVE ]  " + cTime);
    lines.push(cleanProgramName(epg.current.title));
    lines.push("");
  } else {
    lines.push("[ LIVE ]  当前时段暂无匹配节目");
    lines.push("");
  }

  if (epg.upcoming && epg.upcoming.length > 0) {
    lines.push("【即将播出】");
    var limit = Math.min(epg.upcoming.length, 15);
    for (var i = 0; i < limit; i++) {
      var p = epg.upcoming[i];
      lines.push("  " + formatTime(p.start) + "  " + cleanProgramName(p.title));
    }
    if (epg.upcoming.length > limit) {
      lines.push("  ... 还有 " + (epg.upcoming.length - limit) + " 档");
    }
    lines.push("");
  }

  if (epg.past && epg.past.length > 0) {
    lines.push("【已播出】");
    var pStart = Math.max(0, epg.past.length - 10);
    for (var j = pStart; j < epg.past.length; j++) {
      var p = epg.past[j];
      lines.push("  " + formatTime(p.start) + "  " + cleanProgramName(p.title));
    }
  }

  if (!epg.current && epg.upcoming.length === 0 && epg.past.length === 0) {
    lines.push("今日暂无节目单数据");
  }

  return lines.join("\n");
}

function buildDetailDescription(currentProgram, channelTitle, groupName, epg) {
  var header = "正在播放：" + cleanProgramName(currentProgram) + "\n\n查看节目单\n\n";
  return header + formatEPGDescription(channelTitle, groupName, epg);
}

async function loadResource(params) {
  params = params || {};
  var data = decodeLink(params.link);
  if (!data || !data.c) throw new Error("无法获取直播地址，请返回列表重新进入");

  var channel = await resolveChannel(data, false);
  var streamUrl = channel.url || data.c;
  if (!streamUrl) throw new Error("未找到该频道的直播地址");

  return [
    {
      name: channel.title || channel.name || "直播",
      description: (channel.group || "直播") + " · 实时流",
      url: withPlayToken(streamUrl)
    }
  ];
}

async function loadDetail(link) {
  var data = decodeLink(link);
  if (!data || !data.c) return null;

  try {
    var channel = await resolveChannel(data, false);
    if (!channel.url) channel.url = data.c;

    var epg = await getEPGPrograms(data.e, channel.id, channel.name, channel.title);
    var currentProgram = "暂无节目信息";
    if (epg && epg.current) currentProgram = cleanProgramName(epg.current.title);

    var description = buildDetailDescription(currentProgram, channel.title || channel.name, channel.group, epg);

    var params = buildParamsFromData(data);
    var relatedItems = [];
    try {
      var channels = await getChannels(params, false);
      for (var i = 0; i < channels.length; i++) {
        var c = channels[i];
        if (c.group !== channel.group) continue;
        if (c.url === channel.url) continue;
        relatedItems.push(buildChannelItem(c, params));
        if (relatedItems.length >= 12) break;
      }
    } catch (e) {
      relatedItems = [];
    }

    return {
      id: makeChannelId(channel),
      type: "url",
      mediaType: "movie",
      title: channel.title || channel.name,
      link: link,
      posterPath: channel.logo,
      backdropPath: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      playerType: "system",
      description: description,
      genreTitle: currentProgram,
      relatedItems: relatedItems
    };
  } catch (e) {
    console.error("[loadDetail]", e.message || e);
    var fallbackTitle = data.t || data.n || "直播";
    return {
      id: makeChannelId({ id: data.id, url: data.c }),
      type: "url",
      mediaType: "movie",
      title: fallbackTitle,
      link: link,
      posterPath: data.l,
      backdropPath: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      playerType: "system",
      description: "正在播放：暂无节目信息\n\n查看节目单",
      genreTitle: "未分类",
      relatedItems: []
    };
  }
}
