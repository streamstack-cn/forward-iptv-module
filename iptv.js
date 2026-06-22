WidgetMetadata = {
  id: "forward.iptv.v4",
  title: "IPTV 直播",
  version: "1.0.0",
  requiredVersion: "0.0.1",
  author: "StreamStack",
  site: "https://github.com/streamstack-cn",
  description: "支持 EPG 和分组的 M3U 直播源。支持普通的 HTTP(S) 订阅链接，也支持带 Basic Auth 认证的 WebDAV 链接。",
  modules: [
    {
      id: "loadList",
      title: "全部频道",
      functionName: "loadList",
      params: [
        { name: "m3uUrl", title: "M3U 订阅链接", type: "input", value: "", description: "例如 http://.../iptv.m3u" },
        { name: "username", title: "WebDAV 账号", type: "input", value: "", description: "选填，如果 M3U 链接需要账号认证则填写" },
        { name: "password", title: "WebDAV 密码", type: "input", value: "", description: "选填，如果 M3U 链接需要账号认证则填写" },
        { name: "epgUrl", title: "EPG 节目单链接", type: "input", value: "http://epg.51zmt.top:8000/e.xml" }
      ]
    }
  ]
};

var m3uCache = { url: "", data: [] };
var epgCache = { url: "", xml: "" };

function parseM3U(content) {
  var lines = content.split(/\r?\n/);
  var channels = [];
  var currentInfo = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.indexOf('#EXTINF:') === 0) {
      var idMatch = line.match(/tvg-id="([^"]+)"/);
      var nameMatch = line.match(/tvg-name="([^"]+)"/);
      var logoMatch = line.match(/tvg-logo="([^"]+)"/);
      var groupMatch = line.match(/group-title="([^"]+)"/);
      var parts = line.split(',');
      var title = parts[parts.length - 1].trim();

      currentInfo = {
        id: idMatch ? idMatch[1] : "",
        name: nameMatch ? nameMatch[1] : "",
        logo: logoMatch ? logoMatch[1] : "",
        group: groupMatch ? groupMatch[1] : "未分类",
        title: title
      };
      if (!currentInfo.name) {
        currentInfo.name = currentInfo.title;
      }
    } else if (line.trim() !== "" && line.indexOf('#') !== 0) {
      if (currentInfo) {
        currentInfo.url = line.trim();
        channels.push(currentInfo);
        currentInfo = null;
      }
    }
  }
  return channels;
}

var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
function btoa(input) {
  var str = String(input);
  for (var block, charCode, idx = 0, map = chars, output = ''; str.charAt(idx | 0) || (map = '=', idx % 1); output += map.charAt(63 & block >> 8 - idx % 1 * 8)) {
    charCode = str.charCodeAt(idx += 3/4);
    if (charCode > 0xFF) {
      throw new Error("'btoa' failed");
    }
    block = block << 8 | charCode;
  }
  return output;
}

async function getChannels(url, username, password) {
  if (!url) throw new Error("请在模块设置中配置 M3U 订阅链接");
  if (m3uCache.url === url && m3uCache.data.length > 0) return m3uCache.data;
  
  var content = "";
  if (url.indexOf("file://") === 0 || url.indexOf("/") === 0) {
    throw new Error("M3U 当前只支持填写网络链接");
  } else {
    var encodeUrl = url.replace(/ /g, "%20");
    var headers = {};
    if (username && password) {
       headers["Authorization"] = "Basic " + btoa(username + ":" + password);
    }
    var res = await Widget.http.get(encodeUrl, { allow_redirects: true, headers: headers });
    content = res.data;
  }
  
  if (content && content.indexOf('#EXTM3U') === -1 && content.indexOf('<html') !== -1) {
    throw new Error("M3U 获取失败：返回了网页。可能需要账号密码认证或下载链接不正确。");
  }
  
  m3uCache.data = parseM3U(content);
  m3uCache.url = url;
  return m3uCache.data;
}

function encodeLink(data) {
  return "iptv:" + encodeURIComponent(JSON.stringify(data));
}
function decodeLink(link) {
  return JSON.parse(decodeURIComponent(link.split(":")[1]));
}

