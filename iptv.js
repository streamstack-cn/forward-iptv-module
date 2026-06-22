WidgetMetadata = {
  id: "forward.iptv.custom",
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
  const lines = content.split(/\r?\n/);
  const channels = [];
  let currentInfo = null;

  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      currentInfo = {
        id: line.match(/tvg-id="([^"]+)"/)?.[1] || "",
        name: line.match(/tvg-name="([^"]+)"/)?.[1] || "",
        logo: line.match(/tvg-logo="([^"]+)"/)?.[1] || "",
        group: line.match(/group-title="([^"]+)"/)?.[1] || "未分类",
        title: line.split(',').pop().trim()
      };
      if (!currentInfo.name) currentInfo.name = currentInfo.title;
    } else if (line.trim() && !line.startsWith('#')) {
      if (currentInfo) {
        channels.push({ ...currentInfo, url: line.trim() });
        currentInfo = null;
      }
    }
  }
  return channels;
}

async function getChannels(url) {
  if (!url) throw new Error("请在模块设置中配置 M3U 订阅链接");
  if (m3uCache.url === url && m3uCache.data.length > 0) return m3uCache.data;
  const res = await Widget.http.get(url, { allow_redirects: true });
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

async function loadList(params = {}) {
  const channels = await getChannels(params.m3uUrl);
  const groups = {};
  channels.forEach(c => {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });
  
  return Object.keys(groups).map(g => {
    return {
      id: `group_${encodeURIComponent(g)}`,
      type: "url", 
      title: g,
      mediaType: "tv",
      childItems: groups[g].map(c => {
         const linkData = { u: params.m3uUrl, e: params.epgUrl, id: c.id, n: c.name, c: c.url, g: c.group, l: c.logo, t: c.title };
         return {
           id: `channel_${encodeURIComponent(c.url)}`,
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
  return `${str.substring(8, 10)}:${str.substring(10, 12)}`;
}

async function getEPGInfo(epgUrl, channelId) {
  if (!epgUrl || !channelId) return { text: "未配置 EPG 或未匹配到台标 ID" };
  try {
    let xml = "";
    if (epgCache.url === epgUrl && epgCache.xml) {
      xml = epgCache.xml;
    } else {
      const res = await Widget.http.get(epgUrl, { allow_redirects: true });
      xml = res.data;
      epgCache.url = epgUrl;
      epgCache.xml = xml;
    }
    const regex = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/g;
    let match;
    const programs = [];
    while ((match = regex.exec(xml)) !== null) {
      const cMatch = match[1].match(/channel="([^"]+)"/);
      if (cMatch && cMatch[1] === channelId) {
        const startM = match[1].match(/start="([^"\s]+)/);
        const stopM = match[1].match(/stop="([^"\s]+)/);
        const titleM = match[2].match(/<title[^>]*>([^<]+)<\/title>/);
        if (startM && stopM && titleM) programs.push({ start: startM[1], stop: stopM[1], title: titleM[1] });
      }
    }
    if (programs.length === 0) return { text: "今日暂无节目单" };
    programs.sort((a, b) => a.start.localeCompare(b.start));

    const now = new Date();
    const cnDate = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
    const nowStr = cnDate.getFullYear().toString() + (cnDate.getMonth()+1).toString().padStart(2, '0') + cnDate.getDate().toString().padStart(2, '0') + cnDate.getHours().toString().padStart(2, '0') + cnDate.getMinutes().toString().padStart(2, '0') + cnDate.getSeconds().toString().padStart(2, '0');

    let lines = programs.map(p => `[${formatTime(p.start)}] ${p.title} ${(nowStr >= p.start && nowStr <= p.stop) ? "👈 正在播出" : ""}`);
    return { text: lines.join("\n") };
  } catch(e) {
    return { text: "节目单加载失败" };
  }
}

async function loadDetail(link) {
  if (!link.startsWith("iptv:")) return null;
  const data = decodeLink(link);
  const epg = await getEPGInfo(data.e, data.id);
  
  let episodeItems = [];
  try {
    const channels = await getChannels(data.u);
    const siblings = channels.filter(c => c.group === data.g);
    episodeItems = siblings.map(c => ({
      id: `channel_${encodeURIComponent(c.url)}`,
      title: c.title,
      videoUrl: c.url,
      posterPath: c.logo
    }));
  } catch(e) {
    episodeItems = [{ id: `channel_${encodeURIComponent(data.c)}`, title: data.t || data.n, videoUrl: data.c, posterPath: data.l }];
  }

  return {
    id: `channel_${encodeURIComponent(data.c)}`,
    type: "url",
    title: data.t || data.n,
    link: link,
    posterPath: data.l,
    videoUrl: data.c,
    description: epg.text,
    episodeItems: episodeItems
  };
}
