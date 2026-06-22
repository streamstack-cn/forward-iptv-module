const fs = require("fs");
const assert = require("assert/strict");

global.Widget = {
  http: {
    get: async (url) => {
      if (url.includes("m3u")) {
        return {
          data: `
#EXTM3U
#EXTINF:-1 tvg-id="1" tvg-name="CCTV1" tvg-logo="logo.png" group-title="央视",CCTV-1 综合
http://stream.cctv1
          `.trim()
        };
      }
      if (url.includes("e.xml")) {
        return {
          data: `
          <programme start="20260622080000 +0800" stop="20260622100000 +0800" channel="1">
            <title>Morning News</title>
          </programme>
          <programme start="20260622100000 +0800" stop="20260622235959 +0800" channel="1">
            <title>Test Program CCTV1</title>
          </programme>
        `
        };
      }
      return { data: "" };
    }
  }
};
global.WidgetMetadata = {};

eval(fs.readFileSync("./iptv.js", "utf8"));

(async () => {
  const params = { m3uUrl: "http://test/m3u", epgUrl: "http://test/e.xml" };
  const list = await loadList(params);
  const link = list[0].link;

  const detail = await loadDetail(link);
  assert.equal(detail.videoUrl, "http://stream.cctv1");
  assert.equal(detail.description.split("\n")[1], "节目单");

  const stream = await loadResource({ link: link });
  assert.equal(stream[0].url, "http://stream.cctv1");

  const fallback = await loadDetail(link.replace("ch:", "bad:"));
  assert.equal(fallback, null);

  const offlineLink = encodeLink({
    u: "",
    e: "http://test/e.xml",
    id: "9",
    n: "CCTV5",
    c: "http://stream.cctv5",
    g: "央视",
    l: "",
    t: "CCTV5"
  });
  const offlineDetail = await loadDetail(offlineLink);
  assert.equal(offlineDetail.videoUrl, "http://stream.cctv5");
  assert.ok(offlineDetail.description.includes("节目单"));

  console.log("✅ test pass!");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
