WidgetMetadata = {
  id: "forward.iptv.v3",
  title: "IPTV 直播",
  version: "1.0.0",
  requiredVersion: "0.0.1",
  author: "StreamStack",
  site: "https://github.com/streamstack-cn",
  description: "支持 EPG 和分组的 M3U 直播源。",
  modules: [
    {
      id: "loadList",
      title: "全部频道",
      functionName: "loadList",
      params: [
        { name: "m3uUrl", title: "M3U 订阅链接", type: "input", value: "http://your-server-ip/iptv.m3u" },
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

async function getChannels(url) {
  if (!url) throw new Error("请在模块设置中配置 M3U 订阅链接");
  if (m3uCache.url === url && m3uCache.data.length > 0) return m3uCache.data;
  var res = await Widget.http.get(url, { allow_redirects: true });
  m3uCache.data = parseM3U(res.data);
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
  var channels = await getChannels(params.m3uUrl);
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
      childItems: groups[g].map(function(c) {
         var linkData = { u: params.m3uUrl, e: params.epgUrl, id: c.id, n: c.name, c: c.url, g: c.group, l: c.logo, t: c.title };
         return {
           id: "channel_" + encodeURIComponent(c.url),
           type: "url",
           title: c.title,
           posterPath: c.logo,
           link: encodeLink(linkData)
         };
      })
    };
  });
}

function formatTime(str) {
  if (!str) return "";
  return str.substring(8, 10) + ":" + str.substring(10, 12);
}

async function getEPGInfo(epgUrl, channelId) {
  if (!epgUrl || !channelId) return { text: "未配置 EPG 或未匹配到台标 ID" };
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
  var epg = await getEPGInfo(data.e, data.id);
  
  var episodeItems = [];
  try {
    var channels = await getChannels(data.u);
    var siblings = channels.filter(function(c) { return c.group === data.g; });
    episodeItems = siblings.map(function(c) {
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