async function loadList(params) {
  if (!params) params = {};
  var channels = await getChannels(params.m3uUrl, params.username, params.password);
  var groups = {};
  channels.forEach(function(c) {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });
  
  return Object.keys(groups).map(function(g) {
    return {
      id: "group_" + encodeURIComponent(g),
      type: "url", 
      title: g,
      mediaType: "tv",
      // Forward 要求顶层列表项目如果是文件夹/分组形式，且可以直接点击进入的话，不需要用 childItems。
      // 因为如果用了 childItems，在没有提供 `loadDetail` 的情况下，App会认为这是一个自带子列表的复杂对象。
      // 为了支持“频道收藏”以及更好的节目单显示，我们把每一个分组视作一个 url item，它的 link 跳转到自己特制的路由中
      link: encodeLink({ action: "group", u: params.m3uUrl, usr: params.username, pwd: params.password, e: params.epgUrl, g: g })
    };
  });
}

function formatTime(str) {
  if (!str) return "";
  return str.substring(8, 10) + ":" + str.substring(10, 12);
}

async function getEPGInfo(epgUrl, channelId) {
  if (!epgUrl || !channelId) return { text: "未配置 EPG" };
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
      var cMatch = match[1].match(/channel="([^"]+)"/);
      if (cMatch && cMatch[1] === channelId) {
        var startM = match[1].match(/start="([^"\s]+)/);
        var stopM = match[1].match(/stop="([^"\s]+)/);
        var titleM = match[2].match(/<title[^>]*>([^<]+)<\/title>/);
        if (startM && stopM && titleM) {
          programs.push({ start: startM[1], stop: stopM[1], title: titleM[1] });
        }
      }
    }
    if (programs.length === 0) return { text: "今日暂无节目单" };
    programs.sort(function(a, b) {
      return a.start.localeCompare(b.start);
    });

    var now = new Date();
    var cnDate = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
    
    function pad(n) { return n < 10 ? '0' + n : n; }
    var nowStr = cnDate.getFullYear().toString() + 
                 pad(cnDate.getMonth() + 1) + 
                 pad(cnDate.getDate()) + 
                 pad(cnDate.getHours()) + 
                 pad(cnDate.getMinutes()) + 
                 pad(cnDate.getSeconds());

    var lines = programs.map(function(p) {
      var isPlaying = (nowStr >= p.start && nowStr <= p.stop);
      return "[" + formatTime(p.start) + "] " + p.title + (isPlaying ? " 👈 正在播出" : "");
    });
    return { text: lines.join("\n") };
  } catch(e) {
    return { text: "节目单加载失败" };
  }
}

async function loadDetail(link) {
  if (link.indexOf("iptv:") !== 0) return null;
  var data = decodeLink(link);
  
  // 处理点击分组的情况（第一层下钻）
  if (data.action === "group") {
    var channels = await getChannels(data.u, data.usr, data.pwd);
    var siblings = channels.filter(function(c) { return c.group === data.g; });
    var items = siblings.map(function(c) {
       var linkData = { action: "play", u: data.u, e: data.e, usr: data.usr, pwd: data.pwd, id: c.id, n: c.name, c: c.url, g: c.group, l: c.logo, t: c.title };
       return {
         id: "channel_" + encodeURIComponent(c.url),
         type: "url",
         title: c.title,
         posterPath: c.logo,
         link: encodeLink(linkData)
       };
    });
    return items; // loadDetail 可以直接返回 VideoItem 数组用于构建子列表
  }
  
  // 处理点击具体频道播放的情况
  if (data.action === "play") {
    var epg = await getEPGInfo(data.e, data.id);
    var episodeItems = [];
    try {
      var allChannels = await getChannels(data.u, data.usr, data.pwd);
      var currentGroupChannels = allChannels.filter(function(c) { return c.group === data.g; });
      episodeItems = currentGroupChannels.map(function(c) {
        return {
          id: "channel_" + encodeURIComponent(c.url),
          title: c.title,
          videoUrl: c.url,
          posterPath: c.logo
        };
      });
    } catch(e) {
      episodeItems = [{ 
        id: "channel_" + encodeURIComponent(data.c), 
        title: data.t || data.n, 
        videoUrl: data.c, 
        posterPath: data.l 
      }];
    }

    return {
      id: "channel_" + encodeURIComponent(data.c),
      type: "url",
      title: data.t || data.n,
      link: link,
      posterPath: data.l,
      videoUrl: data.c,
      description: epg.text,
      episodeItems: episodeItems
    };
  }
  
  return null;
}
